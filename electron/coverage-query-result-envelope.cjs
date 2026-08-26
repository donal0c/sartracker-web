const { isStrictTrackingTimestamp } = require('./tracking-timestamp.cjs')
const {
  createCoverageChunkIdentity,
  normalizeCoverageChunkKey,
} = require('./coverage-worker-envelope.cjs')

const MAX_RESULT_ITEMS = 100_000
const MAX_PAGE_ITEMS = 10_000
const COVERAGE_BLOCKERS = new Set([
  'not_enumerated',
  'pending_invalidation',
  'backfill_incomplete',
  'chunk_missing',
  'chunk_not_fresh',
])

/** Validates and copies one result according to the exact request kind. */
function normalizeCoverageWorkerResult(query, value, resultLimits = {}) {
  if (!isPlainRecord(value)) throw invalidResult(query.kind, 'result is not an object')
  assertCoverageWorkerResultCardinality(query, value, resultLimits)
  if (query.kind === 'enumerate') {
    return normalizeEnumerationResult(value, readResultLimit(
      resultLimits, 'maxChunks', MAX_RESULT_ITEMS,
    ))
  }
  if (query.kind === 'manifest') {
    return normalizeManifestResult(value, {
      maxOutings: readResultLimit(resultLimits, 'maxOutings', MAX_RESULT_ITEMS),
      maxChunks: readResultLimit(resultLimits, 'maxChunks', MAX_RESULT_ITEMS),
    })
  }
  if (query.kind === 'claim') return normalizeClaimResult(query, value)
  if (query.kind === 'chunk-page') return normalizeChunkPageResult(query, value)
  if (query.kind === 'chunk-summary') return normalizeChunkSummaryResult(query, value)
  if (query.kind === 'invalidation-analysis') {
    return normalizeInvalidationResult(query, value, readResultLimit(
      resultLimits, 'maxAffectedKeys', MAX_RESULT_ITEMS,
    ))
  }
  throw invalidResult('query', 'kind is unsupported')
}

/** Rejects oversized arrays before a worker result crosses into the main isolate. */
function assertCoverageWorkerResultCardinality(query, value, resultLimits = {}) {
  if (!isPlainRecord(value)) throw invalidResult(query.kind, 'result is not an object')
  if (query.kind === 'enumerate') {
    assertResultArray(value.chunks, 'enumeration', readResultLimit(
      resultLimits, 'maxChunks', MAX_RESULT_ITEMS,
    ))
    return
  }
  if (query.kind === 'manifest') {
    assertResultArray(value.outings, 'manifest', readResultLimit(
      resultLimits, 'maxOutings', MAX_RESULT_ITEMS,
    ))
    assertResultArray(value.chunks, 'manifest', readResultLimit(
      resultLimits, 'maxChunks', MAX_RESULT_ITEMS,
    ))
    return
  }
  if (query.kind === 'claim') {
    assertResultArray(value.blockers, 'claim', COVERAGE_BLOCKERS.size)
    assertResultArray(value.chunkRevisions, 'claim', query.selectedKeys.length)
    return
  }
  if (query.kind === 'chunk-page') {
    assertResultArray(
      value.positions,
      'chunk page',
      Math.min(query.limit ?? MAX_PAGE_ITEMS, MAX_PAGE_ITEMS),
    )
    return
  }
  if (query.kind === 'invalidation-analysis') {
    const maximum = readResultLimit(
      resultLimits, 'maxAffectedKeys', MAX_RESULT_ITEMS,
    )
    if (!Array.isArray(value.affectedKeys) || value.affectedKeys.length > maximum) {
      throw new Error('Coverage invalidation result key list is invalid.')
    }
  }
}

