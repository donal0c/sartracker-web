'use strict'

const { createHash } = require('node:crypto')

const { canonicalJson } = require('./archive-container.cjs')
const { MAX_GPX_SOURCE_BYTES } = require('./gpx-source-reader.cjs')

const MAX_STORED_BASE64_BYTES = Math.ceil(MAX_GPX_SOURCE_BYTES / 3) * 4 + 64 * 1024
const MAX_GPX_PROOF_BYTES = 2 * 1024 * 1024
const MAX_GPX_PROOF_RECORDS = 20_000

/** Rejects a GPX proof record set before any oversized projection is retained. */
function assertGpxProofRecordBound(recordCount) {
  if (!Number.isSafeInteger(recordCount) || recordCount < 0
    || recordCount > MAX_GPX_PROOF_RECORDS) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_PROOF_LIMIT',
      'Mission archive GPX identity proof exceeds its supported record bound.',
    )
  }
}
const SHA256_INSENSITIVE = /^[0-9a-f]{64}$/iu

/** Signals that retained GPX source-byte custody cannot support truthful archive proof. */
class ArchiveGpxProofError extends Error {
  /** Creates a stable GPX proof failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveGpxProofError'
    this.code = code
  }
}

/** Throws cancellation while iterating potentially large GPX identity sets. */
function assertNotCancelled(input) {
  if (input.isCancelled?.()) {
    throw new ArchiveGpxProofError('ARCHIVE_CANCELLED', 'Mission archive GPX proof was cancelled.')
  }
}

/** Requires a stable bounded evidence identity without silently truncating it. */
function normalizeRecordId(value, label) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 1_000
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_INVALID',
      `Mission archive ${label} has an invalid record identity.`,
    )
  }
  return value
}

/** Normalizes one optional historical hash without inventing missing provenance. */
function normalizeRecordedHash(value, label) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !SHA256_INSENSITIVE.test(value)) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_INVALID',
      `Mission archive ${label} has an invalid recorded content hash.`,
    )
  }
  return value.toLowerCase()
}

/** Decodes bounded Base64 using the production whitespace-compatible canonical rule. */
function decodeRetainedBytes(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_STORED_BASE64_BYTES) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_INVALID',
      `Mission archive ${label} retained source bytes exceed the supported bound.`,
    )
  }
  const compact = value.replace(/\s+/gu, '')
  const decoded = Buffer.from(compact, 'base64')
  if (decoded.length > MAX_GPX_SOURCE_BYTES || decoded.toString('base64') !== compact) {
    decoded.fill(0)
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_INVALID',
      `Mission archive ${label} retained source bytes are invalid Base64 or exceed 8 MiB.`,
    )
  }
  return decoded
}

/** Verifies one retained byte value and returns both recorded and observed identities. */
function verifyRetainedBytes(value, recordedHash, label) {
  const decoded = decodeRetainedBytes(value, label)
  try {
    const observedContentSha256 = createHash('sha256').update(decoded).digest('hex')
    if (recordedHash !== null && observedContentSha256 !== recordedHash) {
      throw new ArchiveGpxProofError(
        'ARCHIVE_GPX_SOURCE_MISMATCH',
        `Mission archive ${label} retained source bytes do not match their recorded hash.`,
      )
    }
    return Object.freeze({
      decodedSizeBytes: decoded.length,
      observedContentSha256,
    })
  } finally {
    decoded.fill(0)
  }
}

/** Reads bounded source text only after SQLite type and storage-length preflight. */
function readBoundedSourceText(db, tableName, rowId, label) {
  const metadata = db.prepare(`SELECT typeof(source_bytes_base64) AS storage_type,
      length(CAST(source_bytes_base64 AS BLOB)) AS stored_bytes
    FROM ${tableName} WHERE id = ?`).get(rowId)
  if (metadata === undefined || metadata.storage_type === 'null') return null
  if (metadata.storage_type !== 'text' || !Number.isSafeInteger(Number(metadata.stored_bytes))
    || Number(metadata.stored_bytes) > MAX_STORED_BASE64_BYTES) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_INVALID',
      `Mission archive ${label} retained source storage is invalid or unbounded.`,
    )
  }
  return db.prepare(`SELECT source_bytes_base64 FROM ${tableName} WHERE id = ?`).get(rowId)
    .source_bytes_base64
}

