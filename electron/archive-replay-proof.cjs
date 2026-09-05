'use strict'

const { createHash } = require('node:crypto')

const { canonicalJson } = require('./archive-container.cjs')
const {
  readMissionReplayFilterPage,
  readMissionReplayObjectChunk,
  readMissionReplayState,
  readMissionReplayTrackChunk,
} = require('./mission-replay-query.cjs')

const MAX_REPLAY_SAMPLES = 5
const TRACK_PAGE_LIMIT = 64
const OBJECT_PAGE_LIMIT = 32

/** Signals that production replay queries could not prove archive semantics. */
class ArchiveReplayProofError extends Error {
  /** Creates a stable replay proof failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveReplayProofError'
    this.code = code
  }
}

/** Adds one canonical past-or-present sample timestamp to the proof set. */
function addSample(samples, value) {
  if (value === null || value === undefined) return
  if (
    typeof value !== 'string'
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
    || Date.parse(value) > Date.now()
  ) {
    throw new ArchiveReplayProofError(
      'ARCHIVE_REPLAY_SAMPLE_INVALID',
      'Mission archive replay evidence contains an invalid sample timestamp.',
    )
  }
  samples.add(value)
  if (samples.size > MAX_REPLAY_SAMPLES) {
    throw new ArchiveReplayProofError(
      'ARCHIVE_REPLAY_SAMPLE_LIMIT',
      'Mission archive replay proof exceeds the supported deterministic sample bound.',
    )
  }
}

/** Computes a canonical midpoint strictly inside one valid time range. */
function midpointTimestamp(start, end) {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs + 1) return null
  return new Date(startMs + Math.floor((endMs - startMs) / 2)).toISOString()
}

/** Enumerates the binding deterministic replay sample set for one mission. */
function listReplaySampleTimes(db, missionId, requestEventId, archiveKind) {
  const mission = db.prepare(`SELECT start_time, finish_time FROM missions WHERE id = ?`).get(missionId)
  if (mission === undefined) {
    throw new ArchiveReplayProofError(
      'ARCHIVE_REPLAY_SCOPE_INVALID',
      'Mission archive replay proof cannot find its mission.',
    )
  }
  const expectedEventType = archiveKind === 'finalized'
    ? 'mission_finalize_requested'
    : 'mission_archive_requested'
  const requestEvent = db.prepare(`SELECT timestamp FROM mission_events
    WHERE id = ? AND mission_id = ? AND event_type = ?`).get(
    requestEventId,
    missionId,
    expectedEventType,
  )
  if (requestEvent === undefined) {
    throw new ArchiveReplayProofError(
      'ARCHIVE_REPLAY_SCOPE_INVALID',
      'Mission archive replay proof cannot find its bound request event.',
    )
  }
  const startMs = Date.parse(mission.start_time)
  const finishMs = mission.finish_time === null ? null : Date.parse(mission.finish_time)
  const fenceMs = Date.parse(requestEvent.timestamp)
  if (!Number.isFinite(startMs) || !Number.isFinite(fenceMs)
    || (finishMs !== null && (!Number.isFinite(finishMs) || finishMs < startMs))
    || fenceMs < (finishMs ?? startMs)) {
    throw new ArchiveReplayProofError(
      'ARCHIVE_REPLAY_SAMPLE_INVALID',
      'Mission archive replay boundaries are not chronologically valid.',
    )
  }
  const samples = new Set()
  addSample(samples, mission.start_time)
  if (mission.finish_time !== null) {
    addSample(samples, midpointTimestamp(mission.start_time, mission.finish_time))
    addSample(samples, mission.finish_time)
    addSample(samples, midpointTimestamp(mission.finish_time, requestEvent.timestamp))
  } else {
    addSample(samples, midpointTimestamp(mission.start_time, requestEvent.timestamp))
  }
  addSample(samples, requestEvent.timestamp)
  return Object.freeze([...samples].sort())
}

/** Removes generation-bound cursors while retaining the semantic state projection. */
function normalizeReplayState(state) {
  const {
    availableOutingIds: _availableOutingIds,
    availableOutingTotalCount: _availableOutingTotalCount,
    replayGeneration: _replayGeneration,
    objectCursor: _objectCursor,
    nextObjectCursor: _nextObjectCursor,
    trackCursor: _trackCursor,
    previousCursor: _previousCursor,
    nextCursor: _nextCursor,
    availableOutingNextCursor: _availableOutingNextCursor,
    progress: _progress,
    objects: _objects,
    tracks: _tracks,
    ...semanticState
  } = state
  return {
    ...semanticState,
    limitations: semanticState.limitations
      .filter((limitation) =>
        !['legacy_event_replay_scan_fallback', 'legacy_replay_scan_fallback'].includes(
          limitation.code,
        ))
      .map(({ message: _message, ...semanticLimitation }) => semanticLimitation),
  }
}

