'use strict'

const { listArchiveInventoryForSchema } = require('./archive-inventory.cjs')

const ARCHIVE_CLEANUP_MEMBERSHIP_GENERATION_KEY_PREFIX =
  'archive_cleanup_membership_generation_v1:'
const ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_KEY_PREFIX =
  'archive_cleanup_membership_bypass_v1:'
const MAX_GENERATION = Number.MAX_SAFE_INTEGER
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const ARCHIVE_CLEANUP_OPERATIONAL_TABLES = Object.freeze([
  'gpx_import_source_receipts',
  'ingest_anomaly_deliveries',
  'participant_backfill_checkpoints',
  'tracking_history_checkpoints',
])
const ARCHIVE_CLEANUP_MEMBERSHIP_EVENT_TYPES = Object.freeze([
  'device_updated',
  'mission_backup_synced',
  'position_recorded',
])

/**
 * Every v13 cleanup table plus the removable mission-event subset. The replay
 * generation table is deliberately omitted: it is a reconstructed cache counter.
 */
const TRACKED_TABLE_SELECTORS = Object.freeze({
  coverage_chunks: Object.freeze({ kind: 'mission_column' }),
  coverage_invalidations: Object.freeze({ kind: 'mission_column' }),
  coverage_missions: Object.freeze({ kind: 'mission_column' }),
  devices: Object.freeze({ kind: 'mission_column' }),
  drawings: Object.freeze({ kind: 'mission_column' }),
  gpx_evidence_points: Object.freeze({ kind: 'gpx_revision' }),
  gpx_evidence_rejections: Object.freeze({ kind: 'gpx_revision' }),
  gpx_import_aliases: Object.freeze({ kind: 'mission_column' }),
  gpx_import_batches: Object.freeze({ kind: 'mission_column' }),
  gpx_import_failures: Object.freeze({ kind: 'mission_column' }),
  gpx_import_revisions: Object.freeze({ kind: 'mission_column' }),
  gpx_import_source_receipts: Object.freeze({ kind: 'mission_column' }),
  gpx_track_imports: Object.freeze({ kind: 'mission_column' }),
  helicopters: Object.freeze({ kind: 'mission_column' }),
  ingest_anomalies: Object.freeze({ kind: 'mission_column' }),
  ingest_anomaly_deliveries: Object.freeze({ kind: 'mission_column' }),
  ingest_anomaly_devices: Object.freeze({ kind: 'mission_column' }),
  ingest_anomaly_mission_health: Object.freeze({ kind: 'mission_column' }),
  layer_catalog_entries: Object.freeze({ kind: 'mission_column' }),
  legacy_event_provenance_quarantine_missions: Object.freeze({ kind: 'mission_column' }),
  markers: Object.freeze({ kind: 'mission_column' }),
  mission_events: Object.freeze({ kind: 'mission_event_telemetry' }),
  mission_group_membership_events: Object.freeze({ kind: 'mission_column' }),
  mission_object_versions: Object.freeze({ kind: 'mission_column' }),
  mission_participants: Object.freeze({ kind: 'mission_column' }),
  mission_replay_position_day_counts: Object.freeze({ kind: 'mission_column' }),
  mission_teams: Object.freeze({ kind: 'mission_column' }),
  outings: Object.freeze({ kind: 'mission_column' }),
  participant_backfill_checkpoints: Object.freeze({ kind: 'mission_column' }),
  position_revisions: Object.freeze({ kind: 'mission_column' }),
  positions: Object.freeze({ kind: 'mission_column' }),
  search_areas: Object.freeze({ kind: 'mission_column' }),
  search_assignments: Object.freeze({ kind: 'mission_column' }),
  search_pass_evidence_links: Object.freeze({ kind: 'search_pass' }),
  search_passes: Object.freeze({ kind: 'mission_column' }),
  tracking_history_checkpoints: Object.freeze({ kind: 'mission_column' }),
})

const ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES = Object.freeze(
  Object.keys(TRACKED_TABLE_SELECTORS).sort(),
)
const ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES = Object.freeze(
  ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES.flatMap((tableName) => [
    `archive_cleanup_membership_${tableName}_delete`,
    `archive_cleanup_membership_${tableName}_insert`,
    `archive_cleanup_membership_${tableName}_update`,
  ]).sort(),
)

