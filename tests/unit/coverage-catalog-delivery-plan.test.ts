import { describe, expect, it } from 'vitest'

import { createCoverageCatalogDeliveryBatches } from '../../src/features/tracking/coverage-catalog-delivery-plan'
import type {
  CoverageManifest,
  CoverageManifestChunk,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('coverage catalog delivery plan [DON-276]', () => {
  it('keeps a delivered open-outing period until its cooled-down replacement is ready', () => {
    const open = chunk('outing', 'open-outing', 2)
    const unassigned = chunk('unassigned', '', 2)
    const current = manifest([open, unassigned])

    const batches = createCoverageCatalogDeliveryBatches({
      manifest: current,
      priorManifest: current,
      priorDelivered: {
        [identity(open)]: 1,
        [identity(unassigned)]: 1,
      },
      retainDelivery: true,
      orderedPending: [unassigned],
    })

    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual([open, unassigned])
  })

  it('does not invent retained geometry for an identity that was never delivered', () => {
    const open = chunk('outing', 'open-outing', 2)
    const unassigned = chunk('unassigned', '', 2)
    const current = manifest([open, unassigned])

    const batches = createCoverageCatalogDeliveryBatches({
      manifest: current,
      priorManifest: current,
      priorDelivered: {
        [identity(open)]: 0,
        [identity(unassigned)]: 1,
      },
      retainDelivery: true,
      orderedPending: [unassigned],
    })

    expect(batches[0]).toEqual([unassigned])
  })
})

function manifest(chunks: readonly CoverageManifestChunk[]): CoverageManifest {
  return {
    changeSeq: 2,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    outings: [{
      id: 'open-outing',
      label: 'Open outing',
      started_at: '2026-08-26T00:00:00.000Z',
      ended_at: null,
    }],
    chunks,
  }
}

function chunk(
  periodKind: 'outing' | 'unassigned',
  periodId: string,
  contentRev: number,
): CoverageManifestChunk {
  return {
    key: { device_id: 'device-1', period_kind: periodKind, period_id: periodId },
    contentRev,
    builtRev: 1,
    fixCount: 5,
    exactCount: 6,
    fixDigest: 'digest-old',
  }
}

function identity(chunkValue: CoverageManifestChunk): string {
  const key = chunkValue.key
  return `${key.device_id}\u0000${key.period_kind}\u0000${key.period_id}`
}
