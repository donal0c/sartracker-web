import { create } from 'zustand'

import type { CoverageController, CoverageState } from './coverage-controller'

type AdmissionFailure = { readonly from: string; readonly until: string }
type AdmissionFailures = Readonly<Record<string, Readonly<Record<string, AdmissionFailure>>>>

type CoverageStore = {
  readonly state: CoverageState
  readonly sourceState: CoverageState
  readonly historyAdmissionFailures: AdmissionFailures
  readonly controller: CoverageController | null
}

const INACTIVE_STATE: CoverageState = { status: 'inactive' }

/** Stores mission-keyed complete-coverage state outside the live tracking store. */
export const useCoverageStore = create<CoverageStore>(() => ({
  state: INACTIVE_STATE,
  sourceState: INACTIVE_STATE,
  historyAdmissionFailures: {},
  controller: null,
}))

/** Publishes coverage state outside React render code. */
export function applyCoverageState(state: CoverageState): void {
  useCoverageStore.setState({ sourceState: state, state: withHistoryAdmissionBlocker(state, useCoverageStore.getState().historyAdmissionFailures) })
}

/** Keeps a failed pre-dispatch write separate from accepted-evidence loss. */
export function recordHistoryAdmissionFailure(missionId: string, deviceId: string, from: string, until: string): void {
  const current = useCoverageStore.getState()
  const devices = current.historyAdmissionFailures[missionId] ?? {}
  const previous = devices[deviceId]
  const failure = { from: previous && previous.from < from ? previous.from : from,
    until: previous && previous.until > until ? previous.until : until }
  const historyAdmissionFailures = { ...current.historyAdmissionFailures, [missionId]: { ...devices, [deviceId]: failure } }
  useCoverageStore.setState({ historyAdmissionFailures, state: withHistoryAdmissionBlocker(current.sourceState, historyAdmissionFailures) })
}

/** Clears only the covered failure observed before refresh; newer failures retain ownership. */
export async function recoverHistoryAdmission(missionId: string, deviceId: string, from: string, until: string): Promise<void> {
  const observed = useCoverageStore.getState().historyAdmissionFailures[missionId]?.[deviceId]
  if (!observed || from > observed.from || until < observed.until) return
  await useCoverageStore.getState().controller?.refresh()
  const current = useCoverageStore.getState()
  if (current.historyAdmissionFailures[missionId]?.[deviceId] !== observed) return
  const devices = { ...current.historyAdmissionFailures[missionId] }
  delete devices[deviceId]
  const historyAdmissionFailures = { ...current.historyAdmissionFailures, [missionId]: devices }
  useCoverageStore.setState({ historyAdmissionFailures, state: withHistoryAdmissionBlocker(current.sourceState, historyAdmissionFailures) })
}

/** Projects mission-scoped admission failure onto the same structured completeness state. */
function withHistoryAdmissionBlocker(state: CoverageState, failures: AdmissionFailures): CoverageState {
  if (state.status === 'inactive' || !Object.keys(failures[state.missionId] ?? {}).length) return state
  return { ...state, status: state.status === 'complete' ? 'partial' : state.status,
    blockers: [...new Set([...(state.blockers ?? []), 'history_reconciliation_incomplete'])] }
}

/** Publishes the active coverage controller outside React render code. */
export function applyCoverageController(controller: CoverageController | null): void {
  useCoverageStore.setState({ controller })
}

/** Clears all renderer-generation delivery attestation fail-closed. */
export function resetCoverageStore(): void {
  useCoverageStore.setState({ state: INACTIVE_STATE, sourceState: INACTIVE_STATE, controller: null })
}
