import path from 'node:path'

const DIAGNOSTIC_FIELDS = Object.freeze([
  'consoleErrors',
  'consoleWarnings',
  'pageErrors',
  'mainProcessErrors',
  'processStderr',
  'networkFailures',
])
const MAX_DIAGNOSTIC_ENTRIES = 40
const KNOWN_BASEMAP_ORIGINS = Object.freeze([
  'https://tile.openstreetmap.org',
  'https://tile.opentopomap.org',
  'https://services.arcgisonline.com',
])

/**
 * The packaged smoke has a small, explicit diagnostic allowlist. Network
 * blocking is the only renderer noise structurally expected in this harness;
 * every other renderer or main-process diagnostic is a failure. Expected
 * basemap blocks are aggregated separately; unexpected events remain in an
 * append-only receipt log so an early failure cannot be evicted by later noise.
 */
export const DEFAULT_DIAGNOSTIC_ALLOWLIST = Object.freeze({
  consoleErrors: Object.freeze([
    (entry) => entry?.type === 'console.error'
      && entry?.source === 'renderer-console'
      && /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT\.?$/u.test(entry?.message ?? '')
      && isKnownBlockedResourceUrl(entry?.url ?? ''),
  ]),
  consoleWarnings: Object.freeze([]),
  networkFailures: Object.freeze([
    (entry) => entry?.type === 'requestfailed'
      && entry?.source === 'renderer-network'
      && entry?.message === entry?.errorText
      && entry?.errorText === 'net::ERR_BLOCKED_BY_CLIENT'
      && /^(?:https:\/\/tile\.(?:openstreetmap|opentopomap)\.org\/|https:\/\/services\.arcgisonline\.com\/)/u.test(entry?.url ?? ''),
  ]),
  pageErrors: Object.freeze([]),
  mainProcessErrors: Object.freeze([]),
  processStderr: Object.freeze([]),
})

/** Creates bounded diagnostic storage with counters that cannot lose failures. */
export function createDiagnosticState() {
  return {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    mainProcessErrors: [],
    processStderr: [],
    networkFailures: [],
    counts: Object.fromEntries(DIAGNOSTIC_FIELDS.map((field) => [field, 0])),
    truncated: Object.fromEntries(DIAGNOSTIC_FIELDS.map((field) => [field, false])),
    expectedBlockedResources: {},
    unexpectedEvents: [],
    sequenceLog: [],
    nextSequence: 1,
    lastTimestampMs: 0,
    captureStartedAt: performance.now(),
  }
}

/** Returns whether a blocked renderer resource is one of the configured basemap hosts. */
function isKnownBlockedResourceUrl(value) {
  try {
    return KNOWN_BASEMAP_ORIGINS.includes(new URL(value).origin)
  } catch {
    return false
  }
}

/** Returns whether one event is the exact expected blocked-basemap shape. */
function isExpectedBlockedResource(field, entry) {
  if (!isKnownBlockedResourceUrl(entry.url)) return false
  if (field === 'consoleErrors') {
    return entry.type === 'console.error'
      && entry.source === 'renderer-console'
      && /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT\.?$/u.test(entry.message)
  }
  if (field === 'networkFailures') {
    return entry.type === 'requestfailed'
      && entry.source === 'renderer-network'
      && entry.message === entry.errorText
      && entry.errorText === 'net::ERR_BLOCKED_BY_CLIENT'
  }
  return false
}

/** Returns the compact aggregation key for one expected blocked event. */
function expectedBlockedResourceKey(field, entry) {
  if (!isExpectedBlockedResource(field, entry)) return null
  return `${field}|${entry.type}|${entry.source}|${entry.phase}|${diagnosticOrigin(entry.url)}`
}

/** Returns the exact origin for one structurally valid URL. */
function diagnosticOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

/** Normalizes one diagnostic with ordered, source-rich capture metadata. */
function normalizeDiagnosticEntry(diagnostics, field, entry, metadata = {}) {
  const raw = typeof entry === 'string' ? { message: entry } : entry
  if (raw === null || typeof raw !== 'object' || typeof raw.message !== 'string') {
    throw new Error(`Packaged smoke diagnostic entry is invalid for ${field}.`)
  }
  const candidateTimestamp = Date.parse(raw.at ?? metadata.at ?? '')
  const timestampMs = Math.max(
    diagnostics.lastTimestampMs,
    Number.isFinite(candidateTimestamp) ? candidateTimestamp : Date.now(),
  )
  const sequence = diagnostics.nextSequence
  diagnostics.nextSequence += 1
  diagnostics.lastTimestampMs = timestampMs
  return {
    ...raw,
    field,
    sequence,
    at: new Date(timestampMs).toISOString(),
    elapsedMs: raw.elapsedMs ?? (performance.now() - diagnostics.captureStartedAt),
    teardownRequestedAt: raw.teardownRequestedAt ?? null,
    timeBasis: 'collector-receipt',
    phase: typeof metadata.phase === 'string' && metadata.phase !== ''
      ? metadata.phase : (typeof raw.phase === 'string' && raw.phase !== '' ? raw.phase : 'unknown'),
    type: typeof metadata.type === 'string' && metadata.type !== ''
      ? metadata.type : (typeof raw.type === 'string' && raw.type !== '' ? raw.type : field),
    source: typeof metadata.source === 'string' && metadata.source !== ''
      ? metadata.source : (typeof raw.source === 'string' && raw.source !== '' ? raw.source : field),
    url: typeof raw.url === 'string' ? raw.url : '',
    message: raw.message,
  }
}

