import { afterEach, describe, expect, it, vi } from 'vitest'

import { setLayerSubtreeVisibility } from '../../src/features/layers/layer-subtree-visibility'
import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import { getCoverageDeviceFeatureNodeId } from '../../src/features/layers/layer-catalog-ids'
import {
  selectCoverageChunkKeys,
  useCoverageFilterStore,
} from '../../src/features/tracking/coverage-filter-store'
import type { CoverageManifest } from '../../src/infrastructure/mission-store/tauri-mission-store'

afterEach(() => {
  useCoverageFilterStore.getState().resetMission(null)
})

describe('coverage filter state [DON-275]', () => {
  it('filters the claim denominator without any catalog/store write', async () => {
    const manifest = createManifest()
    const filters = useCoverageFilterStore.getState()
    filters.resetMission('mission-1')
    filters.reconcile('mission-1', manifest)
    const root = buildLayerCatalogTree({
      missionId: 'mission-1', devices: [], markers: [], drawings: [], helicopters: [],
      gpxImports: [], measurements: [], metadataEntries: [],
      coverage: {
        devices: [
          { deviceId: 'device-1', label: 'Team Alpha', visible: true },
          { deviceId: 'device-2', label: 'Team Bravo', visible: true },
        ],
        periods: [{ periodKey: 'outing\u0000outing-1', label: 'Sweep 1', visible: true }],
      },
    })
    const setNodeVisibilities = vi.fn()

    await setLayerSubtreeVisibility({
      root,
      controller: { setNodeVisibilities } as never,
      nodeId: getCoverageDeviceFeatureNodeId('device-2'),
      visible: false,
    })

    expect(setNodeVisibilities).not.toHaveBeenCalled()
    expect(useCoverageFilterStore.getState().omittedDeviceIds).toEqual(['device-2'])
    expect(selectCoverageChunkKeys(manifest, useCoverageFilterStore.getState()))
      .toEqual([manifest.chunks[0]!.key])
  })

  it('resets omissions at the mission identity fence', () => {
    const store = useCoverageFilterStore.getState()
    store.resetMission('mission-1')
    store.setDeviceVisibility('device-1', false)
    store.setPeriodVisibility('outing\u0000outing-1', false)

    useCoverageFilterStore.getState().resetMission('mission-2')

    expect(useCoverageFilterStore.getState()).toMatchObject({
      missionId: 'mission-2', omittedDeviceIds: [], omittedPeriodKeys: [],
    })
  })
})

function createManifest(): CoverageManifest {
  return {
    changeSeq: 1, enumerated: true, pendingInvalidation: false,
    backfillIncomplete: false,
    outings: [{
      id: 'outing-1', label: 'Sweep 1',
      started_at: '2026-08-24T10:00:00.000Z', ended_at: null,
    }],
    chunks: ['device-1', 'device-2'].map((deviceId) => ({
      key: { device_id: deviceId, period_kind: 'outing' as const, period_id: 'outing-1' },
      contentRev: 1, builtRev: 1, fixCount: 1, exactCount: 1, fixDigest: 'digest',
    })),
  }
}
