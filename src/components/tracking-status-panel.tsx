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
  const criticalTrustWarning = isCriticalTrackingTrustWarning(status.warning)
  const modeLabel = getTrackingModeLabel(status.mode, status.warning)
  const modeChipClassName =
    status.mode === 'online' && !criticalTrustWarning
      ? 'sar-status-chip-success'
      : status.mode === 'offline' || criticalTrustWarning
        ? 'sar-status-chip-alert'
        : 'sar-status-chip-neutral'

  return (
    <div
      className="sar-panel p-4 text-sm"
      data-testid="tracking-status"
    >
      <div className="mb-4 flex items-center justify-between border-b border-[var(--sar-line)] pb-3">
        <div>
          <span className="sar-section-label text-amber-300">Tracking System</span>
          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-stone-300">
            telemetry stream
          </p>
        </div>
        <div
          className={`flex items-center gap-2 px-2 py-1 ${modeChipClassName}`}
          data-testid="tracking-mode-chip"
        >
          <div
            className={`h-2 w-2 rounded-full ${
              status.mode === 'online' && !criticalTrustWarning
                ? 'bg-emerald-300'
                : status.mode === 'offline' || criticalTrustWarning
                  ? 'bg-red-200 animate-pulse shadow-[0_0_10px_rgba(248,113,113,0.85)]'
                  : 'bg-stone-300'
            }`}
          />
          <span className="font-bold uppercase text-[11px]">{modeLabel}</span>
        </div>
      </div>

      {status.warning === null ? null : (
        <TrackingStatusMessage tone={criticalTrustWarning ? 'critical' : 'warning'}>
          {status.warning}
        </TrackingStatusMessage>
      )}

      <div className="grid grid-cols-4 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] font-mono text-[13px] tracking-tight text-stone-100">
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Devices</span>
          <span className="mt-1 block text-lg font-black text-stone-100">{snapshot.devices.length}</span>
        </div>
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Fixes</span>
          <span className="mt-1 block text-lg font-black text-stone-100">{snapshot.positions.length}</span>
        </div>
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Cache</span>
          <span className="mt-1 block text-lg font-black text-amber-400">{cachedDeviceCount}</span>
        </div>
        <div className="px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Stale</span>
          <span className={`mt-1 block text-lg font-black ${staleDeviceCount > 0 ? 'text-rose-300' : 'text-stone-200'}`}>{staleDeviceCount}</span>
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
        {status.warning === null ? (
          <TrackingStatusMessage tone="healthy">
            Telemetry stream healthy
          </TrackingStatusMessage>
        ) : null}
      </div>
    </div>
  )
}

function getTrackingModeLabel(mode: 'idle' | 'offline' | 'online', warning: string | null): string {
  if (warning !== null && /live refresh suspended/i.test(warning)) {
    return 'paused'
  }
  return mode
}

function isCriticalTrackingTrustWarning(warning: string | null): boolean {
  if (warning === null) {
    return false
  }

  return /offline mode|live refresh suspended/i.test(warning)
}

function TrackingStatusMessage(props: {
  readonly children: string
  readonly tone: 'critical' | 'healthy' | 'warning'
}) {
  const className =
    props.tone === 'critical'
      ? 'sar-status-alert-panel mb-4'
      : props.tone === 'warning'
        ? 'mb-4 border-l-amber-400 bg-amber-400/15 text-amber-100'
        : 'border-l-emerald-400 bg-emerald-400/10 text-emerald-200'

  return (
    <p
      className={`border-l-4 px-3 py-2 text-xs font-medium leading-relaxed ${className}`}
      data-testid="tracking-warning"
    >
      {props.children}
    </p>
  )
}
