const { createHash } = require('node:crypto')

const { compareStringsByCodeUnit } = require('./deterministic-string-order.cjs')
const { resolveCoveragePeriod } = require('./coverage-period-resolver.cjs')

const DEFAULT_PAGE_LIMIT = 10_000
const MAX_PAGE_LIMIT = 10_000

/** Computes the canonical read-only device × period chunk set for one mission. */
function enumerateCoverageChunks(database, input) {
  const deviceIds = readCoverageDeviceUniverse(database, input.missionId)
  const outings = database.prepare(`SELECT id, started_at, ended_at
    FROM outings WHERE mission_id = ? ORDER BY started_at ASC, id ASC`)
    .all(input.missionId)
  const periods = [
    ...outings.map((outing) => ({
      period_kind: 'outing',
      period_id: outing.id,
    })),
    { period_kind: 'unassigned', period_id: '' },
  ]
  const chunks = []
  for (const deviceId of deviceIds) {
    chunks.push(...summarizeCoverageChunksForDevice(
      database,
      input.missionId,
      deviceId,
      outings,
      periods,
    ))
  }
  const mission = database.prepare(`SELECT change_seq FROM coverage_missions
    WHERE mission_id = ?`).get(input.missionId)
  return {
    changeSeq: Number(mission?.change_seq ?? 0),
    chunks,
  }
}

/**
 * Summarizes every period for one device from one indexed chronological pass.
 * The per-period row order remains identical to the exact chunk query because
 * filtering a timestamp/id-ordered stream preserves the order of each subset.
 */
function summarizeCoverageChunksForDevice(
  database,
  missionId,
  deviceId,
  outings,
  periods,
) {
  const summaries = new Map(periods.map((period) => [
    createPeriodMapKey(period.period_kind, period.period_id),
    {
      digest: createHash('sha256'),
      fixCount: 0,
      minTs: null,
      maxTs: null,
    },
  ]))
  const rows = database.prepare(`SELECT position.id, position.source_position_id,
      position.timestamp
    FROM positions AS position
    WHERE position.mission_id = ? AND position.device_id = ?
    ORDER BY position.timestamp ASC, position.id ASC`)
    .raw()
    .iterate(missionId, deviceId)
  for (const row of rows) {
    const [id, sourcePositionId, timestamp] = row
    const period = resolveCoveragePeriod(outings, timestamp)
    const summary = summaries.get(createPeriodMapKey(
      period.period_kind,
      period.period_id,
    ))
    if (summary === undefined) {
      throw new Error('Coverage enumeration resolved an unknown period.')
    }
    if (summary.fixCount > 0) summary.digest.update('\n')
    summary.digest.update(sourcePositionId === null
      ? `stored:${id}`
      : `source:${sourcePositionId}`)
    summary.fixCount += 1
    summary.minTs ??= timestamp
    summary.maxTs = timestamp
  }
  return periods.map((period) => {
    const summary = summaries.get(createPeriodMapKey(
      period.period_kind,
      period.period_id,
    ))
    return {
      device_id: deviceId,
      ...period,
      fix_count: summary.fixCount,
      fix_digest: summary.digest.digest('hex'),
      min_ts: summary.minTs,
      max_ts: summary.maxTs,
    }
  })
}

/** Creates a collision-free identity for one tagged period. */
function createPeriodMapKey(periodKind, periodId) {
  return `${periodKind}\u0000${periodId}`
}

