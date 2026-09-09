import { describe, expect, it, vi } from 'vitest'
import { loadReplayMap } from '../../src/features/mission-review/load-replay-map'
import type { MissionReplayReadResult } from '../../src/infrastructure/mission-store/tauri-mission-store'

/** Creates a complete empty evidence snapshot for loader boundary tests. */
function emptyReplay(): MissionReplayReadResult {
  return { missionId: 'm', selectedTime: '2026-09-09T10:00:00.000Z', replayGeneration: 0, timezone: 'Europe/Dublin',
    tracks: [], objects: [], totalTrackCount: 0, totalObjectCount: 0, objectTypeCounts: {},
    trackCursor: '0', objectCursor: '0', nextCursor: null, previousCursor: null, nextObjectCursor: null,
    availableDeviceIds: [], availableOutingIds: [], deviceFilterIds: [], outingFilterIds: [], staticGpxEvidence: [],
    staticGpxPointCount: 0, progress: 1, limitations: [] }
}

describe('replay map loading [DON-215]', () => {
  it('rejects prematurely terminated geometry instead of accepting truncated retained state', async () => {
    const object = { object_type: 'drawing', object_id: 'd', version_sequence: 1, operation: 'created', recorded_at: '2026-09-09T09:00:00Z', effective_at: '2026-09-09T09:00:00Z', state: { _state_details_omitted: true } } as MissionReplayReadResult['objects'][number]
    const publish = vi.fn()
    const first = { ...emptyReplay(), objects: [object], totalObjectCount: 1 }
    await loadReplayMap({ first, store: { readMissionReplayObjectChunk: async () => ({ ...first, objectDetails: {
      objectType: 'drawing', objectId: 'd', versionSequence: 1, offset: 0, fragment: '{}', totalCharacters: 100, nextOffset: null,
    } }) }, requestId: () => 'r', isCurrent: () => true, publish, project: async () => ({ blob: new Blob(), bounds: null }) })
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }))
  })
  it('does not claim ready when a page chain omits required evidence', async () => {
    const publish = vi.fn()
    await loadReplayMap({ first: { ...emptyReplay(), totalObjectCount: 1 }, store: {}, requestId: () => 'request', isCurrent: () => true, publish })
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', data: null }))
  })
  it('retains evidence limitations even after all available pages load', async () => {
    const publish = vi.fn()
    await loadReplayMap({ first: { ...emptyReplay(), limitations: [{ code: 'legacy', message: 'History unknown' }] }, store: {}, requestId: () => 'request', isCurrent: () => true, publish,
      project: async () => ({ blob: new Blob(), bounds: null }) })
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'partial' }))
  })
  it('rejects cross-mission continuation and releases superseded loading', async () => {
    const first = { ...emptyReplay(), nextCursor: 'next', totalTrackCount: 1 }
    const publish = vi.fn()
    await loadReplayMap({ first, store: { readMissionReplayTrackChunk: async () => ({ ...emptyReplay(), missionId: 'other' }) }, requestId: () => 'request', isCurrent: () => true, publish })
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }))
    publish.mockClear()
    await loadReplayMap({ first, store: {}, requestId: () => 'request', isCurrent: () => false, publish })
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
  })
})
