const SEARCH_OPERATION_PAGE_LIMIT = 25
const MAX_SEARCH_OPERATION_PAGE_LIMIT = 50
const MAX_SEARCH_OPERATION_PAGE_BYTES = 256 * 1024
const MAX_SEARCH_OPERATION_TEXT_LENGTH = 200
const SEARCH_OPERATION_KINDS = new Set(['areas', 'assignments', 'outings', 'passes'])

/** Reads one bounded, searchable Search Operations projection page. */
function readSearchOperationPage(database, input) {
  const query = normalizeSearchOperationPageQuery(input)
  const specification = pageSpecification(query.kind)
  const cursor = decodeSearchOperationCursor(query.cursor, query)
  const searchPattern = `%${escapeLike(query.search)}%`
  const searchParameters = Array.from(
    { length: specification.searchColumnCount },
    () => searchPattern,
  )
  const cursorParameters = cursor === null
    ? []
    : [cursor.orderValue, cursor.orderValue, cursor.id]
  const sharedParameters = [query.missionId, ...searchParameters]
  const totalCount = Number(database.prepare(`SELECT COUNT(*) AS count
    FROM ${specification.table}
    WHERE mission_id = ? ${specification.activeClause}
      AND (${specification.searchClause})`).get(...sharedParameters).count)
  const rows = database.prepare(`SELECT ${specification.projection}
    FROM ${specification.table}
    WHERE mission_id = ? ${specification.activeClause}
      AND (${specification.searchClause})
      ${cursor === null ? '' : `AND (
        ${specification.orderColumn} > ? OR
        (${specification.orderColumn} = ? AND id > ?)
      )`}
    ORDER BY ${specification.orderColumn} ASC, id ASC
    LIMIT ?`).all(...sharedParameters, ...cursorParameters, query.limit + 1)
  const visibleRows = rows.slice(0, query.limit)
  const entries = visibleRows.map((row) => projectSearchOperationRow(query.kind, row))
  const last = visibleRows.at(-1)
  const result = {
    kind: query.kind,
    search: query.search,
    entries,
    totalCount,
    nextCursor: rows.length <= query.limit || last === undefined
      ? null
      : encodeSearchOperationCursor({
          kind: query.kind,
          missionId: query.missionId,
          search: query.search,
          orderValue: String(last.__order_value),
          id: String(last.id),
        }),
  }
  assertSearchOperationPageResult(result, query.limit)
  return result
}

/** Strictly normalizes a renderer-originated Search Operations page query. */
function normalizeSearchOperationPageQuery(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Search Operations page input is invalid.')
  }
  const missionId = normalizeBoundedText(input.missionId, 'mission ID', 200, false)
  if (!SEARCH_OPERATION_KINDS.has(input.kind)) {
    throw new Error('Search Operations page kind is invalid.')
  }
  const search = input.search === undefined || input.search === null
    ? ''
    : normalizeBoundedText(input.search, 'search', 120, true)
  const limit = input.limit ?? SEARCH_OPERATION_PAGE_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SEARCH_OPERATION_PAGE_LIMIT) {
    throw new Error(
      `Search Operations page limit must be between 1 and ${MAX_SEARCH_OPERATION_PAGE_LIMIT}.`,
    )
  }
  if (input.cursor !== undefined && input.cursor !== null
    && (typeof input.cursor !== 'string' || input.cursor.length > 2_000)) {
    throw new Error('Search Operations page cursor is invalid.')
  }
  return {
    missionId,
    kind: input.kind,
    search,
    limit,
    ...(input.cursor === undefined || input.cursor === null || input.cursor === ''
      ? {}
      : { cursor: input.cursor }),
  }
}

