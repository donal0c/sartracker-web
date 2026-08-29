const { randomUUID } = require('node:crypto')

/** Creates the transactional mission participant subsystem. */
function createParticipantStore(options) {
  const { db } = options
  const readNow = options.now ?? (() => new Date().toISOString())
  const faultInjection = options.faultInjection ?? {}
  const recordCoverageChange = options.recordCoverageChange ?? (() => undefined)

  return {
    selectMissionParticipants(input) {
      const mission = requireMutableMission(db, input?.mission_id)
      const groups = normalizeArray(input?.groups, 'Participant groups')
      const devices = normalizeArray(input?.devices, 'Participant devices')
      const selectedBy = normalizeActor(input?.selected_by, 'Participant selector')
      assertNoInitialSelectionOverlap(groups, devices)
      const timestamp = readNow()
      const transaction = db.transaction(() => {
        const selected = []
        for (const groupInput of groups) {
          const team = createOrGetTeam(db, mission.id, groupInput, timestamp)
          assertNoActiveDuplicate(db, mission.id, 'group', null, team.id)
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
              recordedAt: timestamp,
            })
            insertBackfillCheckpoint(db, {
              missionId: mission.id,
              deviceId,
              windowFrom: mission.start_time,
              windowTo: timestamp,
              reconciledUntil: mission.start_time,
              completed: mission.start_time === timestamp,
              updatedAt: timestamp,
            })
          }
        }
        for (const deviceInput of devices) {
          const deviceId = normalizeIdentifier(
            deviceInput?.traccar_device_id,
            'Traccar device id',
          )
          assertNoActiveDuplicate(db, mission.id, 'device', deviceId, null)
          selected.push(insertParticipant(db, {
            missionId: mission.id,
            kind: 'device',
            deviceId,
            provenance: 'explicit',
            effectiveFrom: mission.start_time,
            addedAt: timestamp,
            addedBy: selectedBy,
          }))
          insertBackfillCheckpoint(db, {
            missionId: mission.id,
            deviceId,
            windowFrom: mission.start_time,
            windowTo: timestamp,
            reconciledUntil: mission.start_time,
            completed: mission.start_time === timestamp,
            updatedAt: timestamp,
          })
        }
        if (selected.length > 0) {
          recordCoverageChange(mission.id, timestamp)
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
          if (!Array.isArray(input?.ref?.member_device_ids)) {
            throw new Error('Current group member device ids are required.')
          }
          synchronizeObservedGroupMembership(
            db,
            mission.id,
            teamId,
            normalizeDeviceIdArray(input.ref.member_device_ids),
            addedAt,
            addedAt,
          )
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
        } else {
          for (const memberDeviceId of normalizeDeviceIdArray(input.ref.member_device_ids)) {
            insertBackfillCheckpoint(db, {
              missionId: mission.id,
              deviceId: memberDeviceId,
              windowFrom: effectiveFrom,
              windowTo: addedAt,
              reconciledUntil: effectiveFrom,
              completed: effectiveFrom === addedAt,
              updatedAt: addedAt,
            })
          }
        }
        recordCoverageChange(mission.id, addedAt)
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
        recordCoverageChange(mission.id, removedAt)
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
      const recordedAt = readNow()
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
            ORDER BY observed_at DESC, COALESCE(sequence, rowid) DESC LIMIT 1`)
            .get(mission.id, teamId, deviceId)
          if (latest?.change === change) continue
          inserted.push(insertMembershipEvent(db, {
            missionId: mission.id,
            missionTeamId: teamId,
            deviceId,
            change,
            observedAt,
            recordedAt,
          }))
        }
        if (inserted.length > 0) {
          recordCoverageChange(mission.id, recordedAt)
          failAfterMutation(faultInjection)
          insertAudit(db, mission.id, 'group_membership_changed', recordedAt, {
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
        return db.prepare(`SELECT *, COALESCE(sequence, rowid) AS sequence
          FROM mission_group_membership_events
          WHERE mission_id = ? ORDER BY observed_at ASC, COALESCE(sequence, rowid) ASC`).all(missionId)
      }
      return db.prepare(`SELECT *, COALESCE(sequence, rowid) AS sequence
        FROM mission_group_membership_events
        WHERE mission_id = ? AND mission_team_id = ?
        ORDER BY observed_at ASC, COALESCE(sequence, rowid) ASC`).all(missionId, teamId)
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
      const completed = input?.completed === true ? 1 : 0
      if ((reconciledUntil === windowTo) !== (completed === 1)) {
        throw new Error(
          'Completed participant backfill must have its cursor at the fixed window end.',
        )
      }
      const updatedAt = readNow()
      const transaction = db.transaction(() => {
        const existing = db.prepare(`SELECT * FROM participant_backfill_checkpoints
          WHERE mission_id = ? AND traccar_device_id = ? AND window_from = ?`)
          .get(mission.id, deviceId, windowFrom)
        if (existing !== undefined && existing.window_to !== windowTo) {
          throw new Error('Participant backfill window edges are immutable.')
        }
        if (existing?.completed === 1 && completed !== 1) {
          throw new Error('Participant backfill completion is irreversible.')
        }
        if (
          existing !== undefined &&
          reconciledUntil < existing.reconciled_until
        ) {
          throw new Error('Participant backfill cursor cannot decrease or rewind.')
        }
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
        recordCoverageChange(mission.id, updatedAt)
        if (completed === 1 && existing?.completed !== 1) {
          insertAudit(db, mission.id, 'participant_backfill_completed', updatedAt, {
            traccar_device_id: deviceId,
            window_from: windowFrom,
            window_to: windowTo,
          })
        }
        return requireCheckpoint(db, mission.id, deviceId, windowFrom)
      })
      return transaction()
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
  const sequence = Number(db.prepare(`SELECT COALESCE(MAX(COALESCE(sequence, rowid)), 0) + 1
    FROM mission_group_membership_events`).pluck().get())
  const event = {
    id: randomUUID(),
    sequence,
    mission_id: input.missionId,
    mission_team_id: input.missionTeamId,
    traccar_device_id: input.deviceId,
    change: input.change,
    observed_at: input.observedAt,
    recorded_at: input.recordedAt,
    recording_completeness: 'complete',
  }
  db.prepare(`INSERT INTO mission_group_membership_events
    (id, sequence, mission_id, mission_team_id, traccar_device_id, change, observed_at,
      recorded_at, recording_completeness)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      event.id, event.sequence, event.mission_id, event.mission_team_id,
      event.traccar_device_id, event.change, event.observed_at, event.recorded_at,
      event.recording_completeness,
    )
  return event
}

