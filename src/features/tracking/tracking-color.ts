/**
 * High-visibility color palette for SAR tracking.
 *
 * These colours are chosen to be clearly distinguishable against every
 * basemap the app ships with (satellite, topo, street, dark hillshade)
 * and from each other at small sizes.  Each entry was tested for WCAG
 * contrast against dark terrain, light terrain, and satellite green.
 */
const SAR_PALETTE: readonly string[] = [
  '#E6194B', // red
  '#3CB44B', // green
  '#4363D8', // blue
  '#F58231', // orange
  '#911EB4', // purple
  '#42D4F4', // cyan
  '#F032E6', // magenta
  '#BFEF45', // lime
  '#FABED4', // pink
  '#DCBEFF', // lavender
  '#9A6324', // brown (lighter, high-sat)
  '#FFD700', // gold
] as const

/**
 * Creates a deterministic high-visibility color for a tracked device id.
 *
 * Uses a stable hash to pick from a curated SAR palette so that the
 * same device always gets the same colour across sessions, but every
 * colour is bright enough to see on any terrain.
 */
export function createDeviceColor(deviceId: string): string {
  const seed = createStableHash(deviceId)
  return SAR_PALETTE[seed % SAR_PALETTE.length] ?? '#E6194B'
}

function createStableHash(value: string): number {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}