/** Returns the fixed SQL and projection contract for one page kind. */
function pageSpecification(kind) {
  switch (kind) {
    case 'areas':
      return {
        table: 'search_areas', activeClause: 'AND retired_at IS NULL',
        orderColumn: 'name', searchColumnCount: 2,
        searchClause: "name LIKE ? ESCAPE '\\' COLLATE NOCASE OR id LIKE ? ESCAPE '\\' COLLATE NOCASE",
        projection: `id, mission_id, substr(name, 1, 120) AS name, status,
          version_sequence, substr(updated_by, 1, 120) AS updated_by,
          created_at, updated_at, retired_at, name AS __order_value`,
      }
    case 'assignments':
      return {
        table: 'search_assignments', activeClause: 'AND retired_at IS NULL',
        orderColumn: 'created_at', searchColumnCount: 5,
        searchClause: `team_id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR search_area_id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR outing_id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR updated_by LIKE ? ESCAPE '\\' COLLATE NOCASE`,
        projection: `id, mission_id, search_area_id, outing_id,
          substr(team_id, 1, 120) AS team_id, version_sequence,
          substr(updated_by, 1, 120) AS updated_by,
          created_at, updated_at, retired_at, created_at AS __order_value`,
      }
    case 'outings':
      return {
        table: 'outings', activeClause: '', orderColumn: 'started_at', searchColumnCount: 2,
        searchClause: "label LIKE ? ESCAPE '\\' COLLATE NOCASE OR id LIKE ? ESCAPE '\\' COLLATE NOCASE",
        projection: `id, mission_id, substr(label, 1, 120) AS label,
          started_at, ended_at, created_at, updated_at, started_at AS __order_value`,
      }
    case 'passes':
      return {
        table: 'search_passes', activeClause: '', orderColumn: 'started_at', searchColumnCount: 6,
        searchClause: `id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR search_area_id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR assignment_id LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR coordinator_name LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR outcome LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR notes LIKE ? ESCAPE '\\' COLLATE NOCASE`,
        projection: `id, mission_id, search_area_id, assignment_id,
          started_at, ended_at, outcome,
          substr(coordinator_name, 1, 120) AS coordinator_name,
          version_sequence, created_at, updated_at,
          (SELECT COUNT(*) FROM search_pass_evidence_links AS links
            WHERE links.pass_id = search_passes.id
              AND links.version_sequence = search_passes.version_sequence
              AND links.link_kind = 'participant') AS participant_count,
          (SELECT COUNT(*) FROM search_pass_evidence_links AS links
            WHERE links.pass_id = search_passes.id
              AND links.version_sequence = search_passes.version_sequence
              AND links.link_kind = 'clue') AS clue_count,
          (SELECT COUNT(*) FROM search_pass_evidence_links AS links
            WHERE links.pass_id = search_passes.id
              AND links.version_sequence = search_passes.version_sequence
              AND links.link_kind = 'track') AS track_evidence_count,
          started_at AS __order_value`,
      }
    default:
      throw new Error('Search Operations page kind is invalid.')
  }
}

/** Removes internal cursor fields and retains only the bounded display projection. */
function projectSearchOperationRow(kind, row) {
  const { __order_value: _orderValue, ...projection } = row
  if (kind === 'areas') {
    return { ...projection, geometry_available: true }
  }
  return projection
}

/** Escapes a literal substring for a SQLite LIKE expression. */
function escapeLike(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

/** Encodes one mission/kind/search-bound keyset continuation. */
function encodeSearchOperationCursor(value) {
  return Buffer.from(JSON.stringify({ v: 1, ...value }), 'utf8').toString('base64url')
}

/** Decodes and verifies a Search Operations continuation before SQL use. */
function decodeSearchOperationCursor(value, query) {
  if (value === undefined) return null
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Search Operations page cursor is invalid.')
  }
  if (parsed?.v !== 1 || parsed.missionId !== query.missionId
    || parsed.kind !== query.kind || parsed.search !== query.search
    || !isBoundedCursorText(parsed.orderValue) || !isBoundedCursorText(parsed.id)) {
    throw new Error('Search Operations page cursor is invalid.')
  }
  return parsed
}

/** Enforces the worker-to-renderer cardinality and byte envelope. */
function assertSearchOperationPageResult(result, requestedLimit = MAX_SEARCH_OPERATION_PAGE_LIMIT) {
  if (typeof result !== 'object' || result === null || !SEARCH_OPERATION_KINDS.has(result.kind)
    || !Array.isArray(result.entries) || result.entries.length > requestedLimit
    || !Number.isSafeInteger(result.totalCount) || result.totalCount < result.entries.length
    || (result.nextCursor !== null
      && (typeof result.nextCursor !== 'string' || result.nextCursor.length > 2_000))) {
    throw new Error('Search Operations worker returned an invalid page.')
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_SEARCH_OPERATION_PAGE_BYTES) {
    throw new Error('Search Operations worker page exceeds the renderer byte budget.')
  }
}

/** Normalizes one small text field before it can reach SQLite or a cursor. */
function normalizeBoundedText(value, label, maximumLength, allowEmpty) {
  if (typeof value !== 'string' || value.length > maximumLength
    || (!allowEmpty && value.trim() === '')) {
    throw new Error(`Search Operations ${label} is invalid.`)
  }
  return value.trim()
}

/** Checks decoded continuation text before SQL keyset use. */
function isBoundedCursorText(value) {
  return typeof value === 'string' && value.length > 0
    && value.length <= MAX_SEARCH_OPERATION_TEXT_LENGTH
}

module.exports = {
  MAX_SEARCH_OPERATION_PAGE_BYTES,
  MAX_SEARCH_OPERATION_PAGE_LIMIT,
  SEARCH_OPERATION_PAGE_LIMIT,
  assertSearchOperationPageResult,
  normalizeSearchOperationPageQuery,
  readSearchOperationPage,
}
