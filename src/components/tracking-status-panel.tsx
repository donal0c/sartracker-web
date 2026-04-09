import { useTrackingStore } from '../features/tracking/tracking-store'

/**
 * Renders the operator-facing tracking status summary.
 */
export function TrackingStatusPanel() {
  const snapshot = useTrackingStore((state) => state.snapshot)
  const status = useTrackingStore((state) => state.status)
  const staleDeviceCount = snapshot.positions.filter((position) => position.device_cache_stale).length
  const cachedDeviceCount = snapshot.positions.filter((position) => position.data_origin === 'cache').length

  return (
    <div
      className="mt-6 rounded-2xl border border-stone-700 bg-stone-950/70 p-4 text-sm text-stone-300"
      data-testid="tracking-status"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-stone-100">Tracking</span>
        <span
          className={
            status.mode === 'online'
              ? 'text-emerald-300'
              : status.mode === 'offline'
                ? 'text-amber-300'
                : 'text-stone-400'
          }
        >
          {status.mode}
        </span>
      </div>
      <div className="mt-3 space-y-1 text-xs leading-5 text-stone-400">
        <p>Devices: {snapshot.devices.length}</p>
        <p>Current positions: {snapshot.positions.length}</p>
        <p>Breadcrumb points: {snapshot.breadcrumbs.length}</p>
        <p>Cached positions: {cachedDeviceCount}</p>
        <p>Stale devices: {staleDeviceCount}</p>
        <p>Last success: {status.lastSuccessAt ?? 'No live poll yet'}</p>
        <p>{status.warning ?? 'Tracking connected and healthy.'}</p>
      </div>
    </div>
  )
}