/** Returns whether one named application table exists in this schema. */
function tableExists(db, tableName) {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) !== undefined
}

/** Rejects transitional GPX custody before operational rows are excluded from scratch. */
function assertArchiveGpxCustodyReady(db, input) {
  if (!db || typeof db.prepare !== 'function'
    || typeof input?.missionId !== 'string' || input.missionId.length < 1) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_INVALID',
      'Mission archive GPX readiness input is invalid.',
    )
  }
  assertNotCancelled(input)
  const state = db.prepare(`SELECT
    (SELECT COUNT(*) FROM gpx_import_batches
      WHERE mission_id = ? AND status = 'running') AS running_batches,
    (SELECT COUNT(*) FROM gpx_import_source_receipts
      WHERE mission_id = ? AND status IN ('pending', 'retained')) AS unsettled_receipts,
    (SELECT COUNT(*) FROM gpx_import_revisions
      WHERE mission_id = ? AND import_state = 'staging') AS staging_revisions,
    (SELECT COUNT(*) FROM gpx_track_imports
      WHERE mission_id = ? AND import_state = 'staging') AS staging_imports,
    (SELECT CASE WHEN
        safe.scanned_through_rowid < safe.scan_target_rowid
        OR unsafe.low_scanned_through_rowid > unsafe.low_target_rowid
        OR unsafe.high_scanned_through_rowid < unsafe.high_target_rowid
      THEN 1 ELSE 0 END
      FROM legacy_gpx_backfill_state AS safe
      JOIN legacy_gpx_rowid_scan_state AS unsafe ON unsafe.singleton = safe.singleton
      WHERE safe.singleton = 1) AS pending_legacy_backfills,
    (SELECT COUNT(*) FROM gpx_track_imports AS imports
      JOIN legacy_gpx_backfill_quarantine AS quarantine
        ON quarantine.source_rowid = imports.rowid
      WHERE imports.mission_id = ?) AS quarantined_legacy_backfills`).get(
    input.missionId,
    input.missionId,
    input.missionId,
    input.missionId,
    input.missionId,
  )
  const unsettledCount = Object.values(state).reduce((total, value) => total + Number(value ?? 0), 0)
  if (unsettledCount > 0) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_CUSTODY_UNSETTLED',
      'Mission archive cannot seal while GPX source custody is unsettled.',
    )
  }
}

/** Creates one closed manifest record for an immutable source revision root. */
function projectSourceRevision(db, row, input) {
  const recordId = normalizeRecordId(row.id, 'GPX source revision')
  const importId = normalizeRecordId(row.import_id, 'GPX import')
  const recordedHash = normalizeRecordedHash(row.content_sha256, 'GPX source revision')
  const sourceText = readBoundedSourceText(
    db,
    'gpx_import_revisions',
    recordId,
    'GPX source revision',
  )
  let custodyClass
  let observedContentSha256 = null
  let decodedSizeBytes = null
  if (sourceText !== null) {
    const verified = verifyRetainedBytes(sourceText, recordedHash, 'GPX source revision')
    observedContentSha256 = verified.observedContentSha256
    decodedSizeBytes = verified.decodedSizeBytes
    custodyClass = row.completeness === 'complete' ? 'exact_bytes' : 'legacy_exact_bytes'
  } else if (row.completeness === 'complete') {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_MISSING',
      'Mission archive complete GPX source revision has no retained source bytes.',
    )
  } else if (recordedHash !== null) {
    custodyClass = 'legacy_hash_only'
  } else {
    custodyClass = 'legacy_unavailable'
  }
  assertNotCancelled(input)
  return Object.freeze({
    kind: 'source_revision',
    import_id: importId,
    source_revision_sequence: Number(row.revision_sequence),
    failure_id: null,
    batch_id: null,
    completeness: row.completeness,
    custody_class: custodyClass,
    recorded_content_sha256: recordedHash,
    observed_content_sha256: observedContentSha256,
    decoded_size_bytes: decodedSizeBytes,
  })
}

