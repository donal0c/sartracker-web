import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyCoverageController,
  applyCoverageState,
  resetCoverageStore,
  recordHistoryAdmissionFailure,
  recoverHistoryAdmission,
  useCoverageStore,
} from '../../src/features/tracking/coverage-store'

describe('coverage store [DON-276]', () => {
  beforeEach(() => { resetCoverageStore(); useCoverageStore.setState({ historyAdmissionFailures: {} }) })

  it('does not clear a newer failed admission while an older recovery awaits refresh', async () => {
    recordHistoryAdmissionFailure('m', 'a', '08:00', '10:00')
    let finish!: () => void
    applyCoverageController({ refresh: () => new Promise<void>((resolve) => { finish = resolve }) } as never)
    const recovery = recoverHistoryAdmission('m', 'a', '08:00', '10:00')
    recordHistoryAdmissionFailure('m', 'a', '08:00', '11:00')
    finish()
    await recovery
    expect(useCoverageStore.getState().historyAdmissionFailures.m?.a).toMatchObject({ until: '11:00' })
    await recoverHistoryAdmission('m', 'a', '08:00', '10:00')
    expect(useCoverageStore.getState().historyAdmissionFailures.m?.a).toBeDefined()
  })

  it('withholds completion after admission failure across coverage restart, scoped to mission and device', async () => {
    const complete = { status: 'complete' as const, missionId: 'mission-1', rendererGeneration: 'r',
      changeSeq: 1, latestObservedChangeSeq: 1, manifest: null, tileCatalog: null,
      delivered: {}, deliveredFixCount: 2, totalFixCount: 2 }
    applyCoverageState(complete)
    recordHistoryAdmissionFailure('mission-1', 'alpha', '08:00', '10:00')
    recordHistoryAdmissionFailure('mission-1', 'bravo', '08:00', '10:00')
    resetCoverageStore()
    applyCoverageState(complete)
    await recoverHistoryAdmission('mission-1', 'alpha', '08:00', '10:00')
    expect(useCoverageStore.getState().state).toMatchObject({ status: 'partial', blockers: ['history_reconciliation_incomplete'], deliveredFixCount: 2 })
    applyCoverageState({ ...complete, missionId: 'mission-2' })
    expect(useCoverageStore.getState().state.status).toBe('complete')
    applyCoverageState(complete)
    await recoverHistoryAdmission('mission-1', 'bravo', '08:00', '10:00')
    expect(useCoverageStore.getState().state.status).toBe('complete')
  })

  it('publishes mission-keyed state and clears it fail-closed', () => {
    applyCoverageState({
      status: 'partial', missionId: 'mission-1', rendererGeneration: 'r1',
      changeSeq: 2, latestObservedChangeSeq: 2, manifest: null,
      tileCatalog: null,
      delivered: {}, deliveredFixCount: 0, totalFixCount: 10,
    })
    const controller = { stop: () => undefined }
    applyCoverageController(controller as never)

    expect(useCoverageStore.getState()).toMatchObject({
      state: { missionId: 'mission-1', status: 'partial' }, controller,
    })

    resetCoverageStore()
    expect(useCoverageStore.getState()).toMatchObject({
      state: { status: 'inactive' }, controller: null,
    })
  })
})