/** Validates the first exact chunk enumeration before main-side persistence. */
function normalizeEnumerationResult(value, maxChunks) {
  const changeSeq = normalizeSequence(value.changeSeq, 'enumeration')
  const chunks = normalizeUniqueArray(value.chunks, 'enumeration', (candidate) => {
    if (!isPlainRecord(candidate)) throw invalidResult('enumeration', 'chunk is invalid')
    const key = normalizeResultKey(candidate, 'enumeration')
    const summary = normalizeSummary(candidate, 'enumeration')
    return { ...key, ...summary }
  }, (chunk) => createCoverageChunkIdentity(chunk), maxChunks)
  return { changeSeq, chunks }
}

/** Validates one complete bounded manifest snapshot. */
function normalizeManifestResult(value, limits) {
  const changeSeq = normalizeSequence(value.changeSeq, 'manifest')
  if (
    typeof value.enumerated !== 'boolean' ||
    typeof value.pendingInvalidation !== 'boolean' ||
    typeof value.backfillIncomplete !== 'boolean'
  ) {
    throw invalidResult('manifest', 'state flags are invalid')
  }
  const diagnostics = normalizeDiagnostics(value.diagnostics)
  const outings = normalizeUniqueArray(
    value.outings,
    'manifest',
    normalizeOuting,
    (outing) => outing.id,
    limits.maxOutings,
  )
  const chunks = normalizeUniqueArray(value.chunks, 'manifest', normalizeManifestChunk, (chunk) =>
    createCoverageChunkIdentity(chunk.key), limits.maxChunks)
  if (
    diagnostics.queueDepth !==
      diagnostics.pendingChunkCount + diagnostics.staleChunkCount ||
    value.pendingInvalidation !== (diagnostics.pendingInvalidationCount > 0)
  ) {
    throw invalidResult('manifest', 'diagnostics do not match its chunks')
  }
  return {
    changeSeq,
    enumerated: value.enumerated,
    pendingInvalidation: value.pendingInvalidation,
    backfillIncomplete: value.backfillIncomplete,
    diagnostics,
    outings,
    chunks,
  }
}

/** Validates one manifest outing descriptor. */
function normalizeOuting(candidate) {
  if (
    !isPlainRecord(candidate) ||
    !isBoundedString(candidate.id, 100) ||
    !isBoundedString(candidate.label, 500) ||
    !isStrictTrackingTimestamp(candidate.started_at) ||
    !isOptionalTimestamp(candidate.ended_at) ||
    (candidate.ended_at !== null && candidate.ended_at < candidate.started_at)
  ) {
    throw invalidResult('manifest', 'outing is invalid')
  }
  return {
    id: candidate.id,
    label: candidate.label,
    started_at: candidate.started_at,
    ended_at: candidate.ended_at,
  }
}

/** Validates and copies one manifest chunk descriptor. */
function normalizeManifestChunk(candidate) {
  if (!isPlainRecord(candidate)) throw invalidResult('manifest', 'chunk is invalid')
  const key = normalizeResultKey(candidate.key, 'manifest')
  const contentRev = normalizePositiveInteger(candidate.contentRev, 'manifest')
  const builtRev = candidate.builtRev === null
    ? null
    : normalizePositiveInteger(candidate.builtRev, 'manifest')
  if (builtRev !== null && builtRev > contentRev) {
    throw invalidResult('manifest', 'built revision exceeds content revision')
  }
  const fixCount = normalizeOptionalCount(candidate.fixCount, 'manifest')
  const fixDigest = normalizeOptionalDigest(candidate.fixDigest, 'manifest')
  const exactCount = normalizeCount(candidate.exactCount, 'manifest')
  const exactDigest = normalizeDigest(candidate.exactDigest, 'manifest')
  const exactMinTs = normalizeOptionalTimestamp(candidate.exactMinTs, 'manifest')
  const exactMaxTs = normalizeOptionalTimestamp(candidate.exactMaxTs, 'manifest')
  const minTs = normalizeOptionalTimestamp(candidate.minTs, 'manifest')
  const maxTs = normalizeOptionalTimestamp(candidate.maxTs, 'manifest')
  validateSummaryBounds(exactCount, exactMinTs, exactMaxTs, 'manifest')
  if ((fixCount === null) !== (fixDigest === null)) {
    throw invalidResult('manifest', 'durable summary is incomplete')
  }
  if (fixCount !== null) validateSummaryBounds(fixCount, minTs, maxTs, 'manifest')
  if (
    builtRev === contentRev &&
    (fixCount !== exactCount || fixDigest !== exactDigest ||
      minTs !== exactMinTs || maxTs !== exactMaxTs)
  ) {
    throw invalidResult('manifest', 'fresh summary diverges from exact evidence')
  }
  return {
    key,
    contentRev,
    builtRev,
    fixCount,
    exactCount,
    fixDigest,
    exactDigest,
    exactMinTs,
    exactMaxTs,
    minTs,
    maxTs,
  }
}