/** Reads one exact manifest snapshot, keeping durable and exact counts distinct. */
function readCoverageManifestSnapshot(database, input) {
  const ledgerRows = database.prepare(`SELECT * FROM coverage_chunks
    WHERE mission_id = ?`).all(input.missionId)
  const ledgerByKey = new Map(ledgerRows.map((row) => [
    createChunkMapKey(row.device_id, row.period_kind, row.period_id),
    row,
  ]))
  const mission = database.prepare(`SELECT change_seq, enumerated
    FROM coverage_missions WHERE mission_id = ?`).get(input.missionId)
  const exact = mission?.enumerated === 1
    ? null
    : enumerateCoverageChunks(database, input)
  const pendingInvalidation = database.prepare(`SELECT 1 FROM coverage_invalidations
    WHERE mission_id = ? AND drained_at IS NULL LIMIT 1`).get(input.missionId) !== undefined
  const pendingInvalidationMetrics = database.prepare(`SELECT COUNT(*) AS count
    FROM coverage_invalidations WHERE mission_id = ? AND drained_at IS NULL`)
    .get(input.missionId)
  const backfillIncomplete = database.prepare(`SELECT 1
    FROM participant_backfill_checkpoints
    WHERE mission_id = ? AND completed = 0 LIMIT 1`).get(input.missionId) !== undefined
  const outings = database.prepare(`SELECT id, label, started_at, ended_at
    FROM outings WHERE mission_id = ? ORDER BY started_at ASC, id ASC`)
    .all(input.missionId)
  const chunkDiagnostics = summarizeCoverageLedgerRows(ledgerRows)
  return {
    changeSeq: Number(mission?.change_seq ?? exact?.changeSeq ?? 0),
    enumerated: mission?.enumerated === 1,
    pendingInvalidation,
    backfillIncomplete,
    diagnostics: {
      ...chunkDiagnostics,
      pendingInvalidationCount: Number(pendingInvalidationMetrics?.count ?? 0),
    },
    outings,
    chunks: (exact?.chunks ?? readCoverageInventory(database, input.missionId))
      .map((chunk) => {
      const ledger = ledgerByKey.get(createChunkMapKey(
        chunk.device_id,
        chunk.period_kind,
        chunk.period_id,
      ))
      const exactSummary = exact === null && ledger !== undefined &&
        (ledger.built_rev !== ledger.content_rev || ledger.fix_count === null)
        ? summarizeCoverageChunk(database, input.missionId, chunk)
        : null
      const exactCount = exactSummary?.fix_count ?? chunk.fix_count ?? ledger?.fix_count ?? 0
      const exactDigest = exactSummary?.fix_digest ?? chunk.fix_digest ??
        ledger?.fix_digest ?? createHash('sha256').digest('hex')
      const exactMinTs = exactSummary?.min_ts ?? chunk.min_ts ?? ledger?.min_ts ?? null
      const exactMaxTs = exactSummary?.max_ts ?? chunk.max_ts ?? ledger?.max_ts ?? null
      return {
        key: {
          device_id: chunk.device_id,
          period_kind: chunk.period_kind,
          period_id: chunk.period_id,
        },
        contentRev: Number(ledger?.content_rev ?? 1),
        builtRev: ledger?.built_rev ?? null,
        fixCount: ledger?.fix_count ?? null,
        exactCount,
        fixDigest: ledger?.fix_digest ?? null,
        exactDigest,
        exactMinTs,
        exactMaxTs,
        minTs: ledger?.min_ts ?? null,
        maxTs: ledger?.max_ts ?? null,
      }
    }),
  }
}

/** Evaluates database readiness from bounded ledger and scope metadata only. */
function readCoverageClaimSnapshot(database, input) {
  const mission = database.prepare(`SELECT change_seq, enumerated
    FROM coverage_missions WHERE mission_id = ?`).get(input.missionId)
  const pendingInvalidation = database.prepare(`SELECT 1 FROM coverage_invalidations
    WHERE mission_id = ? AND drained_at IS NULL LIMIT 1`).get(input.missionId) !== undefined
  const backfillIncomplete = database.prepare(`SELECT 1
    FROM participant_backfill_checkpoints
    WHERE mission_id = ? AND completed = 0 LIMIT 1`).get(input.missionId) !== undefined
  const allowedKeys = new Set(readCoverageInventory(database, input.missionId).map((chunk) =>
    createChunkMapKey(chunk.device_id, chunk.period_kind, chunk.period_id)))
  const readChunk = database.prepare(`SELECT content_rev, built_rev FROM coverage_chunks
    WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?`)
  const blockers = []
  const chunkRevisions = []
  if (mission?.enumerated !== 1) blockers.push('not_enumerated')
  if (pendingInvalidation) blockers.push('pending_invalidation')
  if (backfillIncomplete) blockers.push('backfill_incomplete')
  for (const key of input.selectedKeys) {
    const identity = createChunkMapKey(key.device_id, key.period_kind, key.period_id)
    const chunk = allowedKeys.has(identity)
      ? readChunk.get(input.missionId, key.device_id, key.period_kind, key.period_id)
      : undefined
    if (chunk === undefined) {
      blockers.push('chunk_missing')
      continue
    }
    chunkRevisions.push({ key: { ...key }, contentRev: Number(chunk.content_rev) })
    if (chunk.built_rev !== chunk.content_rev) blockers.push('chunk_not_fresh')
  }
  const uniqueBlockers = [...new Set(blockers)]
  return {
    changeSeq: Number(mission?.change_seq ?? 0),
    databaseReady: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    chunkRevisions,
  }
}