/** Appends one diagnostic while bounding only display samples and aggregating known map blocks. */
export function appendBoundedDiagnostic(diagnostics, field, entry, metadata = {}) {
  if (!DIAGNOSTIC_FIELDS.includes(field)) throw new Error(`Unknown packaged diagnostic field: ${field}`)
  if (!Array.isArray(diagnostics?.[field]) || diagnostics?.counts === null
    || typeof diagnostics?.counts !== 'object' || diagnostics?.truncated === null
    || typeof diagnostics?.truncated !== 'object' || !Array.isArray(diagnostics?.unexpectedEvents)
    || !Array.isArray(diagnostics?.sequenceLog)
    || diagnostics?.expectedBlockedResources === null
    || typeof diagnostics?.expectedBlockedResources !== 'object'
    || !Number.isSafeInteger(diagnostics?.nextSequence)
    || !Number.isFinite(diagnostics?.lastTimestampMs)) {
    throw new Error('Packaged smoke diagnostic state is invalid.')
  }
  const normalized = normalizeDiagnosticEntry(diagnostics, field, entry, metadata)
  const aggregateKey = expectedBlockedResourceKey(field, normalized)
  diagnostics.counts[field] += 1
  if (diagnostics[field].length < MAX_DIAGNOSTIC_ENTRIES) diagnostics[field].push(normalized)
  else diagnostics.truncated[field] = true
  if (aggregateKey !== null) {
    const origin = diagnosticOrigin(normalized.url)
    const aggregate = diagnostics.expectedBlockedResources[aggregateKey]
    if (aggregate === undefined) {
      diagnostics.expectedBlockedResources[aggregateKey] = {
        field,
        type: normalized.type,
        source: normalized.source,
        phase: normalized.phase,
        origin,
        url: normalized.url,
        count: 1,
        first: normalized,
      }
    } else {
      aggregate.count += 1
    }
    diagnostics.sequenceLog.push({
      sequence: normalized.sequence,
      at: normalized.at,
      kind: 'expected-blocked',
      aggregateKey,
      field,
      phase: normalized.phase,
      type: normalized.type,
      source: normalized.source,
      url: normalized.url,
    })
    return
  }
  diagnostics.unexpectedEvents.push(normalized)
  diagnostics.sequenceLog.push({
    sequence: normalized.sequence,
    at: normalized.at,
    kind: 'unexpected',
    field,
    phase: normalized.phase,
    type: normalized.type,
    source: normalized.source,
    url: normalized.url,
  })
}

/** Returns the append-only unexpected event log grouped by diagnostic field. */
function diagnosticList(diagnostics, field) {
  return diagnostics.unexpectedEvents.filter((entry) => entry.field === field)
}

