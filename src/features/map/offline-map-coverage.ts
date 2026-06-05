import { buildTileUrl, getBasemapById, type BasemapId } from '../../lib/map-config'

export const MAP_TILE_CACHE_NAME = 'sartracker-map-tiles-v1'

export type OfflineMapTileCoordinate = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type OfflineMapCoverageBounds = {
  readonly east: number
  readonly north: number
  readonly south: number
  readonly west: number
}

export type OfflineMapCoverageStatus =
  | 'unchecked'
  | 'checking'
  | 'complete'
  | 'partial'
  | 'missing'
  | 'unavailable'
  | 'error'

export type OfflineMapCoverageTone = 'neutral' | 'success' | 'warning' | 'danger'

export type OfflineMapCoverage = {
  readonly cachedTiles: number | null
  readonly detail: string
  readonly label: string
  readonly status: OfflineMapCoverageStatus
  readonly tone: OfflineMapCoverageTone
  readonly totalTiles: number | null
  readonly zoom: number | null
}

export type OfflineMapCoverageSummaryInput = {
  readonly basemapLabel: string
  readonly cachedTiles: number
  readonly totalTiles: number
  readonly zoom: number
}

export type OfficialOfflineMapCoverageInput = {
  readonly basemapLabel: string
  readonly packageBounds: readonly [number, number, number, number]
  readonly viewBounds: OfflineMapCoverageBounds
  readonly zoom: number
}

const WEB_MERCATOR_LATITUDE_LIMIT = 85.05112878

/**
 * Creates the initial operator-facing coverage state before a preflight check.
 */
export function createUncheckedOfflineMapCoverage(): OfflineMapCoverage {
  return {
    cachedTiles: null,
    detail: 'Check the current map view before relying on offline tiles.',
    label: 'Current view not checked',
    status: 'unchecked',
    tone: 'neutral',
    totalTiles: null,
    zoom: null,
  }
}

/**
 * Creates the transient coverage state shown while cache entries are inspected.
 */
export function createCheckingOfflineMapCoverage(): OfflineMapCoverage {
  return {
    cachedTiles: null,
    detail: 'Inspecting cached tiles for the visible map area.',
    label: 'Checking current view',
    status: 'checking',
    tone: 'neutral',
    totalTiles: null,
    zoom: null,
  }
}

/**
 * Creates a coverage state for runtimes that cannot inspect offline map tiles.
 */
export function createUnavailableOfflineMapCoverage(detail: string): OfflineMapCoverage {
  return {
    cachedTiles: null,
    detail,
    label: 'Coverage check unavailable',
    status: 'unavailable',
    tone: 'danger',
    totalTiles: null,
    zoom: null,
  }
}

/**
 * Creates a coverage state for unexpected cache-inspection failures.
 */
export function createErroredOfflineMapCoverage(): OfflineMapCoverage {
  return {
    cachedTiles: null,
    detail: 'Tile cache coverage could not be checked. Keep network available.',
    label: 'Coverage check failed',
    status: 'error',
    tone: 'danger',
    totalTiles: null,
    zoom: null,
  }
}

/**
 * Summarizes tile-cache coverage in language operators can act on.
 */
export function describeOfflineMapCoverage(
  input: OfflineMapCoverageSummaryInput,
): OfflineMapCoverage {
  const detail = `${input.cachedTiles}/${input.totalTiles} ${input.basemapLabel} tiles cached for z${input.zoom}.`

  if (input.totalTiles <= 0) {
    return createUnavailableOfflineMapCoverage('No visible map tiles could be calculated.')
  }

  if (input.cachedTiles === input.totalTiles) {
    return {
      cachedTiles: input.cachedTiles,
      detail,
      label: 'Current view cached',
      status: 'complete',
      tone: 'success',
      totalTiles: input.totalTiles,
      zoom: input.zoom,
    }
  }

  if (input.cachedTiles === 0) {
    return {
      cachedTiles: input.cachedTiles,
      detail,
      label: 'Current view not cached',
      status: 'missing',
      tone: 'danger',
      totalTiles: input.totalTiles,
      zoom: input.zoom,
    }
  }

  return {
    cachedTiles: input.cachedTiles,
    detail,
    label: 'Current view partially cached',
    status: 'partial',
    tone: 'warning',
    totalTiles: input.totalTiles,
    zoom: input.zoom,
  }
}

/**
 * Summarizes whether the visible official-map viewport is inside the local package bounds.
 */
