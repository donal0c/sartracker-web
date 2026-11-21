import { useGpxStore } from '../features/gpx/gpx-store'

/**
 * Tells the operator, on the map itself, when it does not show every imported GPX track or could not be
 * refreshed. A track is never silently absent from the map [DON-350] [M-87].
 */
export function GpxMapCoverageNotice() {
  const notice = useGpxStore((state) => state.mapCoverageNotice)
  if (notice === null) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-auto absolute bottom-[10rem] left-4 z-10 max-w-[min(24rem,calc(100%-2rem))] border border-amber-300/80 bg-stone-950/95 px-3 py-1.5 text-[11px] font-bold text-amber-100 shadow-lg shadow-black/40"
      data-testid="gpx-map-coverage-notice"
      role="status"
    >
      {notice}
    </div>
  )
}
