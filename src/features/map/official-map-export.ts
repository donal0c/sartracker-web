import type { OfficialMapId } from '../../lib/map-config'

export const OFFICIAL_MAP_TILE_PROTOCOL = 'sartracker-official-map'
export const OFFICIAL_MAP_TILE_SIZE = 256

export type OfficialMapTileRequest = {
  readonly mapId: OfficialMapId
  readonly z: number
  readonly x: number
  readonly y: number
}

export type MapGenieExportRequestInput = OfficialMapTileRequest & {
  readonly serviceUrl: string
  readonly username: string
  readonly password: string
}

export type MapGenieExportRequest = {
  readonly url: string
  readonly authorizationHeader: string
}

const WEB_MERCATOR_HALF_WORLD_METRES = 20037508.342789244
const OFFICIAL_MAP_TILE_PATTERN = /^\/?tile\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png$/u

/**
 * Builds the app-owned tile URL template consumed by MapLibre.
 */
export function buildOfficialMapTileTemplate(mapId: OfficialMapId): string {
  return `${OFFICIAL_MAP_TILE_PROTOCOL}://tile/${mapId}/{z}/{x}/{y}.png`
}

/**
 * Parses the custom-protocol tile URL emitted by the official map style.
 */
export function parseOfficialMapTileUrl(url: string): OfficialMapTileRequest {
  const parsed = new URL(url)
  if (parsed.protocol !== `${OFFICIAL_MAP_TILE_PROTOCOL}:`) {
    throw new Error('Official map tile URL uses an unexpected protocol.')
  }

  const path = `${parsed.hostname}${parsed.pathname}`
  const match = OFFICIAL_MAP_TILE_PATTERN.exec(path)
  if (match === null) {
    throw new Error('Official map tile URL is malformed.')
  }

  return {
    mapId: readOfficialMapId(match[1]!),
    z: readTileCoordinate(match[2]!, 'z'),
    x: readTileCoordinate(match[3]!, 'x'),
    y: readTileCoordinate(match[4]!, 'y'),
  }
}

/**
 * Builds the upstream ArcGIS REST export request for one Web Mercator tile.
 * Credentials are returned only as an Authorization header, never in the URL.
 */
export function buildMapGenieExportRequest(
  input: MapGenieExportRequestInput,
): MapGenieExportRequest {
  const url = new URL(`${normalizeMapServerUrl(input.serviceUrl)}/export`)
  url.searchParams.set('bbox', tileToWebMercatorBbox(input))
  url.searchParams.set('bboxSR', '3857')
  url.searchParams.set('imageSR', '3857')
  url.searchParams.set('size', `${OFFICIAL_MAP_TILE_SIZE},${OFFICIAL_MAP_TILE_SIZE}`)
  url.searchParams.set('format', 'png32')
  url.searchParams.set('transparent', 'false')
  url.searchParams.set('f', 'image')

  return {
    url: url.toString(),
    authorizationHeader: `Basic ${btoa(`${input.username}:${input.password}`)}`,
  }
}

function tileToWebMercatorBbox(input: OfficialMapTileRequest): string {
  const tilesPerAxis = 2 ** input.z
  const tileSizeMetres = (WEB_MERCATOR_HALF_WORLD_METRES * 2) / tilesPerAxis
  const minX = -WEB_MERCATOR_HALF_WORLD_METRES + input.x * tileSizeMetres
  const maxX = minX + tileSizeMetres
  const maxY = WEB_MERCATOR_HALF_WORLD_METRES - input.y * tileSizeMetres
  const minY = maxY - tileSizeMetres

  return [minX, minY, maxX, maxY].map(formatBboxNumber).join(',')
}

function normalizeMapServerUrl(serviceUrl: string): string {
  const parsed = new URL(serviceUrl.trim())
  const lowerPath = parsed.pathname.toLowerCase()
  const mapServerPathEnd = lowerPath.indexOf('/mapserver')
  if (mapServerPathEnd !== -1) {
    parsed.pathname = parsed.pathname.slice(0, mapServerPathEnd + '/MapServer'.length)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/+$/u, '')
  }

  const trimmed = serviceUrl.trim().replace(/\/+$/u, '')
  return trimmed.endsWith('/wmts') ? trimmed.slice(0, -5) : trimmed
}

function readTileCoordinate(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Official map tile ${label} coordinate is invalid.`)
  }
  return parsed
}

function readOfficialMapId(value: string): OfficialMapId {
  if (
    value === 'official_discovery_topo' ||
    value === 'official_premium_basemap' ||
    value === 'official_aerial_imagery' ||
    value === 'official_high_resolution_imagery'
  ) {
    return value
  }

  throw new Error(`Unknown official map id: ${value}`)
}

function formatBboxNumber(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/u, '')
}