/** Returns the diagnostic shape required in every terminal smoke receipt. */
function assertCompleteDiagnosticShape(diagnostics) {
  if (diagnostics === null || typeof diagnostics !== 'object'
    || diagnostics.counts === null || typeof diagnostics.counts !== 'object'
    || diagnostics.truncated === null || typeof diagnostics.truncated !== 'object'
    || !Array.isArray(diagnostics.unexpectedEvents)
    || !Array.isArray(diagnostics.sequenceLog)
    || diagnostics.expectedBlockedResources === null
    || typeof diagnostics.expectedBlockedResources !== 'object'
    || !Number.isSafeInteger(diagnostics.nextSequence)
    || !Number.isFinite(diagnostics.lastTimestampMs)) {
    throw new Error('Packaged smoke diagnostic metadata is missing.')
  }
  let totalCount = 0
  for (const field of DIAGNOSTIC_FIELDS) {
    if (!Array.isArray(diagnostics[field])
      || !Number.isSafeInteger(diagnostics.counts[field])
      || diagnostics[field].length > MAX_DIAGNOSTIC_ENTRIES
      || diagnostics.counts[field] < diagnostics[field].length
      || diagnostics.truncated[field] !== (diagnostics.counts[field] > diagnostics[field].length)) {
      throw new Error(`Packaged smoke diagnostic metadata is incomplete for ${field}.`)
    }
    if (diagnostics[field].some((entry) => !isDiagnosticEventShape(entry, field))) {
      throw new Error(`Packaged smoke diagnostic entry is invalid for ${field}.`)
    }
    totalCount += diagnostics.counts[field]
  }
  for (const entry of diagnostics.unexpectedEvents) {
    if (entry === null || typeof entry !== 'object'
      || !isDiagnosticEventShape(entry, entry.field)) {
      throw new Error('Packaged smoke unexpected diagnostic event is invalid.')
    }
  }
  const unexpectedBySequence = new Map()
  let previousUnexpectedSequence = 0
  for (const entry of diagnostics.unexpectedEvents) {
    if (unexpectedBySequence.has(entry.sequence)) {
      throw new Error('Packaged smoke diagnostic sequence contains a duplicate unexpected event.')
    }
    if (entry.sequence <= previousUnexpectedSequence) {
      throw new Error('Packaged smoke unexpected diagnostic events are out of order.')
    }
    previousUnexpectedSequence = entry.sequence
    unexpectedBySequence.set(entry.sequence, entry)
  }
  if (diagnostics.sequenceLog.length !== totalCount) {
    throw new Error('Packaged smoke diagnostic sequence log is incomplete.')
  }
  const aggregateSequenceCounts = new Map()
  let previousTimestamp = Number.NEGATIVE_INFINITY
  for (let index = 0; index < diagnostics.sequenceLog.length; index += 1) {
    const sequenceEntry = diagnostics.sequenceLog[index]
    const timestamp = Date.parse(sequenceEntry?.at ?? '')
    if (sequenceEntry === null || typeof sequenceEntry !== 'object'
      || sequenceEntry.sequence !== index + 1
      || !Number.isFinite(timestamp)
      || timestamp < previousTimestamp
      || (sequenceEntry.kind !== 'expected-blocked' && sequenceEntry.kind !== 'unexpected')
      || !DIAGNOSTIC_FIELDS.includes(sequenceEntry.field)
      || typeof sequenceEntry.phase !== 'string' || sequenceEntry.phase === ''
      || typeof sequenceEntry.type !== 'string' || sequenceEntry.type === ''
      || typeof sequenceEntry.source !== 'string' || sequenceEntry.source === ''
      || typeof sequenceEntry.url !== 'string') {
      throw new Error('Packaged smoke diagnostic sequence is invalid or out of order.')
    }
    previousTimestamp = timestamp
    if (sequenceEntry.kind === 'unexpected') {
      const matching = unexpectedBySequence.get(sequenceEntry.sequence)
      if (matching === undefined
        || matching.at !== sequenceEntry.at
        || matching.field !== sequenceEntry.field
        || matching.phase !== sequenceEntry.phase
        || matching.type !== sequenceEntry.type
        || matching.source !== sequenceEntry.source
        || matching.url !== sequenceEntry.url) {
        throw new Error('Packaged smoke diagnostic sequence does not reconcile unexpected events.')
      }
      unexpectedBySequence.delete(sequenceEntry.sequence)
    } else {
      if (typeof sequenceEntry.aggregateKey !== 'string'
        || diagnostics.expectedBlockedResources[sequenceEntry.aggregateKey] === undefined) {
        throw new Error('Packaged smoke diagnostic sequence references a missing aggregate.')
      }
      aggregateSequenceCounts.set(
        sequenceEntry.aggregateKey,
        (aggregateSequenceCounts.get(sequenceEntry.aggregateKey) ?? 0) + 1,
      )
    }
  }
  if (unexpectedBySequence.size > 0) {
    throw new Error('Packaged smoke diagnostic unexpected events are missing from the sequence log.')
  }
  const lastSequenceEntry = diagnostics.sequenceLog.at(-1)
  if ((lastSequenceEntry === undefined && diagnostics.lastTimestampMs !== 0)
    || (lastSequenceEntry !== undefined && diagnostics.lastTimestampMs !== Date.parse(lastSequenceEntry.at))) {
    throw new Error('Packaged smoke diagnostic timestamp does not reconcile with the sequence log.')
  }
  let expectedCount = 0
  for (const aggregate of Object.values(diagnostics.expectedBlockedResources)) {
    if (aggregate === null || typeof aggregate !== 'object'
      || !DIAGNOSTIC_FIELDS.includes(aggregate.field)
      || typeof aggregate.type !== 'string'
      || typeof aggregate.source !== 'string'
      || typeof aggregate.phase !== 'string' || aggregate.phase === ''
      || typeof aggregate.origin !== 'string'
      || typeof aggregate.url !== 'string'
      || !Number.isSafeInteger(aggregate.count)
      || aggregate.count < 1
      || aggregate.first === null
      || typeof aggregate.first !== 'object'
      || aggregate.first.field !== aggregate.field
      || !isDiagnosticEventShape(aggregate.first, aggregate.field)
      || aggregate.first.type !== aggregate.type
      || aggregate.first.source !== aggregate.source
      || aggregate.first.phase !== aggregate.phase
      || aggregate.first.url !== aggregate.url
      || diagnosticOrigin(aggregate.first.url) !== aggregate.origin
      || !isExpectedBlockedResource(aggregate.field, aggregate.first)) {
      throw new Error('Packaged smoke expected diagnostic aggregate is invalid.')
    }
    const aggregateKey = `${aggregate.field}|${aggregate.type}|${aggregate.source}|${aggregate.phase}|${aggregate.origin}`
    const sequenceCount = aggregateSequenceCounts.get(aggregateKey)
    if (sequenceCount !== aggregate.count) {
      throw new Error('Packaged smoke expected diagnostic aggregate count does not reconcile.')
    }
    const firstSequence = diagnostics.sequenceLog.find((entry) => entry.aggregateKey === aggregateKey)
    if (firstSequence === undefined
      || firstSequence.sequence !== aggregate.first.sequence
      || firstSequence.at !== aggregate.first.at
      || firstSequence.url !== aggregate.first.url) {
      throw new Error('Packaged smoke expected diagnostic aggregate first event is not retained.')
    }
    expectedCount += aggregate.count
  }
  const unexpectedCount = diagnostics.unexpectedEvents.length
  if (expectedCount + unexpectedCount !== totalCount
    || diagnostics.nextSequence !== totalCount + 1) {
    throw new Error('Packaged smoke diagnostic counts are inconsistent with the append-only event log.')
  }
}