/** Adds one length-delimited canonical projection to a streaming semantic digest. */
function updateSemanticDigest(hash, label, value) {
  const labelBytes = Buffer.from(label, 'utf8')
  const valueBytes = Buffer.from(canonicalJson(value), 'utf8')
  const lengths = Buffer.alloc(8)
  lengths.writeUInt32BE(labelBytes.length, 0)
  lengths.writeUInt32BE(valueBytes.length, 4)
  hash.update(lengths)
  hash.update(labelBytes)
  hash.update(valueBytes)
}

/** Reads and incrementally hashes every bounded production replay page for one selected time. */
function digestReplaySample(db, missionId, selectedTime, isCancelled, onPage) {
  const input = {
    missionId,
    selectedTime,
    trackLimit: TRACK_PAGE_LIMIT,
    objectLimit: OBJECT_PAGE_LIMIT,
  }
  const state = readMissionReplayState(db, input)
  const semanticHash = createHash('sha256')
  updateSemanticDigest(semanticHash, 'state', normalizeReplayState(state))
  let trackCount = 0
  let objectCount = 0
  let outingFilterCount = 0
  const outingFilterIds = new Set()
  for (const object of state.objects) {
    updateSemanticDigest(semanticHash, 'object', object)
    objectCount += 1
  }
  for (const track of state.tracks) {
    updateSemanticDigest(semanticHash, 'track', track)
    trackCount += 1
  }
  const initialOutingIds = Array.isArray(state.availableOutingIds)
    ? state.availableOutingIds
    : []
  const totalOutingFilterCount = Number.isSafeInteger(state.availableOutingTotalCount)
    ? state.availableOutingTotalCount
    : initialOutingIds.length
  for (const outingId of initialOutingIds) {
    if (outingFilterIds.has(outingId)) {
      throw new ArchiveReplayProofError(
        'ARCHIVE_REPLAY_TOTAL_MISMATCH',
        'Mission archive Replay outing choices contain a duplicate identity.',
      )
    }
    outingFilterIds.add(outingId)
    updateSemanticDigest(semanticHash, 'outing-filter-choice', outingId)
    outingFilterCount += 1
  }
  const initialRows = trackCount + objectCount + outingFilterCount
  if (initialRows > 0) onPage?.(initialRows)
  const seenTrackCursors = new Set()
  let nextTrackCursor = state.nextCursor
  while (nextTrackCursor !== null) {
    if (seenTrackCursors.has(nextTrackCursor)) {
      throw new ArchiveReplayProofError(
        'ARCHIVE_REPLAY_CURSOR_CYCLE',
        'Mission archive replay track paging repeated a cursor.',
      )
    }
    seenTrackCursors.add(nextTrackCursor)
    if (isCancelled?.()) throw new ArchiveReplayProofError('ARCHIVE_CANCELLED', 'Mission archive verification was cancelled.')
    const page = readMissionReplayTrackChunk(db, { ...input, cursor: nextTrackCursor })
    for (const track of page.tracks) {
      updateSemanticDigest(semanticHash, 'track', track)
      trackCount += 1
    }
    if (page.tracks.length > 0) onPage?.(page.tracks.length)
    if (trackCount > state.totalTrackCount
      || (page.tracks.length === 0 && page.nextCursor !== null)) {
      throw new ArchiveReplayProofError(
        'ARCHIVE_REPLAY_TOTAL_MISMATCH',
        'Mission archive replay track paging disagrees with its declared total.',
      )
    }
    nextTrackCursor = page.nextCursor
  }
  const seenObjectCursors = new Set()
  let nextObjectCursor = state.nextObjectCursor
  while (nextObjectCursor !== null) {
    if (seenObjectCursors.has(nextObjectCursor)) {
      throw new ArchiveReplayProofError(
        'ARCHIVE_REPLAY_CURSOR_CYCLE',
        'Mission archive replay object paging repeated a cursor.',
      )
    }
    seenObjectCursors.add(nextObjectCursor)
    if (isCancelled?.()) throw new ArchiveReplayProofError('ARCHIVE_CANCELLED', 'Mission archive verification was cancelled.')
    const page = readMissionReplayObjectChunk(db, {
      ...input,
      objectCursor: nextObjectCursor,
      replayGeneration: state.replayGeneration,
    })
    for (const object of page.objects) {
      updateSemanticDigest(semanticHash, 'object', object)
      objectCount += 1
    }
    if (page.objects.length > 0) onPage?.(page.objects.length)
    if (objectCount > state.totalObjectCount
      || (page.objects.length === 0 && page.nextObjectCursor !== null)) {
      throw new ArchiveReplayProofError(
        'ARCHIVE_REPLAY_TOTAL_MISMATCH',
        'Mission archive replay object paging disagrees with its declared total.',
      )
    }
    nextObjectCursor = page.nextObjectCursor
  }
  const seenOutingFilterCursors = new Set()
  let nextOutingFilterCursor = state.availableOutingNextCursor ?? null
  while (nextOutingFilterCursor !== null) {
    if (seenOutingFilterCursors.has(nextOutingFilterCursor)) {
      throw new ArchiveReplayProofError(
        'ARCHIVE_REPLAY_CURSOR_CYCLE',
        'Mission archive Replay outing-filter paging repeated a cursor.',
      )
    }
    seenOutingFilterCursors.add(nextOutingFilterCursor)
    if (isCancelled?.()) throw new ArchiveReplayProofError('ARCHIVE_CANCELLED', 'Mission archive verification was cancelled.')
    const page = readMissionReplayFilterPage(db, {
      ...input,
      filterKind: 'outing',
      filterCursor: nextOutingFilterCursor,
      filterLimit: 100,
    })
    if (page.filterKind !== 'outing' || page.search !== ''
      || page.totalCount !== totalOutingFilterCount || !Array.isArray(page.entries)) {
      throw new ArchiveReplayProofError(
        'ARCHIVE_REPLAY_TOTAL_MISMATCH',
        'Mission archive Replay outing-filter paging changed its declared scope.',
      )
    }
    for (const outingId of page.entries) {
      if (outingFilterIds.has(outingId)) {
        throw new ArchiveReplayProofError(
          'ARCHIVE_REPLAY_TOTAL_MISMATCH',
          'Mission archive Replay outing choices contain a duplicate identity.',
        )
      }
      outingFilterIds.add(outingId)
      updateSemanticDigest(semanticHash, 'outing-filter-choice', outingId)
      outingFilterCount += 1
    }
    if (page.entries.length > 0) onPage?.(page.entries.length)
    if (outingFilterCount > totalOutingFilterCount
      || (page.entries.length === 0 && page.nextCursor !== null)) {
      throw new ArchiveReplayProofError(
        'ARCHIVE_REPLAY_TOTAL_MISMATCH',
        'Mission archive Replay outing-filter paging disagrees with its declared total.',
      )
    }
    nextOutingFilterCursor = page.nextCursor
  }
  if (trackCount !== state.totalTrackCount || objectCount !== state.totalObjectCount) {
    throw new ArchiveReplayProofError(
      'ARCHIVE_REPLAY_TOTAL_MISMATCH',
      'Mission archive replay paging did not exhaust its declared rows.',
    )
  }
  if (outingFilterCount !== totalOutingFilterCount) {
    throw new ArchiveReplayProofError(
      'ARCHIVE_REPLAY_TOTAL_MISMATCH',
      'Mission archive Replay outing-filter paging did not exhaust its declared choices.',
    )
  }
  return Object.freeze({
    selected_time: selectedTime,
    semantic_sha256: semanticHash.digest('hex'),
    sampled_outing_filter_count: outingFilterCount,
    sampled_object_count: objectCount,
    sampled_track_count: trackCount,
    total_outing_filter_count: totalOutingFilterCount,
    total_object_count: state.totalObjectCount,
    total_track_count: state.totalTrackCount,
  })
}

