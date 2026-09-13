'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')

const Database = require('better-sqlite3')

const MAX_TILE_BYTES = 4 * 1024 * 1024
const MAX_FALLBACK_ADDRESS_TRACKING = 1_000_000
const MAX_METADATA_ROWS = 128
const MAX_METADATA_NAME_BYTES = 256
const MAX_METADATA_VALUE_BYTES = 64 * 1024
const MAX_ZOOM = 30
const ATTESTATION_VERSION = 1
const SCHEMA_VERSION = 1
const DECODER_POLICY = 'native-raster-256-or-512-opaque-v1'
const SUPPORTED_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp'])
const SQLITE_SIDECAR_SUFFIXES = Object.freeze(['-wal', '-shm', '-journal'])

/** A non-reflective failure emitted by official map package verification. */
class OfficialMapPackageError extends Error {
  /** Creates one sanitized package verification failure. */
  constructor(message) {
    super(message)
    this.name = 'OfficialMapPackageError'
  }
}

/**
 * Inspects one immutable MBTiles package and creates a path-free attestation.
 *
 * The decoder belongs to the Electron integration because this module deliberately
 * does not implement an image codec. It must return true only after checking the
 * format and the accepted raster dimensions for the tile.
 */
async function inspectOfficialMapPackage(packagePath, options = {}) {
  if (typeof options.decodeTile !== 'function') {
    throw packageFailure('Official map package tile decoder is unavailable.')
  }

  const initial = readPackageSnapshot(packagePath)
  let database = null
  try {
    database = new Database(packagePath, { fileMustExist: true, readonly: true })
    const metadata = readAndValidateSchema(database)
    const scan = await scanTiles(database, metadata, options.decodeTile)
    if (scan.minZoom !== metadata.minZoom || scan.maxZoom !== metadata.maxZoom) {
      throw packageFailure('Official map package zoom metadata does not match its tiles.')
    }

    const sha256 = await hashPackage(packagePath)
    const finalIdentity = readPackageIdentity(packagePath)
    if (finalIdentity !== initial.identity) {
      throw packageFailure('Official map package changed during verification.')
    }

    const verifiedAt = resolveTimestamp(options.now)
    return Object.freeze({
      bounds: Object.freeze(metadata.bounds),
      minZoom: metadata.minZoom,
      maxZoom: metadata.maxZoom,
      tileCount: scan.tileCount,
      tileFormat: metadata.tileFormat,
      sizeBytes: initial.sizeBytes,
      createdAt: initial.createdAt,
      verifiedAt,
      attestation: Object.freeze({
        version: ATTESTATION_VERSION,
        schemaVersion: SCHEMA_VERSION,
        decoderPolicy: DECODER_POLICY,
        sha256,
        identity: initial.identity,
      }),
    })
  } catch (error) {
    if (error instanceof OfficialMapPackageError) {
      throw error
    }
    throw packageFailure('Official map package could not be verified.')
  } finally {
    if (database !== null) {
      try {
        database.close()
      } catch {
        // The original verification failure is safer than exposing a native close error.
      }
    }
  }
}

/**
 * Reads the stable filesystem identity used to detect replacement or mutation.
 * Symlinks, non-files, unreadable files, and SQLite sidecars fail closed.
 */
function readPackageIdentity(packagePath) {
  return readPackageSnapshot(packagePath).identity
}

/** Returns true only when a well-formed attestation still names this exact file. */
function isPackageIdentityCurrent(packagePath, attestation) {
  if (
    attestation === null
    || typeof attestation !== 'object'
    || Array.isArray(attestation)
    || attestation.version !== ATTESTATION_VERSION
    || attestation.schemaVersion !== SCHEMA_VERSION
    || attestation.decoderPolicy !== DECODER_POLICY
    || typeof attestation.identity !== 'string'
    || !/^[a-f0-9]{64}$/u.test(String(attestation.sha256 ?? ''))
  ) {
    return false
  }
  try {
    return readPackageIdentity(packagePath) === attestation.identity
  } catch {
    return false
  }
}

/** Rehashes an attested package and confirms its identity before and after hashing. */
async function verifyPackageAttestation(packagePath, attestation) {
  if (!isPackageIdentityCurrent(packagePath, attestation)) return false
  try {
    const sha256 = await hashPackage(packagePath)
    if (!isPackageIdentityCurrent(packagePath, attestation)) return false
    return sha256 === attestation.sha256
  } catch {
    return false
  }
}

