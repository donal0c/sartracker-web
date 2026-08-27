const { randomUUID } = require('node:crypto')

const OBJECT_TYPES = new Set(['marker', 'drawing', 'outing', 'search_area', 'search_assignment', 'search_pass'])
const OPERATIONS = new Set(['created', 'updated', 'retired', 'legacy_baseline'])

/** Creates the append-only mission-object version boundary on the shared transaction. */
function createMissionEvidenceVersionStore(options) {
  const { db } = options
  const readNow = options.now ?? (() => new Date().toISOString())
  const faultInjection = options.faultInjection ?? {}

  return {
    recordVersion(input) {
      const objectType = normalizeEnum(input.objectType, OBJECT_TYPES, 'evidence object type')
      const operation = normalizeEnum(input.operation, OPERATIONS, 'evidence version operation')
      const missionId = normalizeId(input.missionId, 'mission id')
      const objectId = normalizeId(input.objectId, 'evidence object id')
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

/** Adds one explicit migration-time baseline for every unversioned legacy mutable object. */
function backfillLegacyMissionObjectVersions(db, migrationTime) {
  const versionStore = createMissionEvidenceVersionStore({ db, now: () => migrationTime })
  const baselines = [
    { table: 'markers', objectType: 'marker', effectiveColumn: 'created_at' },
    { table: 'drawings', objectType: 'drawing', effectiveColumn: 'created_at' },
    { table: 'outings', objectType: 'outing', effectiveColumn: 'started_at' },
    { table: 'search_areas', objectType: 'search_area', effectiveColumn: 'created_at' },
    { table: 'search_assignments', objectType: 'search_assignment', effectiveColumn: 'created_at' },
    { table: 'search_passes', objectType: 'search_pass', effectiveColumn: 'started_at' },
  ]
  for (const baseline of baselines) {
    const rows = db.prepare(`SELECT * FROM ${baseline.table} AS source
      WHERE NOT EXISTS (
        SELECT 1 FROM mission_object_versions AS version
        WHERE version.mission_id = source.mission_id
          AND version.object_type = ?
          AND version.object_id = source.id
      )
      ORDER BY source.mission_id ASC, source.id ASC`).all(baseline.objectType)
    for (const row of rows) {
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
  backfillLegacyMissionObjectVersions,
  createMissionEvidenceVersionStore,
}
