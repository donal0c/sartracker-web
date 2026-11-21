import { useCoverageStore } from '../features/tracking/coverage-store'
import {
  COVERAGE_CATCH_UP_STALL_MS,
  summarizeCoverageStatus,
  type CoverageStatusSummary,
} from '../features/tracking/coverage-progress'
import { selectCoverageStateForMission } from '../features/tracking/mission-coverage-scope'
import { useMissionStore } from '../features/mission/mission-store'

/**
 * Compact warning in the awareness strip that the mission history line is
 * failed, stalled or incomplete, shown whenever the full Tracking panel is off
 * screen (sidebar collapsed or another tab open). Renders nothing while the
 * line is up to date or catching up normally [DON-338 REN-6].
 */
export function CoverageAttentionIndicator(props: { readonly onOpenTracking: () => void }) {
  const coverageState = useCoverageStore((state) => state.state)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const summary = summarizeCoverageStatus(selectCoverageStateForMission(coverageState, missionId))
  if (!summary.needsAttention) return null

  return (
    <button
      aria-live="polite"
      className="sar-status-chip-warning max-w-[32rem] border-l-4 px-3 py-2 text-left text-xs font-bold leading-snug"
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
    return `MISSION HISTORY — the history line has not updated for over ${minutes} minutes and may be missing recent positions or be out of date.`
  }
  return 'MISSION HISTORY — the history line is incomplete. Do not treat it as the full record.'
}
