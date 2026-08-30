'use strict'

const path = require('node:path')

const {
  MAX_ARCHIVE_REVIEW_RESULT_ROWS,
  assertArchiveReviewResultBudget,
} = require('./archive-review-result-budget.cjs')
const { listGpxImportProjectionPage } = require('./gpx-renderer-boundary.cjs')

const MAX_ID_BYTES = 200
const MAX_DATABASE_PATH_BYTES = 8_192
const MAX_CURSOR_BYTES = 2_048
const PROJECTION_METHODS = Object.freeze(new Set([
  'listMissions',
  'listMarkers',
  'listDevices',
  'listDrawings',
  'listHelicopters',
  'listGpxImports',
  'listGpxImportPage',
  'listOutings',
  'listLayerCatalogMetadata',
]))

/** Stable closed projection-query failure. */
class ArchiveReviewProjectionQueryError extends Error {
  /** Creates a non-reflective query failure. */
  constructor(message = 'Archive review projection request is invalid.') {
    super(message)
    this.name = 'ArchiveReviewProjectionQueryError'
  }
}

/** Requires one exact plain record. */
function requireExactRecord(value, allowedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveReviewProjectionQueryError()
  }
  const keys = Object.keys(value).sort().join(',')
  if (!allowedKeys.some((allowed) => [...allowed].sort().join(',') === keys)) {
    throw new ArchiveReviewProjectionQueryError()
  }
}

/** Requires one bounded mission identity. */
function normalizeMissionId(value) {
  if (typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > MAX_ID_BYTES
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ArchiveReviewProjectionQueryError()
  }
  return value
}

/** Requires one canonical absolute restored-database path. */
function normalizeDatabasePath(value) {
  if (typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') < 1
    || Buffer.byteLength(value, 'utf8') > MAX_DATABASE_PATH_BYTES
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value) {
    throw new ArchiveReviewProjectionQueryError(
      'Archive review projection database path is invalid.',
    )
  }
  return value
}

/** Shape-closes the one paged GPX projection query. */
function normalizeGpxPageQuery(value) {
  requireExactRecord(value, [
    ['missionId', 'limit'],
    ['missionId', 'cursor', 'limit'],
  ])
  const missionId = normalizeMissionId(value.missionId)
  if (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100) {
    throw new ArchiveReviewProjectionQueryError()
  }
  if (value.cursor !== undefined && value.cursor !== null
    && (typeof value.cursor !== 'string'
      || Buffer.byteLength(value.cursor, 'utf8') > MAX_CURSOR_BYTES
      || /[\u0000-\u001f\u007f]/u.test(value.cursor))) {
    throw new ArchiveReviewProjectionQueryError()
  }
  return Object.freeze({
    missionId,
    ...(Object.prototype.hasOwnProperty.call(value, 'cursor') ? { cursor: value.cursor } : {}),
    limit: value.limit,
  })
}

/** Normalizes only the closed data that may cross into the projection worker. */
function normalizeArchiveReviewProjectionRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || !PROJECTION_METHODS.has(input.method)) {
    throw new ArchiveReviewProjectionQueryError()
  }
  const databasePath = normalizeDatabasePath(input.databasePath)
  if (input.method === 'listGpxImportPage') {
    requireExactRecord(input, [['databasePath', 'method', 'query']])
    return Object.freeze({
      databasePath,
      method: input.method,
      query: normalizeGpxPageQuery(input.query),
    })
  }
  requireExactRecord(input, [['databasePath', 'method', 'missionId']])
  return Object.freeze({
    databasePath,
    method: input.method,
    missionId: normalizeMissionId(input.missionId),
  })
}

