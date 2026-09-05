'use strict'

const { createHash } = require('node:crypto')

const DIGEST_PROGRESS_INTERVAL_ROWS = 4_096

const ARCHIVE_INVENTORY_VERSION = 1

const DECISIONS = new Set([
  'mission_rows',
  'global_rows',
  'derived_excluded',
  'operational_excluded',
])

/** Error raised when schema or inventory state cannot support a complete archive. */
class ArchiveInventoryError extends Error {
  /**
   * @param {string} code Stable machine-readable failure code.
   * @param {string} message Operator-actionable failure description.
   * @param {Readonly<Record<string, unknown>>} [details] Bounded diagnostic context.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ArchiveInventoryError'
    this.code = code
    this.details = deepFreeze({ ...details })
  }
}

/** Builds a direct mission-id selection declaration. */
function missionRows(tableName, sinceSchemaVersion = 12) {
  return {
    tableName,
    decision: 'mission_rows',
    sinceSchemaVersion,
    predicate: {
      kind: 'mission_column',
      column: 'mission_id',
      parameterNames: ['missionId'],
    },
  }
}

/** Builds the single mission-root row selection keyed by missions.id. */
function missionIdentityRows(tableName, sinceSchemaVersion = 12) {
  return {
    tableName,
    decision: 'mission_rows',
    sinceSchemaVersion,
    predicate: {
      kind: 'mission_identity',
      column: 'id',
      parameterNames: ['missionId'],
    },
  }
}

/** Builds a mission selection reached through a bounded, named relationship. */
function referencedMissionRows(tableName, name, sql, sinceSchemaVersion = 12) {
  return {
    tableName,
    decision: 'mission_rows',
    sinceSchemaVersion,
    predicate: {
      kind: 'referenced_selection',
      name,
      sql,
      parameterNames: ['missionId'],
    },
  }
}

/** Builds a bounded global-row selection declaration. */
function globalRows(tableName, name, sql, parameterNames = [], sinceSchemaVersion = 12) {
  return {
    tableName,
    decision: 'global_rows',
    sinceSchemaVersion,
    predicate: {
      kind: 'bounded_global_selection',
      name,
      sql,
      parameterNames,
    },
  }
}

/** Builds a rebuildable-table exclusion declaration. */
function derivedExcluded(tableName, reason, rebuildPath, sinceSchemaVersion = 12) {
  return {
    tableName,
    decision: 'derived_excluded',
    sinceSchemaVersion,
    reason,
    rebuildPath,
  }
}

/** Builds a retained machine/orchestration-state exclusion declaration. */
function operationalExcluded(tableName, reason, retentionPath, sinceSchemaVersion = 12) {
  return {
    tableName,
    decision: 'operational_excluded',
    sinceSchemaVersion,
    reason,
    retentionPath,
  }
}

const ARCHIVE_TABLE_INVENTORY = deepFreeze([
  derivedExcluded(
    'coverage_chunks',
    'Coverage chunk ledgers are derived read models, not primary mission evidence.',
    'Rebuild from accepted positions and outing boundaries through the coverage ledger enumerator.',
  ),
  derivedExcluded(
    'coverage_invalidations',
    'Coverage invalidations are a drainable rebuild queue, not primary mission evidence.',
    'Re-enumerate coverage chunks from archived accepted positions and outing boundaries.',
  ),
  derivedExcluded(
    'coverage_missions',
    'Mission coverage counters are derived read-model state.',
    'Initialize and rebuild from accepted positions, outings and coverage chunks.',
  ),
  missionRows('devices'),
  missionRows('drawings'),
  referencedMissionRows(
    'gpx_evidence_points',
    'gpx_revision_for_mission',
    'EXISTS (SELECT 1 FROM gpx_import_revisions AS inventory_revision WHERE inventory_revision.import_id = archive_row.import_id AND inventory_revision.revision_sequence = archive_row.revision_sequence AND inventory_revision.mission_id = ?)',
  ),
  referencedMissionRows(
    'gpx_evidence_rejections',
    'gpx_rejection_revision_for_mission',
    'EXISTS (SELECT 1 FROM gpx_import_revisions AS inventory_revision WHERE inventory_revision.import_id = archive_row.import_id AND inventory_revision.revision_sequence = archive_row.revision_sequence AND inventory_revision.mission_id = ?)',
  ),
  missionRows('gpx_import_aliases'),
  missionRows('gpx_import_batches'),
  missionRows('gpx_import_failures'),
  missionRows('gpx_import_revisions'),
  operationalExcluded(
    'gpx_import_source_receipts',
    'Source receipts are bounded ingest-recovery bookkeeping and must be settled before finalization.',
    'Retain in the live store until settled; complete imports and failures remain in their evidence tables.',
  ),
  missionRows('gpx_track_imports'),
  missionRows('helicopters'),
  missionRows('ingest_anomalies'),
  operationalExcluded(
    'ingest_anomaly_deliveries',
    'Delivery identifiers are transport deduplication bookkeeping, not anomaly evidence.',
    'Retain in the live store; archive ingest_anomalies and rebuild delivery state only for live transport.',
  ),
  derivedExcluded(
    'ingest_anomaly_devices',
    'Per-device anomaly totals are derived summaries.',
    'Rebuild by grouping archived ingest_anomalies by mission and device.',
  ),
  derivedExcluded(
    'ingest_anomaly_mission_health',
    'Mission anomaly-health totals are derived summaries.',
    'Rebuild by grouping archived ingest_anomalies by mission and kind.',
  ),
  missionRows('layer_catalog_entries'),
  operationalExcluded(
    'legacy_event_provenance_backfill_state',
    'Legacy provenance scan cursors are migration progress, not mission evidence.',
    'Retain in the live store until the bounded provenance backfill completes.',
  ),
  globalRows(
    'legacy_event_provenance_quarantine',
    'event_quarantine_rows_referenced_by_mission',
    'EXISTS (SELECT 1 FROM legacy_event_provenance_quarantine_missions AS inventory_quarantine_mission WHERE inventory_quarantine_mission.table_name = archive_row.table_name AND inventory_quarantine_mission.source_rowid = archive_row.source_rowid AND inventory_quarantine_mission.mission_id = ?)',
    ['missionId'],
  ),
  missionRows('legacy_event_provenance_quarantine_missions'),
  globalRows(
    'legacy_gpx_backfill_quarantine',
    'gpx_quarantine_rows_referenced_by_mission',
    'EXISTS (SELECT 1 FROM gpx_track_imports AS inventory_import WHERE inventory_import.rowid = archive_row.source_rowid AND inventory_import.mission_id = ?)',
    ['missionId'],
  ),
  operationalExcluded(
    'legacy_gpx_backfill_state',
    'Legacy GPX scan cursors are migration progress, not mission evidence.',
    'Retain in the live store until the bounded GPX backfill completes.',
  ),
  operationalExcluded(
    'legacy_gpx_rowid_scan_state',
    'Extreme-rowid GPX scan bounds are migration progress, not mission evidence.',
    'Retain in the live store until the bounded GPX rowid scan completes.',
  ),
  operationalExcluded(
    'legacy_mission_object_backfill_state',
    'Legacy object-version scan cursors are migration progress, not mission evidence.',
    'Retain in the live store until mission object version backfill completes.',
  ),
  missionRows('markers'),
  globalRows(
    'metadata',
    'archive_schema_version_metadata',
    'archive_row.key = \'schema_version\'',
  ),
  operationalExcluded(
    'mission_archive_supplements',
    'Supplement-chain custody rows are committed after predecessor archive bytes and must not make a container recursively depend on later live registry state.',
    'Retain with the compact live mission stub; each archive header independently authenticates its predecessor ciphertext hash.',
    13,
  ),
  operationalExcluded(
    'mission_archives',
    'The custody registry is committed only after archive bytes are fixed and cannot recursively describe its own container.',
    'Retain with the compact live mission stub and reconcile against custody events and the exact file on disk.',
    13,
  ),
  operationalExcluded(
    'mission_cleanup_journal',
    'Cleanup cursors are live-store crash-recovery state and are not mission evidence inside the archive being cleaned.',
    'Retain with the compact live mission stub until cleanup completes and keep the terminal journal record.',
    13,
  ),
  missionRows('mission_events'),
  operationalExcluded(
    'mission_finalization_fences',
    'Finalization fences are transient live-store coordination state.',
    'Retain in the live store and clear only through the existing PR5 finalization recovery contract.',
  ),
  missionRows('mission_group_membership_events'),
  missionRows('mission_object_versions'),
  missionRows('mission_participants'),
  derivedExcluded(
    'mission_replay_generations',
    'Replay generations are cache-invalidation counters, not evidence.',
    'Initialize a fresh generation in the restored scratch store after extraction.',
  ),
  derivedExcluded(
    'mission_replay_position_day_counts',
    'Replay day counts are an indexed rollup of accepted positions.',
    'Rebuild from archived positions using the schema replay-day-count projection.',
  ),
  missionRows('mission_teams'),
  missionIdentityRows('missions'),
  missionRows('outings'),
  operationalExcluded(
    'participant_backfill_checkpoints',
    'Participant history checkpoints are live reconciliation progress.',
    'Retain in the live store until participant history reconciliation completes.',
  ),
  missionRows('position_revisions'),
  missionRows('positions'),
  missionRows('search_areas'),
  missionRows('search_assignments'),
  referencedMissionRows(
    'search_pass_evidence_links',
    'search_pass_for_mission',
    'EXISTS (SELECT 1 FROM search_passes AS inventory_pass WHERE inventory_pass.id = archive_row.pass_id AND inventory_pass.mission_id = ?)',
  ),
  missionRows('search_passes'),
  operationalExcluded(
    'tracking_history_checkpoints',
    'Tracking history checkpoints are live polling/reconciliation progress, not accepted fixes.',
    'Retain in the live store; archived positions and revisions are the mission evidence.',
  ),
].sort(compareInventoryEntries))

/** Sorts ASCII-safe table names with locale-independent code-unit ordering. */
function compareInventoryEntries(left, right) {
  if (left.tableName < right.tableName) {
    return -1
  }
  if (left.tableName > right.tableName) {
    return 1
  }
  return 0
}

/** Recursively freezes arrays and plain objects. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

/** Validates and normalizes a positive schema version. */
function normalizeSchemaVersion(schemaVersion) {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_SCHEMA_VERSION',
      'Archive inventory requires a positive integer schema version.',
      { schemaVersion },
    )
  }
  return schemaVersion
}

