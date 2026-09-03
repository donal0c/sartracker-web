/**
 * Pure CLI, CI, privacy, and evidence gates for the packaged Electron archive
 * lifecycle smoke. Runtime control remains in the adjacent scripts.
 */

import path from 'node:path'

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const SENSITIVE_ARGUMENT = /passphrase|recovery|secret|credential/iu
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const CLOSED_REVIEW_ROOT_KEYS = Object.freeze(['missions', 'replay', 'review'])
const CLOSED_REVIEW_RESULT_KEYS = Object.freeze([
  'auditEvents',
  'breadcrumbCount',
  'correctionAuthorized',
  'workerThreadId',
])
const CLOSED_REVIEW_EXCLUDED_PATHS = Object.freeze(['review.workerThreadId'])
const CLOSED_REPLAY_KEYS = Object.freeze([
  'initial',
  'objectPages',
  'outingFilterPages',
  'query',
  'trackPages',
])
const CLOSED_REPLAY_QUERY_KEYS = Object.freeze([
  'missionId',
  'objectLimit',
  'selectedTime',
  'timezone',
  'trackLimit',
])
const CLOSED_REPLAY_EXPECTED_KEYS = Object.freeze([
  'expectedBreadcrumbCount',
  'expectedObjectCount',
  'expectedOutingFilterCount',
  'missionId',
  'selectedTime',
])
const CLOSED_REPLAY_PAGE_KEYS = Object.freeze(['request', 'result'])
const CLOSED_REPLAY_TRACK_REQUEST_KEYS = Object.freeze([
  ...CLOSED_REPLAY_QUERY_KEYS,
  'cursor',
])
const CLOSED_REPLAY_OBJECT_REQUEST_KEYS = Object.freeze([
  ...CLOSED_REPLAY_QUERY_KEYS,
  'objectCursor',
  'replayGeneration',
])
const CLOSED_REPLAY_FILTER_REQUEST_KEYS = Object.freeze([
  ...CLOSED_REPLAY_QUERY_KEYS,
  'filterCursor',
  'filterKind',
  'filterLimit',
  'filterSearch',
])
const REQUIRED_CREATE_PHASES = Object.freeze([
  'snapshot',
  'encrypt',
  'publish',
  'seal',
  'staged',
])
const REQUIRED_VERIFY_PHASES = Object.freeze([
  'decrypt',
  'inventory',
  'replay',
  'plaintext_cleanup',
  'verified',
])
const REVIEW_KEYS = Object.freeze([
  'archiveIdMatched',
  'breadcrumbCount',
  'closed',
  'contentSha256',
  'denialAudited',
  'immutable',
  'mutationAttempt',
  'mutationBoundary',
  'mutationDenied',
  'openDirectoriesOwnerOnly',
  'openFilesOwnerOnly',
  'openPrivacyCanaryDetected',
  'openResidualFileCount',
  'opened',
  'plaintextResidual',
  'readMissionIdMatched',
  'replayObjectCount',
  'replayOutingFilterCount',
  'replayTrackCount',
  'residualEntriesAfterClose',
  'verified',
])

/** Requires the public addPositionsBulk result to contain every requested row. */
export function archiveLifecycleSmokeBatchInsertedEveryRow(result, expectedCount) {
  return Array.isArray(result)
    && Number.isSafeInteger(expectedCount)
    && expectedCount > 0
    && result.length === expectedCount
}

/** Validates one complete public closed Review payload without worker metadata. */
export function projectArchiveLifecycleSmokeClosedReviewSemantic(content, expected) {
  if (content === null || typeof content !== 'object' || Array.isArray(content)
    || Object.keys(content).sort().join(',') !== [...CLOSED_REVIEW_ROOT_KEYS].sort().join(',')
    || !Array.isArray(content.missions)
    || content.review === null || typeof content.review !== 'object'
    || Array.isArray(content.review)
    || content.replay === null || typeof content.replay !== 'object'
    || Array.isArray(content.replay)) {
    throw new Error('Packaged closed Review content has an invalid root shape.')
  }
  if (Object.keys(content.review).sort().join(',')
      !== [...CLOSED_REVIEW_RESULT_KEYS].sort().join(',')
    || typeof content.review.correctionAuthorized !== 'boolean'
    || !Number.isSafeInteger(content.review.workerThreadId)
    || content.review.workerThreadId < 1) {
    throw new Error('Packaged closed Review worker-session metadata is invalid.')
  }
  const semanticReview = Object.fromEntries(
    Object.entries(content.review).filter(([key]) => key !== 'workerThreadId'),
  )
  const replayCounts = validateClosedReplayEvidence(content.replay, expected)
  return Object.freeze({
    excludedPaths: CLOSED_REVIEW_EXCLUDED_PATHS,
    replayCounts,
    semantic: Object.freeze({
      missions: content.missions,
      review: Object.freeze(semanticReview),
      replay: content.replay,
    }),
  })
}

