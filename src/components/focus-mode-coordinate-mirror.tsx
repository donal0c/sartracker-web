import { formatMapCoordinateBar } from '../lib/coordinates'
import { readCoordinateDisplayMode } from '../lib/coordinate-preferences'

type FocusModeCoordinateMirrorProps = {
  readonly latitude: number | null
  readonly longitude: number | null
}

/**
 * Mirrors live cursor coordinates inside focus mode, where normal chrome is reduced.
 */
export function FocusModeCoordinateMirror({
  latitude,
  longitude,
}: FocusModeCoordinateMirrorProps) {
  const mode = readCoordinateDisplayMode()
  const coordinateText =
    latitude === null || longitude === null
      ? 'Move over map for coordinates'
      : formatMapCoordinateBar(latitude, longitude, mode)

  return (
    <div
      className="pointer-events-none absolute left-4 bottom-16 z-20 rounded-xl border border-amber-500/30 bg-[rgba(9,8,7,0.94)] px-4 py-3 font-mono text-sm font-semibold text-stone-100 shadow-2xl shadow-black/40"
      data-testid="focus-mode-coordinate-mirror"
    >
      <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
        Focus Coordinates
      </p>
      <p className="mt-1" data-testid="focus-mode-coordinate-display">
        {coordinateText}
      </p>
    </div>
  )
}