/** Returns the caller declarations while rejecting malformed or duplicate entries. */
function validateDeclarations(declarations) {
  if (!Array.isArray(declarations)) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_DECLARATIONS',
      'Archive inventory declarations must be an array.',
    )
  }
  const seen = new Set()
  for (const entry of declarations) {
    if (!entry || typeof entry !== 'object' || typeof entry.tableName !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.tableName)) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_DECLARATION',
        'Every archive inventory declaration must have a safe SQLite table name.',
      )
    }
    if (seen.has(entry.tableName)) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_DUPLICATE_DECLARATION',
        `Archive inventory declares table ${entry.tableName} more than once.`,
        { tableName: entry.tableName },
      )
    }
    seen.add(entry.tableName)
    if (!DECISIONS.has(entry.decision)) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_DECLARATION',
        `Archive inventory decision for ${entry.tableName} is not recognized.`,
        { tableName: entry.tableName, decision: entry.decision },
      )
    }
    normalizeSchemaVersion(entry.sinceSchemaVersion)
    if ((entry.decision === 'mission_rows' || entry.decision === 'global_rows')
      && (!entry.predicate || typeof entry.predicate !== 'object')) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_DECLARATION',
        `Included archive table ${entry.tableName} requires explicit selection metadata.`,
        { tableName: entry.tableName },
      )
    }
    if (entry.decision === 'derived_excluded'
      && (typeof entry.reason !== 'string' || typeof entry.rebuildPath !== 'string')) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_DECLARATION',
        `Derived archive exclusion ${entry.tableName} requires a reason and rebuild path.`,
        { tableName: entry.tableName },
      )
    }
    if (entry.decision === 'operational_excluded'
      && (typeof entry.reason !== 'string' || typeof entry.retentionPath !== 'string')) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_DECLARATION',
        `Operational archive exclusion ${entry.tableName} requires a reason and retention path.`,
        { tableName: entry.tableName },
      )
    }
  }
  return declarations
}