/** Validates every ordered continuation page and returns exact aggregate counts. */
function validateClosedReplayEvidence(replay, expected) {
  requireClosedReplayRecord(replay, CLOSED_REPLAY_KEYS, 'Replay evidence')
  requireClosedReplayRecord(expected, CLOSED_REPLAY_EXPECTED_KEYS, 'Replay expectation')
  const expectedMissionId = requireClosedReplayText(expected.missionId, 'expected mission')
  const expectedSelectedTime = requireClosedReplayText(
    expected.selectedTime,
    'expected selected time',
  )
  const expectedBreadcrumbCount = requireClosedReplayCount(
    expected.expectedBreadcrumbCount,
    'expected breadcrumb count',
  )
  const expectedObjectCount = requireClosedReplayCount(
    expected.expectedObjectCount,
    'expected object count',
  )
  const expectedOutingFilterCount = requireClosedReplayCount(
    expected.expectedOutingFilterCount,
    'expected outing-filter count',
  )
  const query = requireClosedReplayRecord(
    replay.query,
    CLOSED_REPLAY_QUERY_KEYS,
    'Replay query',
  )
  if (query.missionId !== expectedMissionId) {
    throw new Error('Packaged Replay query mission does not match the closed Review mission.')
  }
  if (query.selectedTime !== expectedSelectedTime) {
    throw new Error('Packaged Replay query selected time does not match the closed Review time.')
  }
  if (query.timezone !== 'Europe/Dublin'
    || !Number.isSafeInteger(query.trackLimit) || query.trackLimit < 1 || query.trackLimit > 1_000
    || !Number.isSafeInteger(query.objectLimit) || query.objectLimit < 1
    || query.objectLimit > 100) {
    throw new Error('Packaged Replay query bounds are invalid.')
  }
  const initial = requireClosedReplayRecord(replay.initial, null, 'Replay initial result')
  assertClosedReplayInitialContext(initial, query, {
    expectedBreadcrumbCount,
    expectedObjectCount,
    expectedOutingFilterCount,
  })
  const trackPages = requireClosedReplayArray(replay.trackPages, 'Replay track pages')
  const objectPages = requireClosedReplayArray(replay.objectPages, 'Replay object pages')
  const outingFilterPages = requireClosedReplayArray(
    replay.outingFilterPages,
    'Replay outing-filter pages',
  )
  const trackRows = validateClosedReplayTrackPages(initial, trackPages, query)
  const objectRows = validateClosedReplayObjectPages(initial, objectPages, query)
  const outingFilterEntries = validateClosedReplayFilterPages(
    initial,
    outingFilterPages,
    query,
  )
  return Object.freeze({
    objectPages: objectPages.length,
    objectRows,
    outingFilterEntries,
    outingFilterPages: outingFilterPages.length,
    trackPages: trackPages.length,
    trackRows,
  })
}

/** Requires initial Replay scope, generation, totals, and first-page cursors. */
function assertClosedReplayInitialContext(initial, query, expected) {
  if (initial.missionId !== query.missionId) {
    throw new Error('Packaged Replay initial mission does not match its query.')
  }
  if (initial.selectedTime !== query.selectedTime) {
    throw new Error('Packaged Replay initial selected time does not match its query.')
  }
  if (initial.timezone !== query.timezone) {
    throw new Error('Packaged Replay initial timezone does not match its query.')
  }
  requireClosedReplayCount(initial.replayGeneration, 'Replay generation', { allowZero: true })
  const trackTotal = requireClosedReplayCount(initial.totalTrackCount, 'Replay track total', {
    allowZero: true,
  })
  if (trackTotal !== expected.expectedBreadcrumbCount) {
    throw new Error('Packaged Replay track total does not equal every seeded breadcrumb.')
  }
  const objectTotal = requireClosedReplayCount(
    initial.totalObjectCount,
    'Replay object total',
    { allowZero: true },
  )
  if (objectTotal !== expected.expectedObjectCount) {
    throw new Error('Packaged Replay object total does not equal every seeded object.')
  }
  const outingFilterTotal = requireClosedReplayCount(
    initial.availableOutingTotalCount,
    'Replay outing-filter total',
    { allowZero: true },
  )
  if (outingFilterTotal !== expected.expectedOutingFilterCount) {
    throw new Error('Packaged Replay outing-filter total does not equal every seeded outing choice.')
  }
  if (initial.trackCursor !== '0' || initial.objectCursor !== '0'
    || initial.previousCursor !== null) {
    throw new Error('Packaged Replay initial page offsets are invalid.')
  }
  requireClosedReplayCursor(initial.nextCursor, 'Replay next track cursor')
  requireClosedReplayCursor(initial.nextObjectCursor, 'Replay next object cursor')
  requireClosedReplayCursor(
    initial.availableOutingNextCursor,
    'Replay next outing-filter cursor',
  )
  const initialTracks = requireClosedReplayArray(initial.tracks, 'Replay initial tracks')
  const initialObjects = requireClosedReplayArray(initial.objects, 'Replay initial objects')
  const initialOutingFilters = requireClosedReplayArray(
    initial.availableOutingIds,
    'Replay initial outing filters',
  )
  if (initialTracks.length === 0 && initial.nextCursor !== null) {
    throw new Error('Packaged Replay initial track page is empty before its terminal cursor.')
  }
  if (initialObjects.length === 0 && initial.nextObjectCursor !== null) {
    throw new Error('Packaged Replay initial object page is empty before its terminal cursor.')
  }
  if (initialOutingFilters.length === 0 && initial.availableOutingNextCursor !== null) {
    throw new Error('Packaged Replay initial outing-filter page is empty before its terminal cursor.')
  }
}