/** Enumerates only bounded device and period identities, never position rows. */
function readCoverageInventory(database, missionId) {
  const outings = database.prepare(`SELECT id FROM outings
    WHERE mission_id = ? ORDER BY started_at ASC, id ASC`).all(missionId)
  const periods = [
    ...outings.map((outing) => ({ period_kind: 'outing', period_id: outing.id })),
    { period_kind: 'unassigned', period_id: '' },
  ]
  return readCoverageDeviceUniverse(database, missionId).flatMap((deviceId) =>
    periods.map((period) => ({ device_id: deviceId, ...period })))
}

/** Summarizes only bounded ledger metadata and never returns chunk identity. */
function summarizeCoverageLedgerRows(rows) {
  let pendingChunkCount = 0
  let staleChunkCount = 0
  let freshChunkCount = 0
  let oldestQueuedAt = null
  for (const row of rows) {
    if (row.built_rev === null) pendingChunkCount += 1
    else if (row.built_rev < row.content_rev) staleChunkCount += 1
    else if (row.built_rev === row.content_rev) freshChunkCount += 1
    if (row.built_rev !== row.content_rev) {
      if (oldestQueuedAt === null || row.updated_at < oldestQueuedAt) {
        oldestQueuedAt = row.updated_at
      }
    }
  }
  return {
    queueDepth: pendingChunkCount + staleChunkCount,
    oldestQueuedAt,
    pendingChunkCount,
    staleChunkCount,
    freshChunkCount,
  }
}

/** Reads one lossless cursor page after proving only this chunk revision. */
function readCoverageChunkPage(database, input) {
  const limit = normalizePageLimit(input.limit)
  const ledger = database.prepare(`SELECT content_rev FROM coverage_chunks
    WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?`)
    .get(
      input.missionId,
      input.key.device_id,
      input.key.period_kind,
      input.key.period_id,
    )
  if (ledger === undefined || ledger.content_rev !== input.expectedContentRev) {
    const error = new Error('chunk-stale: coverage chunk revision changed')
    error.code = 'chunk-stale'
    throw error
  }
  const rows = readCoverageRows(database, {
    missionId: input.missionId,
    key: input.key,
    cursor: input.cursor ?? null,
    limit: limit + 1,
  })
  const hasMore = rows.length > limit
  const positions = hasMore ? rows.slice(0, limit) : rows
  const finalRow = positions.at(-1)
  return {
    key: { ...input.key },
    contentRev: ledger.content_rev,
    positions,
    nextCursor: hasMore && finalRow !== undefined
      ? { timestamp: finalRow.timestamp, id: finalRow.id }
      : null,
  }
}

/** Summarizes one exact chunk only while its requested revision is current. */
function summarizeCoverageChunkAtRevision(database, input) {
  const ledger = database.prepare(`SELECT content_rev FROM coverage_chunks
    WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?`)
    .get(
      input.missionId,
      input.key.device_id,
      input.key.period_kind,
      input.key.period_id,
    )
  if (ledger === undefined || ledger.content_rev !== input.expectedContentRev) {
    const error = new Error('chunk-stale: coverage chunk revision changed')
    error.code = 'chunk-stale'
    throw error
  }
  return {
    contentRev: ledger.content_rev,
    ...summarizeCoverageChunk(database, input.missionId, input.key),
  }
}