/** Stable cleanup-membership invariant failure. */
class ArchiveCleanupMembershipError extends Error {
  /** Creates a bounded error that never reflects mission data. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveCleanupMembershipError'
    this.code = code
  }
}

/** Validates one bounded mission identifier used to derive a metadata key. */
function normalizeMissionId(missionId) {
  if (typeof missionId !== 'string' || missionId.length < 1
    || Buffer.byteLength(missionId, 'utf8') > 200
    || /[\u0000-\u001f\u007f]/u.test(missionId)) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_INPUT_INVALID',
      'Archive cleanup membership identity is invalid.',
    )
  }
  return missionId
}

/** Encodes a mission identity without allowing delimiter collisions in metadata. */
function encodeMissionId(missionId) {
  return Buffer.from(normalizeMissionId(missionId), 'utf8').toString('hex').toUpperCase()
}

/** Returns the retained metadata key for one mission generation. */
function archiveCleanupMembershipGenerationKey(missionId) {
  return `${ARCHIVE_CLEANUP_MEMBERSHIP_GENERATION_KEY_PREFIX}${encodeMissionId(missionId)}`
}

/** Returns the transaction-only metadata key for one mission cleanup bypass. */
function archiveCleanupMembershipBypassKey(missionId) {
  return `${ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_KEY_PREFIX}${encodeMissionId(missionId)}`
}

/** Parses one canonical, safe integer generation without coercing corrupt state. */
function parseGeneration(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_GENERATION_CORRUPT',
      'Archive cleanup membership generation is corrupt.',
    )
  }
  const generation = Number(value)
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_GENERATION_CORRUPT',
      'Archive cleanup membership generation is corrupt.',
    )
  }
  return generation
}

/** Reads one O(1) retained generation; no row means the pristine generation zero. */
function readArchiveCleanupMembershipGeneration(db, missionId) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function') {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_INPUT_INVALID',
      'Archive cleanup membership database is invalid.',
    )
  }
  const normalizedMissionId = normalizeMissionId(missionId)
  if (db.prepare('SELECT 1 FROM metadata WHERE key = ?')
    .get(archiveCleanupMembershipBypassKey(normalizedMissionId)) !== undefined) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_CORRUPT',
      'Archive cleanup membership bypass exists outside its owning transaction.',
    )
  }
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?')
    .get(archiveCleanupMembershipGenerationKey(normalizedMissionId))
  return row === undefined ? 0 : parseGeneration(row.value)
}

/** Requires a captured generation to remain exact before seal or cleanup mutation. */
function assertArchiveCleanupMembershipGeneration(db, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_INPUT_INVALID',
      'Archive cleanup membership generation input is invalid.',
    )
  }
  const current = readArchiveCleanupMembershipGeneration(db, input.missionId)
  if (current !== input.expectedGeneration) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_CHANGED',
      'Mission cleanup membership changed after the archive evidence boundary was captured.',
    )
  }
  return current
}

/** Resolves a trigger row's mission identity without accepting runtime identifiers. */
function missionExpression(selector, rowAlias) {
  if (['mission_column', 'mission_event_telemetry'].includes(selector.kind)) {
    return `${rowAlias}."mission_id"`
  }
  if (selector.kind === 'gpx_revision') {
    return `(SELECT cleanup_revision.mission_id FROM gpx_import_revisions AS cleanup_revision
      WHERE cleanup_revision.import_id = ${rowAlias}."import_id"
        AND cleanup_revision.revision_sequence = ${rowAlias}."revision_sequence")`
  }
  if (selector.kind === 'search_pass') {
    return `(SELECT cleanup_pass.mission_id FROM search_passes AS cleanup_pass
      WHERE cleanup_pass.id = ${rowAlias}."pass_id")`
  }
  throw new ArchiveCleanupMembershipError(
    'ARCHIVE_CLEANUP_MEMBERSHIP_SCHEMA_UNSAFE',
    'Archive cleanup membership selector is unsupported.',
  )
}

