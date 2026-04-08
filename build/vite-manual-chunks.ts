const REACT_VENDOR_SEGMENTS = ['/react/', '/react-dom/', '/scheduler/']
const MAP_VENDOR_SEGMENTS = ['/maplibre-gl/']
const GEODESY_VENDOR_SEGMENTS = ['/proj4/']

function includesAny(id: string, segments: readonly string[]): boolean {
  return segments.some((segment) => id.includes(segment))
}

/**
 * Groups heavy vendor libraries into stable chunks so the lazy-loaded map route
 * does not collapse into one oversized artifact.
 */
export function createManualChunk(id: string): string | undefined {
  if (!id.includes('/node_modules/')) {
    return undefined
  }

  if (includesAny(id, REACT_VENDOR_SEGMENTS)) {
    return 'react-vendor'
  }

  if (includesAny(id, MAP_VENDOR_SEGMENTS)) {
    return 'map-vendor'
  }

  if (includesAny(id, GEODESY_VENDOR_SEGMENTS)) {
    return 'geodesy-vendor'
  }

  return undefined
}
