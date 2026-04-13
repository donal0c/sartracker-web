import { formatWGS84Degrees, formatIrishGridReference, wgs84ToTM65, formatMapCoordinateBar } from '../lib/coordinates'
import { useCoordinateToolStore } from '../features/coordinates/coordinate-tool-store'
import { useMapTargetStore } from '../features/map/map-target-store'
import { readCoordinateDisplayMode } from '../lib/coordinate-preferences'

type CoordinateBarProps = {
  readonly latitude: number | null
  readonly longitude: number | null
}

export function CoordinateBar({ latitude, longitude }: CoordinateBarProps) {
  const mode = readCoordinateDisplayMode()
  const openDialog = useCoordinateToolStore((state) => state.openDialog)
  const activeTarget = useMapTargetStore((state) => state.activeTarget)
  const content =
    latitude === null || longitude === null ? '—' : formatMapCoordinateBar(latitude, longitude, mode)

  let wgs84Display: string | null = null
  let gridDisplay: string | null = null
  if (latitude !== null && longitude !== null) {
    wgs84Display = formatWGS84Degrees(latitude, longitude)
    const [easting, northing] = wgs84ToTM65(latitude, longitude)
    gridDisplay = formatIrishGridReference(easting, northing)
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 border-t border-stone-700 bg-stone-950/90 px-4 py-2.5 font-mono text-base font-semibold text-stone-100 backdrop-blur"
      data-testid="coordinate-display"
    >
      <div className="flex items-center justify-between gap-4">
        <span data-testid="coords-combined" className="sr-only">{content}</span>
        {wgs84Display !== null && gridDisplay !== null ? (
          mode === 'tm65_first' ? (
            <span className="flex items-center gap-3">
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-100" data-testid="coords-grid">{gridDisplay}</span>
              <span className="text-stone-400">|</span>
              <span className="text-stone-300" data-testid="coords-wgs84">{wgs84Display}</span>
            </span>
          ) : (
            <span className="flex items-center gap-3">
              <span className="text-stone-300" data-testid="coords-wgs84">{wgs84Display}</span>
              <span className="text-stone-400">|</span>
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-100" data-testid="coords-grid">{gridDisplay}</span>
            </span>
          )
        ) : (
          <span>—</span>
        )}
        <div className="flex items-center gap-2">
          {activeTarget !== null ? (
            <span
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-sans font-semibold uppercase tracking-[0.2em] text-amber-100"
              data-testid="coordinate-target-indicator"
            >
              {activeTarget.label ?? 'Target Active'}
            </span>
          ) : null}
          <button
            className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-1 text-xs font-sans font-semibold text-stone-200"
            data-testid="open-coordinate-converter"
            onClick={() => openDialog()}
            type="button"
          >
            Convert
          </button>
        </div>
      </div>
    </div>
  )
}
