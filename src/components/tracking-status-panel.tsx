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
      className="sar-panel p-4 text-sm"
      data-testid="tracking-status"
    >
      <div className="mb-4 flex items-center justify-between border-b border-[var(--sar-line)] pb-3">
        <div>
          <span className="sar-section-label text-amber-300/90">Tracking System</span>
          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-stone-500">
            telemetry stream
          </p>
        </div>
        <div className="flex items-center gap-2 border border-emerald-400/20 bg-emerald-400/10 px-2 py-1">
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

      <div className="grid grid-cols-4 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] font-mono text-[13px] tracking-tight text-stone-300">
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Devices</span>
          <span className="mt-1 block text-lg font-black text-stone-100">{snapshot.devices.length}</span>
        </div>
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Fixes</span>
          <span className="mt-1 block text-lg font-black text-stone-100">{snapshot.positions.length}</span>
        </div>
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Cache</span>
          <span className="mt-1 block text-lg font-black text-amber-400">{cachedDeviceCount}</span>
        </div>
        <div className="px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Stale</span>
          <span className={`mt-1 block text-lg font-black ${staleDeviceCount > 0 ? 'text-rose-400' : 'text-stone-500'}`}>{staleDeviceCount}</span>
        </div>
      </div>

      <div className="mt-4 space-y-3 border-t border-[var(--sar-line)] pt-4">
        <div className="flex">
          <button
            className="sar-button w-full px-3 py-2 text-xs font-bold uppercase tracking-[0.1em]"
            data-testid="open-devices-workspace"
            onClick={() => openWorkspace()}
            type="button"
          >
            Open Devices
          </button>
        </div>
        <div className="sar-readout flex items-center justify-between px-3 py-2 text-[11px] font-medium text-stone-300">
          <span>Last success</span>
          <span className="font-mono font-bold text-stone-300">
            {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleTimeString() : 'N/A'}
          </span>
        </div>
        <p className={`border-l-2 px-3 py-2 text-xs font-normal leading-relaxed ${status.warning ? 'border-l-amber-400 bg-amber-400/10 text-amber-300' : 'border-l-emerald-400/60 bg-emerald-400/10 text-emerald-300'}`}>
          {status.warning ?? 'Telemetry stream healthy'}
        </p>
      </div>
    </div>
  )
}
