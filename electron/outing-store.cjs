const { randomUUID } = require('node:crypto')

const { outingWindowsOverlap } = require('./outing-overlap-policy.cjs')

/** Creates the transactional outing subsystem on the shared mission database. */
function createOutingStore(options) {
  const { db } = options
  const readNow = options.now ?? (() => new Date().toISOString())
  const faultInjection = options.faultInjection ?? {}

  return {
    createOuting(input) {
      const mission = requireMission(db, input?.mission_id)
      assertMissionCanCreateOuting(mission)
      const timestamp = readNow()
      const startedAt = normalizeBoundary(input?.started_at ?? timestamp, 'start')
      validateStartBoundary(mission, startedAt, timestamp)
      const label = normalizeLabel(input?.label)
      const outing = {
        id: randomUUID(),
        mission_id: mission.id,
        label,
        started_at: startedAt,
        ended_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      }
      assertNoOverlap(db, outing)
      const transaction = db.transaction(() => {
        db.prepare(`INSERT INTO outings
          (id, mission_id, label, started_at, ended_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?)`)
          .run(outing.id, outing.mission_id, outing.label, outing.started_at, timestamp, timestamp)
        failAfterMutation(faultInjection)
        insertAudit(db, mission.id, 'outing_started', timestamp, {
          outing_id: outing.id,
          label: outing.label,
          started_at: outing.started_at,
        })
      })
      transaction()
      return requireOuting(db, mission.id, outing.id)
    },

    endOuting(input) {
      const mission = requireMission(db, input?.mission_id)
      assertMissionAllowsBookkeeping(mission)
      const existing = requireOuting(db, mission.id, input?.outing_id)
      if (existing.ended_at !== null) {
        throw new Error(`Outing "${existing.label}" has already ended.`)
      }
      const timestamp = readNow()
      const endedAt = normalizeBoundary(input?.ended_at ?? timestamp, 'end')
      validateWindow(existing.started_at, endedAt, timestamp)
      const candidate = { ...existing, ended_at: endedAt }
      assertNoOverlap(db, candidate)
      const transaction = db.transaction(() => {
        db.prepare('UPDATE outings SET ended_at = ?, updated_at = ? WHERE id = ?')
          .run(endedAt, timestamp, existing.id)
        failAfterMutation(faultInjection)
        insertAudit(db, mission.id, 'outing_ended', timestamp, {
          outing_id: existing.id,
          label: existing.label,
          started_at: existing.started_at,
          ended_at: endedAt,
        })
      })
      transaction()
      return requireOuting(db, mission.id, existing.id)
    },

    renameOuting(input) {
      const mission = requireMission(db, input?.mission_id)
      assertMissionAllowsBookkeeping(mission)
      const existing = requireOuting(db, mission.id, input?.outing_id)
      const label = normalizeLabel(input?.label)
      if (label === existing.label) return existing
      const timestamp = readNow()
      const transaction = db.transaction(() => {
        db.prepare('UPDATE outings SET label = ?, updated_at = ? WHERE id = ?')
          .run(label, timestamp, existing.id)
        failAfterMutation(faultInjection)
        insertAudit(db, mission.id, 'outing_renamed', timestamp, {
          outing_id: existing.id,
          before: { label: existing.label },
          after: { label },
        })
      })
      transaction()
      return requireOuting(db, mission.id, existing.id)
    },

    editOutingBoundaries(input) {
      const mission = requireMission(db, input?.mission_id)
      assertMissionAllowsBookkeeping(mission)
      const existing = requireOuting(db, mission.id, input?.outing_id)
      const timestamp = readNow()
      const startedAt = input?.started_at === undefined
        ? existing.started_at
        : normalizeBoundary(input.started_at, 'start')
      const endedAt = input?.ended_at === undefined
        ? existing.ended_at
        : input.ended_at === null
          ? null
          : normalizeBoundary(input.ended_at, 'end')
      validateStartBoundary(mission, startedAt, timestamp)
      if (endedAt !== null) validateWindow(startedAt, endedAt, timestamp)
      const candidate = { ...existing, started_at: startedAt, ended_at: endedAt }
      assertNoOverlap(db, candidate)
      if (startedAt === existing.started_at && endedAt === existing.ended_at) return existing
      const transaction = db.transaction(() => {
        db.prepare('UPDATE outings SET started_at = ?, ended_at = ?, updated_at = ? WHERE id = ?')
          .run(startedAt, endedAt, timestamp, existing.id)
        failAfterMutation(faultInjection)
        insertAudit(db, mission.id, 'outing_boundaries_edited', timestamp, {
          outing_id: existing.id,
          before: { started_at: existing.started_at, ended_at: existing.ended_at },
          after: { started_at: startedAt, ended_at: endedAt },
        })
      })
      transaction()
      return requireOuting(db, mission.id, existing.id)
    },

    listOutings(missionId) {
      requireMission(db, missionId)
      return db.prepare(
        'SELECT * FROM outings WHERE mission_id = ? ORDER BY started_at ASC, id ASC',
      ).all(missionId)
    },
  }
}

