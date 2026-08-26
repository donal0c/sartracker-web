import type { CoverageTileCatalog } from '../../infrastructure/mission-store/tauri-mission-store'
import type { CoverageState } from './coverage-controller'

const INACTIVE_COVERAGE_STATE: CoverageState = { status: 'inactive' }

/**
 * Returns coverage state only when it belongs to the mission currently shown
 * to the operator. A mission transition fails closed while controller teardown
 * or irreversible catalog finalization finishes in the background.
 */
export function selectCoverageStateForMission(
  state: CoverageState,
  missionId: string | null,
): CoverageState {
  if (missionId === null || state.status === 'inactive' || state.missionId !== missionId) {
    return INACTIVE_COVERAGE_STATE
  }
  return state
}

/** Returns a renderable coverage catalog only for the mission currently shown. */
export function selectCoverageCatalogForMission(
  state: CoverageState,
  missionId: string | null,
): CoverageTileCatalog | null {
  const scopedState = selectCoverageStateForMission(state, missionId)
  return scopedState.status === 'inactive' ? null : scopedState.tileCatalog
}
