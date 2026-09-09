import { useMissionStore } from '../features/mission/mission-store'
import { useMissionTimer } from '../features/mission/use-mission-timer'
import { formatMissionDuration } from '../features/mission/mission-timers'
import { useMissionReviewWorkspaceStore } from '../features/mission-review/mission-review-workspace-store'

/** Presents the same mission clock and review entry when the full controls are hidden. */
export function CompactMissionStrip({ onRestore }: { readonly onRestore: () => void }) {
  const mission = useMissionStore((state) => state.currentMission)
  const phase = useMissionStore((state) => state.phase)
  const timer = useMissionTimer(mission)
  const openReview = useMissionReviewWorkspaceStore((state) => state.openWorkspace)
  return <div className="sar-compact-mission" data-testid="compact-mission-strip">
    <span className="min-w-0"><strong className="block truncate" title={mission?.name}>{mission?.name ?? 'No active mission'}</strong><span className="font-bold uppercase">{phase}</span></span>
    <span className="whitespace-nowrap">Active search <strong className="font-mono">{formatMissionDuration(timer?.activeSeconds ?? 0)}</strong></span>
    <button className="sar-button px-3 py-2" data-testid="compact-mission-review" disabled={mission === null} onClick={openReview} type="button">Review</button>
    <button className="sar-button px-3 py-2" data-testid="compact-mission-restore" onClick={onRestore} type="button">Restore mission</button>
  </div>
}
