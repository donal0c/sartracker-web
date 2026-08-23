const { randomUUID } = require('node:crypto')

/** Creates the transactional mission participant subsystem. */
function createParticipantStore(options) {
  const { db } = options
  const readNow = options.now ?? (() => new Date().toISOString())
  const faultInjection = options.faultInjection ?? {}

  return {
    selectMissionParticipants(input) {
      const mission = requireMutableMission(db, input?.mission_id)
      const groups = normalizeArray(input?.groups, 'Participant groups')
      const devices = normalizeArray(input?.devices, 'Participant devices')
      const selectedBy = normalizeActor(input?.selected_by, 'Participant selector')
      const timestamp = readNow()
      const transaction = db.transaction(() => {
        const selected = []
        for (const groupInput of groups) {
          const team = createOrGetTeam(db, mission.id, groupInput, timestamp)
          selected.push(insertParticipant(db, {
            missionId: mission.id,
            kind: 'group',
            missionTeamId: team.id,
            provenance: 'explicit',
            effectiveFrom: mission.start_time,
            addedAt: timestamp,
            addedBy: selectedBy,
          }))
          for (const deviceId of normalizeDeviceIdArray(groupInput?.member_device_ids)) {
            insertMembershipEvent(db, {
              missionId: mission.id,
              missionTeamId: team.id,
              deviceId,
              change: 'member',
              observedAt: timestamp,
            })
          }
        }
        for (const deviceInput of devices) {
          selected.push(insertParticipant(db, {
            missionId: mission.id,
            kind: 'device',
            deviceId: normalizeIdentifier(
              deviceInput?.traccar_device_id,
              'Traccar device id',
            ),
            provenance: 'explicit',
            effectiveFrom: mission.start_time,
            addedAt: timestamp,
            addedBy: selectedBy,
          }))
        }
        failAfterMutation(faultInjection)
        insertAudit(db, mission.id, 'participants_selected', timestamp, {
          selected_by: selectedBy,
          group_count: groups.length,
          device_count: devices.length,
          effective_from: mission.start_time,
        })
        return selected
      })
      transaction()
      return listMissionParticipants(db, mission.id)
    },

    addMissionParticipant(input) {
      const mission = requireMutableMission(db, input?.mission_id)
      const kind = normalizeKind(input?.kind)
      const actor = normalizeActor(input?.confirmed_by, 'Participant confirmer')
      const addedAt = readNow()
      const effectiveFrom = normalizeTimestamp(
        input?.effective_from ?? addedAt,
        'Participant effective-from',
      )
      validateEffectiveFrom(mission, effectiveFrom, addedAt)
      const transaction = db.transaction(() => {
        let teamId = null
        let deviceId = null
        if (kind === 'group') {
          teamId = createOrGetTeam(db, mission.id, input?.ref, addedAt).id
        } else {
          deviceId = normalizeIdentifier(input?.ref, 'Traccar device id')
        }
        assertNoActiveDuplicate(db, mission.id, kind, deviceId, teamId)
        const participant = insertParticipant(db, {
          missionId: mission.id,
          kind,
          deviceId,
          missionTeamId: teamId,
          provenance: 'explicit',
          effectiveFrom,
          addedAt,
          addedBy: actor,
        })
        if (deviceId !== null) {
          insertBackfillCheckpoint(db, {
            missionId: mission.id,
            deviceId,
            windowFrom: effectiveFrom,
            windowTo: addedAt,
            reconciledUntil: effectiveFrom,
            completed: effectiveFrom === addedAt,
            updatedAt: addedAt,
          })
        }
        failAfterMutation(faultInjection)
        insertAudit(db, mission.id, 'participant_added', addedAt, {
          participant_id: participant.id,
          kind,
          traccar_device_id: deviceId,
          mission_team_id: teamId,
          effective_from: effectiveFrom,
          effective_from_defaulted: input?.effective_from === undefined,
          confirmed_by: actor,
        })
        return participant
      })
      return transaction()
    },

    removeMissionParticipant(input) {
      const mission = requireMutableMission(db, input?.mission_id)
      const participant = requireParticipant(db, mission.id, input?.participant_id)
      if (participant.removed_at !== null) {
        throw new Error('Mission participant has already been removed.')
      }
      const removedBy = normalizeActor(input?.removed_by, 'Participant remover')
      const removedAt = readNow()
      const transaction = db.transaction(() => {
        db.prepare(`UPDATE mission_participants
          SET removed_at = ?, removed_by = ? WHERE id = ?`)
          .run(removedAt, removedBy, participant.id)
        failAfterMutation(faultInjection)
        insertAudit(db, mission.id, 'participant_removed', removedAt, {
          participant_id: participant.id,
          removed_by: removedBy,
          reason: normalizeOptionalText(input?.reason),
        })
      })
      transaction()
      return requireParticipant(db, mission.id, participant.id)
    },

    listMissionParticipants(missionId) {
      requireMission(db, missionId)
      return listMissionParticipants(db, missionId)
    },

    recordGroupMembershipEvents(input) {
      const mission = requireMutableMission(db, input?.mission_id)
      const events = normalizeArray(input?.events, 'Group membership events')
      const transaction = db.transaction(() => {
        const inserted = []
        for (const event of events) {
          const teamId = normalizeIdentifier(event?.mission_team_id, 'Mission team id')
          requireTeam(db, mission.id, teamId)
          const deviceId = normalizeIdentifier(event?.traccar_device_id, 'Traccar device id')
          const change = normalizeMembershipChange(event?.change)
          const observedAt = normalizeTimestamp(event?.observed_at, 'Membership observation')
          const latest = db.prepare(`SELECT change FROM mission_group_membership_events
            WHERE mission_id = ? AND mission_team_id = ? AND traccar_device_id = ?
            ORDER BY observed_at DESC, rowid DESC LIMIT 1`)
            .get(mission.id, teamId, deviceId)
          if (latest?.change === change) continue
          inserted.push(insertMembershipEvent(db, {
            missionId: mission.id,
            missionTeamId: teamId,
            deviceId,
            change,
            observedAt,
          }))
        }
        if (inserted.length > 0) {
          const timestamp = readNow()
          failAfterMutation(faultInjection)
          insertAudit(db, mission.id, 'group_membership_changed', timestamp, {
            event_count: inserted.length,
            event_ids: inserted.map((event) => event.id),
          })
        }
        return inserted
      })
      return transaction()
    },

    listGroupMembershipEvents(missionId, teamId) {
      requireMission(db, missionId)
      if (teamId === undefined) {
        return db.prepare(`SELECT * FROM mission_group_membership_events
          WHERE mission_id = ? ORDER BY observed_at ASC, rowid ASC`).all(missionId)
      }
      return db.prepare(`SELECT * FROM mission_group_membership_events
        WHERE mission_id = ? AND mission_team_id = ?
        ORDER BY observed_at ASC, rowid ASC`).all(missionId, teamId)
    },

    upsertParticipantBackfillCheckpoint(input) {
      const mission = requireMutableMission(db, input?.mission_id)
      const deviceId = normalizeIdentifier(input?.traccar_device_id, 'Traccar device id')
      const windowFrom = normalizeTimestamp(input?.window_from, 'Backfill window start')
      const windowTo = normalizeTimestamp(input?.window_to, 'Backfill window end')
      const reconciledUntil = normalizeTimestamp(
        input?.reconciled_until,
        'Backfill reconciled-until',
      )
      validateBackfillWindow(mission, windowFrom, windowTo, reconciledUntil)
      const existing = db.prepare(`SELECT * FROM participant_backfill_checkpoints
        WHERE mission_id = ? AND traccar_device_id = ? AND window_from = ?`)
        .get(mission.id, deviceId, windowFrom)
      if (existing !== undefined && existing.window_to !== windowTo) {
        throw new Error('Participant backfill window edges are immutable.')
      }
      const completed = input?.completed === true ? 1 : 0
      const updatedAt = readNow()
      db.prepare(`INSERT INTO participant_backfill_checkpoints (
          mission_id, traccar_device_id, window_from, window_to,
          reconciled_until, completed, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mission_id, traccar_device_id, window_from) DO UPDATE SET
          reconciled_until = excluded.reconciled_until,
          completed = excluded.completed,
          updated_at = excluded.updated_at`)
        .run(
          mission.id, deviceId, windowFrom, windowTo,
          reconciledUntil, completed, updatedAt,
        )
      if (completed === 1 && existing?.completed !== 1) {
        insertAudit(db, mission.id, 'participant_backfill_completed', updatedAt, {
          traccar_device_id: deviceId,
          window_from: windowFrom,
          window_to: windowTo,
        })
      }
      return requireCheckpoint(db, mission.id, deviceId, windowFrom)
    },

    listParticipantBackfillCheckpoints(missionId) {
      requireMission(db, missionId)
      return db.prepare(`SELECT * FROM participant_backfill_checkpoints
        WHERE mission_id = ? ORDER BY traccar_device_id ASC, window_from ASC`).all(missionId)
    },
  }
}