/** Exhaustively validates exact-track page scope, cursor chain, order, and identities. */
function validateClosedReplayTrackPages(initial, pages, query) {
  const total = initial.totalTrackCount
  const identities = new Set()
  let previousOrder = null
  let count = 0
  const acceptRows = (rows) => {
    for (const row of rows) {
      const identity = requireClosedReplayText(row?.evidence_id, 'Replay track identity')
      if (identities.has(identity)) throw new Error('Packaged Replay contains a duplicate track identity.')
      identities.add(identity)
      const order = closedReplayTrackOrder(row)
      if (previousOrder !== null && compareClosedReplayOrder(previousOrder, order) >= 0) {
        throw new Error('Packaged Replay track rows changed deterministic order.')
      }
      previousOrder = order
      count += 1
      if (count > total) throw new Error('Packaged Replay track rows overrun their declared total.')
    }
  }
  if (initial.tracks.length > query.trackLimit) {
    throw new Error('Packaged Replay initial track page exceeds its requested bound.')
  }
  acceptRows(initial.tracks)
  let cursor = initial.nextCursor
  const seenCursors = new Set()
  for (const page of pages) {
    if (cursor === null) throw new Error('Packaged Replay track pages continue after terminal cursor.')
    if (count >= total) throw new Error('Packaged Replay track pages continue after their declared total.')
    if (seenCursors.has(cursor)) throw new Error('Packaged Replay track cursor cycle was detected.')
    seenCursors.add(cursor)
    const wrapper = requireClosedReplayRecord(page, CLOSED_REPLAY_PAGE_KEYS, 'Replay track page')
    assertClosedReplayPageRequest(
      wrapper.request,
      CLOSED_REPLAY_TRACK_REQUEST_KEYS,
      query,
      { cursor },
      'track',
    )
    const result = requireClosedReplayRecord(wrapper.result, null, 'Replay track result')
    if (result.missionId !== query.missionId) throw new Error('Packaged Replay track page mission changed.')
    if (result.selectedTime !== query.selectedTime) {
      throw new Error('Packaged Replay track page selected time changed.')
    }
    if (result.totalTrackCount !== total) throw new Error('Packaged Replay track page total changed.')
    if (result.trackCursor !== String(count)) throw new Error('Packaged Replay track page order offset changed.')
    const previousCursor = requireClosedReplayCursor(
      result.previousCursor,
      'Replay previous track cursor',
    )
    if (previousCursor === null) {
      throw new Error('Packaged Replay continuation previous track cursor is missing.')
    }
    const rows = requireClosedReplayArray(result.tracks, 'Replay track page rows')
    if (rows.length > query.trackLimit) {
      throw new Error('Packaged Replay track page exceeds its requested bound.')
    }
    const nextCursor = requireClosedReplayCursor(result.nextCursor, 'Replay next track cursor')
    if (rows.length === 0 && nextCursor !== null) {
      throw new Error('Packaged Replay track page is empty before its terminal cursor.')
    }
    acceptRows(rows)
    if (nextCursor !== null && seenCursors.has(nextCursor)) {
      throw new Error('Packaged Replay track cursor cycle was detected.')
    }
    cursor = nextCursor
  }
  if (cursor !== null) throw new Error('Packaged Replay track paging is partial and nonterminal.')
  if (count !== total) throw new Error('Packaged Replay track paging did not exhaust its total.')
  return count
}

/** Exhaustively validates object page scope, generation, order, and identities. */
function validateClosedReplayObjectPages(initial, pages, query) {
  const total = initial.totalObjectCount
  const generation = initial.replayGeneration
  const identities = new Set()
  let previousOrder = null
  let count = 0
  const acceptRows = (rows) => {
    for (const row of rows) {
      const objectType = requireClosedReplayText(row?.object_type, 'Replay object type')
      const objectId = requireClosedReplayText(row?.object_id, 'Replay object identity')
      const identity = `${objectType}\u0000${objectId}`
      if (identities.has(identity)) throw new Error('Packaged Replay contains a duplicate object identity.')
      identities.add(identity)
      const order = [objectType, objectId]
      if (previousOrder !== null && compareClosedReplayOrder(previousOrder, order) >= 0) {
        throw new Error('Packaged Replay object rows changed deterministic order.')
      }
      previousOrder = order
      count += 1
      if (count > total) throw new Error('Packaged Replay object rows overrun their declared total.')
    }
  }
  if (initial.objects.length > query.objectLimit) {
    throw new Error('Packaged Replay initial object page exceeds its requested bound.')
  }
  acceptRows(initial.objects)
  let cursor = initial.nextObjectCursor
  const seenCursors = new Set()
  for (const page of pages) {
    if (cursor === null) throw new Error('Packaged Replay object pages continue after terminal cursor.')
    if (count >= total) throw new Error('Packaged Replay object pages continue after their declared total.')
    if (seenCursors.has(cursor)) throw new Error('Packaged Replay object cursor cycle was detected.')
    seenCursors.add(cursor)
    const wrapper = requireClosedReplayRecord(page, CLOSED_REPLAY_PAGE_KEYS, 'Replay object page')
    assertClosedReplayPageRequest(
      wrapper.request,
      CLOSED_REPLAY_OBJECT_REQUEST_KEYS,
      query,
      { objectCursor: cursor, replayGeneration: generation },
      'object',
    )
    const result = requireClosedReplayRecord(wrapper.result, null, 'Replay object result')
    if (result.missionId !== query.missionId) throw new Error('Packaged Replay object page mission changed.')
    if (result.selectedTime !== query.selectedTime) {
      throw new Error('Packaged Replay object page selected time changed.')
    }
    if (result.replayGeneration !== generation) {
      throw new Error('Packaged Replay object page generation changed.')
    }
    if (result.totalObjectCount !== total) throw new Error('Packaged Replay object page total changed.')
    if (result.objectCursor !== String(count)) throw new Error('Packaged Replay object page order offset changed.')
    const rows = requireClosedReplayArray(result.objects, 'Replay object page rows')
    if (rows.length > query.objectLimit) {
      throw new Error('Packaged Replay object page exceeds its requested bound.')
    }
    const nextCursor = requireClosedReplayCursor(
      result.nextObjectCursor,
      'Replay next object cursor',
    )
    if (rows.length === 0 && nextCursor !== null) {
      throw new Error('Packaged Replay object page is empty before its terminal cursor.')
    }
    acceptRows(rows)
    if (nextCursor !== null && seenCursors.has(nextCursor)) {
      throw new Error('Packaged Replay object cursor cycle was detected.')
    }
    cursor = nextCursor
  }
  if (cursor !== null) throw new Error('Packaged Replay object paging is partial and nonterminal.')
  if (count !== total) throw new Error('Packaged Replay object paging did not exhaust its total.')
  return count
}

