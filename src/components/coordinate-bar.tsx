import type { ReactNode } from 'react'

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
      className="sar-instrument-strip absolute inset-x-0 bottom-0 z-10 font-mono text-base font-semibold text-stone-100"
      data-testid="coordinate-display"
    >
      <div className="grid min-h-[72px] grid-cols-[minmax(15rem,1.2fr)_minmax(12rem,1fr)_8rem_8rem_auto]">
        <span data-testid="coords-combined" className="sr-only">{content}</span>

        <InstrumentCell label={mode === 'tm65_first' ? 'Irish Grid' : 'Coordinates'}>
          {wgs84Display !== null && gridDisplay !== null ? (
            mode === 'tm65_first' ? (
              <span className="text-amber-100" data-testid="coords-grid">{gridDisplay}</span>
            ) : (
              <span className="text-stone-100" data-testid="coords-wgs84">{wgs84Display}</span>
            )
          ) : (
            <span>—</span>
          )}
        </InstrumentCell>

        <InstrumentCell label={mode === 'tm65_first' ? 'Coordinates' : 'Irish Grid'}>
          {wgs84Display !== null && gridDisplay !== null ? (
            mode === 'tm65_first' ? (
              <span className="text-stone-100" data-testid="coords-wgs84">{wgs84Display}</span>
            ) : (
              <span className="text-amber-100" data-testid="coords-grid">{gridDisplay}</span>
            )
          ) : (
            <span>—</span>
          )}
        </InstrumentCell>

        <InstrumentCell label="Map CRS">
          <span className="text-stone-100">WGS84</span>
        </InstrumentCell>

        <InstrumentCell label="Work CRS">
          <span className="text-stone-100">ITM</span>
        </InstrumentCell>

        <div className="flex items-center gap-2 border-l border-[var(--sar-line)] px-4">
          {activeTarget !== null ? (
            <span
              className="border border-amber-500/40 bg-amber-500/12 px-2 py-1 text-[11px] font-sans font-bold uppercase tracking-[0.2em] text-amber-100"
              data-testid="coordinate-target-indicator"
            >
              {activeTarget.label ?? 'Target Active'}
            </span>
          ) : null}
          <button
            className="sar-button px-4 py-2 text-xs font-sans font-bold uppercase tracking-[0.1em]"
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

function InstrumentCell(props: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col justify-center border-l border-[var(--sar-line)] px-4 first:border-l-0">
      <p className="sar-meta-label">
        {props.label}
      </p>
      <p className="mt-1 truncate text-[17px] font-black leading-none">
        {props.children}
      </p>
    </div>
  )
}