/** Computes the logical keys affected by one still-pending outing invalidation. */
function analyzeCoverageInvalidation(database, input) {
  const invalidation = database.prepare(`SELECT * FROM coverage_invalidations
    WHERE id = ? AND drained_at IS NULL`).get(input.invalidationId)
  if (invalidation === undefined) {
    throw new Error(`Pending coverage invalidation not found: ${input.invalidationId}`)
  }
  const currentOutings = database.prepare(`SELECT id, started_at, ended_at
    FROM outings WHERE mission_id = ? ORDER BY started_at ASC, id ASC`)
    .all(invalidation.mission_id)
  const intersectingOutingIds = currentOutings
    .filter((outing) => outingIntersectsInvalidation(outing, invalidation))
    .map((outing) => outing.id)
  if (!intersectingOutingIds.includes(invalidation.subject_outing_id)) {
    intersectingOutingIds.push(invalidation.subject_outing_id)
  }
  intersectingOutingIds.sort(compareStringsByCodeUnit)

  const affectedKeys = []
  const rangeQuery = createInvalidationDeviceRangeQuery(
    database,
    invalidation.range_to !== null,
  )
  for (const deviceId of readCoverageDeviceUniverse(database, invalidation.mission_id)) {
    const params = invalidation.range_to === null
      ? [invalidation.mission_id, deviceId, invalidation.range_from]
      : [
          invalidation.mission_id,
          deviceId,
          invalidation.range_from,
          invalidation.range_to,
        ]
    if (rangeQuery.get(...params) === undefined) continue
    for (const outingId of intersectingOutingIds) {
      affectedKeys.push({
        mission_id: invalidation.mission_id,
        device_id: deviceId,
        period_kind: 'outing',
        period_id: outingId,
      })
    }
    affectedKeys.push({
      mission_id: invalidation.mission_id,
      device_id: deviceId,
      period_kind: 'unassigned',
      period_id: '',
    })
  }
  return { invalidationId: input.invalidationId, affectedKeys }
}

/** Builds the indexed per-device range probe used by invalidation analysis. */
function createInvalidationDeviceRangeQuery(database, hasRangeEnd) {
  return database.prepare(`SELECT id FROM positions
    WHERE mission_id = ? AND device_id = ? AND timestamp >= ?
      ${hasRangeEnd ? 'AND timestamp < ?' : ''}
    ORDER BY timestamp ASC, id ASC LIMIT 1`)
}

/** Tests half-open current outing overlap with the captured old/new union. */
function outingIntersectsInvalidation(outing, invalidation) {
  if (invalidation.range_to !== null && outing.started_at >= invalidation.range_to) {
    return false
  }
  return outing.ended_at === null || outing.ended_at > invalidation.range_from
}

/** Returns all selected participant devices, including active zero-fix members. */
function readCoverageDeviceUniverse(database, missionId) {
  const deviceIds = new Set(
    database.prepare('SELECT device_id FROM devices WHERE mission_id = ?')
      .all(missionId)
      .map((row) => row.device_id),
  )
  for (const row of database.prepare(`SELECT traccar_device_id AS device_id
    FROM mission_participants
    WHERE mission_id = ? AND kind = 'device' AND removed_at IS NULL`)
    .all(missionId)) {
    deviceIds.add(row.device_id)
  }
  for (const row of database.prepare(`SELECT membership.traccar_device_id AS device_id
    FROM mission_participants AS participant
    INNER JOIN mission_group_membership_events AS membership
      ON membership.mission_id = participant.mission_id
     AND membership.mission_team_id = participant.mission_team_id
    WHERE participant.mission_id = ?
      AND participant.kind = 'group'
      AND participant.removed_at IS NULL
      AND membership.change = 'member'
      AND NOT EXISTS (
        SELECT 1 FROM mission_group_membership_events AS newer
        WHERE newer.mission_id = membership.mission_id
          AND newer.mission_team_id = membership.mission_team_id
          AND newer.traccar_device_id = membership.traccar_device_id
          AND (
            newer.observed_at > membership.observed_at OR
            (newer.observed_at = membership.observed_at
              AND newer.sequence > membership.sequence)
          )
      )`).all(missionId)) {
    deviceIds.add(row.device_id)
  }
  return [...deviceIds].sort(compareStringsByCodeUnit)
}

/** Streams one chunk to exact count, source-identity digest, and time bounds. */
function summarizeCoverageChunk(database, missionId, key) {
  const digest = createHash('sha256')
  let fixCount = 0
  let minTs = null
  let maxTs = null
  for (const row of iterateCoverageRows(database, { missionId, key })) {
    if (fixCount > 0) digest.update('\n')
    digest.update(createAcceptedPositionIdentity(row))
    fixCount += 1
    minTs ??= row.timestamp
    maxTs = row.timestamp
  }
  return {
    fix_count: fixCount,
    fix_digest: digest.digest('hex'),
    min_ts: minTs,
    max_ts: maxTs,
  }
}