/** Validates bounded manifest queue diagnostics. */
function normalizeDiagnostics(value) {
  if (!isPlainRecord(value)) throw invalidResult('manifest', 'diagnostics are invalid')
  const queueDepth = normalizeCount(value.queueDepth, 'manifest')
  const pendingChunkCount = normalizeCount(value.pendingChunkCount, 'manifest')
  const staleChunkCount = normalizeCount(value.staleChunkCount, 'manifest')
  const freshChunkCount = normalizeCount(value.freshChunkCount, 'manifest')
  const pendingInvalidationCount = normalizeCount(
    value.pendingInvalidationCount,
    'manifest',
  )
  const oldestQueuedAt = normalizeOptionalTimestamp(value.oldestQueuedAt, 'manifest')
  if (queueDepth === 0 && oldestQueuedAt !== null) {
    throw invalidResult('manifest', 'empty queue has an oldest timestamp')
  }
  return {
    queueDepth,
    oldestQueuedAt,
    pendingChunkCount,
    staleChunkCount,
    freshChunkCount,
    pendingInvalidationCount,
  }
}

/** Validates a claim and binds every ready revision to its requested key. */
function normalizeClaimResult(query, value) {
  const changeSeq = normalizeSequence(value.changeSeq, 'claim')
  if (typeof value.databaseReady !== 'boolean') {
    throw invalidResult('claim', 'readiness flag is invalid')
  }
  const blockers = normalizeUniqueArray(value.blockers, 'claim', (blocker) => {
    if (typeof blocker !== 'string' || !COVERAGE_BLOCKERS.has(blocker)) {
      throw invalidResult('claim', 'blocker is invalid')
    }
    return blocker
  }, (blocker) => blocker, COVERAGE_BLOCKERS.size)
  const requested = new Set(query.selectedKeys.map(createCoverageChunkIdentity))
  const chunkRevisions = normalizeUniqueArray(
    value.chunkRevisions,
    'claim',
    (candidate) => {
      if (!isPlainRecord(candidate)) throw invalidResult('claim', 'revision is invalid')
      const key = normalizeResultKey(candidate.key, 'claim')
      if (!requested.has(createCoverageChunkIdentity(key))) {
        throw invalidResult('claim', 'revision is outside the request')
      }
      return {
        key,
        contentRev: normalizePositiveInteger(candidate.contentRev, 'claim'),
      }
    },
    (revision) => createCoverageChunkIdentity(revision.key),
    requested.size,
  )
  if (
    value.databaseReady !== (blockers.length === 0) ||
    (value.databaseReady && chunkRevisions.length !== requested.size) ||
    (!value.databaseReady && chunkRevisions.length !== requested.size &&
      !blockers.includes('chunk_missing'))
  ) {
    throw invalidResult('claim', 'readiness does not match its evidence')
  }
  return { changeSeq, databaseReady: value.databaseReady, blockers, chunkRevisions }
}

