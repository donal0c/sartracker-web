const DEFAULT_GEOMETRY_BYTE_LIMIT = 384 * 1024
const DEFAULT_PAGE_BYTE_LIMIT = 1024 * 1024
const DEFAULT_PAGE_LIMIT = 25

/**
 * Produces a deterministic display-only MultiLineString while leaving exact
 * GPX bytes and evidence-point rows untouched.
 */
function compactGpxDisplayGeometry(
  geometryJson,
  byteLimit = DEFAULT_GEOMETRY_BYTE_LIMIT,
) {
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1024) {
    throw new Error('GPX display geometry byte limit is invalid.')
  }
  const parsed = JSON.parse(geometryJson)
  if (
    (parsed?.type !== 'MultiLineString' && parsed?.type !== 'LineString') ||
    !Array.isArray(parsed.coordinates)
  ) {
    throw new Error('GPX display geometry must be a LineString or MultiLineString.')
  }
  const sourceSegments = parsed.type === 'LineString' ? [parsed.coordinates] : parsed.coordinates
  const segments = sourceSegments.map((segment) => {
    if (!Array.isArray(segment)) throw new Error('GPX display segment is invalid.')
    return segment.map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2
        || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) {
        throw new Error('GPX display coordinate is invalid.')
      }
      return coordinate
    })
  })
  const unchanged = JSON.stringify({ type: 'MultiLineString', coordinates: segments })
  if (Buffer.byteLength(unchanged, 'utf8') <= byteLimit) return unchanged

  let stride = 2
  while (stride <= 1_048_576) {
    const compacted = segments.map((segment) => compactSegment(segment, stride))
    const candidate = JSON.stringify({ type: 'MultiLineString', coordinates: compacted })
    if (Buffer.byteLength(candidate, 'utf8') <= byteLimit) return candidate
    stride *= 2
  }
  throw new Error(
    'GPX display geometry cannot fit the renderer byte budget without hiding complete segments.',
  )
}

/** Retains each segment endpoint and deterministic intermediate samples. */
function compactSegment(segment, stride) {
  if (segment.length <= 2) return segment
  const sampled = [segment[0]]
  for (let index = stride; index < segment.length - 1; index += stride) {
    sampled.push(segment[index])
  }
  sampled.push(segment[segment.length - 1])
  return sampled
}

/**
 * Packs already projected rows into a strict JSON response budget. Exact GPX
 * source bytes are forbidden at this boundary.
 */
function packGpxRendererPage(rows, options = {}) {
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT
  const byteLimit = options.byteLimit ?? DEFAULT_PAGE_BYTE_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('GPX renderer page limit must be between 1 and 100.')
  }
  if (!Number.isSafeInteger(byteLimit) || byteLimit < 1024 || byteLimit > DEFAULT_PAGE_BYTE_LIMIT) {
    throw new Error('GPX renderer page byte limit is invalid.')
  }
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(row, 'source_bytes_base64')) {
      throw new Error('GPX renderer projection must not contain exact retained source bytes.')
    }
  }

  const entries = []
  for (const row of rows.slice(0, limit)) {
    const candidate = [...entries, row]
    const probe = { entries: candidate, hasMore: candidate.length < rows.length }
    if (Buffer.byteLength(JSON.stringify(probe), 'utf8') > byteLimit) {
      if (entries.length === 0) {
        throw new Error('One GPX renderer projection exceeds the response byte budget.')
      }
      break
    }
    entries.push(row)
  }
  return { entries, hasMore: entries.length < rows.length }
}

/** Reads one keyset page of GPX display projections without exact source bytes. */
function listGpxImportProjectionPage(db, input) {
  const missionId = normalizePageText(input?.missionId, 'GPX mission')
  const limit = normalizePageLimit(input?.limit)
  const cursor = decodePageCursor(input?.cursor, 'imports', missionId)
  const cursorClause = cursor === null
    ? ''
    : `AND (
      display_name > ? OR
      (display_name = ? AND imported_at > ?) OR
      (display_name = ? AND imported_at = ? AND id > ?)
    )`
  const parameters = cursor === null
    ? [missionId, limit + 1]
    : [
        missionId,
        cursor.displayName,
        cursor.displayName,
        cursor.importedAt,
        cursor.displayName,
        cursor.importedAt,
        cursor.id,
        limit + 1,
      ]
  const rows = db.prepare(`SELECT
      id, mission_id, source_path, file_name, display_name, geometry_json,
      metadata_json, content_sha256, timing_class, outing_id,
      revision_sequence, retired_at, retired_by, imported_at, updated_at
    FROM gpx_track_imports
    WHERE mission_id = ? AND retired_at IS NULL AND import_state = 'complete'
      AND EXISTS (
        SELECT 1 FROM gpx_import_revisions AS revisions
        WHERE revisions.import_id = gpx_track_imports.id
      )
      ${cursorClause}
    ORDER BY display_name ASC, imported_at ASC, id ASC
    LIMIT ?`).all(...parameters)
  const packed = packGpxRendererPage(rows, {
    limit,
    byteLimit: DEFAULT_PAGE_BYTE_LIMIT - 1024,
  })
  const last = packed.entries.at(-1)
  return {
    entries: packed.entries,
    nextCursor: !packed.hasMore || last === undefined
        ? null
        : encodePageCursor({
          kind: 'imports',
          contextId: missionId,
          displayName: last.display_name,
          importedAt: last.imported_at,
          id: last.id,
        }),
  }
}