/** Restricts event-table tracking to the rows cleanup is authorized to remove. */
function mutationPredicate(selector, rowAlias) {
  if (selector.kind !== 'mission_event_telemetry') return '1'
  return `${rowAlias}."event_type" IN (${ARCHIVE_CLEANUP_MEMBERSHIP_EVENT_TYPES
    .map((eventType) => `'${eventType}'`)
    .join(', ')})`
}

/** Builds one trigger statement that advances a mission generation unless cleanup owns it. */
function createAdvanceStatement(missionSql, additionalPredicate = '1') {
  const generationKey = `'${ARCHIVE_CLEANUP_MEMBERSHIP_GENERATION_KEY_PREFIX}'
      || hex(CAST((${missionSql}) AS BLOB))`
  const bypassKey = `'${ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_KEY_PREFIX}'
      || hex(CAST((${missionSql}) AS BLOB))`
  return `INSERT INTO metadata (key, value)
    SELECT ${generationKey}, '1'
    WHERE (${missionSql}) IS NOT NULL
      AND (${additionalPredicate})
      AND EXISTS (SELECT 1 FROM missions AS cleanup_mission
        WHERE cleanup_mission.id = (${missionSql})
          AND cleanup_mission.status IN ('finished', 'finalized'))
      AND NOT EXISTS (SELECT 1 FROM metadata AS cleanup_bypass
        WHERE cleanup_bypass.key = ${bypassKey})
    ON CONFLICT(key) DO UPDATE SET value = CASE
      WHEN (metadata.value = '0' OR (
        length(metadata.value) BETWEEN 1 AND 16
        AND metadata.value NOT GLOB '*[^0-9]*'
        AND substr(metadata.value, 1, 1) BETWEEN '1' AND '9'
        AND CAST(metadata.value AS INTEGER) BETWEEN 1 AND ${MAX_GENERATION - 1}
      )) THEN CAST(metadata.value AS INTEGER) + 1
      ELSE RAISE(ABORT, 'Archive cleanup membership generation is corrupt.')
    END;`
}

/** Builds the canonical persistent triggers for one cleanup-selectable table. */
function createTableTriggerSql(tableName, selector) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(tableName)) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_SCHEMA_UNSAFE',
      'Archive cleanup membership table identity is unsafe.',
    )
  }
  const oldMission = missionExpression(selector, 'OLD')
  const newMission = missionExpression(selector, 'NEW')
  const oldMutation = mutationPredicate(selector, 'OLD')
  const newMutation = mutationPredicate(selector, 'NEW')
  return Object.freeze([
    `CREATE TRIGGER archive_cleanup_membership_${tableName}_delete
      BEFORE DELETE ON "${tableName}"
      BEGIN
        ${createAdvanceStatement(oldMission, oldMutation)}
      END`,
    `CREATE TRIGGER archive_cleanup_membership_${tableName}_insert
      BEFORE INSERT ON "${tableName}"
      BEGIN
        ${createAdvanceStatement(newMission, newMutation)}
      END`,
    `CREATE TRIGGER archive_cleanup_membership_${tableName}_update
      BEFORE UPDATE ON "${tableName}"
      BEGIN
        ${createAdvanceStatement(oldMission, oldMutation)}
        ${createAdvanceStatement(newMission, `(${newMutation}) AND (
          NOT (${oldMutation}) OR (${newMission}) IS NOT (${oldMission})
        )`)}
      END`,
  ])
}

const ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_SQL = Object.freeze(Object.fromEntries(
  ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES.flatMap((tableName) =>
    createTableTriggerSql(tableName, TRACKED_TABLE_SELECTORS[tableName]).map((sql) => {
      const name = sql.match(/^CREATE TRIGGER ([a-z0-9_]+)/u)?.[1]
      if (name === undefined) {
        throw new ArchiveCleanupMembershipError(
          'ARCHIVE_CLEANUP_MEMBERSHIP_SCHEMA_UNSAFE',
          'Archive cleanup membership trigger identity is invalid.',
        )
      }
      return [name, sql]
    })),
))