/**
 * Lists declarations applicable to one migrated schema, sorted by table name.
 *
 * @param {number} schemaVersion Schema version represented by the database.
 * @param {{ declarations?: readonly Record<string, unknown>[] }} [options] Test-only declaration override.
 */
function listArchiveInventoryForSchema(schemaVersion, options = {}) {
  const normalizedVersion = normalizeSchemaVersion(schemaVersion)
  const declarations = validateDeclarations(options.declarations || ARCHIVE_TABLE_INVENTORY)
  return deepFreeze(declarations
    .filter((entry) => entry.sinceSchemaVersion <= normalizedVersion
      && (entry.untilSchemaVersion === undefined || entry.untilSchemaVersion >= normalizedVersion))
    .slice()
    .sort(compareInventoryEntries))
}

/** Reads the schema version stored in a migrated mission database. */
function readSchemaVersion(db) {
  let row
  try {
    row = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()
  } catch {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_SCHEMA_VERSION_UNAVAILABLE',
      'Mission archive inventory could not read the migrated store schema version.',
    )
  }
  return normalizeSchemaVersion(Number(row && row.value))
}

/** Lists only application-owned SQLite tables, excluding SQLite internals. */
function listUserTables(db) {
  return db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name`).all().map((row) => row.name)
}

/** Compiles every included selection so bad columns or relationships fail at reconciliation. */
function assertIncludedPredicatesCompile(db, declarations) {
  for (const declaration of declarations) {
    if (declaration.decision !== 'mission_rows' && declaration.decision !== 'global_rows') {
      continue
    }
    try {
      const selection = buildSelection(declaration.predicate, '__inventory_schema_probe__')
      db.prepare(`SELECT 1 FROM ${quoteIdentifier(declaration.tableName)} AS archive_row
        WHERE ${selection.sql} LIMIT 0`)
    } catch (error) {
      if (error instanceof ArchiveInventoryError) {
        throw error
      }
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_PREDICATE',
        `Archive selection for ${declaration.tableName} does not match the runtime schema.`,
        { tableName: declaration.tableName },
      )
    }
  }
}

/**
 * Reconciles the declarative inventory against sqlite_master in both directions.
 *
 * @param {object} db Open better-sqlite3 database.
 * @param {{ schemaVersion?: number, declarations?: readonly Record<string, unknown>[] }} [options]
 */
function reconcileArchiveInventory(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_DATABASE',
      'Archive inventory reconciliation requires an open SQLite database.',
    )
  }
  const schemaVersion = options.schemaVersion === undefined
    ? readSchemaVersion(db)
    : normalizeSchemaVersion(options.schemaVersion)
  const declarations = listArchiveInventoryForSchema(schemaVersion, {
    declarations: options.declarations || ARCHIVE_TABLE_INVENTORY,
  })
  const declaredNames = declarations.map((entry) => entry.tableName)
  const declaredSet = new Set(declaredNames)
  const runtimeNames = listUserTables(db)
  const runtimeSet = new Set(runtimeNames)
  const undeclared = runtimeNames.filter((tableName) => !declaredSet.has(tableName))
  if (undeclared.length > 0) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_UNDECLARED_TABLE',
      `Mission archive cannot continue because schema table ${undeclared[0]} has no archive decision.`,
      { tableNames: undeclared },
    )
  }
  const missing = declaredNames.filter((tableName) => !runtimeSet.has(tableName))
  if (missing.length > 0) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_MISSING_TABLE',
      `Mission archive cannot continue because declared table ${missing[0]} is missing from the schema.`,
      { tableNames: missing },
    )
  }
  assertIncludedPredicatesCompile(db, declarations)
  return deepFreeze({
    inventoryVersion: ARCHIVE_INVENTORY_VERSION,
    schemaVersion,
    tableNames: runtimeNames.slice(),
  })
}

/** Converts inventory data to JSON-safe values while sorting every object key. */
function canonicalize(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_NON_CANONICAL_DOCUMENT',
        `Archive inventory document contains a non-finite number at ${path}.`,
      )
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => canonicalize(child, `${path}[${index}]`))
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_NON_CANONICAL_DOCUMENT',
      `Archive inventory document contains an unsupported value at ${path}.`,
    )
  }
  const result = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_NON_CANONICAL_DOCUMENT',
        `Archive inventory document contains undefined at ${path}.${key}.`,
      )
    }
    result[key] = canonicalize(value[key], `${path}.${key}`)
  }
  return result
}

/** Serializes inventory data with deterministic object-key ordering. */
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

/**
 * Creates the complete, auditable inventory decision document embedded in an archive.
 *
 * @param {{ schemaVersion: number, declarations?: readonly Record<string, unknown>[] } | number} input
 */
function createArchiveInventoryDocument(input) {
  const normalizedInput = typeof input === 'number' ? { schemaVersion: input } : input
  if (!normalizedInput || typeof normalizedInput !== 'object') {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_DOCUMENT_INPUT',
      'Archive inventory document requires a schema version.',
    )
  }
  const schemaVersion = normalizeSchemaVersion(normalizedInput.schemaVersion)
  const tables = listArchiveInventoryForSchema(schemaVersion, {
    declarations: normalizedInput.declarations || ARCHIVE_TABLE_INVENTORY,
  })
  return deepFreeze(canonicalize({
    inventoryVersion: ARCHIVE_INVENTORY_VERSION,
    schemaVersion,
    tables,
  }))
}

/** Computes the lowercase SHA-256 identity of a canonical inventory document. */
function digestArchiveInventoryDocument(document) {
  return createHash('sha256').update(canonicalJson(document), 'utf8').digest('hex')
}

/** Quotes a validated SQLite identifier. */
function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_IDENTIFIER',
      'Archive inventory encountered an unsafe SQLite identifier.',
      { identifier },
    )
  }
  return `"${identifier}"`
}

/** Returns deterministic selection SQL and parameters from frozen predicate metadata. */
function buildSelection(predicate, missionId) {
  if (!predicate || typeof predicate !== 'object') {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_PREDICATE',
      'Included archive table has no valid row-selection predicate.',
    )
  }
  if (predicate.kind === 'mission_column' || predicate.kind === 'mission_identity') {
    if (typeof missionId !== 'string' || missionId.length === 0) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_MISSION_ID',
        'Mission-scoped archive digest requires a mission ID.',
      )
    }
    return {
      sql: `archive_row.${quoteIdentifier(predicate.column)} = ?`,
      parameters: [missionId],
    }
  }
  if (predicate.kind === 'referenced_selection') {
    if (typeof predicate.name !== 'string' || predicate.name.length === 0
      || typeof predicate.sql !== 'string' || predicate.sql.length === 0
      || typeof missionId !== 'string' || missionId.length === 0) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_PREDICATE',
        'Referenced archive selection requires a name, bounded SQL and mission ID.',
      )
    }
    return { sql: predicate.sql, parameters: [missionId] }
  }
  if (predicate.kind === 'bounded_global_selection') {
    if (typeof predicate.name !== 'string' || predicate.name.length === 0
      || typeof predicate.sql !== 'string' || predicate.sql.length === 0) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_INVALID_PREDICATE',
        'Global archive selection requires a name and bounded SQL.',
      )
    }
    const parameterNames = predicate.parameterNames || []
    return {
      sql: predicate.sql,
      parameters: parameterNames.map((parameterName) => {
        if (parameterName === 'missionId' && typeof missionId === 'string' && missionId.length > 0) {
          return missionId
        }
        throw new ArchiveInventoryError(
          'ARCHIVE_INVENTORY_INVALID_PREDICATE',
          `Global archive selection requests unsupported parameter ${parameterName}.`,
        )
      }),
    }
  }
  throw new ArchiveInventoryError(
    'ARCHIVE_INVENTORY_INVALID_PREDICATE',
    `Archive row-selection predicate kind ${String(predicate.kind)} is not recognized.`,
  )
}

/** Returns the one declared row selection shared by extraction and digest proof. */
function createArchiveTableSelection(input) {
  if (!input || typeof input !== 'object') {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_SELECTION_INPUT',
      'Archive table selection requires a table, mission and schema version.',
    )
  }
  const schemaVersion = normalizeSchemaVersion(input.schemaVersion)
  const declaration = listArchiveInventoryForSchema(schemaVersion, {
    declarations: input.declarations || ARCHIVE_TABLE_INVENTORY,
  }).find((candidate) => candidate.tableName === input.tableName)
  if (!declaration) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_UNDECLARED_TABLE',
      `Archive table ${String(input.tableName)} has no applicable archive decision.`,
      { tableName: input.tableName },
    )
  }
  if (declaration.decision !== 'mission_rows' && declaration.decision !== 'global_rows') {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_TABLE_EXCLUDED',
      `Archive table ${declaration.tableName} is explicitly excluded as ${declaration.decision}.`,
      { tableName: declaration.tableName, decision: declaration.decision },
    )
  }
  const selection = buildSelection(declaration.predicate, input.missionId)
  return deepFreeze({
    whereSql: selection.sql,
    parameters: [...selection.parameters],
  })
}

/** Writes an unsigned 64-bit length into a hash without string ambiguity. */
function updateLength(hash, length) {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_VALUE_LENGTH',
      'Archive table digest encountered an invalid value length.',
      { length },
    )
  }
  const encoded = Buffer.allocUnsafe(8)
  encoded.writeBigUInt64BE(BigInt(length))
  hash.update(encoded)
}

/** Adds one explicitly typed SQLite value to the streaming table hash. */
function updateSqliteValue(hash, storageClass, value) {
  const tags = {
    null: 0,
    integer: 1,
    real: 2,
    text: 3,
    blob: 4,
  }
  const tag = tags[storageClass]
  if (tag === undefined) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_UNKNOWN_STORAGE_CLASS',
      `Archive table digest encountered SQLite storage class ${String(storageClass)}.`,
    )
  }
  hash.update(Buffer.from([tag]))
  let encoded
  if (storageClass === 'null') {
    encoded = Buffer.alloc(0)
  } else if (storageClass === 'integer') {
    encoded = Buffer.from((typeof value === 'bigint' ? value : BigInt(value)).toString(10), 'ascii')
  } else if (storageClass === 'real') {
    encoded = Buffer.allocUnsafe(8)
    encoded.writeDoubleBE(value)
  } else if (storageClass === 'text') {
    encoded = Buffer.from(value, 'utf8')
  } else {
    encoded = Buffer.from(value)
  }
  updateLength(hash, encoded.length)
  hash.update(encoded)
}

/** Reads and validates a table's stable schema and row-order definition. */
function readDigestSchema(db, tableName) {
  const quotedTable = quoteIdentifier(tableName)
  const columns = db.prepare(`PRAGMA table_xinfo(${quotedTable})`).all()
    .filter((column) => Number(column.hidden) === 0)
    .sort((left, right) => Number(left.cid) - Number(right.cid))
  if (columns.length === 0) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_MISSING_TABLE',
      `Cannot digest missing archive table ${tableName}.`,
      { tableName },
    )
  }
  const primaryKeyColumns = columns
    .filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => column.name)
  const definition = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName)
  const withoutRowid = Boolean(definition && /\bWITHOUT\s+ROWID\b/i.test(definition.sql || ''))
  if (primaryKeyColumns.length === 0 && withoutRowid) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_UNORDERABLE_TABLE',
      `Archive table ${tableName} has neither an ordered primary key nor a rowid.`,
      { tableName },
    )
  }
  return {
    columns,
    includesRowid: !withoutRowid,
    orderKind: primaryKeyColumns.length > 0 ? 'primary_key' : 'rowid',
    orderColumns: primaryKeyColumns.length > 0 ? primaryKeyColumns : ['_rowid_'],
  }
}

/** Streams one explicit table selection into a typed SHA-256 digest. */
function computeDigestForSelection(db, input) {
  const { declaration, schemaVersion, selection } = input
  if ((input.onProgress !== undefined && typeof input.onProgress !== 'function')
    || (input.isCancelled !== undefined && typeof input.isCancelled !== 'function')) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_DIGEST_INPUT',
      'Archive table digest progress controls are invalid.',
    )
  }
  const schema = readDigestSchema(db, declaration.tableName)
  const selectTerms = [
    ...(schema.includesRowid
      ? ['typeof(archive_row._rowid_)', 'archive_row._rowid_']
      : []),
    ...schema.columns.flatMap((column) => {
      const columnName = `archive_row.${quoteIdentifier(column.name)}`
      return [`typeof(${columnName})`, columnName]
    }),
  ]
  const orderTerms = schema.orderColumns.map((columnName) => {
    if (columnName === '_rowid_') {
      return 'archive_row._rowid_'
    }
    return `archive_row.${quoteIdentifier(columnName)}`
  })
  const statement = db.prepare(`SELECT ${selectTerms.join(', ')}
    FROM ${quoteIdentifier(declaration.tableName)} AS archive_row
    WHERE ${selection.sql}
    ORDER BY ${orderTerms.join(', ')}`)
  if (typeof statement.raw !== 'function' || typeof statement.iterate !== 'function') {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_DATABASE_UNSUPPORTED',
      'Archive table digest requires a streaming better-sqlite3 statement.',
    )
  }
  const hash = createHash('sha256')
  const digestHeader = canonicalJson({
    digestFormat: 2,
    tableName: declaration.tableName,
    schemaVersion: normalizeSchemaVersion(schemaVersion),
    orderKind: schema.orderKind,
    orderColumns: schema.orderColumns,
    includesRowid: schema.includesRowid,
    columns: schema.columns.map((column) => ({
      cid: Number(column.cid),
      name: column.name,
      declaredType: column.type || '',
      notNull: Number(column.notnull),
      defaultSql: column.dflt_value === null ? null : column.dflt_value,
      primaryKeyOrdinal: Number(column.pk),
    })),
  })
  updateLength(hash, Buffer.byteLength(digestHeader, 'utf8'))
  hash.update(digestHeader, 'utf8')
  let rowCount = 0
  let lastProgressRows = 0
  const rowStatement = statement.safeIntegers(true).raw(true)
  for (const row of rowStatement.iterate(...selection.parameters)) {
    if (input.isCancelled?.()) {
      throw new ArchiveInventoryError(
        'ARCHIVE_CANCELLED',
        'Mission archive table digest was cancelled.',
      )
    }
    hash.update(Buffer.from([0x52]))
    for (let index = 0; index < row.length; index += 2) {
      updateSqliteValue(hash, row[index], row[index + 1])
    }
    rowCount += 1
    if (!Number.isSafeInteger(rowCount)) {
      throw new ArchiveInventoryError(
        'ARCHIVE_INVENTORY_ROW_COUNT_OVERFLOW',
        `Archive table ${declaration.tableName} has too many rows to count safely.`,
      )
    }
    if (rowCount === 1 || rowCount - lastProgressRows >= DIGEST_PROGRESS_INTERVAL_ROWS) {
      input.onProgress?.(Object.freeze({ rowsProcessed: rowCount }))
      lastProgressRows = rowCount
    }
  }
  if (rowCount > lastProgressRows) {
    input.onProgress?.(Object.freeze({ rowsProcessed: rowCount }))
  }
  return deepFreeze({ rowCount, contentSha256: hash.digest('hex') })
}

/** Finds one applicable inventory declaration for a digest operation. */
function findDigestDeclaration(db, input) {
  if (!db || typeof db.prepare !== 'function' || !input || typeof input !== 'object') {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_INVALID_DIGEST_INPUT',
      'Archive table content digest requires an open database and input.',
    )
  }
  const schemaVersion = input.schemaVersion === undefined ? readSchemaVersion(db) : input.schemaVersion
  const declaration = listArchiveInventoryForSchema(schemaVersion, {
    declarations: input.declarations || ARCHIVE_TABLE_INVENTORY,
  }).find((candidate) => candidate.tableName === input.tableName)
  if (!declaration) {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_UNDECLARED_TABLE',
      `Archive table ${String(input.tableName)} has no applicable archive decision.`,
      { tableName: input.tableName },
    )
  }
  return { declaration, schemaVersion }
}

/**
 * Streams all source rows selected by the declaration in explicit PK/rowid order.
 * Schema introspection is bounded; mission table rows are consumed with iterate(), never all().
 *
 * @param {object} db Open better-sqlite3 database.
 * @param {{ tableName: string, missionId: string, schemaVersion?: number, declarations?: readonly Record<string, unknown>[] }} input
 */
function computeTableContentDigest(db, input) {
  const { declaration, schemaVersion } = findDigestDeclaration(db, input)
  if (declaration.decision !== 'mission_rows' && declaration.decision !== 'global_rows') {
    throw new ArchiveInventoryError(
      'ARCHIVE_INVENTORY_TABLE_EXCLUDED',
      `Archive table ${declaration.tableName} is explicitly excluded as ${declaration.decision}.`,
      { tableName: declaration.tableName, decision: declaration.decision },
    )
  }
  return computeDigestForSelection(db, {
    declaration,
    schemaVersion,
    selection: buildSelection(declaration.predicate, input.missionId),
    isCancelled: input.isCancelled,
    onProgress: input.onProgress,
  })
}

/**
 * Digests every row in one table of a completed single-mission archive scratch database.
 * The caller must first enforce mission scope and empty operational-table invariants.
 */
function computeArchivedTableContentDigest(db, input) {
  const { declaration, schemaVersion } = findDigestDeclaration(db, input)
  return computeDigestForSelection(db, {
    declaration,
    schemaVersion,
    selection: { sql: '1 = 1', parameters: [] },
    isCancelled: input.isCancelled,
    onProgress: input.onProgress,
  })
}

module.exports = {
  ARCHIVE_INVENTORY_VERSION,
  ARCHIVE_TABLE_INVENTORY,
  ArchiveInventoryError,
  listArchiveInventoryForSchema,
  reconcileArchiveInventory,
  createArchiveInventoryDocument,
  createArchiveTableSelection,
  digestArchiveInventoryDocument,
  computeTableContentDigest,
  computeArchivedTableContentDigest,
}