/** Exhaustively validates outing-filter page scope, order, and unique choices. */
function validateClosedReplayFilterPages(initial, pages, query) {
  const total = initial.availableOutingTotalCount
  const identities = new Set()
  let previousIdentity = null
  let count = 0
  const acceptEntries = (entries) => {
    for (const entry of entries) {
      const identity = requireClosedReplayText(entry, 'Replay outing-filter identity')
      if (identities.has(identity)) throw new Error('Packaged Replay contains a duplicate outing identity.')
      if (previousIdentity !== null && previousIdentity >= identity) {
        throw new Error('Packaged Replay outing-filter entries changed deterministic order.')
      }
      identities.add(identity)
      previousIdentity = identity
      count += 1
      if (count > total) {
        throw new Error('Packaged Replay outing-filter entries overrun their declared total.')
      }
    }
  }
  if (initial.availableOutingIds.length > 100) {
    throw new Error('Packaged Replay initial outing-filter page exceeds its requested bound.')
  }
  acceptEntries(initial.availableOutingIds)
  let cursor = initial.availableOutingNextCursor
  const seenCursors = new Set()
  for (const page of pages) {
    if (cursor === null) {
      throw new Error('Packaged Replay outing-filter pages continue after terminal cursor.')
    }
    if (count >= total) {
      throw new Error('Packaged Replay outing-filter pages continue after their declared total.')
    }
    if (seenCursors.has(cursor)) {
      throw new Error('Packaged Replay outing-filter cursor cycle was detected.')
    }
    seenCursors.add(cursor)
    const wrapper = requireClosedReplayRecord(
      page,
      CLOSED_REPLAY_PAGE_KEYS,
      'Replay outing-filter page',
    )
    assertClosedReplayPageRequest(
      wrapper.request,
      CLOSED_REPLAY_FILTER_REQUEST_KEYS,
      query,
      { filterCursor: cursor, filterKind: 'outing', filterLimit: 100, filterSearch: '' },
      'outing-filter',
    )
    const result = requireClosedReplayRecord(wrapper.result, null, 'Replay outing-filter result')
    if (result.filterKind !== 'outing') throw new Error('Packaged Replay filter kind changed.')
    if (result.search !== '') throw new Error('Packaged Replay filter search changed.')
    if (result.totalCount !== total) throw new Error('Packaged Replay outing-filter total changed.')
    const entries = requireClosedReplayArray(result.entries, 'Replay outing-filter entries')
    if (entries.length > 100) {
      throw new Error('Packaged Replay outing-filter page exceeds its requested bound.')
    }
    const nextCursor = requireClosedReplayCursor(
      result.nextCursor,
      'Replay next outing-filter cursor',
    )
    if (entries.length === 0 && nextCursor !== null) {
      throw new Error('Packaged Replay outing-filter page is empty before its terminal cursor.')
    }
    acceptEntries(entries)
    if (nextCursor !== null && seenCursors.has(nextCursor)) {
      throw new Error('Packaged Replay outing-filter cursor cycle was detected.')
    }
    cursor = nextCursor
  }
  if (cursor !== null) throw new Error('Packaged Replay outing-filter paging is partial and nonterminal.')
  if (count !== total) throw new Error('Packaged Replay outing-filter paging did not exhaust its total.')
  return count
}

/** Requires an exact page request to retain the initial mission/time/filter scope. */
function assertClosedReplayPageRequest(request, expectedKeys, query, additions, label) {
  const projected = requireClosedReplayRecord(request, expectedKeys, `Replay ${label} request`)
  for (const key of CLOSED_REPLAY_QUERY_KEYS) {
    if (projected[key] !== query[key]) {
      throw new Error(`Packaged Replay ${label} request changed its ${key}.`)
    }
  }
  for (const [key, value] of Object.entries(additions)) {
    if (projected[key] !== value) {
      throw new Error(`Packaged Replay ${label} request changed its ${key}.`)
    }
  }
}

/** Returns the renderer-visible deterministic ordering tuple for one track row. */
function closedReplayTrackOrder(row) {
  const effectiveAt = requireClosedReplayText(row?.effective_at, 'Replay track effective time')
  const recordedAt = requireClosedReplayText(row?.recorded_at, 'Replay track recorded time')
  const evidenceId = requireClosedReplayText(row?.evidence_id, 'Replay track identity')
  if (row?.source_type === 'traccar_fix') return [effectiveAt, recordedAt, '0', evidenceId]
  if (row?.source_type !== 'gpx_point') throw new Error('Packaged Replay track source is invalid.')
  const trackId = requireClosedReplayText(row.track_id, 'Replay GPX track identity')
  const match = /^(.*):(\d+):(\d+):(\d+)$/u.exec(evidenceId)
  if (match === null || match[1] !== trackId) {
    throw new Error('Packaged Replay GPX track order identity is invalid.')
  }
  const stableOrder = `${trackId}:${match[3].padStart(12, '0')}:${match[4].padStart(12, '0')}`
  return [effectiveAt, recordedAt, '1', stableOrder]
}

/** Lexicographically compares two complete deterministic ordering tuples. */
function compareClosedReplayOrder(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1
    if (left[index] > right[index]) return 1
  }
  return 0
}

/** Requires one closed plain object and, when supplied, its exact key set. */
function requireClosedReplayRecord(value, expectedKeys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Packaged ${label} is not a closed object.`)
  }
  if (expectedKeys !== null
    && Object.keys(value).sort().join(',') !== [...expectedKeys].sort().join(',')) {
    throw new Error(`Packaged ${label} contains missing or unknown fields.`)
  }
  return value
}

/** Requires one renderer-returned array without accepting array-like objects. */
function requireClosedReplayArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Packaged ${label} is not an array.`)
  return value
}

/** Requires one non-empty bounded renderer string. */
function requireClosedReplayText(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_000) {
    throw new Error(`Packaged ${label} is invalid.`)
  }
  return value
}

/** Requires one nullable non-empty bounded continuation cursor. */
function requireClosedReplayCursor(value, label) {
  if (value === null) return null
  return requireClosedReplayText(value, label)
}

