import { describe, expect, it } from 'vitest'

import type {
  CoverageManifest,
  CoverageManifestChunk,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { createCoverageScheduler } from '../../src/features/tracking/coverage-scheduler'

describe('coverage build fairness [DON-276]', () => {
  it('lets every closed period run while an open outing is continuously dirtied', () => {
    let now = 1_000
    const scheduler = createCoverageScheduler({ now: () => now, openOutingCooldownMs: 30_000 })
    const manifest = createManifest()
    const pending = new Map(manifest.chunks.map((chunk) => [chunk.key.period_id, chunk]))
    const deliveredClosed: string[] = []

    for (let cycle = 0; cycle < 13; cycle += 1) {
      const queue = scheduler.order(manifest, [...pending.values()])
      const next = queue[0]
      expect(next).toBeDefined()
      scheduler.recordAttempt(next!)
      if (next!.key.period_id !== 'open') {
        pending.delete(next!.key.period_id)
        deliveredClosed.push(next!.key.period_id)
      }
      now += 1_000
    }

    expect(deliveredClosed).toHaveLength(12)
    expect(new Set(deliveredClosed).size).toBe(12)
  })

  it('orders newest periods first and devices round-robin within each period', () => {
    const scheduler = createCoverageScheduler({ now: () => 10_000, openOutingCooldownMs: 30_000 })
    const manifest = createManifest(['device-b', 'device-a'])

    expect(scheduler.order(manifest, manifest.chunks).slice(0, 4).map((chunk) => [
      chunk.key.period_id, chunk.key.device_id,
    ])).toEqual([
      ['open', 'device-a'], ['open', 'device-b'],
      ['closed-12', 'device-a'], ['closed-12', 'device-b'],
    ])
  })

  it('does not return an open-outing chunk again until its cooldown expires', () => {
    let now = 1_000
    const scheduler = createCoverageScheduler({ now: () => now, openOutingCooldownMs: 30_000 })
    const manifest = createManifest()
    const openChunk = manifest.chunks.find((chunk) => chunk.key.period_id === 'open')!

    scheduler.recordAttempt(openChunk)

    expect(scheduler.order(manifest, [openChunk])).toEqual([])
    now += 29_999
    expect(scheduler.order(manifest, [openChunk])).toEqual([])
    now += 1
    expect(scheduler.order(manifest, [openChunk])).toEqual([openChunk])
  })
})

function createManifest(deviceIds: readonly string[] = ['device-a']): CoverageManifest {
  const outings = [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `closed-${index + 1}`,
      label: `Closed ${index + 1}`,
      started_at: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
      ended_at: new Date(Date.UTC(2026, 7, index + 1, 1)).toISOString(),
    })),
    {
      id: 'open', label: 'Open',
      started_at: '2026-08-20T00:00:00.000Z', ended_at: null,
    },
  ]
  const chunks: CoverageManifestChunk[] = outings.flatMap((outing) =>
    deviceIds.map((deviceId) => ({
      key: { device_id: deviceId, period_kind: 'outing' as const, period_id: outing.id },
      contentRev: 1,
      builtRev: null,
      fixCount: null,
      exactCount: 1,
      fixDigest: null,
    })))
  return {
    changeSeq: 1,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    outings,
    chunks,
  }
}