/** Reads and validates the bounded MBTiles schema and metadata envelope. */
function readAndValidateSchema(database) {
  assertIntegrity(database)

  const tableRows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('metadata', 'tiles')")
    .all()
  const tableNames = new Set(tableRows.map((row) => row.name))
  if (!tableNames.has('metadata') || !tableNames.has('tiles')) {
    throw packageFailure('Official map package schema is invalid.')
  }

  assertColumns(database, 'metadata', ['name', 'value'])
  assertColumns(database, 'tiles', ['zoom_level', 'tile_column', 'tile_row', 'tile_data'])

  const metadata = new Map()
  let metadataRowCount = 0
  const metadataRows = database.prepare(`
    SELECT
      CASE WHEN length(CAST(name AS BLOB)) <= ? THEN name ELSE NULL END AS name,
      CASE WHEN length(CAST(value AS BLOB)) <= ? THEN value ELSE NULL END AS value,
      length(CAST(name AS BLOB)) AS nameBytes,
      length(CAST(value AS BLOB)) AS valueBytes
    FROM metadata
  `).iterate(MAX_METADATA_NAME_BYTES, MAX_METADATA_VALUE_BYTES)
  for (const row of metadataRows) {
    metadataRowCount += 1
    if (
      metadataRowCount > MAX_METADATA_ROWS
      || typeof row.name !== 'string'
      || typeof row.value !== 'string'
      || !Number.isSafeInteger(row.nameBytes)
      || !Number.isSafeInteger(row.valueBytes)
      || row.nameBytes > MAX_METADATA_NAME_BYTES
      || row.valueBytes > MAX_METADATA_VALUE_BYTES
    ) {
      throw packageFailure('Official map package metadata is invalid.')
    }
    const key = row.name.trim().toLowerCase()
    if (key === '' || metadata.has(key)) {
      throw packageFailure('Official map package metadata is invalid.')
    }
    metadata.set(key, row.value.trim())
  }

  const bounds = parseBounds(metadata.get('bounds'))
  const minZoom = parseZoom(metadata.get('minzoom'))
  const maxZoom = parseZoom(metadata.get('maxzoom'))
  const tileFormat = parseTileFormat(metadata.get('format'))
  if (bounds === null || minZoom === null || maxZoom === null || tileFormat === null || minZoom > maxZoom) {
    throw packageFailure('Official map package metadata is invalid.')
  }

  return { bounds, minZoom, maxZoom, tileFormat }
}

/** Executes SQLite's integrity check without materializing an unbounded result. */
function assertIntegrity(database) {
  let sawResult = false
  for (const row of database.prepare('PRAGMA integrity_check').iterate()) {
    sawResult = true
    if (row.integrity_check !== 'ok') {
      throw packageFailure('Official map package SQLite integrity check failed.')
    }
  }
  if (!sawResult) {
    throw packageFailure('Official map package SQLite integrity check failed.')
  }
}

/** Confirms only the required column names, keeping schema checks deterministic. */
function assertColumns(database, tableName, requiredColumns) {
  const columns = new Set(
    database.prepare(`PRAGMA table_info("${tableName}")`).all().map((row) => row.name),
  )
  if (requiredColumns.some((column) => !columns.has(column))) {
    throw packageFailure('Official map package schema is invalid.')
  }
}

/** Streams every tile row through coordinate, payload, uniqueness and decode checks. */
async function scanTiles(database, metadata, decodeTile) {
  const addresses = hasUniqueTileAddressIndex(database) ? null : new Set()
  let tileCount = 0
  let minZoom = Number.POSITIVE_INFINITY
  let maxZoom = Number.NEGATIVE_INFINITY
  const tileRows = database
    .prepare('SELECT rowid AS tileId, zoom_level AS zoom, tile_column AS column, tile_row AS tileRow, length(tile_data) AS byteLength FROM tiles')
    .iterate()
  const tileDataStatement = database.prepare('SELECT tile_data AS bytes FROM tiles WHERE rowid = ?')

  for (const row of tileRows) {
    const zoom = row.zoom
    const column = row.column
    const tileRow = row.tileRow
    if (
      !Number.isSafeInteger(zoom)
      || zoom < 0
      || zoom > MAX_ZOOM
      || zoom < metadata.minZoom
      || zoom > metadata.maxZoom
      || !Number.isSafeInteger(column)
      || !Number.isSafeInteger(tileRow)
    ) {
      throw packageFailure('Official map package contains invalid tile coordinates.')
    }

    const dimension = 2 ** zoom
    if (column < 0 || column >= dimension || tileRow < 0 || tileRow >= dimension) {
      throw packageFailure('Official map package contains invalid tile coordinates.')
    }

    const address = `${zoom}:${column}:${tileRow}`
    if (addresses !== null && addresses.has(address)) {
      throw packageFailure('Official map package contains duplicate tile addresses.')
    }
    if (addresses !== null) {
      if (addresses.size >= MAX_FALLBACK_ADDRESS_TRACKING) {
        throw packageFailure('Official map package requires a unique tile address index.')
      }
      addresses.add(address)
    }

    if (!Number.isSafeInteger(row.byteLength) || row.byteLength <= 0 || row.byteLength > MAX_TILE_BYTES) {
      throw packageFailure('Official map package contains an oversized tile.')
    }
    const tileData = tileDataStatement.get(row.tileId)
    if (Object.prototype.toString.call(tileData?.bytes) !== '[object Uint8Array]') {
      throw packageFailure('Official map package contains invalid tile data.')
    }
    const bytes = Buffer.from(tileData.bytes)
    if (bytes.byteLength !== row.byteLength) {
      throw packageFailure('Official map package changed while reading tile data.')
    }
    try {
      if ((await decodeTile(bytes, metadata.tileFormat)) !== true) {
        throw packageFailure('Official map package tile decoder rejected a tile.')
      }
    } catch (error) {
      if (error instanceof OfficialMapPackageError) {
        throw error
      }
      throw packageFailure('Official map package tile decoder rejected a tile.')
    }

    tileCount += 1
    if (!Number.isSafeInteger(tileCount)) {
      throw packageFailure('Official map package has too many tiles.')
    }
    minZoom = Math.min(minZoom, zoom)
    maxZoom = Math.max(maxZoom, zoom)
    await yieldToMainLoop()
  }

  if (tileCount === 0) {
    throw packageFailure('Official map package contains no tiles.')
  }
  return { tileCount, minZoom, maxZoom }
}