/** Requires one exact non-negative count, or a positive expected count by default. */
function requireClosedReplayCount(value, label, options = {}) {
  const minimum = options.allowZero === true ? 0 : 1
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Packaged ${label} is invalid.`)
  }
  return value
}

/** Matches one exact rendered 40-hex build head while tolerating CSS letter casing. */
export function renderedVersionContainsExactHead(renderedText, expectedHead) {
  if (typeof renderedText !== 'string' || typeof expectedHead !== 'string'
    || !SHA1.test(expectedHead)) {
    return false
  }
  const renderedHeads = renderedText.matchAll(
    /(?:^|[^0-9a-f])([0-9a-f]{40})(?![0-9a-f])/giu,
  )
  for (const match of renderedHeads) {
    if (match[1]?.toLowerCase() === expectedHead) return true
  }
  return false
}

/** Parses the fail-closed packaged archive-lifecycle runner command line. */
export function parseArchiveLifecycleSmokeArgs(argv) {
  const parsed = { extraArgs: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    /** Returns the next non-option value and advances the parser. */
    const nextValue = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value.`)
      }
      index += 1
      return value
    }
    switch (token) {
      case '--app':
        parsed.appPath = nextValue()
        break
      case '--evidence':
        parsed.evidenceDir = nextValue()
        break
      case '--expected-head':
        parsed.expectedHead = nextValue()
        break
      case '--seed-position-rows':
        parsed.seedPositionRows = Number(nextValue())
        break
      case '--timeout-ms':
        parsed.timeoutMs = Number(nextValue())
        break
      case '--':
        parsed.extraArgs.push(...argv.slice(index + 1))
        index = argv.length
        break
      default:
        throw new Error(`Unknown archive-lifecycle smoke argument: ${String(token)}`)
    }
  }

  requireAbsolutePath(parsed.appPath, '--app')
  requireAbsolutePath(parsed.evidenceDir, '--evidence')
  if (typeof parsed.expectedHead !== 'string' || !SHA1.test(parsed.expectedHead)) {
    throw new Error('--expected-head must be one exact lowercase 40-character repository head.')
  }
  const seedPositionRows = boundedInteger(
    parsed.seedPositionRows,
    4_096,
    1_024,
    10_000,
    '--seed-position-rows',
  )
  const timeoutMs = boundedInteger(
    parsed.timeoutMs,
    180_000,
    30_000,
    15 * 60_000,
    '--timeout-ms',
  )
  for (const argument of parsed.extraArgs) {
    if (typeof argument !== 'string' || !argument.startsWith('--')
      || argument.length > 200 || CONTROL_CHARACTER.test(argument)
      || SENSITIVE_ARGUMENT.test(argument)) {
      throw new Error('Archive-lifecycle smoke launch arguments cannot contain custody secrets or invalid flags.')
    }
  }
  return Object.freeze({
    appPath: parsed.appPath,
    evidenceDir: parsed.evidenceDir,
    expectedHead: parsed.expectedHead,
    seedPositionRows,
    timeoutMs,
    extraArgs: Object.freeze([...parsed.extraArgs]),
  })
}

/** Builds the deterministic exact-head packaged smoke invocation for CI. */
export function buildArchiveLifecycleSmokeCiRunnerArgs(input) {
  if (typeof input?.projectRoot !== 'string' || !path.isAbsolute(input.projectRoot)
    || typeof input?.appPath !== 'string' || !path.isAbsolute(input.appPath)
    || typeof input?.expectedHead !== 'string' || !SHA1.test(input.expectedHead)
    || !['darwin', 'linux'].includes(input.platform)) {
    throw new Error('Archive-lifecycle smoke CI inputs are invalid.')
  }
  const args = [
    path.join(input.projectRoot, 'scripts', 'electron-archive-lifecycle-smoke.mjs'),
    '--app',
    input.appPath,
    '--evidence',
    path.join(input.projectRoot, 'tmp', 'breadcrumb-pr6-packaged-archive-smoke'),
    '--expected-head',
    input.expectedHead,
  ]
  if (input.platform === 'linux') {
    args.push(
      '--',
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    )
  }
  return Object.freeze(args)
}

/** Scopes Mesa software rendering to the Linux packaged-smoke process tree. */
export function buildArchiveLifecycleSmokeCiEnvironment(input) {
  if (input?.environment === null || typeof input?.environment !== 'object') {
    throw new Error('Archive-lifecycle smoke CI environment is invalid.')
  }
  if (input.platform !== 'linux') return { ...input.environment }
  return {
    ...input.environment,
    LIBGL_ALWAYS_SOFTWARE: '1',
    GALLIUM_DRIVER: 'llvmpipe',
  }
}

/** Resolves the packaged app.asar independently from its platform wrapper executable. */
export function resolvePackagedApplicationArchivePath(appPath, platform) {
  requireAbsolutePath(appPath, 'Packaged executable')
  if (platform === 'linux') {
    return path.join(path.dirname(appPath), 'resources', 'app.asar')
  }
  if (platform === 'darwin') {
    return path.join(path.dirname(path.dirname(appPath)), 'Resources', 'app.asar')
  }
  throw new Error('Packaged application archive platform is unsupported.')
}

/** Rejects evidence serialization that contains either exact in-memory custody value. */
export function assertArchiveLifecycleSmokeEvidenceOmitsSecrets(evidence, secrets) {
  let serialized
  try {
    serialized = JSON.stringify(evidence)
  } catch {
    throw new Error('Archive-lifecycle evidence is not serializable.')
  }
  if (!Array.isArray(secrets) || secrets.length < 1
    || secrets.some((secret) => typeof secret !== 'string' || secret.length < 1)) {
    throw new Error('Archive-lifecycle custody secret set is invalid.')
  }
  if (secrets.some((secret) => serialized.includes(secret))) {
    throw new Error('Archive-lifecycle evidence contained custody secret material.')
  }
  return true
}

/** Validates one closed, machine-readable packaged archive-lifecycle proof. */
export function validateArchiveLifecycleSmokeEvidence(evidence) {
  const failures = []
  const root = exactRecord(evidence, [
    'archive',
    'cleanup',
    'interruptedRestore',
    'mission',
    'privacy',
    'proofKind',
    'reviewAfterCleanup',
    'reviewBeforeCleanup',
    'run',
    'schemaVersion',
    'source',
    'verdict',
  ], 'archive-lifecycle evidence', failures)
  if (root === null) return verdict(failures)
  requireExact(failures, root.schemaVersion, 1, 'Evidence schema version')
  requireExact(
    failures,
    root.proofKind,
    'packaged-electron-archive-lifecycle-v1',
    'Evidence proof kind',
  )

  validateSource(root.source, failures)
  validateRun(root.run, failures)
  const mission = validateMission(root.mission, failures)
  validateArchive(root.archive, failures)
  validateReview(
    root.reviewBeforeCleanup,
    'Pre-cleanup archive review',
    mission?.seededPositionRows,
    mission?.seededReplayObjectRows,
    mission?.seededOutingChoices,
    failures,
  )
  validateInterruptedRestore(root.interruptedRestore, failures)
  validateCleanup(root.cleanup, mission?.seededPositionRows, failures)
  validateReview(
    root.reviewAfterCleanup,
    'Post-cleanup archive review',
    mission?.seededPositionRows,
    mission?.seededReplayObjectRows,
    mission?.seededOutingChoices,
    failures,
  )
  if (typeof root.reviewBeforeCleanup?.contentSha256 === 'string'
    && typeof root.reviewAfterCleanup?.contentSha256 === 'string'
    && root.reviewBeforeCleanup.contentSha256 !== root.reviewAfterCleanup.contentSha256) {
    failures.push('Archive Review content changed after cleanup.')
  }
  validatePrivacy(root.privacy, failures)
  validateEmbeddedVerdict(root.verdict, failures)
  scanEvidencePrivacy(root, failures)
  return verdict(failures)
}