function insertParticipant(db, input) {
  const participant = {
    id: randomUUID(),
    mission_id: input.missionId,
    kind: input.kind,
    traccar_device_id: input.deviceId ?? null,
    mission_team_id: input.missionTeamId ?? null,
    provenance: input.provenance,
    effective_from: input.effectiveFrom,
    added_at: input.addedAt,
    added_by: input.addedBy ?? null,
    removed_at: null,
    removed_by: null,
  }
  db.prepare(`INSERT INTO mission_participants (
      id, mission_id, kind, traccar_device_id, mission_team_id, provenance,
      effective_from, added_at, added_by, removed_at, removed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
    .run(
      participant.id, participant.mission_id, participant.kind,
      participant.traccar_device_id, participant.mission_team_id,
      participant.provenance, participant.effective_from,
      participant.added_at, participant.added_by,
    )
  return participant
}

function createOrGetTeam(db, missionId, input, frozenAt) {
  const groupId = normalizeIdentifier(input?.traccar_group_id, 'Traccar group id')
  const existing = db.prepare(`SELECT * FROM mission_teams
    WHERE mission_id = ? AND traccar_group_id = ?`).get(missionId, groupId)
  if (existing !== undefined) return existing
  const team = {
    id: randomUUID(),
    mission_id: missionId,
    traccar_group_id: groupId,
    name: normalizeLabel(input?.name, 'Mission team name'),
    frozen_at: frozenAt,
  }
  db.prepare(`INSERT INTO mission_teams
    (id, mission_id, traccar_group_id, name, frozen_at) VALUES (?, ?, ?, ?, ?)`)
    .run(team.id, team.mission_id, team.traccar_group_id, team.name, team.frozen_at)
  return team
}

function insertMembershipEvent(db, input) {
  const event = {
    id: randomUUID(),
    mission_id: input.missionId,
    mission_team_id: input.missionTeamId,
    traccar_device_id: input.deviceId,
    change: input.change,
    observed_at: input.observedAt,
  }
  db.prepare(`INSERT INTO mission_group_membership_events
    (id, mission_id, mission_team_id, traccar_device_id, change, observed_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      event.id, event.mission_id, event.mission_team_id,
      event.traccar_device_id, event.change, event.observed_at,
    )
  return event
}

function insertBackfillCheckpoint(db, input) {
  db.prepare(`INSERT INTO participant_backfill_checkpoints (
      mission_id, traccar_device_id, window_from, window_to,
      reconciled_until, completed, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      input.missionId, input.deviceId, input.windowFrom, input.windowTo,
      input.reconciledUntil, input.completed ? 1 : 0, input.updatedAt,
    )
}

function listMissionParticipants(db, missionId) {
  return db.prepare(`SELECT participant.*, team.traccar_group_id, team.name AS team_name,
      checkpoint.window_to AS backfill_window_to,
      checkpoint.reconciled_until AS backfill_reconciled_until,
      checkpoint.completed AS backfill_completed
    FROM mission_participants AS participant
    LEFT JOIN mission_teams AS team ON team.id = participant.mission_team_id
    LEFT JOIN participant_backfill_checkpoints AS checkpoint
      ON checkpoint.mission_id = participant.mission_id
      AND checkpoint.traccar_device_id = participant.traccar_device_id
      AND checkpoint.window_from = participant.effective_from
    WHERE participant.mission_id = ?
    ORDER BY participant.added_at ASC, participant.rowid ASC`).all(missionId)
}

function assertNoActiveDuplicate(db, missionId, kind, deviceId, teamId) {
  const duplicate = kind === 'device'
    ? db.prepare(`SELECT 1 FROM mission_participants WHERE mission_id = ?
        AND kind = 'device' AND traccar_device_id = ? AND removed_at IS NULL`)
        .get(missionId, deviceId)
    : db.prepare(`SELECT 1 FROM mission_participants WHERE mission_id = ?
        AND kind = 'group' AND mission_team_id = ? AND removed_at IS NULL`)
        .get(missionId, teamId)
  if (duplicate !== undefined) throw new Error('Participant is already active for this mission.')
}

function requireMission(db, missionId) {
  const mission = typeof missionId === 'string'
    ? db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId)
    : undefined
  if (mission === undefined) throw new Error(`Mission not found: ${String(missionId)}`)
  return mission
}

function requireMutableMission(db, missionId) {
  const mission = requireMission(db, missionId)
  if (mission.status === 'finalized') throw new Error('Finalized missions are read-only.')
  return mission
}

function requireParticipant(db, missionId, participantId) {
  const participant = typeof participantId === 'string'
    ? db.prepare(`SELECT participant.*, team.traccar_group_id, team.name AS team_name
        FROM mission_participants AS participant
        LEFT JOIN mission_teams AS team ON team.id = participant.mission_team_id
        WHERE participant.mission_id = ? AND participant.id = ?`)
        .get(missionId, participantId)
    : undefined
  if (participant === undefined) throw new Error(`Mission participant not found: ${String(participantId)}`)
  return participant
}

function requireTeam(db, missionId, teamId) {
  const team = db.prepare('SELECT * FROM mission_teams WHERE mission_id = ? AND id = ?')
    .get(missionId, teamId)
  if (team === undefined) throw new Error(`Mission team not found: ${String(teamId)}`)
  return team
}

function requireCheckpoint(db, missionId, deviceId, windowFrom) {
  return db.prepare(`SELECT * FROM participant_backfill_checkpoints
    WHERE mission_id = ? AND traccar_device_id = ? AND window_from = ?`)
    .get(missionId, deviceId, windowFrom)
}

function validateEffectiveFrom(mission, effectiveFrom, now) {
  if (effectiveFrom < mission.start_time) {
    throw new Error('Participant effective-from cannot be before the mission start.')
  }
  if (effectiveFrom > now) throw new Error('Participant effective-from cannot be in the future.')
}

function validateBackfillWindow(mission, windowFrom, windowTo, reconciledUntil) {
  if (windowFrom < mission.start_time || windowTo < windowFrom) {
    throw new Error('Participant backfill window is outside the mission boundary.')
  }
  if (reconciledUntil < windowFrom || reconciledUntil > windowTo) {
    throw new Error('Participant backfill cursor must stay inside its fixed window.')
  }
}

function normalizeArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return value
}

function normalizeDeviceIdArray(value) {
  if (value === undefined) return []
  return normalizeArray(value, 'Group member device ids')
    .map((deviceId) => normalizeIdentifier(deviceId, 'Traccar device id'))
}

function normalizeIdentifier(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required.`)
  return value.trim()
}

function normalizeActor(value, label) {
  return normalizeIdentifier(value, label)
}

function normalizeLabel(value, label) {
  return normalizeIdentifier(value, label)
}

function normalizeKind(value) {
  if (value !== 'device' && value !== 'group') throw new Error('Participant kind is invalid.')
  return value
}

function normalizeMembershipChange(value) {
  if (value !== 'member' && value !== 'left') throw new Error('Membership change is invalid.')
  return value
}

function normalizeTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${label} must be a valid UTC timestamp.`)
  }
  return new Date(value).toISOString()
}

function normalizeOptionalText(value) {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('Participant reason must be text.')
  return value.trim() || null
}

function failAfterMutation(faultInjection) {
  if (faultInjection.afterMutation === true) {
    throw new Error('Injected participant transaction failure.')
  }
}

function insertAudit(db, missionId, eventType, timestamp, details) {
  db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
    VALUES (?, ?, ?, ?, ?)`)
    .run(randomUUID(), missionId, eventType, timestamp, JSON.stringify(details))
}

module.exports = { createParticipantStore }