/** Reads one bounded revision-summary page without geometry or retained bytes. */
function listGpxImportRevisionProjectionPage(db, input) {
  const importId = normalizePageText(input?.importId, 'GPX import')
  const limit = normalizePageLimit(input?.limit)
  const cursor = decodePageCursor(input?.cursor, 'revisions', importId)
  const cursorClause = cursor === null
    ? ''
    : 'AND (revision_sequence > ? OR (revision_sequence = ? AND id > ?))'
  const parameters = cursor === null
    ? [importId, limit + 1]
    : [importId, cursor.revisionSequence, cursor.revisionSequence, cursor.id, limit + 1]
  const rows = db.prepare(`SELECT
      id, mission_id, import_id, revision_sequence, content_sha256,
      source_path, file_name, display_name, metadata_json, timing_class,
      outing_id, import_state, completeness, recorded_at, audit_event_id
    FROM gpx_import_revisions
    WHERE import_id = ? ${cursorClause}
    ORDER BY revision_sequence ASC, id ASC
    LIMIT ?`).all(...parameters)
  const packed = packGpxRendererPage(rows, {
    limit,
    byteLimit: DEFAULT_PAGE_BYTE_LIMIT - 1024,
  })
  const last = packed.entries.at(-1)
  return {
    entries: packed.entries,
    nextCursor: !packed.hasMore || last === undefined
        ? null
        : encodePageCursor({
          kind: 'revisions',
          contextId: importId,
          revisionSequence: last.revision_sequence,
          id: last.id,
        }),
  }
}

/** Normalizes the caller-controlled page size. */
function normalizePageLimit(value) {
  const limit = value ?? DEFAULT_PAGE_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('GPX renderer page limit must be between 1 and 100.')
  }
  return limit
}

/** Normalizes a required bounded text field used by a renderer query. */
function normalizePageText(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 1000) {
    throw new Error(`${label} identifier is invalid.`)
  }
  return value.trim()
}

/** Encodes an opaque renderer cursor. */
function encodePageCursor(value) {
  return Buffer.from(JSON.stringify({ v: 2, ...value }), 'utf8').toString('base64url')
}

/** Decodes and strictly validates an opaque renderer cursor. */
function decodePageCursor(value, expectedKind, expectedContextId) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2048) {
    throw new Error('GPX renderer page cursor is invalid.')
  }
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new Error('GPX renderer page cursor is invalid.')
  }
  if (
    parsed?.v !== 2
    || parsed.kind !== expectedKind
    || parsed.contextId !== expectedContextId
    || !isBoundedCursorText(parsed.id, false)
  ) {
    throw new Error('GPX renderer page cursor is invalid.')
  }
  if (expectedKind === 'imports') {
    if (
      !isBoundedCursorText(parsed.displayName, true)
      || !isBoundedCursorText(parsed.importedAt, false, 100)
    ) {
      throw new Error('GPX renderer page cursor is invalid.')
    }
  } else if (!Number.isSafeInteger(parsed.revisionSequence) || parsed.revisionSequence < 1) {
    throw new Error('GPX renderer page cursor is invalid.')
  }
  return parsed
}

/** Checks decoded cursor text before it can reach a SQLite keyset predicate. */
function isBoundedCursorText(value, allowEmpty, maximumLength = 1000) {
  return typeof value === 'string'
    && value.length <= maximumLength
    && (allowEmpty || value.length > 0)
}

module.exports = {
  DEFAULT_GEOMETRY_BYTE_LIMIT,
  DEFAULT_PAGE_BYTE_LIMIT,
  compactGpxDisplayGeometry,
  listGpxImportProjectionPage,
  listGpxImportRevisionProjectionPage,
  packGpxRendererPage,
}