/** Creates one closed manifest record for terminal GPX import failure evidence. */
function projectImportFailure(db, row, input) {
  const failureId = normalizeRecordId(row.id, 'GPX failure')
  const batchId = normalizeRecordId(row.batch_id, 'GPX failure batch')
  const recordedHash = normalizeRecordedHash(row.content_sha256, 'GPX failure')
  const sourceText = readBoundedSourceText(db, 'gpx_import_failures', failureId, 'GPX failure')
  if ((recordedHash === null) !== (sourceText === null)) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_INVALID',
      'Mission archive GPX failure has one-sided source custody.',
    )
  }
  const verified = sourceText === null
    ? null
    : verifyRetainedBytes(sourceText, recordedHash, 'GPX failure')
  assertNotCancelled(input)
  return Object.freeze({
    kind: 'import_failure',
    import_id: null,
    source_revision_sequence: null,
    failure_id: failureId,
    batch_id: batchId,
    completeness: null,
    custody_class: verified === null ? 'failure_unavailable' : 'failure_exact_bytes',
    recorded_content_sha256: recordedHash,
    observed_content_sha256: verified?.observedContentSha256 ?? null,
    decoded_size_bytes: verified?.decodedSizeBytes ?? null,
  })
}

/** Validates every derived revision, active projection and parsed-evidence lineage edge. */
function validateGpxLineage(db, missionId, input) {
  const sourceLookup = db.prepare(`SELECT id, mission_id, import_id, revision_sequence,
      source_revision_sequence, content_sha256, source_bytes_base64, completeness
    FROM gpx_import_revisions WHERE import_id = ? AND revision_sequence = ?`)
  const revisions = db.prepare(`SELECT id, mission_id, import_id, revision_sequence,
      source_revision_sequence, content_sha256, source_bytes_base64, completeness
    FROM gpx_import_revisions WHERE mission_id = ?
    ORDER BY import_id, revision_sequence, id`).iterate(missionId)
  const roots = new Map()
  for (const revision of revisions) {
    assertNotCancelled(input)
    normalizeRecordId(revision.id, 'GPX revision')
    normalizeRecordId(revision.import_id, 'GPX import')
    if (!Number.isSafeInteger(Number(revision.revision_sequence))
      || !Number.isSafeInteger(Number(revision.source_revision_sequence))
      || Number(revision.revision_sequence) < 1 || Number(revision.source_revision_sequence) < 1
      || !['complete', 'legacy_baseline'].includes(revision.completeness)) {
      throw new ArchiveGpxProofError(
        'ARCHIVE_GPX_LINEAGE_INVALID',
        'Mission archive GPX revision lineage fields are invalid.',
      )
    }
    const source = sourceLookup.get(revision.import_id, revision.source_revision_sequence)
    if (source === undefined || source.mission_id !== missionId
      || source.import_id !== revision.import_id
      || Number(source.revision_sequence) !== Number(source.source_revision_sequence)
      || normalizeRecordedHash(source.content_sha256, 'GPX source revision')
        !== normalizeRecordedHash(revision.content_sha256, 'GPX revision')
      || source.completeness !== revision.completeness) {
      throw new ArchiveGpxProofError(
        'ARCHIVE_GPX_LINEAGE_INVALID',
        'Mission archive GPX revision does not resolve to one matching source root.',
      )
    }
    if (Number(revision.revision_sequence) !== Number(revision.source_revision_sequence)
      && revision.source_bytes_base64 !== null) {
      throw new ArchiveGpxProofError(
        'ARCHIVE_GPX_LINEAGE_INVALID',
        'Mission archive derived GPX revision unexpectedly duplicates source bytes.',
      )
    }
    roots.set(`${source.import_id}\u0000${source.revision_sequence}`, source)
  }
  if (tableExists(db, 'gpx_track_imports')) {
    const invalidProjection = db.prepare(`SELECT 1 FROM gpx_track_imports AS imports
      LEFT JOIN gpx_import_revisions AS revisions
        ON revisions.import_id = imports.id
        AND revisions.revision_sequence = imports.revision_sequence
      WHERE imports.mission_id = ? AND (
        revisions.id IS NULL OR revisions.mission_id != imports.mission_id
        OR lower(COALESCE(revisions.content_sha256, ''))
          != lower(COALESCE(imports.content_sha256, ''))
      ) LIMIT 1`).get(missionId)
    if (invalidProjection !== undefined) {
      throw new ArchiveGpxProofError(
        'ARCHIVE_GPX_LINEAGE_INVALID',
        'Mission archive active GPX projection does not match its immutable revision.',
      )
    }
  }
  for (const tableName of ['gpx_evidence_points', 'gpx_evidence_rejections']) {
    if (!tableExists(db, tableName)) continue
    const invalidEvidence = db.prepare(`SELECT 1 FROM ${tableName} AS evidence
      JOIN gpx_import_revisions AS revisions
        ON revisions.import_id = evidence.import_id
        AND revisions.revision_sequence = evidence.revision_sequence
      WHERE revisions.mission_id = ?
        AND revisions.revision_sequence != revisions.source_revision_sequence
      LIMIT 1`).get(missionId)
    if (invalidEvidence !== undefined) {
      throw new ArchiveGpxProofError(
        'ARCHIVE_GPX_LINEAGE_INVALID',
        'Mission archive parsed GPX evidence is attached to a derived revision.',
      )
    }
  }
  return roots
}