/** Appends the complete observed membership delta for one later group selection. */
function synchronizeObservedGroupMembership(
  db,
  missionId,
  missionTeamId,
  observedDeviceIds,
  observedAt,
  recordedAt,
) {
  const latestByDevice = new Map()
  const rows = db.prepare(`SELECT traccar_device_id, change
    FROM mission_group_membership_events
    WHERE mission_id = ? AND mission_team_id = ?
    ORDER BY observed_at DESC, sequence DESC`).all(missionId, missionTeamId)
  for (const row of rows) {
    if (!latestByDevice.has(row.traccar_device_id)) {
      latestByDevice.set(row.traccar_device_id, row.change)
    }
  }

  const observed = new Set(observedDeviceIds)
  for (const [deviceId, change] of latestByDevice) {
    if (change === 'member' && !observed.has(deviceId)) {
      insertMembershipEvent(db, {
        missionId,
        missionTeamId,
        deviceId,
        change: 'left',
        observedAt,
        recordedAt,
      })
    }
  }
  for (const deviceId of observed) {
    if (latestByDevice.get(deviceId) !== 'member') {
      insertMembershipEvent(db, {
        missionId,
        missionTeamId,
        deviceId,
        change: 'member',
        observedAt,
        recordedAt,
      })
    }
  }
}

