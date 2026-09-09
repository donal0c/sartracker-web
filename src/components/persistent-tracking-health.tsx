import { useMissionStore } from '../features/mission/mission-store'
import { useTrackingStore } from '../features/tracking/tracking-store'
import { describeTrackingHealth } from '../features/tracking/persistent-tracking-health'

const HEALTH_CLASSES = {
  success: 'sar-status-chip-success',
  warning: 'sar-status-chip-warning',
  neutral: 'sar-status-chip-neutral',
  alert: 'sar-status-chip-alert',
} as const

/** Keeps connection and freshness awareness outside collapsible workspaces. */
export function PersistentTrackingHealth() {
  const status = useTrackingStore((state) => state.status)
  const phase = useMissionStore((state) => state.phase)
  const staleCount = useTrackingStore((state) => state.snapshot.positions.filter((position) => position.device_cache_stale).length)
  const unverifiedCount = useTrackingStore((state) => state.snapshot.positions.filter((position) => position.fix_time_unverified).length)
  const readout = describeTrackingHealth(status, phase, staleCount, unverifiedCount)
  return <div className={`sar-persistent-health ${HEALTH_CLASSES[readout.tone]}`} data-testid="persistent-tracking-health" role="status">
    <strong><span aria-hidden="true">{readout.tone === 'success' ? '●' : '⚠'} </span>{readout.label}</strong>
    <span>Last success: {status.lastSuccessAt === null ? 'None yet' : new Date(status.lastSuccessAt).toLocaleString()}</span>
    {status.warning !== null && <span>{status.warning}</span>}
  </div>
}