/** Shape-closes and byte-bounds a projection before and after the worker boundary. */
function normalizeArchiveReviewProjectionResult(input, result) {
  const request = normalizeArchiveReviewProjectionRequest(input)
  if (request.method === 'listGpxImportPage') {
    if (result === null || typeof result !== 'object'
      || Array.isArray(result)
      || Object.keys(result).sort().join(',') !== 'entries,nextCursor'
      || !Array.isArray(result.entries)
      || result.entries.length > request.query.limit
      || (result.nextCursor !== null
        && (typeof result.nextCursor !== 'string'
          || Buffer.byteLength(result.nextCursor, 'utf8') > MAX_CURSOR_BYTES
          || /[\u0000-\u001f\u007f]/u.test(result.nextCursor)))) {
      throw new ArchiveReviewProjectionQueryError()
    }
  } else if (!Array.isArray(result)
    || result.length > MAX_ARCHIVE_REVIEW_RESULT_ROWS
    || (request.method === 'listMissions' && result.length > 1)) {
    throw new ArchiveReviewProjectionQueryError()
  }
  try {
    assertArchiveReviewResultBudget(result)
  } catch {
    throw new ArchiveReviewProjectionQueryError(
      'Archive review projection result exceeds its safe boundary.',
    )
  }
  return result
}

/** Executes one exact read-only projection against an already query-only database. */
function readArchiveReviewProjection(database, input) {
  const request = normalizeArchiveReviewProjectionRequest(input)
  if (request.method === 'listGpxImportPage') {
    return listGpxImportProjectionPage(database, request.query)
  }
  const missionId = request.missionId
  switch (request.method) {
    case 'listMissions':
      return database.prepare(
        'SELECT * FROM missions WHERE id = ? ORDER BY start_time DESC LIMIT 2',
      ).all(missionId)
    case 'listMarkers':
      return database.prepare(`SELECT * FROM markers
        WHERE mission_id = ? AND retired_at IS NULL
        ORDER BY display_order ASC, name ASC LIMIT 100001`).all(missionId)
    case 'listDevices':
      return database.prepare(`SELECT * FROM devices WHERE mission_id = ?
        ORDER BY name ASC LIMIT 100001`).all(missionId)
    case 'listDrawings':
      return database.prepare(`SELECT * FROM drawings
        WHERE mission_id = ? AND retired_at IS NULL
        ORDER BY display_order ASC, name ASC LIMIT 100001`).all(missionId)
    case 'listHelicopters':
      return database.prepare(`SELECT * FROM helicopters WHERE mission_id = ?
        ORDER BY slot_key ASC LIMIT 100001`).all(missionId)
    case 'listGpxImports':
      return database.prepare(`SELECT id, mission_id, source_path, file_name,
          display_name, geometry_json, metadata_json, content_sha256, timing_class,
          outing_id, import_state, revision_sequence, retired_at, retired_by,
          imported_at, updated_at
        FROM gpx_track_imports
        WHERE mission_id = ? AND retired_at IS NULL AND import_state = 'complete'
          AND EXISTS (SELECT 1 FROM gpx_import_revisions AS revisions
            WHERE revisions.import_id = gpx_track_imports.id)
        ORDER BY display_name ASC, imported_at ASC LIMIT 100001`).all(missionId)
    case 'listOutings':
      return database.prepare(`SELECT * FROM outings WHERE mission_id = ?
        ORDER BY started_at ASC, id ASC LIMIT 100001`).all(missionId)
    case 'listLayerCatalogMetadata':
      return database.prepare(`SELECT mission_id, node_id, parent_node_id,
          node_kind, alias, is_favorite, is_visible, display_order,
          metadata_json, updated_at
        FROM layer_catalog_entries WHERE mission_id = ?
        ORDER BY parent_node_id ASC, display_order ASC, node_id ASC
        LIMIT 100001`).all(missionId).map((row) => ({
          missionId: row.mission_id,
          nodeId: row.node_id,
          parentNodeId: row.parent_node_id,
          nodeKind: row.node_kind,
          alias: row.alias,
          isFavorite: Boolean(row.is_favorite),
          isVisible: Boolean(row.is_visible),
          displayOrder: row.display_order,
          metadataJson: row.metadata_json,
          updatedAt: row.updated_at,
        }))
    default:
      throw new ArchiveReviewProjectionQueryError()
  }
}

module.exports = {
  ArchiveReviewProjectionQueryError,
  PROJECTION_METHODS,
  normalizeArchiveReviewProjectionRequest,
  normalizeArchiveReviewProjectionResult,
  readArchiveReviewProjection,
}
