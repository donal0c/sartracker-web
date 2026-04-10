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
      className="rounded-2xl border border-stone-800 bg-stone-950/40 p-5 text-sm"
      data-testid="tracking-status"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="font-bold uppercase tracking-wider text-stone-400 text-[11px]">Tracking System</span>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${status.mode === 'online' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 animate-pulse'}`} />
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

      <div className="grid grid-cols-2 gap-y-2 border-t border-stone-800 pt-4 font-mono text-[11px] uppercase tracking-tight text-stone-400">
        <div className="flex justify-between border-r border-stone-800 pr-3">
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

      <div className="mt-4 space-y-2 border-t border-stone-800 pt-4">
        <div className="flex justify-end">
          <button
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-300"
            data-testid="open-devices-workspace"
            onClick={() => openWorkspace()}
            type="button"
          >
            Open Devices
          </button>
        </div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-stone-500">
          <span>Last Success</span>
          <span className="font-mono font-bold text-stone-300">
            {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleTimeString() : 'N/A'}
          </span>
        </div>
        <p className={`text-[11px] font-medium leading-relaxed ${status.warning ? 'text-amber-400' : 'text-stone-500 italic'}`}>
          {status.warning ?? 'Telemetry stream healthy'}
        </p>
      </div>
    </div>
  )
}