/** Returns whether one stored event carries every required capture field. */
function isDiagnosticEventShape(entry, field) {
  return DIAGNOSTIC_FIELDS.includes(field)
    && entry !== null
    && typeof entry === 'object'
    && entry.field === field
    && Number.isSafeInteger(entry.sequence)
    && typeof entry.at === 'string'
    && Number.isFinite(Date.parse(entry.at))
    && Number.isFinite(entry.elapsedMs) && entry.elapsedMs >= 0
    && entry.timeBasis === 'collector-receipt'
    && (entry.teardownRequestedAt === null
      || (typeof entry.teardownRequestedAt === 'string' && Number.isFinite(Date.parse(entry.teardownRequestedAt))))
    && typeof entry.phase === 'string'
    && typeof entry.type === 'string'
    && typeof entry.source === 'string'
    && typeof entry.url === 'string'
    && typeof entry.message === 'string'
}

/** Returns whether one diagnostic is covered by an exact allowlist pattern. */
function isAllowlisted(entry, patterns) {
  const value = typeof entry === 'string' ? entry : entry?.message
  return patterns.some((pattern) => {
    if (typeof pattern === 'function') return pattern(entry)
    if (pattern instanceof RegExp) return pattern.test(value)
    return typeof pattern === 'string' && pattern === value
  })
}

/** Finds diagnostics outside the deliberately narrow expected-message set. */
export function collectUnexpectedDiagnostics(
  diagnostics,
  allowlist = DEFAULT_DIAGNOSTIC_ALLOWLIST,
) {
  assertCompleteDiagnosticShape(diagnostics)
  const unexpected = {}
  const allowed = {}
  for (const field of DIAGNOSTIC_FIELDS) {
    const entries = diagnosticList(diagnostics, field)
    const patterns = Array.isArray(allowlist?.[field]) ? allowlist[field] : []
    allowed[field] = entries.filter((entry) => isAllowlisted(entry, patterns))
    unexpected[field] = entries.filter((entry) => !isAllowlisted(entry, patterns))
  }
  return { allowed, unexpected }
}

/** Rejects unexpected packaged diagnostics while retaining the bounded detail. */
export function assertNoUnexpectedDiagnostics(
  diagnostics,
  allowlist = DEFAULT_DIAGNOSTIC_ALLOWLIST,
) {
  const result = collectUnexpectedDiagnostics(diagnostics, allowlist)
  const count = Object.values(result.unexpected).reduce((sum, entries) => sum + entries.length, 0)
  if (count > 0) {
    throw new Error(`Unexpected packaged diagnostics: ${JSON.stringify(result.unexpected)}`)
  }
  return result
}

/** Returns the contextual allowlist for the deliberate device-22 history hold. */
export function createSmokeDiagnosticAllowlist(context = {}) {
  const providerOrigin = typeof context.providerOrigin === 'string' ? context.providerOrigin : ''
  const allowHistoryWarning = isBoundedHistoryHoldRequest(context.historyHoldEvidence)
    && /^http:\/\/127\.0\.0\.1:\d+$/u.test(providerOrigin)
  return {
    ...DEFAULT_DIAGNOSTIC_ALLOWLIST,
    consoleWarnings: allowHistoryWarning ? Object.freeze([
      (entry) => entry?.message === 'Participant history backfill pass failed; it will retry.'
        && entry?.type === 'console.warning'
        && entry?.source === 'renderer-console'
        && (entry?.phase === 'aud08' || entry?.phase === 'restart')
        && entry?.url.startsWith('file:'),
    ]) : Object.freeze([]),
  }
}

