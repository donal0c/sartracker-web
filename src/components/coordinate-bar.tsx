import type { ReactNode } from 'react'

import {
  formatIrishGridReference,
  formatWGS84Degrees,
  formatWGS84Dms,
  wgs84ToTM65,
} from '../lib/coordinates'
import { useCoordinateToolStore } from '../features/coordinates/coordinate-tool-store'
import { useMapTargetStore } from '../features/map/map-target-store'

type CoordinateBarProps = {
  readonly latitude: number | null
  readonly longitude: number | null
}

export function CoordinateBar({ latitude, longitude }: CoordinateBarProps) {
  const openDialog = useCoordinateToolStore((state) => state.openDialog)
  const activeTarget = useMapTargetStore((state) => state.activeTarget)

  let wgs84Display: string | null = null
  let gridDisplay: string | null = null
  let dmsDisplay: string | null = null
  if (latitude !== null && longitude !== null) {
    wgs84Display = formatWGS84Degrees(latitude, longitude)
    const [easting, northing] = wgs84ToTM65(latitude, longitude)
    gridDisplay = formatIrishGridReference(easting, northing)
    dmsDisplay = formatWGS84Dms(latitude, longitude)
  }
  const content =
    wgs84Display !== null && gridDisplay !== null && dmsDisplay !== null
      ? `${wgs84Display}  |  ${gridDisplay}  |  ${dmsDisplay}`
      : '—'

  return (
    <div
      className="sar-instrument-strip absolute inset-x-0 bottom-0 z-10 font-mono text-base font-semibold text-stone-100"
      data-testid="coordinate-display"
    >
      <div className="grid min-h-[72px] grid-cols-[1fr_auto]">
        <span data-testid="coords-combined" className="sr-only">{content}</span>

        <div className="flex min-w-0 items-center gap-4 overflow-hidden px-4">
          <InstrumentCell label="DD" valueClassName="text-stone-100" testId="coords-wgs84">
            {wgs84Display}
          </InstrumentCell>
          <span
            aria-hidden="true"
            className="text-stone-500"
          >
            |
          </span>
          <InstrumentCell
            label="Irish Grid"
            valueClassName="text-amber-100"
            testId="coords-grid"
          >
            {gridDisplay}
          </InstrumentCell>
          <span
            aria-hidden="true"
            className="text-stone-500"
          >
            |
          </span>
          <InstrumentCell label="DMS" valueClassName="text-stone-100" testId="coords-dms">
            {dmsDisplay}
          </InstrumentCell>
        </div>

        <div className="flex shrink-0 items-center justify-center gap-2 border-l border-[var(--sar-line)] px-4">
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
  readonly valueClassName?: string
  readonly children: ReactNode
  readonly testId?: string
}) {
  const value = props.children ?? '—'

  return (
    <div className="flex min-w-0 flex-col justify-center">
      <p className="sar-meta-label">
        {props.label}
      </p>
      <p className={`mt-1 truncate text-[17px] font-black leading-none ${props.valueClassName ?? ''}`}>
        <span data-testid={props.testId}>{value}</span>
      </p>
    </div>
  )
}
