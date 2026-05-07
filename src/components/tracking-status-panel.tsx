import { useTrackingStore } from '../features/tracking/tracking-store'
import { useDeviceWorkspaceStore } from '../features/tracking/device-workspace-store'

/**
 * Renders the operator-facing tracking status summary.
 */
export function TrackingStatusPanel() {
  const snapshot = useTrackingStore((state) => state.snapshot)
  const status = useTrackingStore((state) => state.status)
  const openWorkspace = useDeviceWorkspaceStore((state) => state.openWorkspace)
  const staleDeviceCount = snapshot.positions.filter((position) => position.device_cache_stale).length
  const cachedDeviceCount = snapshot.positions.filter((position) => position.data_origin === 'cache').length

  return (
    <div
      className="sar-panel rounded-xl p-5 text-sm"
      data-testid="tracking-status"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="sar-section-label">Tracking System</span>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${status.mode === 'online' ? 'bg-emerald-400' : 'bg-amber-500 animate-pulse'}`} />
          <span
            className={`font-bold uppercase text-[11px] ${
              status.mode === 'online'
                ? 'text-emerald-400'
                : status.mode === 'offline'
                  ? 'text-amber-400'
                  : 'text-stone-500'
            }`}
          >
            {status.mode}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-2 border-t border-[var(--sar-line)] pt-4 font-mono text-[13px] tracking-tight text-stone-300">
        <div className="flex justify-between border-r border-[var(--sar-line)] pr-3">
          <span>Devices</span>
          <span className="font-bold text-stone-200">{snapshot.devices.length}</span>
        </div>
        <div className="flex justify-between pl-3">
          <span>Positions</span>
          <span className="font-bold text-stone-200">{snapshot.positions.length}</span>
        </div>
        <div className="flex justify-between border-r border-stone-800 pr-3">
          <span>Cached</span>
          <span className="font-bold text-amber-400">{cachedDeviceCount}</span>
        </div>
        <div className="flex justify-between pl-3">
          <span>Stale</span>
          <span className={`font-bold ${staleDeviceCount > 0 ? 'text-rose-400' : 'text-stone-500'}`}>{staleDeviceCount}</span>
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-[var(--sar-line)] pt-4">
        <div className="flex justify-end">
          <button
            className="sar-button rounded-lg px-3 py-2 text-xs font-semibold"
            data-testid="open-devices-workspace"
            onClick={() => openWorkspace()}
            type="button"
          >
            Open Devices
          </button>
        </div>
        <div className="flex items-center justify-between text-[11px] font-medium text-stone-300">
          <span>Last success</span>
          <span className="font-mono font-bold text-stone-300">
            {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleTimeString() : 'N/A'}
          </span>
        </div>
        <p className={`text-xs font-normal leading-relaxed ${status.warning ? 'text-amber-400' : 'text-stone-500 italic'}`}>
          {status.warning ?? 'Telemetry stream healthy'}
        </p>
      </div>
    </div>
  )
}
