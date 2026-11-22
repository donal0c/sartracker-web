import { useMarkerStore } from '../features/markers/marker-store'

/** Surfaces marker failures over the map while no marker dialog is open. */
export function MarkerStatusBanner() {
  const dialog = useMarkerStore((state) => state.dialog)
  const loadError = useMarkerStore((state) => state.loadError)
  const error = useMarkerStore((state) => state.error)
  const activeMissionId = useMarkerStore((state) => state.activeMissionId)
  const loading = useMarkerStore((state) => state.loading)
  const controller = useMarkerStore((state) => state.controller)

  if (dialog !== null || (loadError === null && error === null)) return null

  return (
    <div
      className="fixed left-1/2 top-24 z-30 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-xl border border-rose-400/40 bg-stone-900 px-4 py-3 text-sm text-rose-200 shadow-xl"
      data-map-interaction-boundary="true"
      data-testid="marker-status-banner"
      role="alert"
    >
      {loadError !== null ? (
        <div>
          <p>Markers could not be loaded for this mission: {loadError} Markers shown on the map may be incomplete.</p>
          <button
            className="mt-2 rounded-lg border border-stone-500 px-3 py-2 text-stone-100 disabled:opacity-50"
            data-testid="marker-status-retry-btn"
            disabled={loading || controller === null || activeMissionId === null}
            onClick={() => void controller?.refreshMission(activeMissionId)}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : null}
      {error !== null ? (
        <div className={loadError === null ? '' : 'mt-3 border-t border-rose-400/30 pt-3'}>
          <p>Marker could not be placed or opened: {error}</p>
          <button
            className="mt-2 rounded-lg border border-stone-500 px-3 py-2 text-stone-100 disabled:opacity-50"
            data-testid="marker-status-dismiss-btn"
            disabled={controller === null}
            onClick={() => controller?.dismissError()}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  )
}