/** Returns whether a provider request is the deliberately bounded device-22 hold. */
export function isBoundedHistoryHoldRequest(request) {
  if (request === null || typeof request !== 'object') return false
  const from = Date.parse(request.from)
  const to = Date.parse(request.to)
  return request.method === 'GET'
    && request.path === '/api/positions'
    && request.isHistory === true
    && request.deviceId === '22'
    && request.status === 503
    && Number.isFinite(from)
    && Number.isFinite(to)
    && from < to
}

/** Creates one monotonic bounded deadline for the complete packaged smoke. */
export function createSmokeDeadline(now = Date.now(), durationMs = 240_000) {
  if (!Number.isFinite(now) || !Number.isFinite(durationMs) || durationMs < 1) {
    throw new Error('Packaged smoke deadline input is invalid.')
  }
  return now + durationMs
}

/**
 * Creates the absolute deadline windows for one packaged smoke run. Scenario
 * work stops before the overall deadline, leaving a cleanup reserve. A small
 * part of that reserve is protected from orderly close and stderr draining so
 * an owned child can still receive SIGTERM/SIGKILL when those operations hang.
 */
export function createSmokeDeadlines(
  now = Date.now(),
  durationMs = 240_000,
  cleanupReserveMs = 20_000,
  escalationReserveMs = 10_000,
) {
  if (!Number.isFinite(now) || !Number.isFinite(durationMs) || durationMs < 1
    || !Number.isFinite(cleanupReserveMs) || cleanupReserveMs <= 0
    || !Number.isFinite(escalationReserveMs) || escalationReserveMs <= 0
    || cleanupReserveMs >= durationMs
    || escalationReserveMs >= cleanupReserveMs) {
    throw new Error('Packaged smoke deadline window input is invalid.')
  }
  const totalDeadline = now + durationMs
  return {
    totalDeadline,
    scenarioDeadline: totalDeadline - cleanupReserveMs,
    cleanupDeadline: totalDeadline,
    cleanupPreEscalationDeadline: totalDeadline - escalationReserveMs,
    cleanupReserveMs,
    escalationReserveMs,
  }
}

/** Derives truthful scenario and overall results without allowing partial proof to pass. */
export function evaluateSmokeResults(scenarioResults, diagnosticResult) {
  const statuses = ['aud08', 'aud09', 'restart'].map((name) => scenarioResults?.[name])
  const scenarioResult = statuses.every((status) => status === 'pass')
    ? 'pass'
    : statuses.some((status) => status === 'fail') ? 'fail' : 'pending'
  return {
    scenarioResult,
    result: scenarioResult === 'pass' && diagnosticResult === 'pass' ? 'pass' : 'fail',
  }
}

/** Returns the remaining time before a smoke deadline, clamped at zero. */
export function remainingSmokeTime(deadline, now = Date.now()) {
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0
  return Math.max(0, deadline - now)
}

/** Runs one async operation inside a bounded timeout and disposes its timer. */
export async function runBounded(operation, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { completed: false, value: undefined }
  }
  const boundedTimeout = timeoutMs
  const timedOut = Symbol('smoke_timeout')
  let timer
  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(timedOut), boundedTimeout)
      }),
    ])
    return result === timedOut
      ? { completed: false, value: undefined }
      : { completed: true, value: result }
  } finally {
    clearTimeout(timer)
  }
}

/** Waits for an owned child to exit, with no unbounded event-listener wait. */
function waitForChildExit(child, timeoutMs) {
  if (child?.exitCode !== null || child?.signalCode !== null) return Promise.resolve(true)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(false)
  const boundedTimeout = timeoutMs
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off?.('exit', onExit)
      resolve(value || child?.exitCode !== null || child?.signalCode !== null)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), boundedTimeout)
    child.once?.('exit', onExit)
  })
}

/**
 * Stops only the child explicitly owned by this smoke, escalating once from
 * SIGTERM to SIGKILL within the caller's shared absolute deadline.
 */
