const MAX_MISSION_ID_LENGTH = 200
const { findContainingOutingIndex } = require('./coverage-period-resolver.cjs')

/** Reads exact per-outing and Unassigned accepted-fix counts from one snapshot. */
function readOutingFixSummary(database, input) {
  const { missionId } = normalizeOutingFixSummaryInput(input)
  const readSnapshot = database.transaction(() => {
    const outingRows = database.prepare(`SELECT id, started_at, ended_at
      FROM outings WHERE mission_id = ? ORDER BY started_at ASC, id ASC`).all(missionId)
    const acceptedFixCounts = outingRows.map(() => 0)
    let totalAcceptedFixCount = 0
    for (const position of database.prepare(
      'SELECT timestamp FROM positions WHERE mission_id = ?',
    ).iterate(missionId)) {
      totalAcceptedFixCount += 1
      const outingIndex = findContainingOutingIndex(outingRows, position.timestamp)
      if (outingIndex !== -1) acceptedFixCounts[outingIndex] += 1
    }
    const outings = outingRows.map((outing, index) => ({
      outing_id: outing.id,
      accepted_fix_count: normalizeCount(acceptedFixCounts[index]),
    }))
    const assignedCount = outings.reduce(
      (total, outing) => total + outing.accepted_fix_count,
      0,
    )
    if (assignedCount > totalAcceptedFixCount) {
      throw new Error('Outing fix summary is invalid because outing windows overlap.')
    }
    return {
      outings,
      unassigned_accepted_fix_count: totalAcceptedFixCount - assignedCount,
      total_accepted_fix_count: totalAcceptedFixCount,
    }
  })
  return readSnapshot()
}

/** Validates the bounded worker query before SQLite opens. */
function normalizeOutingFixSummaryInput(input) {
  if (
    typeof input?.missionId !== 'string' ||
    input.missionId.length < 1 ||
    input.missionId.length > MAX_MISSION_ID_LENGTH
  ) {
    throw new Error('Outing fix-summary mission ID is invalid.')
  }
  return { missionId: input.missionId }
}

/** Converts a SQLite aggregate to a safe non-negative integer. */
function normalizeCount(value) {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Outing fix-summary count is invalid.')
  }
  return count
}

module.exports = {
  normalizeOutingFixSummaryInput,
  readOutingFixSummary,
}