/** Validates exact repository and packaged-binary identity. */
function validateSource(value, failures) {
  const source = exactRecord(value, [
    'expectedHead',
    'headAfter',
    'headBefore',
    'packagedApplicationArchiveSha256',
    'packagedBuildHeadMatched',
    'packagedExecutableSha256',
    'treeAfter',
    'treeBefore',
    'worktreeCleanAfter',
    'worktreeCleanBefore',
  ], 'source evidence', failures)
  if (source === null) return
  for (const key of ['expectedHead', 'headBefore', 'headAfter', 'treeBefore', 'treeAfter']) {
    if (typeof source[key] !== 'string' || !SHA1.test(source[key])) {
      failures.push(`Source ${key} is not a lowercase repository digest.`)
    }
  }
  if (source.expectedHead !== source.headBefore || source.expectedHead !== source.headAfter) {
    failures.push('Source head before and after must equal the expected exact head.')
  }
  if (source.treeBefore !== source.treeAfter) {
    failures.push('Source tree changed during the packaged smoke.')
  }
  if (source.worktreeCleanBefore !== true || source.worktreeCleanAfter !== true) {
    failures.push('Source worktree must be clean before and after the packaged smoke.')
  }
  if (typeof source.packagedExecutableSha256 !== 'string'
    || !SHA256.test(source.packagedExecutableSha256)) {
    failures.push('Packaged executable SHA-256 is invalid.')
  }
  if (typeof source.packagedApplicationArchiveSha256 !== 'string'
    || !SHA256.test(source.packagedApplicationArchiveSha256)) {
    failures.push('Packaged application archive SHA-256 is invalid.')
  }
  if (source.packagedBuildHeadMatched !== true) {
    failures.push('Packaged visible build head did not match the expected exact head.')
  }
}

/** Validates bounded host/run identity without retaining local paths. */
function validateRun(value, failures) {
  const run = exactRecord(value, [
    'architecture',
    'durationMs',
    'finishedAt',
    'launchCount',
    'nodeVersion',
    'observedLaunchExitCount',
    'platform',
    'startedAt',
  ], 'run evidence', failures)
  if (run === null) return
  const started = canonicalTimestamp(run.startedAt)
  const finished = canonicalTimestamp(run.finishedAt)
  if (started === null || finished === null || finished < started) {
    failures.push('Run timestamps are invalid or reversed.')
  }
  if (!Number.isSafeInteger(run.durationMs) || run.durationMs < 1
    || (started !== null && finished !== null && run.durationMs !== finished - started)) {
    failures.push('Run duration must exactly bind its timestamps.')
  }
  if (!['darwin', 'linux'].includes(run.platform)) failures.push('Run platform is unsupported.')
  if (!['arm64', 'x64'].includes(run.architecture)) failures.push('Run architecture is unsupported.')
  if (typeof run.nodeVersion !== 'string' || !/^v\d+\.\d+\.\d+$/u.test(run.nodeVersion)) {
    failures.push('Run Node.js version is invalid.')
  }
  requireExact(failures, run.launchCount, 2, 'Packaged Electron launch count')
  if (run.observedLaunchExitCount !== run.launchCount) {
    failures.push('Packaged Electron launch exit count was not fully observed.')
  }
}

/** Validates the bounded mission lifecycle seeded only through the preload bridge. */
function validateMission(value, failures) {
  const mission = exactRecord(value, [
    'createdStatus',
    'finalizedStatus',
    'finishedStatus',
    'missionId',
    'missionNameSha256',
    'seededOutingChoices',
    'seededPositionRows',
    'seededReplayObjectRows',
  ], 'mission evidence', failures)
  if (mission === null) return null
  boundedText(mission.missionId, 1, 200, 'Mission identity', failures)
  if (typeof mission.missionNameSha256 !== 'string' || !SHA256.test(mission.missionNameSha256)) {
    failures.push('Mission-name SHA-256 is invalid.')
  }
  requireExact(failures, mission.createdStatus, 'active', 'Created mission status')
  requireExact(failures, mission.finishedStatus, 'finished', 'Finished mission status')
  requireExact(failures, mission.finalizedStatus, 'finalized', 'Finalized mission status')
  if (!Number.isSafeInteger(mission.seededPositionRows)
    || mission.seededPositionRows < 1_024 || mission.seededPositionRows > 10_000) {
    failures.push('Seeded position-row count is outside the bounded smoke profile.')
  }
  if (!Number.isSafeInteger(mission.seededReplayObjectRows)
    || mission.seededReplayObjectRows < 101 || mission.seededReplayObjectRows > 10_000) {
    failures.push('Seeded Replay object-row count did not force bounded continuation paging.')
  }
  if (!Number.isSafeInteger(mission.seededOutingChoices)
    || mission.seededOutingChoices < 101 || mission.seededOutingChoices > 1_000) {
    failures.push('Seeded outing-choice count did not force bounded continuation paging.')
  }
  return mission
}