export async function stopOwnedChild(child, options = {}) {
  if (options.owned !== true || child === null || typeof child !== 'object' || typeof child.kill !== 'function') {
    throw new Error('Packaged smoke cleanup received a non-owned child.')
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exited: true, forced: false, signal: child.signalCode ?? null, exitCode: child.exitCode ?? null }
  }
  const hasSharedDeadline = options.deadline !== undefined
  const deadline = options.deadline
  if (hasSharedDeadline && !Number.isFinite(deadline)) {
    throw new Error('Packaged smoke cleanup has an invalid owned child deadline.')
  }
  const termTimeoutMs = options.termTimeoutMs === undefined ? 2_000 : options.termTimeoutMs
  const killTimeoutMs = options.killTimeoutMs === undefined ? 2_000 : options.killTimeoutMs
  if (!Number.isFinite(termTimeoutMs) || !Number.isFinite(killTimeoutMs)
    || termTimeoutMs < 0 || killTimeoutMs < 0
    || (!hasSharedDeadline && (termTimeoutMs <= 0 || killTimeoutMs <= 0))) {
    throw new Error('Packaged smoke cleanup has no remaining deadline for owned child shutdown.')
  }
  if (hasSharedDeadline && remainingSmokeTime(deadline) <= 0) {
    child.kill('SIGKILL')
    throw new Error('Packaged smoke cleanup has no remaining deadline for owned child shutdown.')
  }
  child.kill('SIGTERM')
  const termBudget = hasSharedDeadline
    ? Math.min(termTimeoutMs, remainingSmokeTime(deadline) / 2)
    : termTimeoutMs
  if (await waitForChildExit(child, termBudget)) {
    return { exited: true, forced: false, signal: child.signalCode ?? null, exitCode: child.exitCode ?? null }
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  const killBudget = hasSharedDeadline
    ? Math.min(killTimeoutMs, remainingSmokeTime(deadline))
    : killTimeoutMs
  if (!(await waitForChildExit(child, killBudget))) {
    throw new Error('Packaged smoke owned child did not exit after SIGKILL.')
  }
  return { exited: true, forced: true, signal: child.signalCode ?? null, exitCode: child.exitCode ?? null }
}

/** Closes only the owned application while protecting its escalation budget. */
export async function closeOwnedSmokeChild(child, options) {
  if (options?.owned !== true || child === null || typeof child?.kill !== 'function') {
    throw new Error('Packaged smoke cleanup received a non-owned child.')
  }
  if (!Number.isFinite(options.deadline) || !Number.isFinite(options.orderlyDeadline)
    || options.orderlyDeadline > options.deadline) {
    throw new Error('Packaged smoke cleanup deadline is invalid.')
  }
  let closeError = null
  let forcedCleanup = null
  try {
    const closed = await runBounded(options.close, Math.min(20_000, remainingSmokeTime(options.orderlyDeadline)))
    if (!closed.completed) closeError = new Error('Packaged smoke orderly close deadline exhausted.')
  } catch (error) { closeError = error }
  await waitForChildExit(child, Math.min(20_000, remainingSmokeTime(options.orderlyDeadline)))
  if (child.exitCode === null && child.signalCode === null) {
    try {
      forcedCleanup = await stopOwnedChild(child, {
        owned: true, deadline: options.deadline, termTimeoutMs: 5_000, killTimeoutMs: 5_000,
      })
    } catch (error) { closeError ??= error }
  }
  const exit = child.exitCode !== null || child.signalCode !== null
    ? { exitCode: child.exitCode, signal: child.signalCode } : null
  return { exit, closeError, forcedCleanup }
}