/** Returns one mission or fails with an operator-actionable identity error. */
function requireMission(db, missionId) {
  const mission = typeof missionId === 'string'
    ? db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId)
    : undefined
  if (mission === undefined) throw new Error(`Mission not found: ${String(missionId)}`)
  return mission
}

/** Returns one outing scoped to its mission. */
function requireOuting(db, missionId, outingId) {
  const outing = typeof outingId === 'string'
    ? db.prepare('SELECT * FROM outings WHERE mission_id = ? AND id = ?').get(missionId, outingId)
    : undefined
  if (outing === undefined) throw new Error(`Outing not found: ${String(outingId)}`)
  return outing
}

/** Refuses to invent a new operational period after mission recording ended. */
function assertMissionCanCreateOuting(mission) {
  if (mission.status !== 'active' && mission.status !== 'paused') {
    throw new Error('Cannot start an outing for a finished or finalized mission; it is read-only for new operational periods.')
  }
}

/** Allows closing/correcting known outings until finalization locks the record. */
function assertMissionAllowsBookkeeping(mission) {
  if (mission.status === 'finalized') {
    throw new Error('Cannot change an outing on a finalized mission; it is read-only.')
  }
}

/** Normalizes one stored boundary to canonical UTC ISO text. */
function normalizeBoundary(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Outing ${label} must be a valid ISO8601 date-time.`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Outing ${label} must be a valid ISO8601 date-time.`)
  }
  return new Date(milliseconds).toISOString()
}

/** Validates one start against mission truth and current wall time. */
function validateStartBoundary(mission, startedAt, currentTime) {
  if (Date.parse(startedAt) < Date.parse(mission.start_time)) {
    throw new Error('Outing start cannot be before the mission start.')
  }
  if (Date.parse(startedAt) > Date.parse(currentTime)) {
    throw new Error('Outing start cannot be in the future.')
  }
}

/** Validates one completed half-open window. */
function validateWindow(startedAt, endedAt, currentTime) {
  if (Date.parse(endedAt) <= Date.parse(startedAt)) {
    throw new Error('Outing end must be after its start.')
  }
  if (Date.parse(endedAt) > Date.parse(currentTime)) {
    throw new Error('Outing end cannot be in the future.')
  }
}

/** Returns a non-empty bounded operator label. */
function normalizeLabel(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Outing label is required.')
  }
  const label = value.trim()
  if (label.length > 120) throw new Error('Outing label must be 120 characters or fewer.')
  return label
}

/** Enforces the cross-row non-overlap invariant before mutation. */
function assertNoOverlap(db, candidate) {
  const siblings = db.prepare(
    'SELECT * FROM outings WHERE mission_id = ? AND id <> ? ORDER BY started_at ASC',
  ).all(candidate.mission_id, candidate.id)
  const conflict = siblings.find((sibling) => outingWindowsOverlap(candidate, sibling))
  if (conflict !== undefined) {
    throw new Error(
      `Outing window overlaps "${conflict.label}" (${conflict.started_at} to ${conflict.ended_at ?? 'active'}).`,
    )
  }
}

/** Inserts the mutation audit record inside the owning transaction. */
function insertAudit(db, missionId, eventType, timestamp, details) {
  db.prepare(
    'INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), missionId, eventType, timestamp, JSON.stringify(details))
}

/** Provides a deterministic forced rollback seam for the atomicity regression. */
function failAfterMutation(faultInjection) {
  if (faultInjection.afterMutation === true) {
    throw new Error('Injected outing transaction failure.')
  }
}

module.exports = {
  createOutingStore,
}
