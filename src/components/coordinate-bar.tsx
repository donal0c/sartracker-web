import { formatMapCoordinateBar } from '../lib/coordinates'
import { useCoordinateToolStore } from '../features/coordinates/coordinate-tool-store'
import { readCoordinateDisplayMode } from '../lib/coordinate-preferences'

type CoordinateBarProps = {
  readonly latitude: number | null
  readonly longitude: number | null
}

export function CoordinateBar({ latitude, longitude }: CoordinateBarProps) {
  const mode = readCoordinateDisplayMode()
  const openDialog = useCoordinateToolStore((state) => state.openDialog)
  const activeTarget = useCoordinateToolStore((state) => state.activeTarget)
  const content =
    latitude === null || longitude === null ? '—' : formatMapCoordinateBar(latitude, longitude, mode)

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 border-t border-stone-700 bg-stone-950/90 px-4 py-2 font-mono text-sm text-stone-100 backdrop-blur"
      data-testid="coordinate-display"
    >
      <div className="flex items-center justify-between gap-4">
        <span data-testid="coords-combined">{content}</span>
        <div className="flex items-center gap-2">
          {activeTarget !== null ? (
            <span
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-sans font-semibold uppercase tracking-[0.2em] text-amber-100"
              data-testid="coordinate-target-indicator"
            >
              Target Active
            </span>
          ) : null}
          <button
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-1 text-[11px] font-sans font-semibold uppercase tracking-[0.2em] text-stone-200"
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