/** Adds only uncovered adjacent fixed windows for an authorized history interval. */
function insertBackfillCheckpoint(db, input) {
  const readAt = db.prepare(`SELECT window_to FROM participant_backfill_checkpoints
    WHERE mission_id = ? AND traccar_device_id = ? AND window_from = ?`)
  const insert = db.prepare(`INSERT INTO participant_backfill_checkpoints (
      mission_id, traccar_device_id, window_from, window_to,
      reconciled_until, completed, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  let windowFrom = input.windowFrom
  while (windowFrom < input.windowTo) {
    const existing = readAt.get(input.missionId, input.deviceId, windowFrom)
    if (existing === undefined) {
      insert.run(
        input.missionId, input.deviceId, windowFrom, input.windowTo,
        windowFrom, 0, input.updatedAt,
      )
      return
    }
    if (existing.window_to <= windowFrom) {
      throw new Error('Participant backfill window must advance beyond its start.')
    }
    if (existing.window_to >= input.windowTo) return
    windowFrom = existing.window_to
  }
  if (input.windowFrom === input.windowTo && readAt.get(
    input.missionId,
    input.deviceId,
    input.windowFrom,
  ) === undefined) {
    insert.run(
      input.missionId, input.deviceId, input.windowFrom, input.windowTo,
      input.reconciledUntil, input.completed ? 1 : 0, input.updatedAt,
    )
  }
}

function listMissionParticipants(db, missionId) {
  return db.prepare(`SELECT participant.*, team.traccar_group_id, team.name AS team_name,
      CASE WHEN participant.kind = 'device' THEN (
        SELECT MAX(checkpoint.window_to) FROM participant_backfill_checkpoints AS checkpoint
        WHERE checkpoint.mission_id = participant.mission_id
          AND checkpoint.traccar_device_id = participant.traccar_device_id
          AND checkpoint.window_from >= participant.effective_from
          AND checkpoint.window_to <= participant.added_at
      ) ELSE NULL END AS backfill_window_to,
      CASE WHEN participant.kind = 'device' THEN (
        SELECT COALESCE(
          MIN(CASE WHEN checkpoint.completed = 0 THEN checkpoint.reconciled_until END),
          MAX(checkpoint.reconciled_until)
        ) FROM participant_backfill_checkpoints AS checkpoint
        WHERE checkpoint.mission_id = participant.mission_id
          AND checkpoint.traccar_device_id = participant.traccar_device_id
          AND checkpoint.window_from >= participant.effective_from
          AND checkpoint.window_to <= participant.added_at
      ) ELSE NULL END AS backfill_reconciled_until,
      CASE WHEN participant.kind = 'device' THEN (
        SELECT CASE WHEN COUNT(*) = 0 THEN NULL WHEN MIN(checkpoint.completed) = 1 THEN 1 ELSE 0 END
        FROM participant_backfill_checkpoints AS checkpoint
        WHERE checkpoint.mission_id = participant.mission_id
          AND checkpoint.traccar_device_id = participant.traccar_device_id
          AND checkpoint.window_from >= participant.effective_from
          AND checkpoint.window_to <= participant.added_at
      ) ELSE NULL END AS backfill_completed,
      CASE WHEN participant.kind = 'group' THEN (
        SELECT COUNT(DISTINCT initial_membership.traccar_device_id)
        FROM mission_group_membership_events AS initial_membership
        WHERE initial_membership.mission_id = participant.mission_id
          AND initial_membership.mission_team_id = participant.mission_team_id
          AND initial_membership.change = 'member'
          AND initial_membership.observed_at = participant.added_at
      ) ELSE NULL END AS backfill_member_count,
      CASE WHEN participant.kind = 'group' THEN (
        SELECT COUNT(DISTINCT CASE WHEN EXISTS (
            SELECT 1 FROM participant_backfill_checkpoints AS group_checkpoint
            WHERE group_checkpoint.mission_id = initial_membership.mission_id
              AND group_checkpoint.traccar_device_id = initial_membership.traccar_device_id
              AND group_checkpoint.window_from >= participant.effective_from
              AND group_checkpoint.window_to <= participant.added_at
          ) AND NOT EXISTS (
            SELECT 1 FROM participant_backfill_checkpoints AS group_checkpoint
            WHERE group_checkpoint.mission_id = initial_membership.mission_id
              AND group_checkpoint.traccar_device_id = initial_membership.traccar_device_id
              AND group_checkpoint.window_from >= participant.effective_from
              AND group_checkpoint.window_to <= participant.added_at
              AND group_checkpoint.completed = 0
          ) THEN initial_membership.traccar_device_id END)
        FROM mission_group_membership_events AS initial_membership
        WHERE initial_membership.mission_id = participant.mission_id
          AND initial_membership.mission_team_id = participant.mission_team_id
          AND initial_membership.change = 'member'
          AND initial_membership.observed_at = participant.added_at
      ) ELSE NULL END AS backfill_completed_count
    FROM mission_participants AS participant
    LEFT JOIN mission_teams AS team ON team.id = participant.mission_team_id
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
  if (kind === 'device' && isDeviceCoveredByActiveGroup(db, missionId, deviceId)) {
    throw new Error('Participant device is already active through a selected group.')
  }
  if (kind === 'group' && doesGroupCoverActiveDevice(db, missionId, teamId)) {
    throw new Error('Participant group already covers an active individual device.')
  }
}

/** Returns whether an active group currently covers a direct device candidate. */
function isDeviceCoveredByActiveGroup(db, missionId, deviceId) {
  return db.prepare(`SELECT 1
      FROM mission_participants AS participant
      INNER JOIN mission_group_membership_events AS membership
        ON membership.mission_id = participant.mission_id
       AND membership.mission_team_id = participant.mission_team_id
      WHERE participant.mission_id = ?
        AND participant.kind = 'group'
        AND participant.removed_at IS NULL
        AND membership.traccar_device_id = ?
        AND membership.change = 'member'
        AND NOT EXISTS (
          SELECT 1 FROM mission_group_membership_events AS newer
          WHERE newer.mission_id = membership.mission_id
            AND newer.mission_team_id = membership.mission_team_id
            AND newer.traccar_device_id = membership.traccar_device_id
            AND (
              newer.observed_at > membership.observed_at OR
              (newer.observed_at = membership.observed_at AND newer.sequence > membership.sequence)
            )
        )
      LIMIT 1`).get(missionId, deviceId) !== undefined
}

/** Returns whether a group candidate currently covers an active direct device. */
function doesGroupCoverActiveDevice(db, missionId, teamId) {
  return db.prepare(`SELECT 1
      FROM mission_participants AS participant
      INNER JOIN mission_group_membership_events AS membership
        ON membership.mission_id = participant.mission_id
       AND membership.traccar_device_id = participant.traccar_device_id
      WHERE participant.mission_id = ?
        AND participant.kind = 'device'
        AND participant.removed_at IS NULL
        AND membership.mission_team_id = ?
        AND membership.change = 'member'
        AND NOT EXISTS (
          SELECT 1 FROM mission_group_membership_events AS newer
          WHERE newer.mission_id = membership.mission_id
            AND newer.mission_team_id = membership.mission_team_id
            AND newer.traccar_device_id = membership.traccar_device_id
            AND (
              newer.observed_at > membership.observed_at OR
              (newer.observed_at = membership.observed_at AND newer.sequence > membership.sequence)
            )
        )
      LIMIT 1`).get(missionId, teamId) !== undefined
}

/** Rejects ambiguous initial instructions before their transaction mutates evidence. */
function assertNoInitialSelectionOverlap(groups, devices) {
  const directDeviceIds = devices.map((device) =>
    normalizeIdentifier(device?.traccar_device_id, 'Traccar device id'))
  const duplicateDirectDeviceId = firstDuplicate(directDeviceIds)
  if (duplicateDirectDeviceId !== null) {
    throw new Error(`Participant device ${duplicateDirectDeviceId} is selected more than once.`)
  }

  const groupIds = groups.map((group) =>
    normalizeIdentifier(group?.traccar_group_id, 'Traccar group id'))
  const duplicateGroupId = firstDuplicate(groupIds)
  if (duplicateGroupId !== null) {
    throw new Error(`Participant group ${duplicateGroupId} is selected more than once.`)
  }

  const groupMemberDeviceIds = new Set(
    groups.flatMap((group) => normalizeDeviceIdArray(group?.member_device_ids)),
  )
  const overlappingDeviceIds = [...new Set(directDeviceIds)]
    .filter((deviceId) => groupMemberDeviceIds.has(deviceId))
    .sort()
  if (overlappingDeviceIds.length > 0) {
    throw new Error(
      `Participant devices already covered by a selected group must be selected only once: ${overlappingDeviceIds.join(', ')}.`,
    )
  }
}

/** Returns the first repeated identifier without hiding an invalid selection. */
function firstDuplicate(values) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
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
  if (mission.status === 'finished' || mission.status === 'finalized') {
    throw new Error('Finished and finalized missions are read-only for participant changes.')
  }
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
  db.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
  ) VALUES (?, ?, ?, ?, ?, ?, 'complete')`)
    .run(randomUUID(), missionId, eventType, timestamp, JSON.stringify(details), timestamp)
}

module.exports = { createParticipantStore }