export function describeOfficialOfflineMapCoverage(
  input: OfficialOfflineMapCoverageInput,
): OfflineMapCoverage {
  if (isViewInsidePackageBounds(input.viewBounds, input.packageBounds)) {
    return {
      cachedTiles: null,
      detail: `${input.basemapLabel}: current view is inside the registered official offline package at z${input.zoom}.`,
      label: 'Current view inside official offline area',
      status: 'complete',
      tone: 'success',
      totalTiles: null,
      zoom: input.zoom,
    }
  }

  return {
    cachedTiles: null,
    detail: `${input.basemapLabel}: current view is outside the registered official offline package. Use online maps or switch to a public fallback.`,
    label: 'Outside official offline area',
    status: 'missing',
    tone: 'danger',
    totalTiles: null,
    zoom: input.zoom,
  }
}

function isViewInsidePackageBounds(
  viewBounds: OfflineMapCoverageBounds,
  packageBounds: readonly [number, number, number, number],
): boolean {
  const [west, south, east, north] = packageBounds
  return (
    viewBounds.west >= west &&
    viewBounds.east <= east &&
    viewBounds.south >= south &&
    viewBounds.north <= north
  )
}

/**
 * Builds tile URLs for the active basemap and visible Web Mercator tile range.
 */
export function buildOfflineCoverageTileUrls(
  basemapId: BasemapId,
  bounds: OfflineMapCoverageBounds,
  zoom: number,
): readonly string[] {
  const basemap = getBasemapById(basemapId)

  return getTileCoordinatesForBounds(bounds, zoom).map((tile) =>
    buildTileUrl(basemap.tiles[0], tile.z, tile.x, tile.y),
  )
}

/**
 * Returns every slippy-map tile coordinate intersecting the provided bounds.
 */
export function getTileCoordinatesForBounds(
  bounds: OfflineMapCoverageBounds,
  zoom: number,
): readonly OfflineMapTileCoordinate[] {
  const normalizedZoom = Math.max(0, Math.floor(zoom))
  const maxTileIndex = 2 ** normalizedZoom - 1
  const west = clampLongitude(bounds.west)
  const east = clampLongitude(bounds.east)
  const south = clampLatitude(bounds.south)
  const north = clampLatitude(bounds.north)
  const westX = clampTileIndex(longitudeToTileX(west, normalizedZoom), maxTileIndex)
  const eastX = clampTileIndex(longitudeToTileX(east, normalizedZoom), maxTileIndex)
  const northY = clampTileIndex(latitudeToTileY(north, normalizedZoom), maxTileIndex)
  const southY = clampTileIndex(latitudeToTileY(south, normalizedZoom), maxTileIndex)
  const xRange = buildTileRange(westX, eastX, maxTileIndex)
  const yRange = buildNumericRange(Math.min(northY, southY), Math.max(northY, southY))

  return xRange.flatMap((x) =>
    yRange.map((y) => ({
      x,
      y,
      z: normalizedZoom,
    })),
  )
}

/**
 * Converts longitude to a slippy-map tile x index.
 */
export function longitudeToTileX(longitude: number, zoom: number): number {
  const normalizedZoom = Math.max(0, Math.floor(zoom))

  return Math.floor(((clampLongitude(longitude) + 180) / 360) * 2 ** normalizedZoom)
}

/**
 * Converts latitude to a slippy-map tile y index.
 */
export function latitudeToTileY(latitude: number, zoom: number): number {
  const normalizedZoom = Math.max(0, Math.floor(zoom))
  const radians = (clampLatitude(latitude) * Math.PI) / 180

  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
      2 ** normalizedZoom,
  )
}

/**
 * Builds a horizontal tile range, including wrapped anti-meridian ranges.
 */
function buildTileRange(westX: number, eastX: number, maxTileIndex: number): readonly number[] {
  if (westX <= eastX) {
    return buildNumericRange(westX, eastX)
  }

  return [...buildNumericRange(westX, maxTileIndex), ...buildNumericRange(0, eastX)]
}

/**
 * Builds an inclusive numeric range for bounded tile indexes.
 */
function buildNumericRange(start: number, end: number): readonly number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

/**
 * Clamps invalid or out-of-range longitude values before tile conversion.
 */
function clampLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) {
    return 0
  }

  return Math.max(-180, Math.min(180, longitude))
}

/**
 * Clamps latitude to the Web Mercator projection limit before tile conversion.
 */
function clampLatitude(latitude: number): number {
  if (!Number.isFinite(latitude)) {
    return 0
  }

  return Math.max(
    -WEB_MERCATOR_LATITUDE_LIMIT,
    Math.min(WEB_MERCATOR_LATITUDE_LIMIT, latitude),
  )
}

/**
 * Clamps a tile index into the valid range for the selected zoom level.
 */
function clampTileIndex(tileIndex: number, maxTileIndex: number): number {
  return Math.max(0, Math.min(maxTileIndex, tileIndex))
}
