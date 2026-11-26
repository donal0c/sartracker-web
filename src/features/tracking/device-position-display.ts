import { formatIrishGridReference, isWithinIreland, wgs84ToTM65 } from '../../lib/coordinates'

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
    return {
      kind: 'irish_grid',
      primary: formatIrishGridReference(...wgs84ToTM65(latitude, longitude)),
      secondary,
    }
  } catch (error) {
    // A point on the very edge of the Irish envelope can fall outside the TM65 grid.
    // Say so rather than crash the card or guess a reference.
    if (error instanceof RangeError) {
      return { kind: 'grid_unavailable', primary: 'Irish Grid unavailable', secondary }
    }
    throw error
  }
}

function isReadableWgs84(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  )
}
