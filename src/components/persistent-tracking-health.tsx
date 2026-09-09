import { useMissionStore } from '../features/mission/mission-store'
import { useTrackingStore } from '../features/tracking/tracking-store'
import { describeTrackingHealth } from '../features/tracking/persistent-tracking-health'

/** Keeps connection and freshness awareness outside collapsible workspaces. */
export function PersistentTrackingHealth() {
  const status = useTrackingStore((state) => state.status)
  const phase = useMissionStore((state) => state.phase)
  const staleCount = useTrackingStore((state) => state.snapshot.positions.filter((position) => position.device_cache_stale).length)
  const readout = describeTrackingHealth(status, phase, staleCount)
  return <div className={`sar-persistent-health sar-status-chip-${readout.tone}`} data-testid="persistent-tracking-health" role="status">
    <strong><span aria-hidden="true">{readout.tone === 'success' ? '●' : '⚠'} </span>{readout.label}</strong>
    <span>Last success: {status.lastSuccessAt === null ? 'None yet' : new Date(status.lastSuccessAt).toLocaleString()}</span>
    {status.warning !== null && <span>{status.warning}</span>}
  </div>
}
