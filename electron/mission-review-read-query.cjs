const TELEMETRY_EVENT_TYPES = Object.freeze([
  'device_updated',
  'position_recorded',
  'mission_backup_synced',
])
const MAX_AUDIT_QUERY_LIMIT = 5_001
const {
  assertMissionLiveReviewAvailable,
} = require('./mission-live-review-access.cjs')

/**
 * Reads the bounded Mission Review audit page and exact breadcrumb count from
 * one SQLite snapshot. Callers must run this query outside Electron main.
 */
function readMissionReviewSummary(database, input) {
  const normalized = normalizeMissionReviewReadInput(input)
  const readSnapshot = database.transaction(() => {
    assertMissionLiveReviewAvailable(database, normalized.missionId)
    return {
      auditEvents: listMissionReviewAuditEvents(database, normalized),
      breadcrumbCount: countMissionPositions(database, normalized.missionId),
    }
  })
  const result = readSnapshot()
  assertArchiveReviewResultBudget(result)
  return result
}

/** Returns the bounded newest-first audit page with the established telemetry policy. */
function listMissionReviewAuditEvents(database, input) {
  if (input.includeTelemetry) {
    return database.prepare(
      `SELECT * FROM mission_events
       WHERE mission_id = ?
       ORDER BY timestamp DESC, rowid DESC
       LIMIT ?`,
    ).all(input.missionId, input.auditLimit)
  }

  const placeholders = TELEMETRY_EVENT_TYPES.map(() => '?').join(', ')
  return database.prepare(
    `SELECT * FROM mission_events
     WHERE mission_id = ? AND event_type NOT IN (${placeholders})
     ORDER BY timestamp DESC, rowid DESC
     LIMIT ?`,
  ).all(
    input.missionId,
    ...TELEMETRY_EVENT_TYPES,
    input.auditLimit,
  )
}

/** Counts accepted position rows without transferring them across the worker boundary. */
function countMissionPositions(database, missionId) {
  const row = database.prepare(
    'SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?',
  ).get(missionId)
  const count = Number(row?.count)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Mission Review breadcrumb count is invalid.')
  }
  return count
}

/** Validates the bounded query contract before any SQLite work begins. */
function normalizeMissionReviewReadInput(input) {
  if (
    typeof input?.missionId !== 'string' ||
    input.missionId.length < 1 ||
    input.missionId.length > 200
  ) {
    throw new Error('Mission Review mission ID is invalid.')
  }
  if (typeof input.includeTelemetry !== 'boolean') {
    throw new Error('Mission Review telemetry selection is invalid.')
  }
  if (
    !Number.isInteger(input.auditLimit) ||
    input.auditLimit < 1 ||
    input.auditLimit > MAX_AUDIT_QUERY_LIMIT
  ) {
    throw new Error(
      `Mission Review audit limit must be between 1 and ${MAX_AUDIT_QUERY_LIMIT}.`,
    )
  }
  return input
}

module.exports = {
  MAX_AUDIT_QUERY_LIMIT,
  TELEMETRY_EVENT_TYPES,
  listMissionReviewAuditEvents,
  normalizeMissionReviewReadInput,
  readMissionReviewSummary,
}
const {
  assertArchiveReviewResultBudget,
} = require('./archive-review-result-budget.cjs')