/** Validates one bounded page and binds it to the requested chunk revision. */
function normalizeChunkPageResult(query, value) {
  const key = normalizeResultKey(value.key, 'chunk page')
  if (
    createCoverageChunkIdentity(key) !== createCoverageChunkIdentity(query.key) ||
    value.contentRev !== query.expectedContentRev ||
    !Array.isArray(value.positions) ||
    value.positions.length > Math.min(query.limit ?? MAX_PAGE_ITEMS, MAX_PAGE_ITEMS)
  ) {
    throw invalidResult('chunk page', 'identity, revision, or cardinality diverged')
  }
  let previous = query.cursor ?? null
  const positions = value.positions.map((candidate) => {
    const position = normalizePosition(candidate, key)
    if (previous !== null && compareCursor(position, previous) <= 0) {
      throw invalidResult('chunk page', 'position order is invalid')
    }
    previous = position
    return position
  })
  const nextCursor = value.nextCursor === null
    ? null
    : normalizeCursor(value.nextCursor, 'chunk page')
  const last = positions.at(-1)
  if (
    nextCursor !== null &&
    (last === undefined || nextCursor.timestamp !== last.timestamp || nextCursor.id !== last.id)
  ) {
    throw invalidResult('chunk page', 'next cursor is not the final position')
  }
  return { key, contentRev: value.contentRev, positions, nextCursor }
}

/** Validates one exact chunk summary at the requested revision. */
function normalizeChunkSummaryResult(query, value) {
  if (value.contentRev !== query.expectedContentRev) {
    throw invalidResult('chunk summary', 'revision diverged from the request')
  }
  return {
    contentRev: value.contentRev,
    ...normalizeSummary(value, 'chunk summary'),
  }
}

/** Validates invalidation analysis identity and its bounded tagged key set. */
function normalizeInvalidationResult(query, value, maxAffectedKeys) {
  if (value.invalidationId !== query.invalidationId) {
    throw invalidResult('invalidation', 'identity does not match its request')
  }
  if (!Array.isArray(value.affectedKeys) || value.affectedKeys.length > maxAffectedKeys) {
    throw new Error('Coverage invalidation result key list is invalid.')
  }
  const affectedKeys = normalizeUniqueArray(
    value.affectedKeys,
    'invalidation',
    (candidate) => {
      if (!isPlainRecord(candidate) || !isBoundedString(candidate.mission_id, 200)) {
        throw invalidResult('invalidation', 'key identity is invalid')
      }
      const key = normalizeResultKey(candidate, 'invalidation')
      return { mission_id: candidate.mission_id, ...key }
    },
    (key) => `${key.mission_id}\u0000${createCoverageChunkIdentity(key)}`,
    maxAffectedKeys,
  )
  return { invalidationId: query.invalidationId, affectedKeys }
}

/** Validates one stored position returned by a chunk page. */
function normalizePosition(value, key) {
  if (
    !isPlainRecord(value) ||
    !isBoundedString(value.id, 100) ||
    !(value.source_position_id === null || isBoundedString(value.source_position_id, 200)) ||
    value.device_id !== key.device_id ||
    !isStrictTrackingTimestamp(value.timestamp) ||
    typeof value.lat !== 'number' || !Number.isFinite(value.lat) ||
    value.lat < -90 || value.lat > 90 ||
    typeof value.lon !== 'number' || !Number.isFinite(value.lon) ||
    value.lon < -180 || value.lon > 180
  ) {
    throw invalidResult('chunk page', 'position is invalid')
  }
  return {
    id: value.id,
    source_position_id: value.source_position_id,
    device_id: value.device_id,
    timestamp: value.timestamp,
    lat: value.lat,
    lon: value.lon,
  }
}

/** Validates and copies a digest/count/time summary. */
function normalizeSummary(value, label) {
  const fix_count = normalizeCount(value.fix_count, label)
  const fix_digest = normalizeDigest(value.fix_digest, label)
  const min_ts = normalizeOptionalTimestamp(value.min_ts, label)
  const max_ts = normalizeOptionalTimestamp(value.max_ts, label)
  validateSummaryBounds(fix_count, min_ts, max_ts, label)
  return { fix_count, fix_digest, min_ts, max_ts }
}