/** Iterates a full logical chunk in deterministic source order. */
function iterateCoverageRows(database, input) {
  const query = createCoverageRowsQuery(database, input.missionId, input.key)
  return query.statement.iterate(...query.params)
}

/** Reads a bounded chunk page using the same deterministic query contract. */
function readCoverageRows(database, input) {
  const query = createCoverageRowsQuery(
    database,
    input.missionId,
    input.key,
    input.cursor,
    input.limit,
  )
  return query.statement.all(...query.params)
}

/** Builds the indexed outing or Unassigned logical-chunk statement. */
function createCoverageRowsQuery(database, missionId, key, cursor = null, limit = null) {
  const cursorSql = cursor === null
    ? ''
    : ' AND (position.timestamp > ? OR (position.timestamp = ? AND position.id > ?))'
  const cursorParams = cursor === null
    ? []
    : [cursor.timestamp, cursor.timestamp, cursor.id]
  const limitSql = limit === null ? '' : ' LIMIT ?'
  if (key.period_kind === 'outing') {
    const outing = database.prepare(`SELECT started_at, ended_at FROM outings
      WHERE mission_id = ? AND id = ?`).get(missionId, key.period_id)
    if (outing === undefined) {
      throw new Error(`Coverage outing not found: ${key.period_id}`)
    }
    const endSql = outing.ended_at === null ? '' : ' AND position.timestamp < ?'
    const endParams = outing.ended_at === null ? [] : [outing.ended_at]
    return {
      statement: database.prepare(`SELECT position.id, position.source_position_id,
          position.device_id, position.timestamp, position.lat, position.lon
        FROM positions AS position
        WHERE position.mission_id = ? AND position.device_id = ?
          AND position.timestamp >= ?${endSql}${cursorSql}
        ORDER BY position.timestamp ASC, position.id ASC${limitSql}`),
      params: [
        missionId,
        key.device_id,
        outing.started_at,
        ...endParams,
        ...cursorParams,
        ...(limit === null ? [] : [limit]),
      ],
    }
  }
  if (key.period_kind !== 'unassigned' || key.period_id !== '') {
    throw new Error('Coverage chunk period key is invalid.')
  }
  return {
    statement: database.prepare(`SELECT position.id, position.source_position_id,
        position.device_id, position.timestamp, position.lat, position.lon
      FROM positions AS position
      WHERE position.mission_id = ? AND position.device_id = ?${cursorSql}
        AND NOT EXISTS (
          SELECT 1 FROM outings AS outing
          WHERE outing.mission_id = position.mission_id
            AND outing.started_at <= position.timestamp
            AND (outing.ended_at IS NULL OR position.timestamp < outing.ended_at)
        )
      ORDER BY position.timestamp ASC, position.id ASC${limitSql}`),
    params: [
      missionId,
      key.device_id,
      ...cursorParams,
      ...(limit === null ? [] : [limit]),
    ],
  }
}

/** Returns the source-exact identity used by the coverage digest oracle. */
function createAcceptedPositionIdentity(row) {
  return row.source_position_id === null
    ? `stored:${row.id}`
    : `source:${row.source_position_id}`
}

/** Enforces the dot-page upper bound for coverage transport. */
function normalizePageLimit(value) {
  if (value === undefined) return DEFAULT_PAGE_LIMIT
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new Error(`Coverage page limit must be between 1 and ${MAX_PAGE_LIMIT}.`)
  }
  return value
}

/** Creates an internal map identity for one already-tagged chunk key. */
function createChunkMapKey(deviceId, periodKind, periodId) {
  return `${deviceId}\u0000${periodKind}\u0000${periodId}`
}

module.exports = {
  analyzeCoverageInvalidation,
  createAcceptedPositionIdentity,
  createInvalidationDeviceRangeQuery,
  createCoverageRowsQuery,
  enumerateCoverageChunks,
  readCoverageClaimSnapshot,
  readCoverageManifestSnapshot,
  readCoverageChunkPage,
  readCoverageDeviceUniverse,
  summarizeCoverageChunk,
  summarizeCoverageChunkAtRevision,
}