/** Reconciles trigger coverage against the inventory-derived coordinator scope. */
function assertTrackedTableCoverage(db, schemaVersion) {
  const operational = new Set(ARCHIVE_CLEANUP_OPERATIONAL_TABLES)
  const expected = listArchiveInventoryForSchema(schemaVersion)
    .filter((entry) => (
      entry.decision === 'mission_rows' && entry.tableName !== 'missions'
    ) || (
      entry.decision === 'derived_excluded'
        && entry.tableName !== 'mission_replay_generations'
        && db.prepare(`PRAGMA table_info("${entry.tableName}")`).all()
          .some((column) => column.name === 'mission_id')
    ) || operational.has(entry.tableName))
    .map((entry) => entry.tableName)
    .sort()
  if (expected.length !== ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES.length
    || expected.some((tableName, index) =>
      tableName !== ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES[index])) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_SCHEMA_UNSAFE',
      'Archive cleanup membership trigger coverage does not match the cleanup inventory.',
    )
  }
}

/** Installs the canonical v13 triggers at the live-write boundary. */
function installArchiveCleanupMembershipTriggers(db, schemaVersion) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function'
    || schemaVersion !== 13) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_INPUT_INVALID',
      'Archive cleanup membership trigger installation input is invalid.',
    )
  }
  const staleBypass = db.prepare(`SELECT 1 FROM metadata
    WHERE substr(key, 1, ?) = ? LIMIT 1`).get(
    ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_KEY_PREFIX.length,
    ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_KEY_PREFIX,
  )
  if (staleBypass !== undefined) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_CORRUPT',
      'Archive cleanup membership bypass exists outside its owning transaction.',
    )
  }
  assertTrackedTableCoverage(db, schemaVersion)
  for (const triggerName of ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES) {
    db.exec(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }
  for (const sql of Object.values(ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_SQL)) db.exec(sql)
}

/**
 * Runs one synchronous cleanup mutation under a mission/archive-scoped bypass.
 * The caller must already own a SQLite transaction; rollback therefore removes
 * both the bypass and every partial delete after a process exit or thrown error.
 */
function withArchiveCleanupMembershipBypass(db, input, work) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function'
    || db.inTransaction !== true
    || input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.archiveId !== 'string' || !UUID_V4.test(input.archiveId)
    || typeof work !== 'function') {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_INVALID',
      'Archive cleanup membership bypass requires one active transaction and exact identity.',
    )
  }
  const bypassKey = archiveCleanupMembershipBypassKey(input.missionId)
  try {
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)')
      .run(bypassKey, input.archiveId)
  } catch (cause) {
    const error = new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_ACTIVE',
      'Archive cleanup membership bypass is already active or unavailable.',
    )
    error.cause = cause
    throw error
  }
  let result
  let workError = null
  try {
    result = work()
    if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
      throw new ArchiveCleanupMembershipError(
        'ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_ASYNC',
        'Archive cleanup membership bypass work must be synchronous.',
      )
    }
  } catch (error) {
    workError = error
  }
  const removed = db.prepare('DELETE FROM metadata WHERE key = ? AND value = ?')
    .run(bypassKey, input.archiveId)
  if (removed.changes !== 1) {
    throw new ArchiveCleanupMembershipError(
      'ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_CORRUPT',
      'Archive cleanup membership bypass changed inside its transaction.',
    )
  }
  if (workError !== null) throw workError
  return result
}

module.exports = {
  ARCHIVE_CLEANUP_MEMBERSHIP_GENERATION_KEY_PREFIX,
  ARCHIVE_CLEANUP_MEMBERSHIP_EVENT_TYPES,
  ARCHIVE_CLEANUP_OPERATIONAL_TABLES,
  ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES,
  ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES,
  ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_SQL,
  ArchiveCleanupMembershipError,
  archiveCleanupMembershipBypassKey,
  archiveCleanupMembershipGenerationKey,
  assertArchiveCleanupMembershipGeneration,
  installArchiveCleanupMembershipTriggers,
  readArchiveCleanupMembershipGeneration,
  withArchiveCleanupMembershipBypass,
}
