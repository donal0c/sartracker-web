const MAX_LEGACY_EVENT_ROWS_PER_TURN = 250

const LEGACY_EVENT_TABLES = Object.freeze([
  Object.freeze({ table: 'mission_events', stateKey: 'mission_events', includesSequence: false }),
  Object.freeze({
    table: 'mission_group_membership_events',
    stateKey: 'mission_group_membership_events',
    includesSequence: true,
  }),
])

/** Captures stable legacy event targets without rewriting the retained rows at startup. */
function initializeLegacyEventProvenanceBackfill(
  db,
  migrationTime,
  captureTargets,
) {
  const insertState = db.prepare(`INSERT OR IGNORE INTO legacy_event_provenance_backfill_state (
    table_name, scanned_through_id, scan_target_id, updated_at
  ) VALUES (?, NULL, ?, ?)`)
  for (const definition of LEGACY_EVENT_TABLES) {
    const target = captureTargets
      ? db.prepare(`SELECT id FROM ${definition.table} ORDER BY id DESC LIMIT 1`).get()?.id ?? null
      : null
    const stateTime = target === null ? '1970-01-01T00:00:00.000Z' : migrationTime
    insertState.run(definition.stateKey, target, stateTime)
    if (captureTargets && target !== null) {
      db.prepare(`UPDATE legacy_event_provenance_backfill_state
        SET scan_target_id = ?, updated_at = ?
        WHERE table_name = ? AND scanned_through_id IS NULL AND scan_target_id IS NULL`).run(
        target,
        migrationTime,
        definition.stateKey,
      )
    }
  }
  return { remaining: readLegacyEventProvenanceBackfillPending(db) }
}

/** Applies one bounded durable legacy-event provenance page. */
function backfillLegacyEventProvenance(
  db,
  migrationTime,
  maximumRows = MAX_LEGACY_EVENT_ROWS_PER_TURN,
) {
  const rowLimit = Math.max(1, Math.min(MAX_LEGACY_EVENT_ROWS_PER_TURN, maximumRows))
  const pendingState = db.prepare(`SELECT table_name, scanned_through_id, scan_target_id
    FROM legacy_event_provenance_backfill_state
    WHERE scan_target_id IS NOT NULL
      AND (scanned_through_id IS NULL OR scanned_through_id < scan_target_id)
    ORDER BY table_name ASC LIMIT 1`).get()
  if (pendingState === undefined) return { remaining: 0 }
  const definition = LEGACY_EVENT_TABLES.find(
    (candidate) => candidate.stateKey === pendingState.table_name,
  )
  if (definition === undefined) {
    throw new Error(`Legacy event provenance table ${pendingState.table_name} is invalid.`)
  }
  const candidates = db.prepare(`SELECT id FROM ${definition.table}
    WHERE (? IS NULL OR id > ?) AND id <= ?
    ORDER BY id ASC LIMIT ?`).all(
    pendingState.scanned_through_id,
    pendingState.scanned_through_id,
    pendingState.scan_target_id,
    rowLimit,
  )
  const nextCursor = candidates.at(-1)?.id ?? pendingState.scan_target_id
  const transaction = db.transaction(() => {
    if (candidates.length > 0) {
      const sequenceAssignment = definition.includesSequence
        ? 'sequence = COALESCE(sequence, rowid),'
        : ''
      db.prepare(`UPDATE ${definition.table} SET
          ${sequenceAssignment}
          recorded_at = COALESCE(recorded_at, ?),
          recording_completeness = COALESCE(recording_completeness, 'legacy_baseline')
        WHERE (? IS NULL OR id > ?) AND id <= ?`).run(
        migrationTime,
        pendingState.scanned_through_id,
        pendingState.scanned_through_id,
        nextCursor,
      )
    }
    db.prepare(`UPDATE legacy_event_provenance_backfill_state
      SET scanned_through_id = ?, updated_at = ? WHERE table_name = ?`).run(
      nextCursor,
      migrationTime,
      definition.stateKey,
    )
  })
  transaction.immediate()
  return { remaining: readLegacyEventProvenanceBackfillPending(db) }
}

/** Returns one while any captured legacy event target lacks explicit provenance. */
function readLegacyEventProvenanceBackfillPending(db) {
  const state = db.prepare(`SELECT 1 FROM legacy_event_provenance_backfill_state
    WHERE scan_target_id IS NOT NULL
      AND (scanned_through_id IS NULL OR scanned_through_id < scan_target_id)
    LIMIT 1`).get()
  return state === undefined ? 0 : 1
}

/** Fails Replay closed while event provenance preparation is pending or failed. */
function assertLegacyEventProvenanceReady(db) {
  const hasState = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'legacy_event_provenance_backfill_state'`).get()
    !== undefined
  const hasMetadata = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'metadata'`).get() !== undefined
  if (!hasState) {
    if (hasMetadata) {
      throw new Error('Mission replay preparation state is missing; Replay is unavailable.')
    }
    return
  }
  const failure = hasMetadata
    ? db.prepare(`SELECT value FROM metadata
        WHERE key = 'legacy_evidence_backfill_failure'`).get()?.value
    : undefined
  if (typeof failure === 'string' && failure !== '') {
    throw new Error(`Legacy evidence provenance reconstruction stopped safely: ${failure}`)
  }
  if (readLegacyEventProvenanceBackfillPending(db) > 0) {
    throw new Error(
      'Legacy event provenance is still being reconstructed in bounded background slices. Current positions remain available; retry Replay after preparation completes.',
    )
  }
}

module.exports = {
  assertLegacyEventProvenanceReady,
  backfillLegacyEventProvenance,
  initializeLegacyEventProvenanceBackfill,
  readLegacyEventProvenanceBackfillPending,
}
