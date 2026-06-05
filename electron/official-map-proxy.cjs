const fs = require('node:fs/promises')

const Database = require('better-sqlite3')

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
  const tile = parseOfficialMapTileUrl(url)

  const localTile = readLocalPackageTile(officialMaps, tile)
  if (localTile.status === 'hit') {
    return localTile.response
  }
  if (localTile.status === 'package_error') {
    throw new Error(localTile.message)
  }

  return fetchMapGenieTile(options, officialMaps, tile, localTile.status === 'miss')
}

async function fetchMapGenieTile(options, officialMaps, tile, hadLocalMiss) {
  if (
    officialMaps?.sourceType !== 'mapgenie_file' ||
    officialMaps.status !== 'configured' ||
    typeof officialMaps.sourcePath !== 'string' ||
    officialMaps.sourcePath.trim() === ''
  ) {
    if (hadLocalMiss) {
      throw new Error('Official map package does not contain the requested tile.')
    }
    throw new Error('Official maps are not configured.')
  }

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

function readLocalPackageTile(officialMaps, tile) {
  const packages = Array.isArray(officialMaps?.packages) ? officialMaps.packages : []
  const matchingPackages = packages.filter((mapPackage) => mapPackage?.mapId === tile.mapId)
  if (matchingPackages.length === 0) {
    return { status: 'not_configured' }
  }

  const readyPackages = matchingPackages.filter(
    (mapPackage) => mapPackage?.sourceType === 'mbtiles' && mapPackage?.status === 'ready',
  )
  if (readyPackages.length === 0) {
    const missingPackage = matchingPackages.find((mapPackage) => mapPackage?.status === 'missing')
    if (missingPackage !== undefined) {
      return { status: 'package_error', message: 'Official map package is missing.' }
    }
    return { status: 'package_error', message: 'Official map package is unreadable.' }
  }

  for (const mapPackage of readyPackages) {
    const row = readMbtilesTile(mapPackage.packagePath, tile)
    if (row.status === 'hit') {
      return {
        status: 'hit',
        response: {
          contentType: contentTypeForTileFormat(mapPackage.tileFormat),
          bytesBase64: Buffer.from(row.bytes).toString('base64'),
        },
      }
    }
    if (row.status === 'package_error') {
      return { status: 'package_error', message: 'Official map package is unreadable.' }
    }
  }

  return { status: 'miss' }
}

function readMbtilesTile(packagePath, tile) {
  if (typeof packagePath !== 'string' || packagePath.trim() === '') {
    return { status: 'package_error' }
  }

  let db
  try {
    db = new Database(packagePath, { readonly: true, fileMustExist: true })
    const row = db
      .prepare(
        'SELECT tile_data AS tileData FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1',
      )
      .get(tile.z, tile.x, xyzToTmsY(tile.z, tile.y))
    if (row?.tileData === undefined) {
      return { status: 'miss' }
    }
    return { status: 'hit', bytes: row.tileData }
  } catch {
    return { status: 'package_error' }
  } finally {
    if (db !== undefined) {
      db.close()
    }
  }
}

function xyzToTmsY(z, xyzY) {
  return 2 ** z - 1 - xyzY
}

function contentTypeForTileFormat(format) {
  const normalized = typeof format === 'string' ? format.trim().toLowerCase() : ''
  if (normalized === 'jpg' || normalized === 'jpeg') {
    return 'image/jpeg'
  }
  if (normalized === 'webp') {
    return 'image/webp'
  }
  return 'image/png'
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