/** Validates independent verification and retained encrypted archive identity. */
function validateArchive(value, failures) {
  const archive = exactRecord(value, [
    'archiveId',
    'availability',
    'ciphertextSha256',
    'containerVersion',
    'createProgressPhases',
    'sizeBytes',
    'statusAfterFinalize',
    'statusAfterIndependentVerify',
    'verifyProgressPhases',
  ], 'archive evidence', failures)
  if (archive === null) return
  boundedText(archive.archiveId, 1, 200, 'Archive identity', failures)
  requireExact(failures, archive.containerVersion, 2, 'Archive container version')
  requireExact(failures, archive.statusAfterFinalize, 'verified', 'Finalization archive status')
  if (archive.statusAfterIndependentVerify !== 'verified') {
    failures.push('Independent archive verification did not finish verified.')
  }
  requireExact(failures, archive.availability, 'present', 'Archive availability')
  if (typeof archive.ciphertextSha256 !== 'string' || !SHA256.test(archive.ciphertextSha256)) {
    failures.push('Archive ciphertext SHA-256 is invalid.')
  }
  if (!Number.isSafeInteger(archive.sizeBytes) || archive.sizeBytes < 1) {
    failures.push('Archive ciphertext byte size is invalid.')
  }
  validateProgressPhases(
    archive.createProgressPhases,
    REQUIRED_CREATE_PHASES,
    'Create',
    failures,
  )
  validateProgressPhases(
    archive.verifyProgressPhases,
    REQUIRED_VERIFY_PHASES,
    'Independent verify',
    failures,
  )
}

/** Validates one open-read-deny-close read-only archive review. */
function validateReview(
  value,
  label,
  expectedBreadcrumbCount,
  expectedObjectCount,
  expectedOutingFilterCount,
  failures,
) {
  const review = exactRecord(value, REVIEW_KEYS, `${label} evidence`, failures)
  if (review === null) return
  for (const key of [
    'opened',
    'immutable',
    'verified',
    'archiveIdMatched',
    'readMissionIdMatched',
    'mutationDenied',
    'denialAudited',
    'closed',
  ]) {
    if (review[key] !== true) failures.push(`${label} ${key} proof is missing.`)
  }
  if (typeof review.contentSha256 !== 'string' || !SHA256.test(review.contentSha256)) {
    failures.push(`${label} content SHA-256 is invalid.`)
  }
  requireExact(
    failures,
    review.plaintextResidual,
    'permission_restricted_session_open',
    `${label} plaintext residual disclosure`,
  )
  requireExact(failures, review.mutationAttempt, 'upsertMarker', `${label} mutation attack`)
  requireExact(
    failures,
    review.mutationBoundary,
    'preload_read_only',
    `${label} mutation boundary`,
  )
  if (!Number.isSafeInteger(review.openResidualFileCount)
    || review.openResidualFileCount < 1) {
    failures.push(`${label} did not observe a plaintext Review file while open.`)
  }
  if (review.openDirectoriesOwnerOnly !== true || review.openFilesOwnerOnly !== true) {
    failures.push(`${label} Review residual permissions were not owner-only.`)
  }
  if (review.openPrivacyCanaryDetected !== true) {
    failures.push(`${label} did not observe the mission privacy canary while open.`)
  }
  if (!Number.isSafeInteger(review.breadcrumbCount) || review.breadcrumbCount < 0) {
    failures.push(`${label} breadcrumb count is invalid.`)
  } else if (Number.isSafeInteger(expectedBreadcrumbCount)
    && review.breadcrumbCount !== expectedBreadcrumbCount) {
    failures.push(`${label} breadcrumb count did not match the seeded archive evidence.`)
  }
  if (!Number.isSafeInteger(review.replayTrackCount) || review.replayTrackCount < 0) {
    failures.push(`${label} exhaustive Replay track count is invalid.`)
  } else if (Number.isSafeInteger(expectedBreadcrumbCount)
    && review.replayTrackCount !== expectedBreadcrumbCount) {
    failures.push(`${label} exhaustive Replay track count did not match every seeded breadcrumb.`)
  }
  if (!Number.isSafeInteger(review.replayObjectCount) || review.replayObjectCount < 0) {
    failures.push(`${label} exhaustive Replay object count is invalid.`)
  } else if (Number.isSafeInteger(expectedObjectCount)
    && review.replayObjectCount !== expectedObjectCount) {
    failures.push(`${label} exhaustive Replay object count did not match every seeded object.`)
  }
  if (!Number.isSafeInteger(review.replayOutingFilterCount)
    || review.replayOutingFilterCount < 0) {
    failures.push(`${label} exhaustive Replay outing-filter count is invalid.`)
  } else if (Number.isSafeInteger(expectedOutingFilterCount)
    && review.replayOutingFilterCount !== expectedOutingFilterCount) {
    failures.push(`${label} exhaustive Replay outing-filter count did not match every seeded outing.`)
  }
  requireExact(failures, review.residualEntriesAfterClose, 0, `${label} residual entries after close`)
}

/** Validates a decrypt-progress-triggered SIGKILL and startup plaintext sweep. */
function validateInterruptedRestore(value, failures) {
  const interruption = exactRecord(value, [
    'exitSignal',
    'killSignalRequested',
    'plaintextFileObservedBeforeRestart',
    'privacyCanaryDetectedBeforeRestart',
    'progressTriggered',
    'residualEntriesAfterRestart',
    'residualEntriesBeforeRestart',
    'restartSweepCompleted',
    'supported',
    'triggerPhase',
  ], 'interrupted restore evidence', failures)
  if (interruption === null) return
  if (interruption.supported !== true) failures.push('Interrupted restore proof must be supported.')
  if (interruption.progressTriggered !== true || interruption.triggerPhase !== 'decrypt') {
    failures.push('Interrupted restore must be triggered by decrypt progress.')
  }
  if (interruption.killSignalRequested !== 'SIGKILL' || interruption.exitSignal !== 'SIGKILL') {
    failures.push('Interrupted restore must request and observe exact SIGKILL.')
  }
  if (!Number.isSafeInteger(interruption.residualEntriesBeforeRestart)
    || interruption.residualEntriesBeforeRestart < 1) {
    failures.push('Interrupted restore must observe an app-addressable residual before restart.')
  }
  if (interruption.plaintextFileObservedBeforeRestart !== true) {
    failures.push('Interrupted restore did not observe a plaintext file before restart.')
  }
  if (interruption.privacyCanaryDetectedBeforeRestart !== true) {
    failures.push('Interrupted restore did not observe the privacy canary before restart.')
  }
  if (interruption.restartSweepCompleted !== true
    || interruption.residualEntriesAfterRestart !== 0) {
    failures.push('Restart sweep must remove every interrupted restore residual.')
  }
}

