/**
 * High-visibility color palette for SAR tracking.
 *
 * These colours are chosen to be clearly distinguishable against every
 * basemap the app ships with (satellite, topo, street, dark hillshade)
 * and from each other at small sizes.  Each entry was tested for WCAG
 * contrast against dark terrain, light terrain, and satellite green.
 */
const SAR_PALETTE: readonly string[] = [
  '#00B8FF', // sky blue
  '#FFB000', // amber
  '#FF4F79', // rose
  '#B8F000', // lime
  '#8B5CF6', // violet
  '#00E0A4', // mint
  '#FF7A00', // orange
  '#F032E6', // magenta
  '#4363D8', // blue
  '#F0E442', // yellow
  '#D55E00', // vermilion
  '#CC79A7', // purple-pink
] as const

/**
 * Creates a deterministic high-visibility color for a tracked device id.
 *
 * Uses a stable hash to pick from a curated SAR palette so that the
 * same device always gets the same colour across sessions, but every
 * colour is bright enough to see on any terrain.
 */
export function createDeviceColor(deviceId: string): string {
  const numericDeviceId = Number(deviceId)
  if (Number.isInteger(numericDeviceId) && numericDeviceId > 0) {
    return SAR_PALETTE[(numericDeviceId - 1) % SAR_PALETTE.length] ?? '#00B8FF'
  }

  const seed = createStableHash(deviceId)
  return SAR_PALETTE[seed % SAR_PALETTE.length] ?? '#00B8FF'
}

function createStableHash(value: string): number {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}
