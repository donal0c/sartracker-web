const WEB_MERCATOR_EQUATOR_METRES_PER_PIXEL = 156_543.033_928_040_97
const NICE_DISTANCE_STEPS = [1, 2, 5] as const

export type MapScaleReadout = {
  readonly distanceM: number
  readonly label: string
  readonly widthPx: number
}

export type BuildMapScaleReadoutInput = {
  readonly latitude: number
  readonly zoom: number
  readonly targetWidthPx?: number
}

/**
 * Selects a rounded scale distance that fits inside the available pixel width.
 */
export function chooseMapScaleDistance(metresPerPixel: number, targetWidthPx = 140): number {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) {
    return 0
  }

  const targetDistanceM = metresPerPixel * targetWidthPx
  const exponent = Math.floor(Math.log10(targetDistanceM))
  let selected = 10 ** exponent

  for (const step of NICE_DISTANCE_STEPS) {
    const candidate = step * 10 ** exponent
    if (candidate <= targetDistanceM) {
      selected = candidate
    }
  }

  return selected
}

/**
 * Formats map scale distances in metres or kilometres for quick operator reading.
 */
export function formatMapScaleDistance(distanceM: number): string {
  if (distanceM < 1_000) {
    return `${Math.round(distanceM)} m`
  }

  const distanceKm = distanceM / 1_000
  return Number.isInteger(distanceKm) ? `${distanceKm} km` : `${distanceKm.toFixed(1)} km`
}

/**
 * Builds the visible map-scale readout from the current MapLibre camera.
 */
export function buildMapScaleReadout(input: BuildMapScaleReadoutInput): MapScaleReadout {
  const targetWidthPx = input.targetWidthPx ?? 140
  const latitudeRadians = clampLatitude(input.latitude) * (Math.PI / 180)
  const metresPerPixel =
    (WEB_MERCATOR_EQUATOR_METRES_PER_PIXEL * Math.cos(latitudeRadians)) / 2 ** input.zoom
  const distanceM = chooseMapScaleDistance(metresPerPixel, targetWidthPx)
  const widthPx = distanceM > 0 ? Math.max(1, distanceM / metresPerPixel) : 0

  return {
    distanceM,
    label: formatMapScaleDistance(distanceM),
    widthPx: Math.min(targetWidthPx, widthPx),
  }
}

/**
 * Keeps Web Mercator scale calculations inside the usable projection range.
 */
function clampLatitude(latitude: number): number {
  if (!Number.isFinite(latitude)) {
    return 0
  }

  return Math.max(-85, Math.min(85, latitude))
}
