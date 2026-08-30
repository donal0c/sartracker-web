const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const {
  normalizeArchiveVerificationIdentity,
  normalizeArchiveVerificationProofForIdentity,
} = require('./archive-envelope.cjs')
const { canonicalJson } = require('./archive-container.cjs')
const { withPinnedCustodyFileIdentity } = require('./archive-custody-file.cjs')
const {
  startArchiveCustodyReconciliation,
} = require('./archive-custody-reconcile-runner.cjs')
const {
  normalizeArchiveCustodyReconcileResult,
} = require('./archive-custody-reconcile-envelope.cjs')

const LEGACY_ARCHIVE_BACKFILL_LIMIT = 50
const LEGACY_ARCHIVE_BACKFILL_SCAN_ROWS = 1_000
const LEGACY_ARCHIVE_BACKFILL_CURSOR_KEY = 'legacy_archive_registry_backfill_cursor'
const LEGACY_ARCHIVE_BACKFILL_TARGET_KEY = 'legacy_archive_registry_backfill_target'
const MAX_RECONCILE_ROWS = 50
const MAX_ID_BYTES = 200
const MAX_TEXT_BYTES = 2_000
const MAX_SLOTS_JSON_BYTES = 16 * 1024
const MAX_VERIFICATION_PROOF_BYTES = 4 * 1024 * 1024
const SUPPORTED_ARCHIVE_KINDS = new Set(['finalized', 'direct', 'finalized_recovery'])
const SUPPORTED_STATUSES = new Set(['sealed', 'verified', 'superseded'])
const SUPPORTED_AVAILABILITY = new Set([
  'unknown',
  'present',
  'missing',
  'not_regular',
  'mismatched',
  'unreadable',
])
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const REQUIRED_ARCHIVE_TABLE_COUNT = 49
const LEGACY_ARCHIVE_EVENT_TYPES = Object.freeze([
  'mission_archived',
  'mission_archive_succeeded',
])

/** Signals an invalid or inconsistent live archive-custody transition. */
class ArchiveRegistryError extends Error {
  /** Creates a stable, bounded archive registry error. */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ArchiveRegistryError'
    this.code = code
    this.details = Object.freeze({ ...details })
  }
}

/** Requires a bounded non-control string. */
function normalizeText(value, label, maximumBytes = MAX_TEXT_BYTES) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      `${label} must be a bounded non-empty string.`,
    )
  }
  return value
}

/** Requires a bounded internal identifier. */
function normalizeId(value, label) {
  return normalizeText(value, label, MAX_ID_BYTES)
}

/** Requires one plain input object with exactly its declared fields. */
function requireExactInput(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      `${label} requires an object.`,
    )
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      `${label} has missing or unsupported fields.`,
    )
  }
}

/** Requires one RFC-4122 version-four identity used by v2 worker envelopes. */
function normalizeUuid(value, label) {
  const normalized = normalizeId(value, label)
  if (!UUID_V4.test(normalized)) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      `${label} must be a version-four UUID.`,
    )
  }
  return normalized
}

/** Requires a canonical application timestamp. */
function normalizeTimestamp(value, label) {
  if (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      `${label} must be a canonical ISO-8601 timestamp.`,
    )
  }
  return value
}

/** Requires a positive exact integer epoch. */
function normalizeEpoch(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      'Archive request event row identity must be a positive safe integer.',
    )
  }
  return value
}

/** Requires a nullable positive PR5 mission-finalized event row identity. */
function normalizeProtectedFinalizationEpoch(value, archiveKind) {
  if (value === null) {
    if (archiveKind === 'finalized_recovery') {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_INPUT',
        'A finalized recovery archive requires its protected finalization epoch.',
      )
    }
    return null
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      'Protected finalization epoch must be null or a positive safe integer.',
    )
  }
  return value
}

/** Requires lowercase SHA-256 hex. */
function normalizeSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      `${label} must be lowercase SHA-256 hex.`,
    )
  }
  return value
}

/** Requires an exact non-negative byte count. */
function normalizeSize(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      'Archive size must be a non-negative safe integer.',
    )
  }
  return value
}

/** Keeps a custody path strictly relative to the application archive directory. */
function normalizeRelativePath(value) {
  const normalized = normalizeText(value, 'Archive relative path', 4_096)
  if (
    path.isAbsolute(normalized)
    || normalized.includes('\\')
    || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_PATH',
      'Archive custody path must be a canonical relative path inside the archive directory.',
    )
  }
  return normalized
}

/** Converts a legacy absolute event path into an app-owned relative custody path. */
function legacyRelativePath(archiveDirectory, archivePath) {
  const absoluteDirectory = path.resolve(archiveDirectory)
  const absoluteArchive = path.resolve(normalizeText(archivePath, 'Legacy archive path', 8_192))
  const relativePath = path.relative(absoluteDirectory, absoluteArchive)
  if (relativePath === '' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_LEGACY_PATH_OUTSIDE_CUSTODY',
      'A legacy archive event points outside the application archive directory and requires explicit custody review.',
      { archivePath: absoluteArchive },
    )
  }
  return normalizeRelativePath(relativePath.split(path.sep).join('/'))
}

/** Reads bounded JSON object details without accepting malformed audit state. */
function parseEventDetails(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_VERIFICATION_PROOF_BYTES) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_EVENT_MISMATCH',
      `${label} has missing or unbounded details.`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_EVENT_MISMATCH',
      `${label} details are not valid JSON.`,
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_EVENT_MISMATCH',
      `${label} details must be an object.`,
    )
  }
  return parsed
}

/** Validates the non-secret key-slot inventory retained in the registry. */
function normalizeSlotInventory(slots, containerVersion) {
  if (!Array.isArray(slots) || slots.length > 3) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      'Archive slot inventory must be a bounded array.',
    )
  }
  const slotIds = new Set()
  const slotTypes = new Set()
  const normalized = slots.map((slot) => {
    if (slot === null || typeof slot !== 'object' || Array.isArray(slot)) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_INPUT',
        'Archive slot inventory contains an invalid entry.',
      )
    }
    const slotType = normalizeId(slot.slotType, 'Archive slot type')
    const slotId = normalizeId(slot.slotId, 'Archive slot ID')
    if (!['passphrase', 'recovery', 'machine'].includes(slotType)) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_INPUT',
        `Archive slot type ${slotType} is unsupported.`,
      )
    }
    if (slotIds.has(slotId) || slotTypes.has(slotType)) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_INPUT',
        'Archive slot inventory contains a duplicate slot ID or type.',
      )
    }
    slotIds.add(slotId)
    slotTypes.add(slotType)
    return { slotType, slotId }
  })
  if (containerVersion === 2 && (
    normalized.length !== 2
    || !slotTypes.has('passphrase')
    || !slotTypes.has('recovery')
  )) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      'Encrypted archives require both passphrase and per-archive recovery slots.',
    )
  }
  normalized.sort((left, right) => left.slotType.localeCompare(right.slotType))
  const json = JSON.stringify(normalized)
  if (Buffer.byteLength(json, 'utf8') > MAX_SLOTS_JSON_BYTES) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      'Archive slot inventory exceeds its storage bound.',
    )
  }
  return json
}