/** Computes the exhaustive, bounded GPX source-custody proof for one archived mission. */
function computeArchiveGpxContentProof(db, inputOrMissionId) {
  const input = typeof inputOrMissionId === 'string'
    ? { missionId: inputOrMissionId }
    : inputOrMissionId
  if (!db || typeof db.prepare !== 'function'
    || typeof input?.missionId !== 'string' || input.missionId.length < 1) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_INVALID',
      'Mission archive GPX proof input is invalid.',
    )
  }
  const roots = validateGpxLineage(db, input.missionId, input)
  assertGpxProofRecordBound(roots.size)
  const records = [...roots.values()]
    .sort((left, right) => {
      const leftKey = `${left.import_id}\u0000${String(left.revision_sequence).padStart(20, '0')}`
      const rightKey = `${right.import_id}\u0000${String(right.revision_sequence).padStart(20, '0')}`
      return leftKey.localeCompare(rightKey)
    })
    .map((row) => projectSourceRevision(db, row, input))
  const failures = db.prepare(`SELECT id, batch_id, content_sha256
    FROM gpx_import_failures WHERE mission_id = ?
    ORDER BY recorded_at, batch_id, id`).iterate(input.missionId)
  for (const row of failures) {
    records.push(projectImportFailure(db, row, input))
    assertGpxProofRecordBound(records.length)
  }
  const recordBytes = Buffer.from(canonicalJson(records), 'utf8')
  if (recordBytes.length > MAX_GPX_PROOF_BYTES) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_PROOF_LIMIT',
      'Mission archive GPX identity proof exceeds its encrypted manifest bound.',
    )
  }
  const countClass = (custodyClass) => records.filter((record) =>
    record.custody_class === custodyClass).length
  return Object.freeze({
    proof_version: 1,
    record_count: records.length,
    exact_bytes_count: records.filter((record) =>
      ['exact_bytes', 'legacy_exact_bytes', 'failure_exact_bytes'].includes(
        record.custody_class,
      )).length,
    legacy_hash_only_count: countClass('legacy_hash_only'),
    legacy_unavailable_count: countClass('legacy_unavailable'),
    failure_unavailable_count: countClass('failure_unavailable'),
    records_sha256: createHash('sha256').update(recordBytes).digest('hex'),
    records: Object.freeze(records),
  })
}

/** Recomputes and compares the complete GPX proof without reparsing GPX payloads. */
function verifyArchiveGpxContentProof(db, input) {
  const observed = computeArchiveGpxContentProof(db, input)
  if (canonicalJson(observed) !== canonicalJson(input.expectedProof)) {
    throw new ArchiveGpxProofError(
      'ARCHIVE_GPX_SOURCE_MISMATCH',
      'Mission archive GPX custody differs from its authenticated proof.',
    )
  }
  return observed
}

module.exports = {
  assertGpxProofRecordBound,
  ArchiveGpxProofError,
  assertArchiveGpxCustodyReady,
  computeArchiveGpxContentProof,
  verifyArchiveGpxContentProof,
}