/** Uses a declared SQLite uniqueness constraint when available, avoiding a large JS set. */
function hasUniqueTileAddressIndex(database) {
  const indexes = database.prepare('PRAGMA index_list("tiles")').all()
  for (const index of indexes) {
    if (Number(index.unique) !== 1 || Number(index.partial) === 1 || typeof index.name !== 'string') {
      continue
    }
    const indexName = index.name.replaceAll('"', '""')
    const columns = database
      .prepare(`PRAGMA index_info("${indexName}")`)
      .all()
      .map((row) => row.name)
    if (
      columns.length === 3
      && columns[0] === 'zoom_level'
      && columns[1] === 'tile_column'
      && columns[2] === 'tile_row'
    ) {
      return true
    }
  }
  return false
}

/** Hashes package bytes through a stream so verification never loads the package in memory. */
function hashPackage(packagePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(packagePath, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', () => reject(packageFailure('Official map package could not be hashed.')))
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

/** Captures the immutable package identity and the operator-safe file metadata. */
function readPackageSnapshot(packagePath) {
  if (typeof packagePath !== 'string' || packagePath.trim() === '' || packagePath.includes('\0')) {
    throw packageFailure('Official map package path is invalid.')
  }
  assertNoSqliteSidecars(packagePath)
  let stats
  try {
    stats = fs.lstatSync(packagePath, { bigint: true })
  } catch {
    throw packageFailure('Official map package could not be read.')
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw packageFailure('Official map package path is not a file.')
  }
  if ((stats.mode & 0o444n) === 0n) {
    throw packageFailure('Official map package is not readable.')
  }
  try {
    fs.accessSync(packagePath, fs.constants.R_OK)
  } catch {
    throw packageFailure('Official map package is not readable.')
  }
  if (stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw packageFailure('Official map package is too large.')
  }

  const birthtimeMs = Number(stats.birthtimeMs)
  if (!Number.isFinite(birthtimeMs)) {
    throw packageFailure('Official map package creation time is invalid.')
  }
  return {
    identity: [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs]
      .map((value) => value.toString())
      .join(':'),
    sizeBytes: Number(stats.size),
    createdAt: new Date(birthtimeMs).toISOString(),
  }
}

/** Rejects all SQLite mutable-state sidecars for this immutable package contract. */
function assertNoSqliteSidecars(packagePath) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    try {
      fs.lstatSync(`${packagePath}${suffix}`)
      throw packageFailure('Official map package has a SQLite journal sidecar.')
    } catch (error) {
      if (error instanceof OfficialMapPackageError) {
        throw error
      }
      if (error?.code !== 'ENOENT') {
        throw packageFailure('Official map package sidecar could not be inspected.')
      }
    }
  }
}

/** Parses the required WGS84 bounds while rejecting non-finite and reversed ranges. */
function parseBounds(value) {
  if (typeof value !== 'string') return null
  const tokens = value.split(',').map((entry) => entry.trim())
  if (tokens.some((entry) => entry === '')) return null
  const values = tokens.map((entry) => Number(entry))
  if (values.length !== 4 || values.some((entry) => !Number.isFinite(entry))) return null
  const [west, south, east, north] = values
  if (
    west < -180 || west > 180 || east < -180 || east > 180
    || south < -90 || south > 90 || north < -90 || north > 90
    || west >= east || south >= north
  ) return null
  return [west, south, east, north]
}

/** Parses a bounded inclusive zoom declaration. */
function parseZoom(value) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_ZOOM ? parsed : null
}

/** Preserves the supported metadata spelling while rejecting unsupported codecs. */
function parseTileFormat(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return SUPPORTED_FORMATS.has(normalized) ? normalized : null
}

/** Resolves the verification timestamp without exposing callback or clock failures. */
function resolveTimestamp(input) {
  let value
  try {
    value = input === undefined ? new Date() : typeof input === 'function' ? input() : input
  } catch {
    throw packageFailure('Official map verification time is invalid.')
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw packageFailure('Official map verification time is invalid.')
  }
  return value.toISOString()
}

/** Yields between tile rows so a large package does not monopolize the main loop. */
function yieldToMainLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Creates a stable, non-reflective package error. */
function packageFailure(message) {
  return new OfficialMapPackageError(message)
}

module.exports = {
  inspectOfficialMapPackage,
  isPackageIdentityCurrent,
  readPackageIdentity,
  verifyPackageAttestation,
}
