import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarkerAndSearch, readCoverageAndReplay } from '../../scripts/qualification/composite-probe.mjs'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

/** Executes the producer's real renderer callback against a bounded public bridge fixture. */
const page = { evaluate: async <T, R>(callback: (input: T) => Promise<R>, input: T) => callback(input) }

describe('composite producer bridge observations', () => {
  it('emits only routine marker fields while retaining returned store identities', async () => {
    const persist = vi.fn(async (input: Record<string, unknown>) => input)
    vi.stubGlobal('window', { sartrackerElectron: { missionStore: {
      upsertMarker: persist, upsertSearchArea: persist,
      upsertSearchAssignment: persist, upsertSearchPass: persist,
    } } })
    const facts = await createMarkerAndSearch(page, 'mission', 'outing', '2026-09-20T00:00:00.000Z')
    expect(facts).toEqual({ supported: true, missionId: 'mission', markerId: 'c28-marker',
      searchAreaId: 'c28-area', assignmentId: 'c28-assignment', searchPassId: 'c28-pass',
      markerCount: 1, searchAreaCount: 1, searchPassCount: 1 })
    expect(persist).toHaveBeenCalledTimes(4)
  })

  it('queries knowledge at the read boundary, after evidence import has completed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T00:01:00.000Z'))
    const replay = vi.fn(async (input: Record<string, unknown>) => ({ ...input,
      replayGeneration: 2, totalTrackCount: 2, staticGpxPointCount: 2, totalObjectCount: 1 }))
    vi.stubGlobal('window', { sartrackerElectron: { missionStore: {
      readCoverageManifest: async () => ({ missionId: 'mission', acceptedFixCount: 1, chunks: [], pending: false }),
      readMissionReplay: replay,
    } } })
    const facts = await readCoverageAndReplay(page, 'mission')
    expect(replay.mock.calls[0][0].selectedTime).toBe('2026-09-20T00:01:00.000Z')
    expect(facts.replay.staticGpxPointCount).toBe(2)
  })

  it('rejects a replay response from a different knowledge time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T00:01:00.000Z'))
    vi.stubGlobal('window', { sartrackerElectron: { missionStore: {
      readCoverageManifest: async () => ({ chunks: [] }),
      readMissionReplay: async () => ({ missionId: 'mission', selectedTime: '2026-09-20T00:00:00.000Z' }),
    } } })
    await expect(readCoverageAndReplay(page, 'mission')).rejects.toThrow(/selected time/u)
  })
})
