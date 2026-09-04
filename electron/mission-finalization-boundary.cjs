'use strict'

const { createHash } = require('node:crypto')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Derives one stable UUID-shaped lifecycle event identity from an archive identity. */
function deriveArchiveLifecycleEventId(archiveId, kind) {
  if (!UUID_V4.test(archiveId ?? '') || typeof kind !== 'string' || kind.length < 1) {
    throw new Error('Archive lifecycle event identity input is invalid.')
  }
  const digest = createHash('sha256')
    .update(`sartracker-archive-lifecycle:${kind}:${archiveId}`, 'utf8')
    .digest('hex')
  const bytes = digest.slice(0, 32).split('')
  bytes[12] = '4'
  bytes[16] = ['8', '9', 'a', 'b'][Number.parseInt(bytes[16], 16) % 4]
  return `${bytes.slice(0, 8).join('')}-${bytes.slice(8, 12).join('')}-${bytes.slice(12, 16).join('')}-${bytes.slice(16, 20).join('')}-${bytes.slice(20).join('')}`
}

/** Reads the current non-superseded archive boundary from its compact registry. */
function readCurrentArchive(db, missionId) {
  return db.prepare(`SELECT id, mission_id, protected_finalization_epoch,
      archive_kind, container_version, status
    FROM mission_archives
    WHERE mission_id = ?
      AND archive_kind IN ('finalized', 'finalized_recovery')
      AND status != 'superseded'
    ORDER BY request_event_rowid DESC, id DESC LIMIT 1`).get(missionId)
}

/** Parses a bounded finalization event document without reflecting corrupt content. */
function parseFinalizationDetails(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 4 * 1024 * 1024) return null
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Projects one validated event row into the stable current-boundary shape. */
function projectBoundary(row, archive, usedLegacyScan) {
  const eventRowid = Number(row?.event_rowid)
  const details = parseFinalizationDetails(row?.details_json)
  if (!Number.isSafeInteger(eventRowid) || eventRowid < 1
    || typeof row?.id !== 'string' || row.id.length < 1
    || row.mission_id !== archive.mission_id
    || row.event_type !== 'mission_finalized'
    || details === null) return null
  const archiveKind = archive.archive_kind
  const containerVersion = Number(archive.container_version)
  if (!['finalized', 'finalized_recovery'].includes(archiveKind)
    || ![1, 2].includes(containerVersion)
    || details.resulting_status !== 'finalized') return null
  const requiresV2Projection = archiveKind === 'finalized' && containerVersion === 2
  const hasV2Projection = details.container_version === 2
  if (requiresV2Projection && !hasV2Projection) return null
  if (archiveKind === 'finalized' && containerVersion === 1
    && details.container_version !== undefined && details.container_version !== 1) return null
  let finalizationArchiveId = null
  let cleanupMembershipGeneration = null
  if (hasV2Projection) {
    finalizationArchiveId = details.archive_id
    cleanupMembershipGeneration = details.cleanup_membership_generation
    if (!UUID_V4.test(finalizationArchiveId ?? '')
      || row.id !== deriveArchiveLifecycleEventId(finalizationArchiveId, 'mission-finalized')
      || details.archive_relative_path !== `${finalizationArchiveId}.sararch`
      || !Number.isSafeInteger(cleanupMembershipGeneration)
      || cleanupMembershipGeneration < 0
      || (requiresV2Projection && finalizationArchiveId !== archive.id)) return null
  } else if (details.archive_path !== undefined
    && (typeof details.archive_path !== 'string' || details.archive_path.length < 1
      || Buffer.byteLength(details.archive_path, 'utf8') > 8_192)) {
    return null
  }
  return Object.freeze({
    archiveId: archive.id,
    archiveKind,
    containerVersion,
    eventId: row.id,
    eventRowid,
    finalizationArchiveId,
    cleanupMembershipGeneration,
    details: Object.freeze(details),
    usedLegacyScan,
  })
}

