import { createHash } from 'node:crypto'
import path from 'node:path'

import Database from 'better-sqlite3'

const REDACTED_MAP_PACKAGE_PATH = '[redacted-map-package-path]'
const DEFAULT_OFFICIAL_MAP_ID = 'official_discovery_topo'

/**
 * Builds a settings-store package entry from a readable MBTiles file.
 */
export function buildOfficialMapPackageSettings({ mapId = DEFAULT_OFFICIAL_MAP_ID, packagePath, now = new Date() }) {
  const metadata = readMbtilesMetadata(packagePath)
  return {
    id: createOfficialMapPackageId(mapId, packagePath),
    sourceType: 'mbtiles',
    mapId,
    packagePath,
    status: 'ready',
    bounds: metadata.bounds,
    minZoom: metadata.minZoom,
    maxZoom: metadata.maxZoom,
    tileCount: metadata.tileCount,
    tileFormat: metadata.tileFormat,
    createdAt: '',
    verifiedAt: now.toISOString(),
    message: 'Official Discovery Topo package is ready.',
  }
}

/**
 * Finds one requestable XYZ tile coordinate from an MBTiles package.
 */
export function findFirstMbtilesTile(packagePath) {
  const db = new Database(packagePath, { readonly: true, fileMustExist: true })
  try {
    const row = db
      .prepare(
        'SELECT zoom_level AS z, tile_column AS x, tile_row AS tmsY FROM tiles ORDER BY zoom_level DESC, tile_column ASC, tile_row ASC LIMIT 1',
      )
      .get()
    if (row === undefined) {
      throw new Error('MBTiles package contains no tiles.')
    }
    return {
      z: Number(row.z),
      x: Number(row.x),
      y: 2 ** Number(row.z) - 1 - Number(row.tmsY),
    }
  } finally {
    db.close()
  }
}

/**
 * Produces a Linear/handoff-safe summary of packaged offline map evidence.
 */
export function buildSafeEvidenceSummary(input) {
  return {
    platform: input.platform,
    appBasename: path.basename(input.appPath),
    packageBasename: path.basename(input.packagePath),
    tile: input.tile,
    tileBytes: input.tileBytes,
    diagnosticsReport: sanitizeEvidenceText(input.diagnosticsReport),
  }
}

/**
 * Redacts local/private map package paths from evidence text.
 */
export function sanitizeEvidenceText(input) {
  return String(input)
    .replace(/[A-Za-z]:\\[^\s`'"]*\.mbtiles/gu, REDACTED_MAP_PACKAGE_PATH)
    .replace(/\/[^\s`'"]*\.mbtiles/gu, REDACTED_MAP_PACKAGE_PATH)
}

/**
 * Builds the full settings JSON used to seed an isolated Electron userData dir.
 */
export function buildSeedSettings(packageSettings) {
  return {
    missionDefaults: {
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 30,
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 30,
      primaryMissionRoot: '',
      backupMissionRoot: '',
      coordinatorRoster: [],
      adminRoster: [],
    },
    dataSource: {
      providerType: 'none',
      baseUrl: '',
      authMode: 'basic',
      email: '',
      autoConnect: true,
      trackingCacheEnabled: true,
      replayEnabled: false,
      replayStart: '',
      replayDurationHours: 4,
    },
    officialMaps: {
      sourceType: 'none',
      sourcePath: '',
      status: 'not_configured',
      username: '',
      availableSources: [],
      serviceCount: 0,
      message: 'Official maps are not configured.',
      packages: [packageSettings],
    },
    weather: {
      links: [],
    },
  }
}

function readMbtilesMetadata(packagePath) {
  const db = new Database(packagePath, { readonly: true, fileMustExist: true })
  try {
    const metadataRows = db.prepare('SELECT name, value FROM metadata').all()
    const metadata = new Map(
      metadataRows.map((row) => [String(row.name).toLowerCase(), String(row.value)]),
    )
    const zoomRange = db
      .prepare('SELECT MIN(zoom_level) AS minZoom, MAX(zoom_level) AS maxZoom FROM tiles')
      .get()
    const tileCount = Number(db.prepare('SELECT COUNT(*) AS count FROM tiles').get()?.count ?? 0)
    return {
      bounds: readBounds(metadata.get('bounds')),
      minZoom: readZoom(metadata.get('minzoom'), zoomRange?.minZoom),
      maxZoom: readZoom(metadata.get('maxzoom'), zoomRange?.maxZoom),
      tileCount,
      tileFormat: String(metadata.get('format') ?? '').trim().toLowerCase(),
    }
  } finally {
    db.close()
  }
}

function readBounds(input) {
  const values = String(input ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
  if (values.length !== 4 || !values.every(Number.isFinite)) {
    return null
  }
  return values
}

function readZoom(primary, fallback) {
  const primaryNumber = Number(primary)
  if (Number.isInteger(primaryNumber) && primaryNumber >= 0) {
    return primaryNumber
  }
  const fallbackNumber = Number(fallback)
  return Number.isInteger(fallbackNumber) && fallbackNumber >= 0 ? fallbackNumber : null
}

function createOfficialMapPackageId(mapId, packagePath) {
  const digest = createHash('sha256').update(`${mapId}\0${packagePath}`).digest('hex').slice(0, 12)
  return `${mapId}-${digest}`
}
