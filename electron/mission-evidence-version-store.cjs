const { randomUUID } = require('node:crypto')

const OBJECT_TYPES = new Set(['marker', 'drawing', 'outing', 'search_area', 'search_assignment', 'search_pass'])
const OPERATIONS = new Set(['created', 'updated', 'retired', 'legacy_baseline'])
const MAX_LEGACY_BASELINE_ROWS_PER_TURN = 25
const MAX_LEGACY_BASELINE_PAGE_BYTES = 1024 * 1024
const MAX_LEGACY_BASELINE_OBJECT_BYTES = 1024 * 1024
const LEGACY_BASELINES = [
  { table: 'markers', objectType: 'marker', effectiveColumn: 'created_at' },
  { table: 'drawings', objectType: 'drawing', effectiveColumn: 'created_at' },
  { table: 'outings', objectType: 'outing', effectiveColumn: 'started_at' },
  { table: 'search_areas', objectType: 'search_area', effectiveColumn: 'created_at' },
  { table: 'search_assignments', objectType: 'search_assignment', effectiveColumn: 'created_at' },
  { table: 'search_passes', objectType: 'search_pass', effectiveColumn: 'started_at' },
]

/** Creates the append-only mission-object version boundary on the shared transaction. */
function createMissionEvidenceVersionStore(options) {
  const { db } = options
  const readNow = options.now ?? (() => new Date().toISOString())
  const faultInjection = options.faultInjection ?? {}
  const assertReady = options.assertReady ?? (() => undefined)

  return {
    recordVersion(input) {
      const objectType = normalizeEnum(input.objectType, OBJECT_TYPES, 'evidence object type')
      const operation = normalizeEnum(input.operation, OPERATIONS, 'evidence version operation')
      if (operation !== 'legacy_baseline') assertReady()
      const missionId = normalizeId(input.missionId, 'mission id')
      const objectId = normalizeId(input.objectId, 'evidence object id')
      if (operation !== 'legacy_baseline') {
        assertOversizedLegacyObjectMayChange(db, missionId, objectType, objectId)
      }
      const recordedAt = normalizeTimestamp(input.recordedAt ?? readNow(), 'recorded time')
      const effectiveAt = normalizeTimestamp(input.effectiveAt ?? recordedAt, 'effective time')
      const previous = db.prepare(`SELECT MAX(version_sequence) AS version_sequence
        FROM mission_object_versions
        WHERE mission_id = ? AND object_type = ? AND object_id = ?`)
        .get(missionId, objectType, objectId)
      const versionSequence = Number(previous?.version_sequence ?? 0) + 1
      const id = randomUUID()
      const completeness = input.completeness === 'legacy_baseline'
        ? 'legacy_baseline'
        : 'complete'
      const stateJson = JSON.stringify(input.state)
      if (faultInjection.afterProjection === true) {
        throw new Error('Injected mission evidence version failure after projection write.')
      }
      db.prepare(`INSERT INTO mission_object_versions (
        id, mission_id, object_type, object_id, version_sequence, operation,
        effective_at, recorded_at, completeness, state_json, actor,
        correlation_id, audit_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          missionId,
          objectType,
          objectId,
          versionSequence,
          operation,
          effectiveAt,
          recordedAt,
          completeness,
          stateJson,
          normalizeOptionalText(input.actor),
          normalizeOptionalText(input.correlationId),
          normalizeOptionalText(input.auditEventId),
        )
      return {
        id,
        mission_id: missionId,
        object_type: objectType,
        object_id: objectId,
        version_sequence: versionSequence,
        operation,
        effective_at: effectiveAt,
        recorded_at: recordedAt,
        completeness,
        state_json: stateJson,
        actor: normalizeOptionalText(input.actor),
        correlation_id: normalizeOptionalText(input.correlationId),
        audit_event_id: normalizeOptionalText(input.auditEventId),
      }
    },

    listVersions(input) {
      const missionId = normalizeId(input?.missionId, 'mission id')
      const where = ['mission_id = ?']
      const parameters = [missionId]
      if (input?.objectType !== undefined) {
        where.push('object_type = ?')
        parameters.push(normalizeEnum(input.objectType, OBJECT_TYPES, 'evidence object type'))
      }
      if (input?.objectId !== undefined) {
        where.push('object_id = ?')
        parameters.push(normalizeId(input.objectId, 'evidence object id'))
      }
      return db.prepare(`SELECT * FROM mission_object_versions
        WHERE ${where.join(' AND ')}
        ORDER BY recorded_at ASC, object_type ASC, object_id ASC, version_sequence ASC`)
        .all(...parameters)
    },
  }
}

/**
 * Protects the current projection when it is the sole exact copy of a legacy
 * object whose immutable baseline could only be recorded as an explicit summary.
 */
function assertOversizedLegacyObjectMayChange(db, missionId, objectType, objectId) {
  const baseline = db.prepare(`SELECT state_json FROM mission_object_versions
    WHERE mission_id = ? AND object_type = ? AND object_id = ?
      AND operation = 'legacy_baseline'
    ORDER BY version_sequence ASC LIMIT 1`).get(missionId, objectType, objectId)
  if (baseline === undefined) return
  let state
  try {
    state = JSON.parse(baseline.state_json)
  } catch {
    throw new Error(
      `Legacy ${objectType} evidence ${objectId} has an unreadable immutable baseline. Preserve the mission database and use the bounded legacy evidence repair path before retrying the change.`,
    )
  }
  if (state?.legacy_state_omitted !== true) return
  throw new Error(
    `The sole exact copy of oversized legacy ${objectType} evidence ${objectId} is retained in the current mission record and cannot be changed or retired. Preserve the mission database and use the bounded legacy evidence repair path before retrying.`,
  )
}

/** Captures bounded, durable targets for legacy mutable-object reconstruction. */
function initializeLegacyMissionObjectVersionBackfill(
  db,
  migrationTime,
  resetCapturedTargets = false,
) {
  for (const baseline of LEGACY_BASELINES) {
    const targetId = db.prepare(`SELECT id FROM ${baseline.table}
      ORDER BY id DESC LIMIT 1`).get()?.id ?? null
    const initialUpdatedAt = targetId === null ? '1970-01-01T00:00:00.000Z' : migrationTime
    db.prepare(`INSERT OR IGNORE INTO legacy_mission_object_backfill_state (
      object_type, scanned_through_id, scan_target_id, updated_at
    ) VALUES (?, NULL, ?, ?)`).run(baseline.objectType, targetId, initialUpdatedAt)
    if (resetCapturedTargets) {
      db.prepare(`UPDATE legacy_mission_object_backfill_state
        SET scanned_through_id = NULL, scan_target_id = ?, updated_at = ?
        WHERE object_type = ?`).run(targetId, initialUpdatedAt, baseline.objectType)
    }
  }
}

/** Adds a bounded page of explicit baselines for unversioned legacy mutable objects. */
function backfillLegacyMissionObjectVersions(
  db,
  migrationTime,
  maximumRows = MAX_LEGACY_BASELINE_ROWS_PER_TURN,
) {
  const versionStore = createMissionEvidenceVersionStore({ db, now: () => migrationTime })
  let remainingRows = Math.max(1, Math.min(MAX_LEGACY_BASELINE_ROWS_PER_TURN, maximumRows))
  let remainingBytes = MAX_LEGACY_BASELINE_PAGE_BYTES
  for (const baseline of LEGACY_BASELINES) {
    if (remainingRows === 0 || remainingBytes === 0) break
    const state = db.prepare(`SELECT scanned_through_id, scan_target_id
      FROM legacy_mission_object_backfill_state WHERE object_type = ?`)
      .get(baseline.objectType)
    if (state?.scan_target_id === null || state?.scan_target_id === undefined
      || state.scanned_through_id === state.scan_target_id) continue
    const byteExpression = legacyPayloadByteExpression(db, baseline.table)
    const candidates = db.prepare(`SELECT id, mission_id,
        ${byteExpression} AS payload_bytes
      FROM ${baseline.table}
      WHERE (? IS NULL OR id > ?) AND id <= ?
      ORDER BY id ASC LIMIT ?`).all(
      state.scanned_through_id,
      state.scanned_through_id,
      state.scan_target_id,
      remainingRows,
    )
    const selected = []
    for (const candidate of candidates) {
      const payloadBytes = Number(candidate.payload_bytes)
      if (selected.length > 0 && payloadBytes > remainingBytes) break
      selected.push({ ...candidate, payload_bytes: payloadBytes })
      remainingBytes = Math.max(0, remainingBytes - Math.min(payloadBytes, remainingBytes))
      if (remainingBytes === 0) break
    }
    const transaction = db.transaction(() => {
      let cursor = state.scanned_through_id
      for (const candidate of selected) {
        const exists = db.prepare(`SELECT 1 FROM mission_object_versions
          WHERE mission_id = ? AND object_type = ? AND object_id = ? LIMIT 1`)
          .get(candidate.mission_id, baseline.objectType, candidate.id)
        if (exists === undefined) {
          if (candidate.payload_bytes > MAX_LEGACY_BASELINE_OBJECT_BYTES) {
            versionStore.recordVersion({
              missionId: candidate.mission_id,
              objectType: baseline.objectType,
              objectId: candidate.id,
              operation: 'legacy_baseline',
              effectiveAt: migrationTime,
              recordedAt: migrationTime,
              completeness: 'legacy_baseline',
              state: {
                id: candidate.id,
                mission_id: candidate.mission_id,
                legacy_history_known: false,
                legacy_state_omitted: true,
                legacy_payload_bytes: candidate.payload_bytes,
              },
            })
          } else {
            const row = db.prepare(`SELECT * FROM ${baseline.table} WHERE id = ?`)
              .get(candidate.id)
            versionStore.recordVersion({
              missionId: row.mission_id,
              objectType: baseline.objectType,
              objectId: row.id,
              operation: 'legacy_baseline',
              effectiveAt: migrationTime,
              recordedAt: migrationTime,
              completeness: 'legacy_baseline',
              state: {
                ...row,
                legacy_history_known: false,
                legacy_source_effective_at: row[baseline.effectiveColumn] ?? null,
              },
            })
          }
        }
        cursor = candidate.id
      }
      if (selected.length === 0) cursor = state.scan_target_id
      db.prepare(`UPDATE legacy_mission_object_backfill_state
        SET scanned_through_id = ?, updated_at = ? WHERE object_type = ?`)
        .run(cursor, migrationTime, baseline.objectType)
    })
    transaction.immediate()
    remainingRows -= selected.length
  }
  return { remaining: readLegacyMissionObjectBackfillPending(db) }
}

/** Returns one when any durable mutable-object baseline target remains unsettled. */
function readLegacyMissionObjectBackfillPending(db) {
  const state = db.prepare(`SELECT COUNT(*) AS count
    FROM legacy_mission_object_backfill_state
    WHERE scan_target_id IS NOT NULL
      AND (scanned_through_id IS NULL OR scanned_through_id < scan_target_id)`).get()
  return Number(state?.count ?? 0) > 0 ? 1 : 0
}

/** Rejects evidence reads or writes until every captured legacy baseline is explicit. */
function assertLegacyMissionObjectBackfillSettled(db) {
  const failure = db.prepare(`SELECT value FROM metadata
    WHERE key = 'legacy_evidence_backfill_failure'`).get()?.value
  if (typeof failure === 'string' && failure !== '') {
    throw new Error(`Legacy evidence baseline reconstruction stopped safely: ${failure}`)
  }
  if (readLegacyMissionObjectBackfillPending(db) > 0) {
    throw new Error(
      'Legacy mutable evidence baselines are still being reconstructed in bounded background slices. Current positions remain available; retry evidence changes or Replay after preparation completes.',
    )
  }
}

/** Builds a SQLite-only payload byte projection without copying legacy fields into JavaScript. */
function legacyPayloadByteExpression(db, table) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  return columns.map((column) =>
    `length(CAST(COALESCE("${String(column.name).replaceAll('"', '""')}", '') AS BLOB))`,
  ).join(' + ')
}

function normalizeId(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    throw new Error(`Mission evidence ${label} is invalid.`)
  }
  return value.trim()
}

function normalizeTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Mission evidence ${label} is invalid.`)
  }
  return new Date(Date.parse(value)).toISOString()
}

function normalizeEnum(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`Mission ${label} is invalid.`)
  return value
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

module.exports = {
  assertLegacyMissionObjectBackfillSettled,
  backfillLegacyMissionObjectVersions,
  createMissionEvidenceVersionStore,
  initializeLegacyMissionObjectVersionBackfill,
  readLegacyMissionObjectBackfillPending,
}
