import type { MapHealth } from '../lib/map-health'
import type { OfflineMapReadiness } from '../features/map/offline-map-readiness'

type MapDegradedAlertProps = {
  readonly mapHealth: MapHealth
  readonly offlineReadiness: OfflineMapReadiness
}

/**
 * Shows map-surface alerts for degraded basemap/offline readiness and persistent
 * overlay synchronization failures. Overlay warnings remain independent of
 * basemap state; successful and loading basemap states stay suppressed (DON-95).
 */
export function MapDegradedAlert({ mapHealth, offlineReadiness }: MapDegradedAlertProps) {
  const showMapDegraded = mapHealth.status === 'degraded'
  const showOfflineWarning = offlineReadiness.tone === 'danger' || offlineReadiness.tone === 'warning'
  const overlayWarnings = mapHealth.overlayWarnings ?? []

  if (!showMapDegraded && !showOfflineWarning && overlayWarnings.length === 0) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute bottom-20 right-3 z-10 flex max-w-[min(22rem,calc(100%-2rem))] flex-col items-end gap-2"
      data-testid="map-degraded-alert"
    >
      {showMapDegraded ? (
        <div
          aria-live="assertive"
          className="pointer-events-auto border border-rose-300/75 bg-stone-950/95 px-3 py-1.5 text-[11px] font-bold text-rose-50 shadow-lg shadow-black/40"
          data-testid="map-health-degraded"
          role="alert"
        >
          {mapHealth.message}
        </div>
      ) : null}
      {showOfflineWarning ? (
        <div
          aria-live="polite"
          className={`pointer-events-auto border px-3 py-1.5 text-[11px] font-bold shadow-lg shadow-black/40 ${
            offlineReadiness.tone === 'danger'
              ? 'border-rose-300/75 bg-stone-950/95 text-rose-50'
              : 'border-amber-300/70 bg-stone-950/95 text-amber-100'
          }`}
          data-testid="map-offline-warning"
        >
          {offlineReadiness.label}
        </div>
      ) : null}
      {overlayWarnings.map((warning) => (
        <div
          key={warning.registrationId}
          aria-live="assertive"
          className="pointer-events-auto border-2 border-rose-200 bg-rose-950 px-3 py-2 text-left text-xs font-semibold text-rose-50 shadow-xl shadow-black/60 ring-1 ring-rose-200/70"
          data-testid={`map-overlay-warning-${warning.registrationId}`}
          role="alert"
        >
          <div className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center border border-rose-100 bg-rose-100 text-sm font-black leading-none text-rose-950"
            >
              !
            </span>
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-rose-100">
                Map overlay warning
              </p>
              <p>{warning.message}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
