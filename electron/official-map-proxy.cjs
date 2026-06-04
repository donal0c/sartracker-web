const fs = require('node:fs/promises')

const OFFICIAL_MAP_TILE_PATTERN = /^\/?tile\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png$/
const WEB_MERCATOR_HALF_WORLD_METRES = 20037508.342789244
const TILE_SIZE = 256

const SOURCE_NAMES = {
  official_discovery_topo: 'discovery',
  official_premium_basemap: 'basemap_premium',
  official_aerial_imagery: 'ortho',
  official_high_resolution_imagery: 'National_High_Resolution_Imagery',
}

/**
 * Creates the Electron main-process proxy for licensed official map imagery.
 */
function createElectronOfficialMapProxy(options) {
  return {
    fetchOfficialMapTile: (url) => fetchOfficialMapTile(options, url),
  }
}

async function fetchOfficialMapTile(options, url) {
  const settings = await options.loadSettings()
  const officialMaps = settings?.officialMaps
  if (
    officialMaps?.sourceType !== 'mapgenie_file' ||
    officialMaps.status !== 'configured' ||
    typeof officialMaps.sourcePath !== 'string' ||
    officialMaps.sourcePath.trim() === ''
  ) {
    throw new Error('Official maps are not configured.')
  }

  const tile = parseOfficialMapTileUrl(url)
  if (!Array.isArray(officialMaps.availableSources) || !officialMaps.availableSources.includes(tile.mapId)) {
    throw new Error('Requested official map source is not configured.')
  }

  const sourceDetails = parseSourceDetails(await fs.readFile(officialMaps.sourcePath, 'utf8'))
  const serviceUrl = sourceDetails.services[tile.mapId]
  if (serviceUrl === undefined) {
    throw new Error('Configured official map source file does not contain the requested service.')
  }
  if (sourceDetails.username === '' || sourceDetails.password === '') {
    throw new Error('Configured official map source file is missing credentials.')
  }

  const request = buildMapGenieExportRequest({
    ...tile,
    password: sourceDetails.password,
    serviceUrl,
    username: sourceDetails.username,
  })
  const response = await options.fetch(request.url, {
    headers: {
      authorization: request.authorizationHeader,
    },
  })

  if (!response.ok) {
    throw new Error(`Official map request failed with HTTP ${response.status}.`)
  }

  return {
    contentType: response.headers.get('content-type') ?? 'image/png',
    bytesBase64: Buffer.from(await response.arrayBuffer()).toString('base64'),
  }
}

function parseSourceDetails(contents) {
  const username = /^Username:\s*(\S+)/im.exec(contents)?.[1] ?? ''
  const password = /^Password:\s*(\S+)/im.exec(contents)?.[1] ?? ''
  const services = {}

  for (const [mapId, sourceName] of Object.entries(SOURCE_NAMES)) {
    const match = new RegExp(
      `\\b${escapeRegExp(sourceName)}\\b[^\\n]*(https?:\\/\\/\\S+)`,
      'i',
    ).exec(contents)
    if (match?.[1] !== undefined) {
      services[mapId] = match[1]
    }
  }

  return { username, password, services }
}

function parseOfficialMapTileUrl(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'sartracker-official-map:') {
    throw new Error('Official map tile URL uses an unexpected protocol.')
  }

  const match = OFFICIAL_MAP_TILE_PATTERN.exec(`${parsed.hostname}${parsed.pathname}`)
  if (match === null) {
    throw new Error('Official map tile URL is malformed.')
  }

  const mapId = match[1]
  if (!Object.hasOwn(SOURCE_NAMES, mapId)) {
    throw new Error(`Unknown official map id: ${mapId}`)
  }

  return {
    mapId,
    z: readTileCoordinate(match[2], 'z'),
    x: readTileCoordinate(match[3], 'x'),
    y: readTileCoordinate(match[4], 'y'),
  }
}

function buildMapGenieExportRequest(input) {
  const url = new URL(`${normalizeMapServerUrl(input.serviceUrl)}/export`)
  url.searchParams.set('bbox', tileToWebMercatorBbox(input))
  url.searchParams.set('bboxSR', '3857')
  url.searchParams.set('imageSR', '3857')
  url.searchParams.set('size', `${TILE_SIZE},${TILE_SIZE}`)
  url.searchParams.set('format', 'png32')
  url.searchParams.set('transparent', 'false')
  url.searchParams.set('f', 'image')

  return {
    url: url.toString(),
    authorizationHeader: `Basic ${Buffer.from(`${input.username}:${input.password}`).toString('base64')}`,
  }
}

function tileToWebMercatorBbox(input) {
  const tilesPerAxis = 2 ** input.z
  const tileSizeMetres = (WEB_MERCATOR_HALF_WORLD_METRES * 2) / tilesPerAxis
  const minX = -WEB_MERCATOR_HALF_WORLD_METRES + input.x * tileSizeMetres
  const maxX = minX + tileSizeMetres
  const maxY = WEB_MERCATOR_HALF_WORLD_METRES - input.y * tileSizeMetres
  const minY = maxY - tileSizeMetres

  return [minX, minY, maxX, maxY].map(formatBboxNumber).join(',')
}

function normalizeMapServerUrl(serviceUrl) {
  const parsed = new URL(serviceUrl.trim())
  const mapServerPathEnd = parsed.pathname.toLowerCase().indexOf('/mapserver')
  if (mapServerPathEnd !== -1) {
    parsed.pathname = parsed.pathname.slice(0, mapServerPathEnd + '/MapServer'.length)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/+$/, '')
  }

  const trimmed = serviceUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/wmts') ? trimmed.slice(0, -5) : trimmed
}

function readTileCoordinate(value, label) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Official map tile ${label} coordinate is invalid.`)
  }
  return parsed
}

function formatBboxNumber(value) {
  return value.toFixed(6).replace(/\.?0+$/, '')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  createElectronOfficialMapProxy,
}
