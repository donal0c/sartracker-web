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

  it('does not let a stale clear resume after cancellation and replace a newer mission', async () => {
    let releaseFirstSummary: (summary: OutingFixSummary) => void = () => undefined
    let releaseCancellation: (cancelled: boolean) => void = () => undefined
    const store = createStore()
    store.readOutingFixSummary
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirstSummary = resolve }))
      .mockResolvedValueOnce(SUMMARY)
    store.cancelOutingFixSummary.mockImplementationOnce(() =>
      new Promise((resolve) => { releaseCancellation = resolve }))
    const states: Array<{ readonly activeMissionId: string | null }> = []
    const runtime = await startOutingRuntime({
      outingStore: store,
      applyRuntime: (state) => states.push(state),
    })

    const firstRefresh = runtime.refreshMission('mission-a')
    await Promise.resolve()
    const staleClear = runtime.refreshMission(null)
    await Promise.resolve()
    await runtime.refreshMission('mission-b')

    expect(states.at(-1)?.activeMissionId).toBe('mission-b')

    releaseCancellation(true)
    releaseFirstSummary(SUMMARY)
    await Promise.all([firstRefresh, staleClear])

    expect(states.at(-1)?.activeMissionId).toBe('mission-b')
  })

  it('publishes a new mission empty and loading before awaiting stale summary cancellation', async () => {
    let releaseSecondSummary: (summary: OutingFixSummary) => void = () => undefined
    let releaseCancellation: (cancelled: boolean) => void = () => undefined
    const store = createStore()
    store.listOutings.mockImplementation((missionId) => Promise.resolve(
      missionId === 'mission-a' ? [{ ...FIRST_OUTING, mission_id: 'mission-a' }] : [],
    ))
    store.readOutingFixSummary
      .mockResolvedValueOnce(SUMMARY)
      .mockImplementationOnce(() => new Promise((resolve) => { releaseSecondSummary = resolve }))
      .mockResolvedValueOnce(SUMMARY)
    store.cancelOutingFixSummary.mockImplementationOnce(() =>
      new Promise((resolve) => { releaseCancellation = resolve }))
    const states: Array<{
      readonly activeMissionId: string | null
      readonly outings: readonly Outing[]
      readonly fixSummary: OutingFixSummary | null
      readonly loading: boolean
    }> = []
    const runtime = await startOutingRuntime({
      outingStore: store,
      applyRuntime: (state) => states.push(state),
    })
    await runtime.refreshMission('mission-a')

    const heldARefresh = runtime.refreshMission('mission-a')
    await Promise.resolve()
    const missionBRefresh = runtime.refreshMission('mission-b')
    await Promise.resolve()
    const stateDuringCancellation = states.at(-1)

    releaseCancellation(true)
    releaseSecondSummary(SUMMARY)
    await Promise.all([heldARefresh, missionBRefresh])

    expect(stateDuringCancellation).toMatchObject({
      activeMissionId: 'mission-b',
      outings: [],
      fixSummary: null,
      loading: true,
    })
  })

  it('does not restore a stale mission after an in-flight mutation completes', async () => {
    let releaseCreate: (outing: Outing) => void = () => undefined
    const store = createStore()
    store.createOuting.mockImplementationOnce(() =>
      new Promise((resolve) => { releaseCreate = resolve }))
    const states: Array<{ readonly activeMissionId: string | null }> = []
    const runtime = await startOutingRuntime({
      outingStore: store,
      applyRuntime: (state) => states.push(state),
    })
    await runtime.refreshMission('mission-1')

    const pendingCreate = runtime.startOuting()
    await Promise.resolve()
    await runtime.refreshMission('mission-2')
    releaseCreate(FIRST_OUTING)
    const staleResult = await pendingCreate

    expect(staleResult).toBeNull()
    expect(states.at(-1)?.activeMissionId).toBe('mission-2')
    expect(store.listOutings.mock.calls.map(([missionId]) => missionId)).toEqual([
      'mission-1',
      'mission-2',
    ])
  })

  it('does not let an older mission mutation block or clear saving for the current mission', async () => {
    let releaseFirstCreate: (outing: Outing) => void = () => undefined
    let releaseSecondCreate: (outing: Outing) => void = () => undefined
    const store = createStore()
    store.listOutings.mockImplementation((missionId) => Promise.resolve(
      missionId === 'mission-b' ? [] : [{ ...FIRST_OUTING, mission_id: 'mission-a' }],
    ))
    store.createOuting
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirstCreate = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseSecondCreate = resolve }))
    const states: Array<{
      readonly activeMissionId: string | null
      readonly saving: boolean
    }> = []
    const runtime = await startOutingRuntime({
      outingStore: store,
      applyRuntime: (state) => states.push(state),
    })
    await runtime.refreshMission('mission-a')

    const firstCreate = runtime.startOuting()
    await Promise.resolve()
    await runtime.refreshMission('mission-b')
    const secondCreate = runtime.startOuting()
    await Promise.resolve()

    expect(store.createOuting).toHaveBeenCalledTimes(2)
    expect(store.createOuting).toHaveBeenNthCalledWith(2, {
      mission_id: 'mission-b',
      label: 'Outing 1',
    })
    expect(states.at(-1)).toMatchObject({ activeMissionId: 'mission-b', saving: true })

    releaseFirstCreate({ ...FIRST_OUTING, mission_id: 'mission-a' })
    await firstCreate
    expect(states.at(-1)).toMatchObject({ activeMissionId: 'mission-b', saving: true })

    releaseSecondCreate({ ...FIRST_OUTING, mission_id: 'mission-b' })
    await secondCreate
    expect(states.at(-1)).toMatchObject({ activeMissionId: 'mission-b', saving: false })
  })

  it('clears prior mission outings and blocks mutations until hydration completes', async () => {
    let releaseMissionBSummary: (summary: OutingFixSummary) => void = () => undefined
    const store = createStore()
    store.listOutings.mockImplementation((missionId) => Promise.resolve(
      missionId === 'mission-a' ? [{ ...FIRST_OUTING, mission_id: 'mission-a' }] : [],
    ))
    store.readOutingFixSummary
      .mockResolvedValueOnce(SUMMARY)
      .mockImplementationOnce(() =>
        new Promise((resolve) => { releaseMissionBSummary = resolve }))
      .mockResolvedValue(SUMMARY)
    const states: Array<{
      readonly activeMissionId: string | null
      readonly outings: readonly Outing[]
      readonly fixSummary: OutingFixSummary | null
      readonly loading: boolean
    }> = []
    const runtime = await startOutingRuntime({
      outingStore: store,
      applyRuntime: (state) => states.push(state),
    })
    await runtime.refreshMission('mission-a')

    const missionBRefresh = runtime.refreshMission('mission-b')
    await Promise.resolve()
    const stateDuringHydration = states.at(-1)
    const blockedMutation = runtime.startOuting()
    await Promise.resolve()
    const createCallsDuringHydration = store.createOuting.mock.calls.length

    releaseMissionBSummary(SUMMARY)
    const [, blockedResult] = await Promise.all([missionBRefresh, blockedMutation])

    expect(stateDuringHydration).toMatchObject({
      activeMissionId: 'mission-b',
      outings: [],
      fixSummary: null,
      loading: true,
    })
    expect(createCallsDuringHydration).toBe(0)
    expect(blockedResult).toBeNull()
  })

  it('keeps mutations blocked when mission hydration fails', async () => {
    const store = createStore()
    store.readOutingFixSummary.mockRejectedValueOnce(new Error('Summary unavailable'))
    const states: Array<{
      readonly activeMissionId: string | null
      readonly loading: boolean
      readonly error: string | null
    }> = []
    const runtime = await startOutingRuntime({
      outingStore: store,
      applyRuntime: (state) => states.push(state),
    })

    await runtime.refreshMission('mission-b')
    const result = await runtime.startOuting()

    expect(states.at(-1)).toMatchObject({
      activeMissionId: 'mission-b',
      loading: false,
      error: 'Summary unavailable',
    })
    expect(result).toBeNull()
    expect(store.createOuting).not.toHaveBeenCalled()
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
