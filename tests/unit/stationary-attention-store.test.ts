import { beforeEach, describe, expect, it } from 'vitest'

import { useStationaryAttentionStore } from '../../src/features/tracking/stationary-attention-store'
import type { NormalizedTrackingPosition, TrackingSnapshot } from '../../src/features/tracking/tracking-types'

describe('stationary attention store [DON-269]', () => {
  beforeEach(() => useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState()))

  it('recomputes from hydrated accepted history and keeps acknowledgement presentation-only', () => {
    const snapshot = createSnapshot([fix('a', 0, 52), fix('b', 20, 52.00001)])
    useStationaryAttentionStore.getState().applySnapshot(snapshot)
    expect(useStationaryAttentionStore.getState().byDevice['device-1']).toMatchObject({ state: 'attention', acknowledged: false })

    useStationaryAttentionStore.getState().acknowledge('device-1')
    useStationaryAttentionStore.getState().applySnapshot(snapshot)
    expect(useStationaryAttentionStore.getState().byDevice['device-1']).toMatchObject({ state: 'attention', acknowledged: true })

    useStationaryAttentionStore.getState().applySnapshot(createSnapshot([fix('a', 0, 52), fix('moved', 21, 52.001)]))
    expect(useStationaryAttentionStore.getState().byDevice['device-1']).toMatchObject({ state: 'none', acknowledged: false })
  })

  it('replaces state on mission change so stale mission attention is ignored', () => {
    useStationaryAttentionStore.getState().applySnapshot(createSnapshot([fix('a', 0, 52), fix('b', 20, 52)]), 'mission-1')
    useStationaryAttentionStore.getState().applySnapshot(createSnapshot([fix('single', 30, 52)]), 'mission-2')
    expect(useStationaryAttentionStore.getState().missionId).toBe('mission-2')
    expect(useStationaryAttentionStore.getState().byDevice['device-1']?.state).toBe('insufficient-data')
  })

  it('recomputes stationary attention from restored fixes with empty source identities', () => {
    useStationaryAttentionStore.getState().applySnapshot(
      createSnapshot([fix('', 0, 52), fix('', 15, 52.00001), fix('', 25, 52.00001)]),
      'mission-restored',
    )

    expect(useStationaryAttentionStore.getState().byDevice['device-1']).toMatchObject({
      state: 'attention',
      acknowledged: false,
    })
  })

  it('evaluates only the mission-active device set when one is selected', () => {
    const deviceTwoFixes = [
      { ...fix('two-a', 0, 52), device_id: 'device-2' },
      { ...fix('two-b', 20, 52), device_id: 'device-2' },
    ]
    const snapshot: TrackingSnapshot = {
      devices: [
        ...createSnapshot([]).devices,
        {
          device_id: 'device-2', name: 'Two', status: 'online', last_seen: null,
          unique_id: null, category: null,
        },
      ],
      positions: [fix('one-b', 20, 52), deviceTwoFixes[1]!],
      breadcrumbs: [fix('one-a', 0, 52), fix('one-b', 20, 52), ...deviceTwoFixes],
    }

    useStationaryAttentionStore.getState().applySnapshot(
      snapshot,
      'mission-1',
      ['device-1'],
    )

    expect(Object.keys(useStationaryAttentionStore.getState().byDevice)).toEqual(['device-1'])
  })

  it('does not rebuild stationary policy state for repeated identical evidence snapshots', () => {
    const snapshot = createSnapshot([fix('a', 0, 52), fix('b', 20, 52.00001)])
    let publicationCount = 0
    const unsubscribe = useStationaryAttentionStore.subscribe(() => {
      publicationCount += 1
    })

    useStationaryAttentionStore.getState().applySnapshot(snapshot, 'mission-1')
    useStationaryAttentionStore.getState().applySnapshot(snapshot, 'mission-1')
    unsubscribe()

    expect(publicationCount).toBe(1)
  })
})

function createSnapshot(fixes: readonly NormalizedTrackingPosition[]): TrackingSnapshot {
  return { devices: [{ device_id: 'device-1', name: 'One', status: 'online', last_seen: null, unique_id: null, category: null }], positions: fixes.slice(-1), breadcrumbs: fixes }
}

function fix(id: string, minutes: number, lat: number): NormalizedTrackingPosition {
  return { id, device_id: 'device-1', lat, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: 4, timestamp: new Date(Date.parse('2026-08-22T10:00:00.000Z') + minutes * 60_000).toISOString(), source: 'osmand', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false }
}