/** Resolves one exact protected finalization row without scanning mission history. */
function readMissionFinalizationBoundaryByEpoch(db, input) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function'
    || input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.missionId !== 'string' || input.missionId.length < 1
    || Buffer.byteLength(input.missionId, 'utf8') > 200
    || !Number.isSafeInteger(input.eventRowid) || input.eventRowid < 1) {
    throw new Error('Mission finalization boundary input is invalid.')
  }
  const row = db.prepare(`SELECT rowid AS event_rowid, id, mission_id, event_type,
      details_json FROM mission_events WHERE rowid = ?`).get(input.eventRowid)
  const details = parseFinalizationDetails(row?.details_json)
  const containerVersion = details?.container_version === 2 ? 2 : 1
  const archiveId = containerVersion === 2 && typeof details.archive_id === 'string'
    ? details.archive_id
    : ''
  return projectBoundary(row, {
    id: archiveId,
    mission_id: input.missionId,
    archive_kind: 'finalized',
    container_version: containerVersion,
  }, false)
}

/** Resolves one v2 finalization projection embedded before its registry row existed. */
function readV2MissionFinalizationBoundaryByArchiveId(db, input) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function'
    || input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.missionId !== 'string' || input.missionId.length < 1
    || Buffer.byteLength(input.missionId, 'utf8') > 200
    || typeof input.archiveId !== 'string' || !UUID_V4.test(input.archiveId)) {
    throw new Error('Mission finalization boundary input is invalid.')
  }
  const eventId = deriveArchiveLifecycleEventId(input.archiveId, 'mission-finalized')
  const row = db.prepare(`SELECT rowid AS event_rowid, id, mission_id, event_type,
      details_json FROM mission_events WHERE id = ?`).get(eventId)
  return projectBoundary(row, {
    id: input.archiveId,
    mission_id: input.missionId,
    archive_kind: 'finalized',
    container_version: 2,
  }, false)
}

/**
 * Resolves current finalization state without scanning a v2 mission's historical events.
 * Legacy v1 state retains its old scan fallback until its bounded registry migration settles.
 */
function readCurrentMissionFinalizationBoundary(db, input) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function'
    || input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.missionId !== 'string' || input.missionId.length < 1
    || Buffer.byteLength(input.missionId, 'utf8') > 200
    || (input.archiveId !== undefined && (
      typeof input.archiveId !== 'string' || input.archiveId.length < 1
      || Buffer.byteLength(input.archiveId, 'utf8') > 200
    ))) {
    throw new Error('Mission finalization boundary input is invalid.')
  }
  const currentArchive = readCurrentArchive(db, input.missionId)
  if (input.archiveId !== undefined && currentArchive?.id !== input.archiveId) return null
  if (currentArchive === undefined) {
    if (input.archiveId !== undefined) return null
    const legacy = db.prepare(`SELECT rowid AS event_rowid, id, mission_id, event_type,
        details_json FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_finalized'
      ORDER BY rowid DESC LIMIT 1`).get(input.missionId)
    if (legacy === undefined) return null
    return projectBoundary(legacy, {
      id: parseFinalizationDetails(legacy.details_json)?.archive_id ?? '',
      mission_id: input.missionId,
      archive_kind: 'finalized',
      container_version: 1,
    }, true)
  }

  if (Number(currentArchive.container_version) === 2
    && currentArchive.archive_kind === 'finalized') {
    return readV2MissionFinalizationBoundaryByArchiveId(db, {
      missionId: currentArchive.mission_id,
      archiveId: currentArchive.id,
    })
  }
  if (currentArchive.archive_kind === 'finalized_recovery') {
    const protectedEpoch = Number(currentArchive.protected_finalization_epoch)
    if (!Number.isSafeInteger(protectedEpoch) || protectedEpoch < 1) return null
    const row = db.prepare(`SELECT rowid AS event_rowid, id, mission_id, event_type,
        details_json FROM mission_events WHERE rowid = ?`).get(protectedEpoch)
    return projectBoundary(row, currentArchive, false)
  }

  const legacy = db.prepare(`SELECT rowid AS event_rowid, id, mission_id, event_type,
      details_json FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(input.missionId)
  return legacy === undefined ? null : projectBoundary(legacy, currentArchive, true)
}

module.exports = {
  deriveArchiveLifecycleEventId,
  readCurrentMissionFinalizationBoundary,
  readMissionFinalizationBoundaryByEpoch,
  readV2MissionFinalizationBoundaryByArchiveId,
}
