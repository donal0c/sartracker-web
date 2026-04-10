import { formatMapCoordinateBar } from '../lib/coordinates'
import { readCoordinateDisplayMode } from '../lib/coordinate-preferences'

type CoordinateBarProps = {
  readonly latitude: number | null
  readonly longitude: number | null
}

export function CoordinateBar({ latitude, longitude }: CoordinateBarProps) {
  const mode = readCoordinateDisplayMode()
  const content =
    latitude === null || longitude === null ? '—' : formatMapCoordinateBar(latitude, longitude, mode)

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 border-t border-stone-700 bg-stone-950/90 px-4 py-2 font-mono text-sm text-stone-100 backdrop-blur"
      data-testid="coordinate-display"
    >
      <span data-testid="coords-combined">{content}</span>
    </div>
  )
}
