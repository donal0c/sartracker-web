import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { loadReplayMap } from '../../src/features/mission-review/load-replay-map'
import type { MissionReplayReadResult } from '../../src/infrastructure/mission-store/tauri-mission-store'

afterEach(() => vi.unstubAllGlobals())

const projection = { blob: new Blob(), bounds: null, limitations: [] }
/** Builds one real-shaped track for pagination and cancellation tests. */
function track(id: string): MissionReplayReadResult['tracks'][number] {
  return { evidence_id: id, source_type: 'traccar_fix', track_id: 'alpha', effective_at: '2026-09-09T09:00:00.000Z',
    recorded_at: '2026-09-09T09:00:00.000Z', lat: 52, lon: -9, elevation: null, accuracy: null,
    time_authority: 'fixTime', completeness: 'complete' }
}

/** Creates a complete empty evidence snapshot for loader boundary tests. */
function emptyReplay(): MissionReplayReadResult {
  return { missionId: 'm', selectedTime: '2026-09-09T10:00:00.000Z', replayGeneration: 0, timezone: 'Europe/Dublin',
    tracks: [], objects: [], totalTrackCount: 0, totalObjectCount: 0, objectTypeCounts: {},
    trackCursor: '0', objectCursor: '0', nextCursor: null, previousCursor: null, nextObjectCursor: null,
    availableDeviceIds: [], availableOutingIds: [], deviceFilterIds: [], outingFilterIds: [], staticGpxEvidence: [],
    staticGpxPointCount: 0, progress: 1, limitations: [] }
}

describe('replay map loading [DON-215]', () => {
  it('publishes ready only after every track and object page reaches the projector', async () => {
    const object = { object_type: 'marker', object_id: 'clue', version_sequence: 1, operation: 'created',
      effective_at: emptyReplay().selectedTime, recorded_at: emptyReplay().selectedTime, completeness: 'complete' as const,
      state: { type: 'clue', lat: 52, lon: -9 } }
    const first = { ...emptyReplay(), tracks: [track('first')], totalTrackCount: 2, nextCursor: 'next-track',
      totalObjectCount: 1, nextObjectCursor: 'next-object' }
    const project = vi.fn(async () => projection)
    const publish = vi.fn()
    await loadReplayMap({ first, store: {
      readMissionReplayTrackChunk: async () => ({ ...first, tracks: [track('second')], nextCursor: null }),
      readMissionReplayObjectChunk: async () => ({ ...first, objects: [object], nextObjectCursor: null, summarizedObjectCount: 0 }),
    }, requestId: () => 'r', isCurrent: () => true, publish, project })
    expect(project).toHaveBeenCalledWith([track('first'), track('second')], [object], expect.any(Function))
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', data: projection, loaded: 3, total: 3 }))
  })

  it.each([true, false])('verifies the whole reconstructed state hash (matching=%s), including split surrogate pairs', async (matching) => {
    vi.stubGlobal('crypto', webcrypto)
    const state = { type: 'clue', name: 'Evidence 🧭', lat: 52, lon: -9 }
    const serialized = JSON.stringify(state)
    const split = serialized.indexOf('🧭') + 1
    const object = { object_type: 'marker', object_id: 'clue', version_sequence: 2, operation: 'created',
      effective_at: emptyReplay().selectedTime, recorded_at: emptyReplay().selectedTime, completeness: 'complete' as const,
      state: { _state_details_omitted: true, _state_sha256: matching ? createHash('sha256').update(serialized).digest('hex') : '0'.repeat(64) } }
    const first = { ...emptyReplay(), objects: [object], totalObjectCount: 1 }
    const project = vi.fn(async () => projection)
    const publish = vi.fn()
    await loadReplayMap({ first, store: { readMissionReplayObjectChunk: async (query) => {
      const offset = query.objectDetails!.offset
      const nextOffset = offset === 0 ? split : null
      return { ...first, summarizedObjectCount: 0, objectDetails: { objectType: 'marker', objectId: 'clue', versionSequence: 2,
        offset, fragment: serialized.slice(offset, nextOffset ?? undefined), totalCharacters: serialized.length, nextOffset } }
    } }, requestId: () => 'r', isCurrent: () => true, publish, project })
    if (matching) {
      expect(project).toHaveBeenCalledWith([], [expect.objectContaining({ state })], expect.any(Function))
      expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }))
    } else {
      expect(project).not.toHaveBeenCalled()
      expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', message: expect.stringContaining('integrity') }))
    }
  })

  it('does not project or publish a successful page that arrives after its seek is superseded', async () => {
    let resolvePage!: (page: MissionReplayReadResult) => void
    const pending = new Promise<MissionReplayReadResult>((resolve) => { resolvePage = resolve })
    const first = { ...emptyReplay(), nextCursor: 'next', totalTrackCount: 1 }
    let current = true
    const publish = vi.fn()
    const project = vi.fn(async () => projection)
    const loading = loadReplayMap({ first, store: { readMissionReplayTrackChunk: () => pending },
      requestId: () => 'r', isCurrent: () => current, publish, project })
    const beforeSuperseding = publish.mock.calls.length
    current = false
    resolvePage({ ...first, tracks: [track('late')], nextCursor: null })
    await loading
    expect(publish).toHaveBeenCalledTimes(beforeSuperseding)
    expect(project).not.toHaveBeenCalled()
  })

  it('does not publish a finished projection after its seek is superseded', async () => {
    let resolveProjection!: (result: typeof projection) => void
    const pending = new Promise<typeof projection>((resolve) => { resolveProjection = resolve })
    let current = true
    const publish = vi.fn()
    const loading = loadReplayMap({ first: emptyReplay(), store: {}, requestId: () => 'r',
      isCurrent: () => current, publish, project: () => pending })
    const beforeSuperseding = publish.mock.calls.length
    current = false
    resolveProjection(projection)
    await loading
    expect(publish).toHaveBeenCalledTimes(beforeSuperseding)
  })
  it('rejects prematurely terminated geometry instead of accepting truncated retained state', async () => {
    const object = { object_type: 'drawing', object_id: 'd', version_sequence: 1, operation: 'created', recorded_at: '2026-09-09T09:00:00Z', effective_at: '2026-09-09T09:00:00Z', state: { _state_details_omitted: true } } as MissionReplayReadResult['objects'][number]
    const publish = vi.fn()
    const first = { ...emptyReplay(), objects: [object], totalObjectCount: 1 }
    await loadReplayMap({ first, store: { readMissionReplayObjectChunk: async () => ({ ...first, objectDetails: {
      objectType: 'drawing', objectId: 'd', versionSequence: 1, offset: 0, fragment: '{}', totalCharacters: 100, nextOffset: null,
    } }) }, requestId: () => 'r', isCurrent: () => true, publish, project: async () => ({ blob: new Blob(), bounds: null, limitations: [] }) })
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
      project: async () => ({ blob: new Blob(), bounds: null, limitations: [] }) })
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
