const MAX_LEGACY_EVENT_ROWS_PER_TURN = 1_000
const MAX_LEGACY_EVENT_BYTES_PER_TURN = 512 * 1_024
const MAX_LEGACY_EVENT_ROW_BYTES = 256 * 1_024
const MAX_LEGACY_EVENT_ID_BYTES = 200

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
  const payloadBytesSql = definition.table === 'mission_events'
    ? `length(CAST(id AS BLOB)) + length(CAST(mission_id AS BLOB))
      + length(CAST(event_type AS BLOB)) + length(CAST(timestamp AS BLOB))
      + length(CAST(COALESCE(details_json, '') AS BLOB))`
    : `length(CAST(id AS BLOB)) + length(CAST(mission_id AS BLOB))
      + length(CAST(mission_team_id AS BLOB))
      + length(CAST(traccar_device_id AS BLOB)) + length(CAST(change AS BLOB))
      + length(CAST(observed_at AS BLOB))`
  const candidatePage = db.prepare(`SELECT rowid, id,
      length(CAST(id AS BLOB)) AS id_bytes,
      ${payloadBytesSql} AS payload_bytes
    FROM ${definition.table}
    WHERE (? IS NULL OR id > ?) AND id <= ?
    ORDER BY id ASC LIMIT ?`).all(
    pendingState.scanned_through_id,
    pendingState.scanned_through_id,
    pendingState.scan_target_id,
    rowLimit,
  )
  const batch = selectLegacyEventTurn(candidatePage)
  if (batch.oversized?.id_bytes > MAX_LEGACY_EVENT_ID_BYTES) {
    throw new Error(
      `Legacy event provenance identity exceeds the ${MAX_LEGACY_EVENT_ID_BYTES}-byte safe reconstruction limit.`,
    )
  }
  const nextCursor = batch.oversized?.id
    ?? batch.candidates.at(-1)?.id
    ?? pendingState.scan_target_id
  const transaction = db.transaction(() => {
    if (batch.candidates.length > 0) {
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
    if (batch.oversized !== null) {
      db.prepare(`INSERT OR REPLACE INTO legacy_event_provenance_quarantine (
        table_name, source_rowid, event_id_preview, reason, payload_bytes, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?)`).run(
        definition.stateKey,
        batch.oversized.rowid,
        String(batch.oversized.id).slice(0, MAX_LEGACY_EVENT_ID_BYTES),
        `Legacy event payload exceeds the ${MAX_LEGACY_EVENT_ROW_BYTES}-byte safe reconstruction limit.`,
        batch.oversized.payload_bytes,
        migrationTime,
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

/** Selects one writer turn by retained bytes and isolates an oversized source row. */
function selectLegacyEventTurn(candidatePage) {
  const candidates = []
  let selectedBytes = 0
  for (const candidate of candidatePage) {
    const payloadBytes = Number(candidate.payload_bytes)
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
      throw new Error('Legacy event provenance payload size is invalid.')
    }
    if (payloadBytes > MAX_LEGACY_EVENT_ROW_BYTES) {
      return candidates.length === 0
        ? { candidates, oversized: candidate }
        : { candidates, oversized: null }
    }
    if (candidates.length > 0
      && selectedBytes + payloadBytes > MAX_LEGACY_EVENT_BYTES_PER_TURN) {
      break
    }
    candidates.push(candidate)
    selectedBytes += payloadBytes
  }
  return { candidates, oversized: null }
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
  const hasQuarantine = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'legacy_event_provenance_quarantine'`).get() !== undefined
  const quarantined = hasQuarantine
    ? db.prepare(`SELECT COUNT(*) AS count
        FROM legacy_event_provenance_quarantine`).get()?.count ?? 0
    : 0
  if (Number(quarantined) > 0) {
    throw new Error(
      `${quarantined} legacy event provenance row(s) exceed the bounded reconstruction envelope. Current positions remain available; Replay, archive and finalization remain unavailable until bounded repair.`,
    )
  }
}

module.exports = {
  assertLegacyEventProvenanceReady,
  backfillLegacyEventProvenance,
  initializeLegacyEventProvenanceBackfill,
  readLegacyEventProvenanceBackfillPending,
}