/** Enforces consistent empty and non-empty time bounds. */
function validateSummaryBounds(count, minTs, maxTs, label) {
  if (
    (count === 0 && (minTs !== null || maxTs !== null)) ||
    (count > 0 && (minTs === null || maxTs === null || minTs > maxTs))
  ) {
    throw invalidResult(label, 'summary time bounds are invalid')
  }
}

/** Validates a bounded unique array and returns allowlisted copies. */
function normalizeUniqueArray(value, label, normalize, identity, maximum = MAX_RESULT_ITEMS) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw invalidResult(label, 'item list is invalid')
  }
  const seen = new Set()
  return value.map((candidate) => {
    const normalized = normalize(candidate)
    const key = identity(normalized)
    if (seen.has(key)) throw invalidResult(label, 'item list contains duplicates')
    seen.add(key)
    return normalized
  })
}

/** Rejects a missing or oversized result array without reading any item. */
function assertResultArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw invalidResult(label, 'item list is invalid')
  }
}

/** Reads one request-derived array limit before any result item is traversed. */
function readResultLimit(resultLimits, key, fallback) {
  const value = resultLimits?.[key]
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RESULT_ITEMS) {
    throw new Error('Coverage query result cardinality limit is invalid.')
  }
  return value
}

/** Converts a chunk-key validation error into the owning result family. */
function normalizeResultKey(value, label) {
  try {
    return normalizeCoverageChunkKey(value)
  } catch {
    throw invalidResult(label, 'chunk key is invalid')
  }
}

/** Validates one cursor pair. */
function normalizeCursor(value, label) {
  if (
    !isPlainRecord(value) ||
    !isStrictTrackingTimestamp(value.timestamp) ||
    !isBoundedString(value.id, 100)
  ) {
    throw invalidResult(label, 'cursor is invalid')
  }
  return { timestamp: value.timestamp, id: value.id }
}

/** Compares a position and cursor in the query's deterministic order. */
function compareCursor(left, right) {
  if (left.timestamp !== right.timestamp) return left.timestamp < right.timestamp ? -1 : 1
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

/** Validates a non-negative safe integer. */
function normalizeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidResult(label, 'count is invalid')
  }
  return value
}

/** Validates an optional non-negative safe integer. */
function normalizeOptionalCount(value, label) {
  return value === null ? null : normalizeCount(value, label)
}

/** Validates a positive safe integer. */
function normalizePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidResult(label, 'revision is invalid')
  }
  return value
}

/** Validates a non-negative database change sequence. */
function normalizeSequence(value, label) {
  return normalizeCount(value, label)
}

/** Validates a SHA-256 hex digest. */
function normalizeDigest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw invalidResult(label, 'digest is invalid')
  }
  return value
}

/** Validates an optional SHA-256 hex digest. */
function normalizeOptionalDigest(value, label) {
  return value === null ? null : normalizeDigest(value, label)
}

/** Validates an optional strict timestamp. */
function normalizeOptionalTimestamp(value, label) {
  if (!isOptionalTimestamp(value)) throw invalidResult(label, 'timestamp is invalid')
  return value
}

/** Returns whether a timestamp is absent or canonical. */
function isOptionalTimestamp(value) {
  return value === null || isStrictTrackingTimestamp(value)
}

/** Returns whether a string is non-empty and bounded. */
function isBoundedString(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

/** Returns whether a structured-clone value is one record. */
function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Creates the stable worker-result error family. */
function invalidResult(label, reason) {
  return new Error(`Coverage ${label} result is invalid: ${reason}.`)
}

module.exports = {
  assertCoverageWorkerResultCardinality,
  normalizeCoverageWorkerResult,
}