/** Validates credential-gated live-row cleanup without weakening the archive. */
function validateCleanup(value, seededPositionRows, failures) {
  const cleanup = exactRecord(value, [
    'completed',
    'eligibilityChecked',
    'eligibleBeforeCredential',
    'freshCredentialOnlyBlocker',
    'movedRows',
    'remainingBreadcrumbRows',
    'storageState',
  ], 'cleanup evidence', failures)
  if (cleanup === null) return
  if (cleanup.eligibilityChecked !== true
    || cleanup.eligibleBeforeCredential !== false
    || cleanup.freshCredentialOnlyBlocker !== true) {
    failures.push('Cleanup eligibility did not fail closed on the fresh credential gate.')
  }
  if (cleanup.completed !== true || cleanup.storageState !== 'archived') {
    failures.push('Cleanup did not complete in archived storage state.')
  }
  if (!Number.isSafeInteger(cleanup.movedRows) || cleanup.movedRows < 0
    || (Number.isSafeInteger(seededPositionRows) && cleanup.movedRows < seededPositionRows)) {
    failures.push('Cleanup moved-row count did not cover the seeded mission evidence.')
  }
  if (cleanup.remainingBreadcrumbRows !== 0) {
    failures.push('Breadcrumb rows remain in the live store after cleanup.')
  }
}

/** Validates exact-secret scans and the truthful app-addressable-residue boundary. */
function validatePrivacy(value, failures) {
  const privacy = exactRecord(value, [
    'exactSecretMatches',
    'exactSecretScanFiles',
    'plaintextResidueEntriesAtEnd',
    'secretsAbsentFromEvidence',
    'secretsAbsentFromProcessArguments',
    'secretsProvidedOnlyViaPreload',
  ], 'privacy evidence', failures)
  if (privacy === null) return
  for (const key of [
    'secretsProvidedOnlyViaPreload',
    'secretsAbsentFromProcessArguments',
    'secretsAbsentFromEvidence',
  ]) {
    if (privacy[key] !== true) failures.push(`Privacy proof ${key} is missing.`)
  }
  if (!Number.isSafeInteger(privacy.exactSecretScanFiles) || privacy.exactSecretScanFiles < 1) {
    failures.push('Exact secret scan did not inspect any profile files.')
  }
  requireExact(failures, privacy.exactSecretMatches, 0, 'Exact secret scan matches')
  if (privacy.plaintextResidueEntriesAtEnd !== 0) {
    failures.push('Final app-addressable plaintext residue count is not zero.')
  }
}

/** Requires the embedded producer verdict to be a closed successful claim. */
function validateEmbeddedVerdict(value, failures) {
  const embedded = exactRecord(value, ['failureReasons', 'passed'], 'embedded verdict', failures)
  if (embedded === null) return
  if (embedded.passed !== true || !Array.isArray(embedded.failureReasons)
    || embedded.failureReasons.length !== 0) {
    failures.push('Embedded packaged-smoke verdict is not a clean pass.')
  }
}

/** Rejects local paths and recovery-code material anywhere in evidence. */
function scanEvidencePrivacy(value, failures, seen = new Set()) {
  if (typeof value === 'string') {
    if (RECOVERY_CODE.test(value)) failures.push('Evidence contains recovery-code material.')
    if (/^(?:\/|[A-Za-z]:[\\/])/u.test(value)) failures.push('Evidence contains an absolute local path.')
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) {
    failures.push('Evidence contains a cyclic value.')
    return
  }
  seen.add(value)
  for (const child of Object.values(value)) scanEvidencePrivacy(child, failures, seen)
  seen.delete(value)
}

/** Requires a unique, closed phase set containing each required phase. */
function validateProgressPhases(value, required, label, failures) {
  if (!Array.isArray(value) || value.length < 1
    || value.some((phase) => typeof phase !== 'string' || phase.length > 40)
    || new Set(value).size !== value.length
    || [...value].sort().some((phase, index) => phase !== value[index])) {
    failures.push(`${label} progress phases are not one sorted closed set.`)
    return
  }
  for (const phase of required) {
    if (!value.includes(phase)) failures.push(`${label} progress did not prove ${phase}.`)
  }
}

/** Returns a plain object only when its key set exactly matches the contract. */
function exactRecord(value, expectedKeys, label, failures) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failures.push(`${label} is not an object.`)
    return null
  }
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    failures.push(`${label} contains missing or unknown fields.`)
    return null
  }
  return value
}

/** Requires one exact primitive value. */
function requireExact(failures, actual, expected, label) {
  if (actual !== expected) failures.push(`${label} must equal ${String(expected)}.`)
}

/** Validates one bounded operator-safe identifier. */
function boundedText(value, minimum, maximum, label, failures) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum
    || CONTROL_CHARACTER.test(value)) {
    failures.push(`${label} is invalid.`)
  }
}

/** Parses one canonical millisecond UTC timestamp. */
function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null
}

/** Returns the public validation result without leaking evidence values. */
function verdict(failures) {
  const unique = [...new Set(failures)]
  return Object.freeze({
    valid: unique.length === 0,
    passed: unique.length === 0,
    failureReasons: Object.freeze(unique),
  })
}

/** Requires one absolute CLI path without normalizing attacker-controlled text. */
function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || CONTROL_CHARACTER.test(value)) {
    throw new Error(`${label} must be an absolute path.`)
  }
}

/** Applies one inclusive integer bound with a default. */
function boundedInteger(value, fallback, minimum, maximum, label) {
  const candidate = value === undefined ? fallback : value
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`)
  }
  return candidate
}
