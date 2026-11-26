import {
  formatIrishGridReference,
  isWithinIreland,
  parseIrishGridReference,
  tm65ToWgs84,
  wgs84ToTM65,
} from '../../lib/coordinates'

/**
 * Which state a device's written-out position is in. Only `irish_grid` carries a grid
 * reference; every other state says plainly why there is none.
 */
export type DevicePositionDisplayKind =
  | 'irish_grid'
  | 'outside_ireland'
  | 'grid_unavailable'
  | 'no_position'
  | 'unreadable'

/** A device position as the selected device card shows it: Irish Grid first, lat/lon beneath. */
export type DevicePositionDisplay = {
  readonly kind: DevicePositionDisplayKind
  /** The large line: the Irish Grid reference, or the reason there is none. */
  readonly primary: string
  /** Decimal latitude, longitude beneath it, or null when there is no readable position. */
  readonly secondary: string | null
}

const LAT_LON_DECIMALS = 5

/**
 * Formats a device's stored WGS84 position for the selected device card [DON-377].
 *
 * Display only: the stored position is never changed. The team reads Irish Grid first,
 * so the grid reference is the primary line and decimal lat/lon sits beneath it. A
 * position outside Ireland says "Outside Ireland", as the coordinate bar does. A missing
 * position says "No position", and a non-finite or out-of-range value says the position
 * cannot be read; neither ever shows a grid reference.
 */
export function formatDevicePositionDisplay(
  latitude: number | null,
  longitude: number | null,
): DevicePositionDisplay {
  if (latitude === null || longitude === null) {
    return { kind: 'no_position', primary: 'No position', secondary: null }
  }
  if (!isReadableWgs84(latitude, longitude)) {
    return { kind: 'unreadable', primary: 'Position unreadable', secondary: null }
  }

  const secondary = `${latitude.toFixed(LAT_LON_DECIMALS)}, ${longitude.toFixed(LAT_LON_DECIMALS)}`
  if (!isWithinIreland(latitude, longitude)) {
    return { kind: 'outside_ireland', primary: 'Outside Ireland', secondary }
  }

  try {
    const gridReference = formatIrishGridReference(...wgs84ToTM65(latitude, longitude))
    // The operator may type this reference into Convert or the marker form. Show only a
    // reference that converts back inside Ireland, so the card never offers one the app
    // itself would reject (a metre cell truncated just past the envelope edge).
    tm65ToWgs84(...parseIrishGridReference(gridReference))
    return { kind: 'irish_grid', primary: gridReference, secondary }
  } catch (error) {
    // A point on the very edge of the Irish envelope can fall outside the TM65 grid, or
    // its reference may not convert back. Say so rather than crash the card or guess a
    // reference, and leave a trace for the support report.
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`Irish Grid unavailable for device position ${secondary}: ${reason}`)
    return { kind: 'grid_unavailable', primary: 'Irish Grid unavailable', secondary }
  }
}

/** Reports whether a latitude/longitude pair is finite and inside the WGS84 range. */
function isReadableWgs84(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  )
}