/** Validates the terminal receipt independently of the Electron runner. */
export function validateSmokeReceipt(receipt, options = {}) {
  if (receipt === null || typeof receipt !== 'object') throw new Error('Packaged smoke receipt is invalid.')
  if (receipt.result !== 'pass') throw new Error('Packaged smoke receipt is not a pass.')
  if (!Array.isArray(receipt.failures) || receipt.failures.length !== 0) {
    throw new Error('Packaged smoke receipt contains failures.')
  }
  const scenarioResults = receipt.scenarioResults
  if (scenarioResults?.aud08 !== 'pass'
    || scenarioResults?.aud09 !== 'pass'
    || scenarioResults?.restart !== 'pass'
    || receipt.scenarioResult !== 'pass') {
    throw new Error('Packaged smoke receipt does not prove all Train D scenarios completed.')
  }
  if (receipt.diagnosticResult !== 'pass'
    || !Array.isArray(receipt.diagnosticBlockers)
    || receipt.diagnosticBlockers.length !== 0) {
    throw new Error('Packaged smoke receipt does not prove clean packaged diagnostics.')
  }
  const strictSource = options.strictSource === true || options.expectedSourceSha !== undefined
  if (strictSource && receipt.source?.dirty !== false) throw new Error('Packaged smoke receipt source tree is dirty.')
  if (strictSource && receipt.source?.proofMode !== 'exact-head-clean-tree') {
    throw new Error('Packaged smoke receipt does not declare exact-head source proof.')
  }
  if (options.requireLinuxUnpacked === true
    && (receipt.runtime?.requireLinuxUnpacked !== true
      || receipt.runtime?.platform !== 'linux'
      || typeof receipt.executablePath !== 'string'
      || !receipt.executablePath.includes(`${path.sep}linux-unpacked${path.sep}`))) {
    throw new Error('Packaged smoke receipt does not prove the CI linux-unpacked executable.')
  }
  if (options.expectedSourceSha !== undefined && receipt.source?.head !== options.expectedSourceSha) {
    throw new Error('Packaged smoke receipt source head does not match EXPECTED_SOURCE_SHA.')
  }
  if (options.expectedSourceTree !== undefined && receipt.source?.tree !== options.expectedSourceTree) {
    throw new Error('Packaged smoke receipt source tree does not match EXPECTED_SOURCE_TREE.')
  }
  if (receipt.profileRetention?.status !== 'removed') {
    throw new Error('Successful packaged smoke must remove its disposable credential profile.')
  }
  if (receipt.package?.packagedInputsMatch !== true
    || typeof receipt.package.archivePath !== 'string'
    || !receipt.package.archivePath.endsWith('.asar')
    || receipt.package.windowAttestation?.hasTraccarHttpBridge !== true) {
    throw new Error('Packaged smoke receipt is missing ASAR, input-hash, or IPC attestation.')
  }
  if (!Array.isArray(receipt.launches) || receipt.launches.length !== 2) {
    throw new Error('Packaged smoke receipt must contain both launches.')
  }
  const historyHoldEvidence = isBoundedHistoryHoldRequest(receipt.provider?.historyHoldEvidence)
  if (receipt.provider?.heldHistoryRequests < 1 || !historyHoldEvidence) {
    throw new Error('Packaged smoke receipt does not constrain the deliberate device-22 history hold.')
  }
  for (const launch of receipt.launches) {
    if (!Number.isSafeInteger(launch?.pid) || launch.pid < 1) {
      throw new Error(`Packaged smoke launch ${String(launch?.label)} has no child pid.`)
    }
    if (launch.close?.graceful !== true || launch.close?.exitCode !== 0 || launch.close?.signal !== null) {
      throw new Error(`Packaged smoke launch ${String(launch.label)} did not close cleanly.`)
    }
    const closeTimes = [launch.close.requestedAt, launch.close.exitObservedAt, launch.close.stderrDrainedAt]
      .map(value => typeof value === 'string' ? Date.parse(value) : NaN)
    if (closeTimes.some(value => !Number.isFinite(value))
      || closeTimes[1] < closeTimes[0] || closeTimes[2] < closeTimes[1]) {
      throw new Error('Packaged smoke teardown timing is missing or out of order.')
    }
    assertNoUnexpectedDiagnostics(launch.close?.diagnostics, createSmokeDiagnosticAllowlist({
      historyHoldEvidence: receipt.provider?.historyHoldEvidence,
      providerOrigin: receipt.provider?.origin,
    }))
  }

  const aud08 = receipt.phases?.aud08
  const automatic = aud08?.automaticBackfill
  if (automatic?.initialCheckpointCompleted !== true
    || automatic?.readdedSuccessfulMember !== '11'
    || automatic?.readdedHeldMember !== '22'
    || !(automatic?.providerHistoryHoldObserved > 0)
    || !(automatic?.currentRequestsAfterHold > automatic?.currentRequestsBeforeHold)) {
    throw new Error('Packaged smoke receipt does not prove the intended AUD-08 pending member.')
  }
  const pendingGroup = aud08?.readdedPending?.participants?.find((participant) =>
    participant.kind === 'group' && participant.removed_at === null)
  const pendingCheckpoints = aud08?.readdedPending?.checkpoints
  const heldCheckpoint = Array.isArray(pendingCheckpoints)
    ? pendingCheckpoints.find((checkpoint) => checkpoint.traccar_device_id === '22' && checkpoint.completed === 0)
    : undefined
  const successfulCheckpoint = Array.isArray(pendingCheckpoints)
    ? pendingCheckpoints.find((checkpoint) => checkpoint.traccar_device_id === '11' && checkpoint.completed === 1)
    : undefined
  if (pendingGroup?.backfill_member_count !== 2
    || pendingGroup.backfill_completed_count !== 1
    || pendingGroup.effective_from !== automatic.readdWindow?.from
    || heldCheckpoint === undefined
    || successfulCheckpoint === undefined
    || !/participant history backfill/iu.test(String(aud08?.finishBlockedSurface ?? ''))
    || !/incomplete/iu.test(String(aud08?.finishBlockedSurface ?? ''))) {
    throw new Error('Packaged smoke receipt does not prove the AUD-08 1/2 progress and finish refusal.')
  }
  const successfulRequest = automatic.successfulHistoryRequest
  if (successfulRequest?.method !== 'GET'
    || successfulRequest?.path !== '/api/positions'
    || successfulRequest?.isHistory !== true
    || successfulRequest?.deviceId !== '11'
    || successfulRequest.status !== 200
    || !historyRequestCoversWindow(successfulRequest, automatic.readdWindow)) {
    throw new Error('Packaged smoke receipt does not prove device 11 history covered the re-add window.')
  }
  if (!String(aud08?.progressScreenshot ?? '').endsWith('aud08-readded-group-progress.png')) {
    throw new Error('Packaged smoke receipt is missing the visible 1/2 progress screenshot.')
  }

  const aud09 = receipt.phases?.aud09
  assertSearchPages(aud09?.firstPage, aud09?.secondPage)
  assertMirrorEvidence(aud09?.readonly, receipt.profile, aud09?.backupPath, aud09?.firstPage?.generation)
  const restart = receipt.phases?.restart
  assertRestartParticipantEvidence(restart?.participant, aud08?.missionId)
  assertSearchPages(aud09?.firstPage, restart?.secondPage)
  assertMirrorEvidence(restart?.readonly, receipt.profile, aud09?.backupPath, aud09?.firstPage?.generation)
  return true
}