/** Reads one registered archive or fails with a stable identity error. */
function getArchiveRow(db, archiveId) {
  const normalizedId = normalizeId(archiveId, 'Archive ID')
  const row = db.prepare('SELECT * FROM mission_archives WHERE id = ?').get(normalizedId)
  if (row === undefined) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_NOT_FOUND',
      `Registered archive ${normalizedId} was not found.`,
      { archiveId: normalizedId },
    )
  }
  if (!SUPPORTED_STATUSES.has(row.status)) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_STATE',
      `Registered archive ${normalizedId} has an invalid lifecycle state.`,
    )
  }
  if (!SUPPORTED_AVAILABILITY.has(row.availability)) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_STATE',
      `Registered archive ${normalizedId} has an invalid availability state.`,
    )
  }
  return row
}

/** Creates the bounded live archive registry facade. */
function createArchiveRegistry({
  db,
  archiveDirectory,
  appendAuditEvent = null,
  startCustodyReconciliation = startArchiveCustodyReconciliation,
}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_DATABASE',
      'Archive registry requires an open better-sqlite3 database.',
    )
  }
  const custodyDirectory = path.resolve(normalizeText(
    archiveDirectory,
    'Archive directory',
    8_192,
  ))
  if (appendAuditEvent !== null && typeof appendAuditEvent !== 'function') {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      'Archive registry audit adapter must be a function when provided.',
    )
  }
  if (typeof startCustodyReconciliation !== 'function') {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      'Archive custody reconciliation runner must be a function.',
    )
  }

  /** Returns the live mission status carried by an archive lifecycle audit event. */
  function readResultingMissionStatus(missionId) {
    const mission = db.prepare('SELECT status FROM missions WHERE id = ?').get(missionId)
    if (!['finished', 'finalized'].includes(mission?.status)) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_STATE',
        'Archive lifecycle audit requires a finished or finalized live mission.',
        { missionId },
      )
    }
    return mission.status
  }

  /** Appends and re-reads one exact audit row inside the caller's database transaction. */
  function appendAndValidateAuditEvent(missionId, eventType, details) {
    if (appendAuditEvent === null) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_AUDIT_REQUIRED',
        'Archive lifecycle state cannot commit without an immutable audit event.',
      )
    }
    const previousMaximumRowid = Number(db.prepare(
      'SELECT COALESCE(MAX(rowid), 0) AS maximum_rowid FROM mission_events',
    ).get().maximum_rowid)
    const eventId = appendAuditEvent(missionId, eventType, details)
    const event = typeof eventId === 'string'
      ? db.prepare(`SELECT rowid AS event_rowid, mission_id, event_type, details_json
        FROM mission_events WHERE id = ?`).get(eventId)
      : undefined
    let observedDetails = null
    try {
      observedDetails = event === undefined
        ? null
        : parseEventDetails(event.details_json, 'Archive lifecycle audit event')
    } catch {
      observedDetails = null
    }
    if (event === undefined
      || Number(event.event_rowid) <= previousMaximumRowid
      || event.mission_id !== missionId
      || event.event_type !== eventType
      || canonicalJson(observedDetails) !== canonicalJson(details)) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_EVENT_MISMATCH',
        'Archive lifecycle audit adapter did not append the exact event to this database.',
        { missionId, eventType },
      )
    }
    return eventId
  }

  /** Re-derives one closed verification identity from current registry and audit state. */
  function deriveVerificationTicket(archive, requireSealed = true) {
    if (requireSealed && archive.status !== 'sealed') {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_STATE',
        'Only a sealed archive can receive a verification ticket.',
        { archiveId: archive.id, status: archive.status },
      )
    }
    const expectedRequestEventType = archive.archive_kind === 'finalized'
      ? 'mission_finalize_requested'
      : 'mission_archive_requested'
    const requestEvent = db.prepare(`SELECT rowid AS event_rowid, id, mission_id,
        event_type, details_json
      FROM mission_events WHERE rowid = ?`).get(archive.request_event_rowid)
    const requestDetails = requestEvent === undefined
      ? null
      : parseEventDetails(requestEvent.details_json, 'Archive request event')
    if (requestEvent?.mission_id !== archive.mission_id
      || requestEvent?.event_type !== expectedRequestEventType
      || requestEvent?.id !== archive.request_event_id
      || !UUID_V4.test(requestEvent?.id ?? '')
      || requestDetails?.archive_id !== archive.id
      || requestDetails?.archive_kind !== archive.archive_kind
      || requestDetails?.archive_relative_path !== archive.relative_path
      || requestDetails?.operation_id !== archive.creation_operation_id
      || requestDetails?.protected_finalization_epoch
        !== (archive.protected_finalization_epoch === null
          ? null
          : Number(archive.protected_finalization_epoch))) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_EVENT_MISMATCH',
        'Archive verification identity does not match its immutable request event.',
        { archiveId: archive.id },
      )
    }
    const sealEvent = archive.sealed_event_id === null
      ? undefined
      : db.prepare(`SELECT mission_id, event_type, timestamp, details_json
        FROM mission_events WHERE id = ?`).get(archive.sealed_event_id)
    const sealDetails = sealEvent === undefined
      ? null
      : parseEventDetails(sealEvent.details_json, 'Archive seal event')
    if (sealEvent?.mission_id !== archive.mission_id
      || sealEvent?.event_type !== 'mission_archive_sealed_v2'
      || sealEvent?.timestamp !== archive.created_at
      || sealDetails?.archive_id !== archive.id
      || sealDetails?.request_event_rowid !== Number(archive.request_event_rowid)
      || sealDetails?.request_event_id !== archive.request_event_id
      || sealDetails?.creation_operation_id !== archive.creation_operation_id
      || sealDetails?.protected_finalization_epoch
        !== (archive.protected_finalization_epoch === null
          ? null
          : Number(archive.protected_finalization_epoch))
      || sealDetails?.relative_path !== archive.relative_path
      || sealDetails?.ciphertext_sha256 !== archive.ciphertext_sha256
      || sealDetails?.size_bytes !== Number(archive.size_bytes)
      || sealDetails?.frame_count !== Number(archive.frame_count)
      || sealDetails?.header_sha256 !== archive.header_sha256
      || sealDetails?.manifest_sha256 !== archive.manifest_sha256
      || sealDetails?.entry_count !== Number(archive.entry_count)
      || sealDetails?.table_count !== Number(archive.table_count)) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_EVENT_MISMATCH',
        'Archive verification identity does not match its immutable seal event.',
        { archiveId: archive.id },
      )
    }
    const previousArchive = archive.previous_archive_id === null
      ? null
      : getArchiveRow(db, archive.previous_archive_id)
    if (previousArchive !== null && (
      previousArchive.mission_id !== archive.mission_id
      || (Number(previousArchive.container_version) === 2
        && previousArchive.ciphertext_sha256 === null)
    )) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_CHAIN_MISMATCH',
        'Archive verification predecessor identity is unavailable or cross-mission.',
        { archiveId: archive.id },
      )
    }
    try {
      return normalizeArchiveVerificationIdentity({
        archiveId: archive.id,
        archiveKind: archive.archive_kind,
        archiveRelativePath: archive.relative_path,
        missionId: archive.mission_id,
        requestEventRowid: Number(archive.request_event_rowid),
        requestEventId: requestEvent.id,
        creationOperationId: archive.creation_operation_id,
        protectedFinalizationEpoch: archive.protected_finalization_epoch === null
          ? null
          : Number(archive.protected_finalization_epoch),
        createdAt: archive.created_at,
        previousArchiveSha256: previousArchive?.ciphertext_sha256 ?? null,
        containerVersion: Number(archive.container_version),
        schemaVersion: 13,
        inventoryVersion: 1,
        ciphertextSha256: archive.ciphertext_sha256,
        sizeBytes: Number(archive.size_bytes),
        frameCount: Number(archive.frame_count),
        headerSha256: archive.header_sha256,
        manifestSha256: archive.manifest_sha256,
        entryCount: Number(archive.entry_count),
        tableCount: Number(archive.table_count),
      })
    } catch {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_STATE',
        'Archive registry cannot issue a malformed verification identity.',
        { archiveId: archive.id },
      )
    }
  }

  return Object.freeze({
    /** Registers one v2 sealed file only when the immutable audit event agrees. */
    registerSealedArchive(input) {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_INPUT',
          'Sealed archive registration requires an object.',
        )
      }
      const id = normalizeUuid(input.id, 'Archive ID')
      const missionId = normalizeId(input.missionId, 'Mission ID')
      const requestEventRowid = normalizeEpoch(input.requestEventRowid)
      if (!SUPPORTED_ARCHIVE_KINDS.has(input.archiveKind)) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_INPUT',
          'Archive kind is unsupported.',
        )
      }
      const requestEventId = normalizeUuid(input.requestEventId, 'Archive request event ID')
      const creationOperationId = normalizeUuid(
        input.creationOperationId,
        'Archive creation operation ID',
      )
      const protectedFinalizationEpoch = normalizeProtectedFinalizationEpoch(
        input.protectedFinalizationEpoch,
        input.archiveKind,
      )
      if (input.containerVersion !== 2) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_INPUT',
          'New sealed archive registration requires SARARCH2 container version 2.',
        )
      }
      const relativePath = normalizeRelativePath(input.relativePath)
      if (relativePath !== `${id}.sararch`) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_PATH',
          'Version-two archives must use their exact flat final custody filename.',
        )
      }
      const ciphertextSha256 = normalizeSha256(
        input.ciphertextSha256,
        'Archive ciphertext identity',
      )
      const sizeBytes = normalizeSize(input.sizeBytes)
      if (sizeBytes < 1) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_INPUT',
          'Version-two archive size must be positive.',
        )
      }
      const frameCount = normalizeSize(input.frameCount)
      const entryCount = normalizeSize(input.entryCount)
      const tableCount = normalizeSize(input.tableCount)
      const headerSha256 = normalizeSha256(input.headerSha256, 'Archive header identity')
      const manifestSha256 = normalizeSha256(
        input.manifestSha256,
        'Archive manifest identity',
      )
      if (frameCount < 2 || sizeBytes < 37 + 29 * frameCount
        || entryCount < 4 || tableCount !== REQUIRED_ARCHIVE_TABLE_COUNT) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_INPUT',
          'Archive creation receipt is structurally incomplete.',
        )
      }
      const createdAt = normalizeTimestamp(input.createdAt, 'Archive creation time')
      const sealedEventId = normalizeId(input.sealedEventId, 'Archive seal event ID')
      const previousArchiveId = input.previousArchiveId === undefined
        || input.previousArchiveId === null
        ? null
        : normalizeId(input.previousArchiveId, 'Previous archive ID')
      const slotsJson = normalizeSlotInventory(input.slots, input.containerVersion)
      const requestEvent = db.prepare(`SELECT rowid AS event_rowid, id, mission_id,
          event_type, details_json
        FROM mission_events WHERE rowid = ?`).get(requestEventRowid)
      const expectedRequestEventType = input.archiveKind === 'finalized'
        ? 'mission_finalize_requested'
        : 'mission_archive_requested'
      const requestDetails = requestEvent === undefined
        ? null
        : parseEventDetails(requestEvent.details_json, 'Archive request event')
      if (requestEvent?.id !== requestEventId
        || requestEvent?.mission_id !== missionId
        || requestEvent?.event_type !== expectedRequestEventType
        || requestDetails?.archive_id !== id
        || requestDetails?.archive_kind !== input.archiveKind
        || requestDetails?.archive_relative_path !== relativePath
        || requestDetails?.operation_id !== creationOperationId
        || requestDetails?.protected_finalization_epoch !== protectedFinalizationEpoch) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_EVENT_MISMATCH',
          'Archive registry fields do not match the immutable request event.',
          { archiveId: id, requestEventId },
        )
      }
      const event = db.prepare(`SELECT mission_id, event_type, details_json
        FROM mission_events WHERE id = ?`).get(sealedEventId)
      const details = event === undefined
        ? null
        : parseEventDetails(event.details_json, 'Archive seal event')
      if (
        event?.mission_id !== missionId
        || event?.event_type !== 'mission_archive_sealed_v2'
        || details.archive_id !== id
        || details.request_event_rowid !== requestEventRowid
        || details.request_event_id !== requestEventId
        || details.creation_operation_id !== creationOperationId
        || details.protected_finalization_epoch !== protectedFinalizationEpoch
        || details.relative_path !== relativePath
        || details.ciphertext_sha256 !== ciphertextSha256
        || details.size_bytes !== sizeBytes
        || details.frame_count !== frameCount
        || details.header_sha256 !== headerSha256
        || details.manifest_sha256 !== manifestSha256
        || details.entry_count !== entryCount
        || details.table_count !== tableCount
      ) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_EVENT_MISMATCH',
          'Archive registry fields do not match the immutable seal event.',
          { archiveId: id, sealedEventId },
        )
      }
      if (previousArchiveId !== null) {
        const previous = getArchiveRow(db, previousArchiveId)
        if (previous.mission_id !== missionId) {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_CHAIN_MISMATCH',
            'Archive predecessor belongs to a different mission.',
          )
        }
      }
      db.prepare(`INSERT INTO mission_archives (
        id, mission_id, request_event_rowid, request_event_id,
        creation_operation_id, protected_finalization_epoch,
        archive_kind, container_version,
        relative_path, ciphertext_sha256, size_bytes, created_at, sealed_event_id,
        frame_count, header_sha256, manifest_sha256, entry_count, table_count,
        verified_at, verification_proof_json, previous_archive_id, status,
        availability, availability_reason, last_reconciled_at,
        last_observed_file_identity, slots_json, last_non_machine_unwrap_at,
        legacy_event_rowid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        NULL, NULL, ?, 'sealed', 'unknown', NULL, NULL, NULL, ?, NULL, NULL)`)
        .run(
          id,
          missionId,
          requestEventRowid,
          requestEventId,
          creationOperationId,
          protectedFinalizationEpoch,
          input.archiveKind,
          relativePath,
          ciphertextSha256,
          sizeBytes,
          createdAt,
          sealedEventId,
          frameCount,
          headerSha256,
          manifestSha256,
          entryCount,
          tableCount,
          previousArchiveId,
          slotsJson,
        )
      return getArchiveRow(db, id)
    },

    /** Returns one exact registered archive. */
    getArchive(archiveId) {
      return getArchiveRow(db, archiveId)
    },

    /** Lists one mission's custody chain newest-first without secrets. */
    listMissionArchives(missionId) {
      const normalizedMissionId = normalizeId(missionId, 'Mission ID')
      return db.prepare(`SELECT archives.*,
          predecessor.ciphertext_sha256 AS previous_archive_sha256,
          CASE WHEN supplement.supplement_sequence IS NULL
            THEN 1 ELSE supplement.supplement_sequence + 1 END AS revision_sequence,
          COALESCE(totals.supplement_count, 0) + 1 AS revision_count,
          supplement.authority AS supplement_authority,
          supplement.reason AS supplement_reason,
          supplement.created_at AS supplement_created_at
        FROM mission_archives AS archives
        LEFT JOIN mission_archives AS predecessor
          ON predecessor.id = archives.previous_archive_id
        LEFT JOIN mission_archive_supplements AS supplement
          ON supplement.archive_id = archives.id
        LEFT JOIN (
          SELECT mission_id, COUNT(*) AS supplement_count
          FROM mission_archive_supplements GROUP BY mission_id
        ) AS totals ON totals.mission_id = archives.mission_id
        WHERE archives.mission_id = ?
        ORDER BY archives.request_event_rowid DESC, archives.created_at DESC, archives.id DESC`)
        .all(normalizedMissionId)
    },

    /** Issues one exact non-secret verification identity from current trusted state. */
    issueVerificationTicket(archiveId) {
      return deriveVerificationTicket(getArchiveRow(db, archiveId))
    },

    /** Issues one path-bounded supported identity for a temporary read-only review session. */
    issueReviewTicket(archiveId) {
      const archive = getArchiveRow(db, archiveId)
      if (archive.container_version === 1) {
        if (!['sealed', 'superseded'].includes(archive.status)
          || archive.availability !== 'present'
          || archive.verified_at !== null
          || archive.verification_proof_json !== null
          || archive.ciphertext_sha256 !== null
          || archive.size_bytes !== null
          || archive.slots_json !== '[]') {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_REVIEW_UNAVAILABLE',
            'Archive review requires available supported legacy archive bytes.',
            { archiveId: archive.id, status: archive.status },
          )
        }
        return Object.freeze({
          archiveId: archive.id,
          archiveKind: archive.archive_kind,
          archiveRelativePath: archive.relative_path,
          missionId: archive.mission_id,
          containerVersion: 1,
          status: archive.status,
          availability: archive.availability,
          createdAt: archive.created_at,
          verifiedAt: null,
          previousArchiveId: archive.previous_archive_id,
          encrypted: false,
          immutable: true,
          slots: Object.freeze([]),
        })
      }
      if (archive.container_version !== 2
        || !['verified', 'superseded'].includes(archive.status)
        || archive.verified_at === null
        || archive.verification_proof_json === null
        || archive.availability !== 'present') {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_REVIEW_UNAVAILABLE',
          'Archive review requires an available verified v2 archive.',
          { archiveId: archive.id, status: archive.status },
        )
      }
      const identity = deriveVerificationTicket(archive, false)
      let proof
      try {
        proof = normalizeArchiveVerificationProofForIdentity(
          JSON.parse(archive.verification_proof_json),
          identity,
        )
      } catch {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_PROOF',
          'Archive review cannot trust a malformed stored verification proof.',
          { archiveId: archive.id },
        )
      }
      let slots
      try {
        slots = JSON.parse(normalizeSlotInventory(JSON.parse(archive.slots_json), 2))
      } catch {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_STATE',
          'Archive review cannot trust a malformed slot inventory.',
          { archiveId: archive.id },
        )
      }
      return Object.freeze({
        ...identity,
        status: archive.status,
        availability: archive.availability,
        verifiedAt: archive.verified_at,
        previousArchiveId: archive.previous_archive_id,
        slots: Object.freeze(slots.map((slot) => Object.freeze({
          slotId: slot.slotId,
          slotType: slot.slotType,
        }))),
        custodyFileIdentity: proof.custodyFileIdentity,
      })
    },

    /** Audits one permission-restricted plaintext review session after its source opens. */
    recordReviewOpened(input) {
      requireExactInput(
        input,
        ['archiveId', 'missionId', 'openedAt', 'plaintextResidual', 'sessionId', 'slotType'],
        'Archive review open audit',
      )
      const archive = getArchiveRow(db, input.archiveId)
      const missionId = normalizeId(input.missionId, 'Archive review mission ID')
      const sessionId = normalizeUuid(input.sessionId, 'Archive review session ID')
      const openedAt = normalizeTimestamp(input.openedAt, 'Archive review open time')
      const v2Review = archive.container_version === 2
        && ['verified', 'superseded'].includes(archive.status)
        && archive.verified_at !== null
        && ['passphrase', 'recovery'].includes(input.slotType)
      const legacyReview = archive.container_version === 1
        && ['sealed', 'superseded'].includes(archive.status)
        && archive.verified_at === null
        && input.slotType === 'legacy_unencrypted'
      if (archive.mission_id !== missionId
        || archive.availability !== 'present'
        || (!v2Review && !legacyReview)
        || input.plaintextResidual !== 'permission_restricted_session_open') {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_REVIEW_UNAVAILABLE',
          'Archive review open audit does not match an available supported archive.',
        )
      }
      return appendAndValidateAuditEvent(missionId, 'mission_archive_review_opened', {
        archive_id: archive.id,
        session_id: sessionId,
        slot_type: input.slotType,
        opened_at: openedAt,
        plaintext_residual: input.plaintextResidual,
        resulting_status: readResultingMissionStatus(missionId),
      })
    },

    /** Audits session closure only after the manager confirms plaintext sweep. */
    recordReviewClosed(input) {
      requireExactInput(
        input,
        [
          'archiveId',
          'closedAt',
          'missionId',
          'plaintextSweepConfirmed',
          'reason',
          'sessionId',
        ],
        'Archive review close audit',
      )
      const archive = getArchiveRow(db, input.archiveId)
      const missionId = normalizeId(input.missionId, 'Archive review mission ID')
      const sessionId = normalizeUuid(input.sessionId, 'Archive review session ID')
      const closedAt = normalizeTimestamp(input.closedAt, 'Archive review close time')
      if (archive.mission_id !== missionId
        || input.plaintextSweepConfirmed !== true
        || !['explicit_close', 'renderer_destroyed', 'app_shutdown'].includes(input.reason)) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_REVIEW_AUDIT_INVALID',
          'Archive review close audit is invalid.',
        )
      }
      return appendAndValidateAuditEvent(missionId, 'mission_archive_review_closed', {
        archive_id: archive.id,
        session_id: sessionId,
        closed_at: closedAt,
        reason: input.reason,
        plaintext_sweep_confirmed: true,
        resulting_status: readResultingMissionStatus(missionId),
      })
    },

    /** Audits a denied archive-review mutation without retaining attempted argument values. */
    recordReviewMutationDenied(input) {
      requireExactInput(
        input,
        [
          'archiveId',
          'attemptedMethod',
          'boundary',
          'deniedAt',
          'missionId',
          'sessionId',
        ],
        'Archive review mutation-denial audit',
      )
      const archive = getArchiveRow(db, input.archiveId)
      const missionId = normalizeId(input.missionId, 'Archive review mission ID')
      const sessionId = normalizeUuid(input.sessionId, 'Archive review session ID')
      const deniedAt = normalizeTimestamp(input.deniedAt, 'Archive review mutation denial time')
      const attemptedMethod = normalizeText(
        input.attemptedMethod,
        'Archive review attempted method',
        100,
      )
      if (archive.mission_id !== missionId
        || /[\u0000-\u001f\u007f]/u.test(attemptedMethod)
        || !['facade', 'ipc'].includes(input.boundary)) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_REVIEW_AUDIT_INVALID',
          'Archive review mutation-denial audit is invalid.',
        )
      }
      return appendAndValidateAuditEvent(
        missionId,
        'mission_archive_review_mutation_denied',
        {
          archive_id: archive.id,
          session_id: sessionId,
          denied_at: deniedAt,
          attempted_method: attemptedMethod,
          boundary: input.boundary,
          resulting_status: readResultingMissionStatus(missionId),
        },
      )
    },

    /** Commits an independently produced exhaustive verification proof. */
    markVerified(input) {
      requireExactInput(
        input,
        ['archiveId', 'verificationProof', 'verifiedAt'],
        'Archive verification commit',
      )
      const verifiedAt = normalizeTimestamp(input.verifiedAt, 'Archive verification time')
      if (appendAuditEvent === null) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_AUDIT_REQUIRED',
          'Archive verification cannot commit without an immutable audit event.',
        )
      }
      const commit = db.transaction(() => {
        const archive = getArchiveRow(db, input.archiveId)
        const expectedHash = normalizeSha256(
          archive.ciphertext_sha256,
          'Registered archive ciphertext identity',
        )
        const verificationTicket = deriveVerificationTicket(archive)
        let verificationProof
        try {
          verificationProof = normalizeArchiveVerificationProofForIdentity(
            input.verificationProof,
            verificationTicket,
          )
        } catch {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_INVALID_PROOF',
            'Archive verification proof does not match the exhaustive registered identity.',
          )
        }
        const proofJson = JSON.stringify(verificationProof)
        if (Buffer.byteLength(proofJson, 'utf8') > MAX_VERIFICATION_PROOF_BYTES) {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_INVALID_PROOF',
            'Archive verification proof exceeds its storage bound.',
          )
        }
        return withPinnedCustodyFileIdentity({
          archiveDirectory: custodyDirectory,
          archiveRelativePath: verificationTicket.archiveRelativePath,
          expectedFileIdentity: verificationProof.custodyFileIdentity,
        }, () => {
          appendAndValidateAuditEvent(archive.mission_id, 'mission_archive_verified_v2', {
            archive_id: archive.id,
            request_event_rowid: Number(archive.request_event_rowid),
            relative_path: archive.relative_path,
            ciphertext_sha256: archive.ciphertext_sha256,
            exhaustive: true,
            resulting_status: readResultingMissionStatus(archive.mission_id),
          })
          const result = db.prepare(`UPDATE mission_archives
            SET status = 'verified', verified_at = ?, verification_proof_json = ?,
              availability = 'present', availability_reason = NULL,
              last_reconciled_at = ?, last_observed_file_identity = ?
            WHERE id = ? AND status = 'sealed' AND ciphertext_sha256 = ?`)
            .run(
              verifiedAt,
              proofJson,
              verifiedAt,
              JSON.stringify(verificationProof.custodyFileIdentity),
              archive.id,
              expectedHash,
            )
          if (result.changes !== 1) {
            throw new ArchiveRegistryError(
              'ARCHIVE_REGISTRY_INVALID_STATE',
              'Only a sealed archive can commit a verification proof.',
              { archiveId: archive.id, status: archive.status },
            )
          }
          return getArchiveRow(db, archive.id)
        })
      })
      try {
        return commit.immediate()
      } catch (error) {
        if (typeof error?.code === 'string' && error.code.startsWith('ARCHIVE_CUSTODY_')) {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_CUSTODY_CHANGED',
            'Archive final custody file changed before verification could be committed.',
            { archiveId: input.archiveId },
          )
        }
        throw error
      }
    },

    /** Records one contiguous supplement link and supersedes only its predecessor status. */
    recordSupplement(input) {
      const id = normalizeId(input.id, 'Supplement ID')
      const missionId = normalizeId(input.missionId, 'Mission ID')
      const archiveId = normalizeId(input.archiveId, 'Supplement archive ID')
      const previousArchiveId = normalizeId(
        input.previousArchiveId,
        'Previous archive ID',
      )
      if (!Number.isSafeInteger(input.supplementSequence) || input.supplementSequence < 1) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_INPUT',
          'Supplement sequence must be a positive safe integer.',
        )
      }
      const authority = normalizeText(input.authority, 'Supplement authority', 200)
      const reason = normalizeText(input.reason, 'Supplement reason', 4_000)
      const createdAt = normalizeTimestamp(input.createdAt, 'Supplement creation time')
      const auditEventId = normalizeId(input.auditEventId, 'Supplement audit event ID')
      const transaction = db.transaction(() => {
        const archive = getArchiveRow(db, archiveId)
        const previous = getArchiveRow(db, previousArchiveId)
        if (
          archive.mission_id !== missionId
          || previous.mission_id !== missionId
          || archive.previous_archive_id !== previousArchiveId
          || !['sealed', 'verified'].includes(archive.status)
          || !['sealed', 'verified'].includes(previous.status)
        ) {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_CHAIN_MISMATCH',
            'Supplement archives do not form one mission-scoped predecessor chain.',
          )
        }
        const expectedSequence = Number(db.prepare(`SELECT COALESCE(MAX(supplement_sequence), 0) + 1
          AS expected FROM mission_archive_supplements WHERE mission_id = ?`).get(missionId).expected)
        if (input.supplementSequence !== expectedSequence) {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_CHAIN_MISMATCH',
            `Supplement sequence must be contiguous at ${expectedSequence}.`,
          )
        }
        const event = db.prepare(`SELECT mission_id, event_type, timestamp, details_json
          FROM mission_events WHERE id = ?`).get(auditEventId)
        const details = event === undefined
          ? null
          : parseEventDetails(event.details_json, 'Archive supplement event')
        if (
          event?.mission_id !== missionId
          || event?.event_type !== 'mission_archive_supplement_recorded'
          || event?.timestamp !== createdAt
          || details.archive_id !== archiveId
          || details.previous_archive_id !== previousArchiveId
          || details.supplement_sequence !== input.supplementSequence
          || details.authority !== authority
          || details.reason !== reason
          || details.resulting_status !== 'finalized'
        ) {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_EVENT_MISMATCH',
            'Archive supplement fields do not match the immutable audit event.',
          )
        }
        db.prepare(`INSERT INTO mission_archive_supplements (
          id, mission_id, archive_id, previous_archive_id, supplement_sequence,
          authority, reason, created_at, audit_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            id,
            missionId,
            archiveId,
            previousArchiveId,
            input.supplementSequence,
            authority,
            reason,
            createdAt,
            auditEventId,
          )
        const superseded = db.prepare(`UPDATE mission_archives SET status = 'superseded'
          WHERE id = ? AND status IN ('sealed', 'verified')`).run(previousArchiveId)
        if (superseded.changes !== 1) {
          throw new ArchiveRegistryError(
            'ARCHIVE_REGISTRY_CHAIN_MISMATCH',
            'Supplement predecessor changed before it could be superseded.',
          )
        }
        return db.prepare('SELECT * FROM mission_archive_supplements WHERE id = ?').get(id)
      })
      return db.inTransaction ? transaction() : transaction.immediate()
    },

    /** Reconciles a durable oldest-first page without changing archive lifecycle state. */
    async reconcileArchiveAvailability(input = {}) {
      const exactArchiveId = input.archiveId === undefined
        ? null
        : normalizeId(input.archiveId, 'Archive ID')
      const limit = input.limit ?? MAX_RECONCILE_ROWS
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECONCILE_ROWS) {
        throw new ArchiveRegistryError(
          'ARCHIVE_REGISTRY_INVALID_INPUT',
          `Archive reconciliation limit must be between 1 and ${MAX_RECONCILE_ROWS}.`,
        )
      }
      const maximumObservedAt = db.prepare(`SELECT MAX(last_reconciled_at) AS observed_at
        FROM mission_archives`).get().observed_at
      const defaultCycleMs = Math.max(
        Date.now(),
        typeof maximumObservedAt === 'string' && !Number.isNaN(Date.parse(maximumObservedAt))
          ? Date.parse(maximumObservedAt) + 1
          : 0,
      )
      const cycleStartedAt = input.cycleStartedAt === undefined
        ? new Date(defaultCycleMs).toISOString()
        : normalizeTimestamp(input.cycleStartedAt, 'Archive reconciliation cycle time')
      const rows = exactArchiveId === null
        ? db.prepare(`SELECT rowid AS registry_rowid, * FROM mission_archives
          WHERE last_reconciled_at IS NULL OR last_reconciled_at < ?
          ORDER BY last_reconciled_at IS NOT NULL ASC, last_reconciled_at ASC, rowid ASC
          LIMIT ?`).all(cycleStartedAt, limit)
        : [getArchiveRow(db, exactArchiveId)].map((row) => ({
            registry_rowid: Number(db.prepare(`SELECT rowid FROM mission_archives
              WHERE id = ?`).get(row.id).rowid),
            ...row,
          }))
      const unavailable = []
      for (const row of rows) {
        const ticket = Object.freeze({
          operationId: randomUUID(),
          registryRowid: Number(row.registry_rowid),
          archiveId: row.id,
          containerVersion: Number(row.container_version),
          archiveDirectory: custodyDirectory,
          archiveRelativePath: normalizeRelativePath(row.relative_path),
          expectedSizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
          expectedCiphertextSha256: row.ciphertext_sha256,
        })
        const operation = startCustodyReconciliation({
          ticket,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
        let workerResult
        try {
          workerResult = await operation
        } finally {
          if (operation?.workerExited !== undefined) await operation.workerExited
        }
        if (input.signal?.aborted === true) {
          const error = new Error('Archive custody reconciliation was cancelled.')
          error.name = 'AbortError'
          error.code = 'ARCHIVE_CANCELLED'
          throw error
        }
        const observation = normalizeArchiveCustodyReconcileResult(workerResult, ticket)
        let availability = 'present'
        let reason = null
        if (observation.outcome === 'missing') {
          availability = 'missing'
          reason = 'Archive file is missing from the registered custody path.'
        } else if (observation.outcome === 'unreadable') {
          availability = 'unreadable'
          reason = 'Archive file could not be inspected at the registered custody path.'
        } else if (observation.outcome === 'not_regular') {
          availability = 'not_regular'
          reason = 'Archive custody path is not a regular file.'
        } else if (observation.outcome === 'changed') {
          availability = 'mismatched'
          reason = 'Archive custody file changed during its identity check.'
        } else if (row.size_bytes !== null
          && observation.observedSizeBytes !== Number(row.size_bytes)) {
          availability = 'mismatched'
          reason = 'Archive file size does not match the registered custody record.'
        } else if (row.ciphertext_sha256 !== null
          && observation.observedCiphertextSha256 !== row.ciphertext_sha256) {
          availability = 'mismatched'
          reason = 'Archive ciphertext SHA-256 does not match the registered custody record.'
        }
        const applyObservation = db.transaction(() => {
          const current = db.prepare(`SELECT rowid AS registry_rowid, * FROM mission_archives
            WHERE id = ?`).get(row.id)
          if (current === undefined
            || Number(current.registry_rowid) !== ticket.registryRowid
            || current.id !== ticket.archiveId
            || Number(current.container_version) !== ticket.containerVersion
            || current.relative_path !== ticket.archiveRelativePath
            || (current.size_bytes === null ? null : Number(current.size_bytes))
              !== ticket.expectedSizeBytes
            || current.ciphertext_sha256 !== ticket.expectedCiphertextSha256) {
            throw new ArchiveRegistryError(
              'ARCHIVE_REGISTRY_IDENTITY_CHANGED',
              'Archive registry identity changed while custody was inspected.',
              { archiveId: row.id },
            )
          }
          const latestObservedAt = db.prepare(`SELECT MAX(last_reconciled_at) AS observed_at
            FROM mission_archives`).get().observed_at
          const observedAt = new Date(Math.max(
            Date.now(),
            Date.parse(cycleStartedAt),
            typeof latestObservedAt === 'string' && !Number.isNaN(Date.parse(latestObservedAt))
              ? Date.parse(latestObservedAt) + 1
              : 0,
          )).toISOString()
          if (availability !== current.availability) {
            const resultingStatus = readResultingMissionStatus(current.mission_id)
            if (availability === 'present'
              && ['missing', 'not_regular', 'mismatched', 'unreadable']
                .includes(current.availability)) {
              appendAndValidateAuditEvent(current.mission_id, 'mission_archive_available', {
                archive_id: current.id,
                request_event_rowid: Number(current.request_event_rowid),
                relative_path: current.relative_path,
                archive_status: current.status,
                resulting_status: resultingStatus,
              })
            } else if (availability !== 'present') {
              appendAndValidateAuditEvent(current.mission_id, 'mission_archive_unavailable', {
                archive_id: current.id,
                request_event_rowid: Number(current.request_event_rowid),
                relative_path: current.relative_path,
                availability,
                reason,
                resulting_status: resultingStatus,
              })
            }
          }
          db.prepare(`UPDATE mission_archives
            SET availability = ?, availability_reason = ?, last_reconciled_at = ?,
              last_observed_file_identity = ?
            WHERE id = ?`).run(
            availability,
            reason,
            observedAt,
            observation.fileIdentity === null
              ? null
              : JSON.stringify(observation.fileIdentity),
            current.id,
          )
        })
        applyObservation.immediate()
        if (reason !== null) unavailable.push({ archiveId: row.id, reason })
      }
      const remaining = exactArchiveId !== null
        ? 0
        : db.prepare(`SELECT 1 FROM mission_archives
          WHERE last_reconciled_at IS NULL OR last_reconciled_at < ? LIMIT 1`)
          .get(cycleStartedAt) === undefined ? 0 : 1
      return { inspected: rows.length, unavailable, remaining }
    },
  })
}

/** Produces a deterministic, collision-resistant legacy registry identity. */
function legacyArchiveId(eventRowid, archivePath) {
  return `legacy-v1-${createHash('sha256')
    .update(String(eventRowid), 'ascii')
    .update('\0', 'ascii')
    .update(archivePath, 'utf8')
    .digest('hex')}`
}

/** Reads one durable legacy archive backfill boundary without scanning mission evidence. */
function readLegacyArchiveBackfillBoundary(db, key) {
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)
  if (row === undefined) return null
  if (typeof row.value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(row.value)) {
    return Number.NaN
  }
  const value = Number(row.value)
  return Number.isSafeInteger(value) ? value : Number.NaN
}

/** Captures the fixed upper row identity for one legacy archive backfill generation. */
function readLegacyArchiveBackfillTarget(db) {
  const row = db.prepare(`SELECT rowid AS target_rowid FROM mission_events
    ORDER BY rowid DESC LIMIT 1`).get()
  const target = Number(row?.target_rowid ?? 0)
  if (!Number.isSafeInteger(target) || target < 0) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_STATE',
      'Legacy archive backfill target is outside the supported row identity range.',
    )
  }
  return target
}

/** Writes one durable legacy archive backfill boundary. */
function writeLegacyArchiveBackfillBoundary(db, key, value) {
  db.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value))
}

/** Returns whether fixed legacy archive backfill work remains from metadata alone. */
function readLegacyArchiveRegistryBackfillPending(db) {
  const cursor = readLegacyArchiveBackfillBoundary(
    db,
    LEGACY_ARCHIVE_BACKFILL_CURSOR_KEY,
  )
  const target = readLegacyArchiveBackfillBoundary(
    db,
    LEGACY_ARCHIVE_BACKFILL_TARGET_KEY,
  )
  if (cursor === null || target === null
    || !Number.isSafeInteger(cursor) || !Number.isSafeInteger(target)
    || cursor > target) return 1
  return cursor < target ? 1 : 0
}

/** Records one bounded legacy archive issue without retaining unsafe historical details. */
function recordLegacyArchiveRegistryIssue(db, event, reasonCode) {
  const key = `legacy_archive_registry_issue:${Number(event.event_rowid)}`
  const value = JSON.stringify({
    eventRowid: Number(event.event_rowid),
    eventId: event.id,
    missionId: event.mission_id,
    reasonCode,
    detectedAt: new Date().toISOString(),
  })
  return db.prepare('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)')
    .run(key, value).changes
}

/** Registers one bounded raw-row page of pre-encryption v1 archive evidence. */
function backfillLegacyArchiveRegistry(db, input) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_DATABASE',
      'Legacy archive backfill requires an open better-sqlite3 database.',
    )
  }
  const archiveDirectory = path.resolve(normalizeText(
    input?.archiveDirectory,
    'Archive directory',
    8_192,
  ))
  const limit = input?.limit ?? LEGACY_ARCHIVE_BACKFILL_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LEGACY_ARCHIVE_BACKFILL_LIMIT) {
    throw new ArchiveRegistryError(
      'ARCHIVE_REGISTRY_INVALID_INPUT',
      `Legacy archive backfill limit must be between 1 and ${LEGACY_ARCHIVE_BACKFILL_LIMIT}.`,
    )
  }
  const transaction = db.transaction(() => {
    let cursor = readLegacyArchiveBackfillBoundary(
      db,
      LEGACY_ARCHIVE_BACKFILL_CURSOR_KEY,
    )
    let target = readLegacyArchiveBackfillBoundary(
      db,
      LEGACY_ARCHIVE_BACKFILL_TARGET_KEY,
    )
    if (cursor === null) {
      cursor = 0
      writeLegacyArchiveBackfillBoundary(
        db,
        LEGACY_ARCHIVE_BACKFILL_CURSOR_KEY,
        cursor,
      )
    }
    if (target === null) {
      target = readLegacyArchiveBackfillTarget(db)
      writeLegacyArchiveBackfillBoundary(
        db,
        LEGACY_ARCHIVE_BACKFILL_TARGET_KEY,
        target,
      )
    }
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_STATE',
        'Legacy archive backfill cursor is invalid.',
      )
    }
    if (!Number.isSafeInteger(target) || target < 0 || cursor > target) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_STATE',
        'Legacy archive backfill target is invalid or precedes its cursor.',
      )
    }
    if (cursor === target) {
      return { processed: 0, quarantined: 0, remaining: 0 }
    }

    const rawBoundary = db.prepare(`SELECT rowid AS event_rowid FROM mission_events
      WHERE rowid > ? AND rowid <= ?
      ORDER BY rowid ASC LIMIT 1 OFFSET ?`).get(
      cursor,
      target,
      LEGACY_ARCHIVE_BACKFILL_SCAN_ROWS - 1,
    )
    const scanEnd = rawBoundary === undefined
      ? target
      : Number(rawBoundary.event_rowid)
    if (!Number.isSafeInteger(scanEnd) || scanEnd <= cursor || scanEnd > target) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_STATE',
        'Legacy archive backfill raw-row boundary is invalid.',
      )
    }
    const page = db.prepare(`SELECT rowid AS event_rowid, id, mission_id, event_type,
        timestamp, details_json
      FROM mission_events
      WHERE rowid > ? AND rowid <= ? AND event_type IN (?, ?)
      ORDER BY rowid ASC LIMIT ?`).all(
      cursor,
      scanEnd,
      ...LEGACY_ARCHIVE_EVENT_TYPES,
      limit,
    )
    let processed = 0
    let quarantined = 0
    for (const event of page) {
      let details
      try {
        details = parseEventDetails(event.details_json, 'Legacy archive event')
      } catch {
        quarantined += recordLegacyArchiveRegistryIssue(
          db,
          event,
          'malformed_event_details',
        )
        continue
      }
      if (typeof details.archive_path !== 'string' || details.archive_path.trim() === '') {
        quarantined += recordLegacyArchiveRegistryIssue(
          db,
          event,
          'missing_archive_path',
        )
        continue
      }
      let relativePath
      try {
        relativePath = legacyRelativePath(archiveDirectory, details.archive_path)
      } catch (error) {
        quarantined += recordLegacyArchiveRegistryIssue(
          db,
          event,
          error?.code === 'ARCHIVE_REGISTRY_LEGACY_PATH_OUTSIDE_CUSTODY'
            ? 'path_outside_current_custody'
            : 'invalid_archive_path',
        )
        continue
      }
      const archiveId = legacyArchiveId(event.event_rowid, details.archive_path)
      const requestEventRowid = Number(event.event_rowid)
      const archiveKind = details.archive_kind === 'finalized_recovery'
        ? 'finalized_recovery'
        : event.event_type === 'mission_archive_succeeded' ? 'finalized' : 'direct'
      const protectedFinalizationEpoch = archiveKind === 'finalized_recovery'
        && Number.isSafeInteger(details.finalization_epoch)
        && details.finalization_epoch > 0
        ? details.finalization_epoch
        : null
      const result = db.prepare(`INSERT OR IGNORE INTO mission_archives (
        id, mission_id, request_event_rowid, request_event_id,
        creation_operation_id, protected_finalization_epoch,
        archive_kind, container_version,
        relative_path, ciphertext_sha256, size_bytes, created_at, sealed_event_id,
        verified_at, verification_proof_json, previous_archive_id, status, slots_json,
        availability, availability_reason, last_reconciled_at,
        last_observed_file_identity, last_non_machine_unwrap_at, legacy_event_rowid
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, 'sealed',
        '[]', 'unknown', NULL, NULL, NULL, NULL, ?)`)
        .run(
          archiveId,
          event.mission_id,
          requestEventRowid,
          event.id,
          protectedFinalizationEpoch,
          archiveKind,
          relativePath,
          event.timestamp,
          event.id,
          event.event_rowid,
        )
      processed += result.changes
    }
    const lastEventRowid = page.length === 0 ? null : Number(page.at(-1).event_rowid)
    if (lastEventRowid !== null
      && (!Number.isSafeInteger(lastEventRowid)
        || lastEventRowid <= cursor
        || lastEventRowid > scanEnd)) {
      throw new ArchiveRegistryError(
        'ARCHIVE_REGISTRY_INVALID_STATE',
        'Legacy archive backfill event page did not advance monotonically.',
      )
    }
    const nextCursor = page.length === limit && lastEventRowid < scanEnd
      ? lastEventRowid
      : scanEnd
    writeLegacyArchiveBackfillBoundary(
      db,
      LEGACY_ARCHIVE_BACKFILL_CURSOR_KEY,
      nextCursor,
    )
    return {
      processed,
      quarantined,
      remaining: nextCursor < target ? 1 : 0,
    }
  })
  return transaction.immediate()
}

module.exports = {
  LEGACY_ARCHIVE_BACKFILL_LIMIT,
  ArchiveRegistryError,
  backfillLegacyArchiveRegistry,
  createArchiveRegistry,
  readLegacyArchiveRegistryBackfillPending,
}