/** Computes sampled production-query semantics inside one caller-visible DB snapshot. */
function computeMissionReplaySemanticProof(db, input) {
  if (!db || typeof db.prepare !== 'function'
    || typeof input?.missionId !== 'string' || input.missionId.length < 1
    || typeof input.requestEventId !== 'string' || input.requestEventId.length < 1
    || !['finalized', 'direct', 'finalized_recovery'].includes(input.archiveKind)
    || (input.onProgress !== undefined && typeof input.onProgress !== 'function')) {
    throw new ArchiveReplayProofError(
      'ARCHIVE_REPLAY_SCOPE_INVALID',
      'Mission archive replay proof input is invalid.',
    )
  }
  let rowsProcessed = 0
  const calculate = db.transaction(() => {
    const sampleTimes = listReplaySampleTimes(
      db,
      input.missionId,
      input.requestEventId,
      input.archiveKind,
    )
    const samples = sampleTimes.map((selectedTime, index) => {
      if (input.isCancelled?.()) {
        throw new ArchiveReplayProofError('ARCHIVE_CANCELLED', 'Mission archive verification was cancelled.')
      }
      const sample = digestReplaySample(
        db,
        input.missionId,
        selectedTime,
        input.isCancelled,
        (pageRows) => {
          if (!Number.isSafeInteger(pageRows) || pageRows < 1
            || rowsProcessed > Number.MAX_SAFE_INTEGER - pageRows) {
            throw new ArchiveReplayProofError(
              'ARCHIVE_REPLAY_PROGRESS_INVALID',
              'Mission archive replay progress exceeded exact row accounting.',
            )
          }
          rowsProcessed += pageRows
          input.onProgress?.(Object.freeze({ rowsProcessed }))
        },
      )
      input.onSample?.({ completed: index + 1, total: sampleTimes.length })
      return sample
    })
    return Object.freeze({
      proof_version: 3,
      sample_strategy: 'mission-start-finish-fence-midpoints-exhaustive-pages-and-outing-filters-v3',
      sample_count: samples.length,
      samples: Object.freeze(samples),
    })
  })
  return calculate()
}

module.exports = {
  ArchiveReplayProofError,
  computeMissionReplaySemanticProof,
  listReplaySampleTimes,
}