/** Validates the pending participant state after the second packaged launch. */
function assertRestartParticipantEvidence(participant, expectedMissionId) {
  const activeGroup = participant?.participants?.find((candidate) =>
    candidate.kind === 'group' && candidate.removed_at === null)
  const heldCheckpoint = participant?.checkpoints?.find((checkpoint) =>
    checkpoint.traccar_device_id === '22' && checkpoint.completed === 0)
  if (typeof expectedMissionId !== 'string' || expectedMissionId.length === 0
    || participant?.mission?.id !== expectedMissionId
    || participant?.mission?.status !== 'active'
    || activeGroup?.mission_id !== expectedMissionId
    || activeGroup?.backfill_member_count !== 2
    || activeGroup.backfill_completed_count !== 1
    || heldCheckpoint?.mission_id !== expectedMissionId) {
    throw new Error('Packaged smoke restart did not retain the active 2/1 participant backfill state.')
  }
}

/** Validates a successful page chain without relying on UI rendering. */
function assertSearchPages(firstPage, secondPage) {
  if (firstPage?.kind !== 'areas'
    || secondPage?.kind !== 'areas'
    || firstPage.totalCount !== 26 || firstPage.entryCount !== 25
    || typeof firstPage.nextCursor !== 'string' || firstPage.nextCursor.length === 0) {
    throw new Error('Packaged smoke Search Operations first page is incomplete.')
  }
  if (secondPage.entryCount !== 1
    || secondPage.nextCursor !== null
    || secondPage.generation !== firstPage.generation
    || secondPage.firstEntry?.id !== 'repair-train-d-area-25'
    || secondPage.firstEntry?.name !== 'AUD-09 area 25') {
    throw new Error('Packaged smoke Search Operations continuation is incomplete.')
  }
}

/** Validates live and backup absolute paths plus integrity and generation evidence. */
function assertMirrorEvidence(readonly, profile, expectedBackupPath, expectedGeneration) {
  const expectedProfile = typeof profile === 'string' ? profile : null
  const expectedBackup = expectedProfile === null ? null : path.join(expectedProfile, 'mission-store.backup.sqlite')
  const expectedLive = expectedProfile === null ? null : path.join(expectedProfile, 'mission-store.sqlite')
  if (expectedBackupPath !== expectedBackup
    || readonly?.live?.path !== expectedLive
    || readonly?.backup?.path !== expectedBackup
    || readonly.live.integrity !== 'ok'
    || readonly.backup.integrity !== 'ok'
    || readonly.live.searchAreaCount !== 26
    || readonly.backup.searchAreaCount !== 26
    || !Number.isSafeInteger(readonly.live.generation)
    || !Number.isSafeInteger(readonly.backup.generation)
    || readonly.live.generation < 0
    || readonly.backup.generation < 0
    || !Number.isSafeInteger(readonly.live.searchOperationsGeneration)
    || !Number.isSafeInteger(readonly.backup.searchOperationsGeneration)
    || readonly.live.searchOperationsGeneration < 0
    || readonly.backup.searchOperationsGeneration < 0
    || readonly.live.searchOperationsGeneration !== expectedGeneration
    || readonly.backup.searchOperationsGeneration !== expectedGeneration
    || !(readonly.live.backupSyncEventCount >= 1)
    || readonly.live.searchOperationsGeneration !== readonly.backup.searchOperationsGeneration) {
    throw new Error('Packaged smoke live/backup mirror evidence is incomplete.')
  }
}

/** Checks that a provider history request encloses one fixed backfill window. */
export function historyRequestCoversWindow(request, window) {
  if (request === null || typeof request !== 'object' || window === null || typeof window !== 'object') return false
  const from = Date.parse(request.from)
  const to = Date.parse(request.to)
  const windowFrom = Date.parse(window.from)
  const windowTo = Date.parse(window.to)
  return [from, to, windowFrom, windowTo].every(Number.isFinite)
    && from <= windowFrom && to >= windowTo
}
