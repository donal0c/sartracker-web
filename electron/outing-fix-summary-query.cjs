const MAX_MISSION_ID_LENGTH = 200

/** Reads exact per-outing and Unassigned accepted-fix counts from one snapshot. */
function readOutingFixSummary(database, input) {
  const { missionId } = normalizeOutingFixSummaryInput(input)
  const readSnapshot = database.transaction(() => {
    const outings = database.prepare(`
      SELECT o.id AS outing_id, COUNT(p.id) AS accepted_fix_count
      FROM outings o
      LEFT JOIN positions p
        ON p.mission_id = o.mission_id
       AND p.timestamp >= o.started_at
       AND (o.ended_at IS NULL OR p.timestamp < o.ended_at)
      WHERE o.mission_id = ?
      GROUP BY o.id, o.started_at
      ORDER BY o.started_at ASC, o.id ASC
    `).all(missionId).map((row) => ({
      outing_id: row.outing_id,
      accepted_fix_count: normalizeCount(row.accepted_fix_count),
    }))
    const totalAcceptedFixCount = normalizeCount(
      database.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?')
        .get(missionId)?.count,
    )
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
