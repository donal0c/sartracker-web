const {
  createCoverageRowsQuery,
  createInvalidationDeviceRangeQuery,
} = require('./coverage-query.cjs')

const REQUIRED_POSITIONS_INDEX = 'idx_positions_mission_device_timestamp'

/**
 * Asserts the production coverage query shapes against SQLite's own planner.
 * This gate prevents a later refactor from silently introducing a positions
 * full scan or a global mission timestamp index dependency.
 */
function assertCoverageQueryPlans(database, input) {
  const outingQuery = createCoverageRowsQuery(database, input.missionId, {
    device_id: input.deviceId,
    period_kind: 'outing',
    period_id: input.outingId,
  })
  const unassignedQuery = createCoverageRowsQuery(database, input.missionId, {
    device_id: input.deviceId,
    period_kind: 'unassigned',
    period_id: '',
  })
  const invalidationQuery = createInvalidationDeviceRangeQuery(database, true)
  const plans = {
    outing: readPlan(database, outingQuery.statement.source, outingQuery.params),
    unassigned: readPlan(
      database,
      unassignedQuery.statement.source,
      unassignedQuery.params,
    ),
    invalidationRange: readPlan(database, invalidationQuery.source, [
      input.missionId,
      input.deviceId,
      '2026-01-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    ]),
  }
  for (const [name, details] of Object.entries(plans)) {
    if (!details.some((detail) => detail.includes(REQUIRED_POSITIONS_INDEX))) {
      throw new Error(
        `Coverage query plan ${name} does not use the required positions index.`,
      )
    }
    if (details.some((detail) => /SCAN (?:TABLE )?position(?:s)?(?:\s|$)/iu.test(detail))) {
      throw new Error(`Coverage query plan ${name} performs a positions full scan.`)
    }
  }
  return plans
}

/** Reads normalized detail strings for one parameterized query plan. */
function readPlan(database, source, params) {
  return database.prepare(`EXPLAIN QUERY PLAN ${source}`)
    .all(...params)
    .map((row) => String(row.detail))
}

module.exports = {
  assertCoverageQueryPlans,
}
