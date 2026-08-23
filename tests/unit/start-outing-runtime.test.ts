import { describe, expect, it, vi } from 'vitest'

import { startOutingRuntime } from '../../src/features/outings/start-outing-runtime'
import type {
  Outing,
  OutingFixSummary,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

const FIRST_OUTING: Outing = {
  id: 'outing-1',
  mission_id: 'mission-1',
  label: 'Outing 1',
  started_at: '2026-08-23T20:00:00.000Z',
  ended_at: null,
  created_at: '2026-08-23T20:00:00.000Z',
  updated_at: '2026-08-23T20:00:00.000Z',
}

const SUMMARY: OutingFixSummary = {
  outings: [{ outing_id: 'outing-1', accepted_fix_count: 7 }],
  unassigned_accepted_fix_count: 3,
  total_accepted_fix_count: 10,
}

describe('startOutingRuntime [DON-270]', () => {
  it('hydrates outings and the worker-computed Unassigned summary after restart', async () => {
    const states: unknown[] = []
    const runtime = await startOutingRuntime({
      outingStore: createStore(),
      applyRuntime: (state) => states.push(state),
    })

    await runtime.refreshMission('mission-1')

    expect(states.at(-1)).toMatchObject({
      activeMissionId: 'mission-1',
      outings: [FIRST_OUTING],
      fixSummary: SUMMARY,
      loading: false,
      error: null,
    })
  })

  it('uses explicit lifecycle mutations and refreshes derived state', async () => {
    const store = createStore()
    const runtime = await startOutingRuntime({
      outingStore: store,
      applyRuntime: vi.fn(),
    })
    await runtime.refreshMission('mission-1')

    await runtime.startOuting({ label: 'Night search' })
    await runtime.renameOuting('outing-1', 'Night search A')
    await runtime.editOutingBoundaries('outing-1', {
      started_at: '2026-08-23T19:30:00.000Z',
      ended_at: null,
    })
    await runtime.endOuting('outing-1')

    expect(store.createOuting).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      label: 'Night search',
    })
    expect(store.renameOuting).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      outing_id: 'outing-1',
      label: 'Night search A',
    })
    expect(store.editOutingBoundaries).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      outing_id: 'outing-1',
      started_at: '2026-08-23T19:30:00.000Z',
      ended_at: null,
    })
    expect(store.endOuting).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      outing_id: 'outing-1',
    })
  })

  it('cancels a stale summary read when mission context changes', async () => {
    const store = createStore()
    let releaseFirst: (summary: OutingFixSummary) => void = () => undefined
    store.readOutingFixSummary
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve }))
      .mockResolvedValueOnce(SUMMARY)
    const runtime = await startOutingRuntime({
      outingStore: store,
      applyRuntime: vi.fn(),
    })

    const firstRefresh = runtime.refreshMission('mission-1')
    await Promise.resolve()
    const secondRefresh = runtime.refreshMission('mission-2')
    releaseFirst(SUMMARY)
    await Promise.all([firstRefresh, secondRefresh])

    expect(store.cancelOutingFixSummary).toHaveBeenCalledTimes(1)
    expect(store.cancelOutingFixSummary).toHaveBeenCalledWith(expect.stringMatching(/^outing-summary-/u))
  })
})

function createStore() {
  return {
    listOutings: vi.fn().mockResolvedValue([FIRST_OUTING]),
    createOuting: vi.fn().mockResolvedValue(FIRST_OUTING),
    endOuting: vi.fn().mockResolvedValue({ ...FIRST_OUTING, ended_at: '2026-08-23T22:00:00.000Z' }),
    renameOuting: vi.fn().mockResolvedValue(FIRST_OUTING),
    editOutingBoundaries: vi.fn().mockResolvedValue(FIRST_OUTING),
    readOutingFixSummary: vi.fn().mockResolvedValue(SUMMARY),
    cancelOutingFixSummary: vi.fn().mockResolvedValue(true),
  }
}
