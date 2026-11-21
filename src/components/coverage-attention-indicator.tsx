import { useCoverageStore } from '../features/tracking/coverage-store'
import {
  COVERAGE_CATCH_UP_STALL_MS,
  summarizeCoverageStatus,
  type CoverageStatusSummary,
} from '../features/tracking/coverage-progress'
import { selectCoverageStateForMission } from '../features/tracking/mission-coverage-scope'
import { useMissionStore } from '../features/mission/mission-store'

/**
 * Compact, always-visible warning that the mission history line is failed or
 * incomplete, for operators who are not on the Tracking tab. Renders nothing
 * while the line is up to date or catching up normally [DON-338 REN-6].
 */
export function CoverageAttentionIndicator(props: { readonly onOpenTracking: () => void }) {
  const coverageState = useCoverageStore((state) => state.state)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const summary = summarizeCoverageStatus(selectCoverageStateForMission(coverageState, missionId))
  if (!summary.needsAttention) return null

  return (
    <button
      aria-live="polite"
      className="mx-5 mb-2 border-l-4 border-l-amber-400 bg-amber-400/15 px-3 py-2 text-left text-xs font-medium leading-relaxed text-amber-100"
      data-testid="coverage-attention-indicator"
      onClick={props.onOpenTracking}
      type="button"
    >
      {describeAttention(summary)}
      {' '}Open Tracking for details.
    </button>
  )
}

/** Words the warning for the operator; the loaded line always stays on the map. */
function describeAttention(summary: CoverageStatusSummary): string {
  if (summary.kind === 'failed') {
    return 'MISSION HISTORY — the history line could not be updated. Loaded history is still shown.'
  }
  if (summary.stalled) {
    const minutes = Math.round(COVERAGE_CATCH_UP_STALL_MS / 60_000)
    return `MISSION HISTORY — the history line has not updated for over ${minutes} minutes and is missing recent positions.`
  }
  return 'MISSION HISTORY — the history line is incomplete. Do not treat it as the full record.'
}
