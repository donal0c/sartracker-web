import { useLayoutEffect, useRef, type ReactNode } from 'react'

import {
  formatIrishGridReference,
  formatWGS84Degrees,
  formatWGS84Dms,
  isWithinIreland,
  wgs84ToTM65,
} from '../lib/coordinates'
import { useCoordinateToolStore } from '../features/coordinates/coordinate-tool-store'

type CoordinateBarProps = {
  readonly latitude: number | null
  readonly longitude: number | null
  /** Whose position the readouts are: under the pointer, or the map centre before any pointer. */
  readonly source: 'cursor' | 'map-centre'
}

/** Caption naming whose position the readouts are, so none can be taken for a person's (DON-372). */
const READOUT_OWNER_CAPTION: Record<CoordinateBarProps['source'], string> = {
  cursor: 'Cursor position',
  'map-centre': 'Map centre',
}

/** Height of the coordinate bar; map chrome above it (scale, Map Tools) keeps clear of it. */
export const COORDINATE_BAR_HEIGHT_VAR = '--sar-coordinate-bar-height'

type CoordinateDisplayParts = {
  readonly wgs84Display: string
  readonly gridDisplay: string
  readonly dmsDisplay: string
}

/**
 * Bottom strip showing the position under the cursor (DD, Irish Grid, DMS) and the Convert button;
 * before the pointer is over the map it shows the map centre and says so. Every readout here
 * belongs to the cursor or map centre, never to a person or marker: no name may sit beside
 * these values, or a coordinator could read the cursor's grid over the radio as someone's
 * position (DON-372). A person's own position belongs with that person, with its age.
 */
export function CoordinateBar({ latitude, longitude, source }: CoordinateBarProps) {
  const ownerCaption = READOUT_OWNER_CAPTION[source]
  const openDialog = useCoordinateToolStore((state) => state.openDialog)
  const barRef = useRef<HTMLDivElement>(null)

  // The readouts wrap onto more rows on a narrow map (DON-368), so publish the real height.
  useLayoutEffect(() => {
    const bar = barRef.current
    if (bar === null) return undefined
    const root = document.documentElement
    const publish = () => root.style.setProperty(COORDINATE_BAR_HEIGHT_VAR, `${bar.getBoundingClientRect().height}px`)
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(bar)
    return () => {
      observer?.disconnect()
      root.style.removeProperty(COORDINATE_BAR_HEIGHT_VAR)
    }
  }, [])

  const displays =
    latitude !== null && longitude !== null
      ? formatCoordinateDisplayParts(latitude, longitude)
      : null
  const wgs84Display = displays?.wgs84Display ?? null
  const gridDisplay = displays?.gridDisplay ?? null
  const dmsDisplay = displays?.dmsDisplay ?? null
  const content =
    wgs84Display !== null && gridDisplay !== null && dmsDisplay !== null
      ? `${ownerCaption}: ${wgs84Display}  |  ${gridDisplay}  |  ${dmsDisplay}`
      : '—'

  return (
    <div
      ref={barRef}
      className="sar-instrument-strip absolute inset-x-0 bottom-0 z-10 font-mono text-base font-semibold text-stone-100"
      data-testid="coordinate-display"
    >
      <div className="sar-coordinate-grid grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch">
        <span data-testid="coords-combined" className="sr-only">{content}</span>

        <div aria-hidden="true" className="sar-coordinate-spacer" />

        <div className="flex min-w-0 flex-col justify-center">
          <p
            aria-hidden="true"
            className="sar-meta-label sar-coordinate-label px-4 text-center leading-none max-[1320px]:px-3"
            data-testid="coordinate-readout-owner"
          >
            {ownerCaption}
          </p>
          <div
            className="sar-coordinate-readouts flex min-w-0 items-center justify-center gap-4 overflow-hidden px-4 max-[1320px]:gap-2 max-[1320px]:px-3"
            data-testid="coordinate-readout-group"
          >
            <InstrumentCell label="DD" valueClassName="text-stone-100" testId="coords-wgs84">
              {wgs84Display}
            </InstrumentCell>
            <span
              aria-hidden="true"
              className="sar-coordinate-separator text-stone-500"
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
              className="sar-coordinate-separator text-stone-500"
            >
              |
            </span>
            <InstrumentCell label="DMS" valueClassName="text-stone-100" testId="coords-dms">
              {dmsDisplay}
            </InstrumentCell>
          </div>
        </div>

        <div className="sar-coordinate-actions flex min-w-0 items-center justify-end gap-2 border-l border-[var(--sar-line)] px-4">
          <button
            className="sar-button px-4 py-2 text-xs font-sans font-bold uppercase tracking-[0.1em] max-[1320px]:px-3"
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

function formatCoordinateDisplayParts(
  latitude: number,
  longitude: number,
): CoordinateDisplayParts | null {
  try {
    const wgs84Display = formatWGS84Degrees(latitude, longitude)
    const dmsDisplay = formatWGS84Dms(latitude, longitude)
    // The Irish Grid / TM65 reference is only meaningful inside Ireland. The cursor
    // routinely tracks out to sea, so we show an explicit "outside Ireland" state
    // rather than fabricating a plausible-looking grid reference for an offshore point.
    const gridDisplay = isWithinIreland(latitude, longitude)
      ? formatIrishGridReference(...wgs84ToTM65(latitude, longitude))
      : 'Outside Ireland'
    return { wgs84Display, gridDisplay, dmsDisplay }
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      return null
    }
    throw error
  }
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
      <p className="sar-meta-label sar-coordinate-label">
        {props.label}
      </p>
      <p className={`sar-coordinate-value mt-1 truncate text-[17px] font-black leading-none max-[1320px]:text-[14px] ${props.valueClassName ?? ''}`}>
        <span data-testid={props.testId}>{value}</span>
      </p>
    </div>
  )
}
