import type { MapHealth } from '../lib/map-health'
import type { OfflineMapReadiness } from '../features/map/offline-map-readiness'

type MapDegradedAlertProps = {
  readonly mapHealth: MapHealth
  readonly offlineReadiness: OfflineMapReadiness
}

/**
 * Shows a compact alert on the map surface only when tile loading or offline
 * readiness is in a degraded state that operators must be aware of. Success
 * and loading states are suppressed from the map to reduce clutter (DON-95).
 */
export function MapDegradedAlert({ mapHealth, offlineReadiness }: MapDegradedAlertProps) {
  const showMapDegraded = mapHealth.status === 'degraded'
  const showOfflineWarning = offlineReadiness.tone === 'danger' || offlineReadiness.tone === 'warning'

  if (!showMapDegraded && !showOfflineWarning) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute bottom-20 right-3 z-10 flex max-w-[min(18rem,calc(100%-2rem))] flex-col items-end gap-2"
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
    </div>
  )
}
