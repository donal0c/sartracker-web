import type { SupportBundleTimeFrame } from '../../types/electron-bridge'

const TRACKING_POLL_LEDGER_STORAGE_KEY = 'sartracker:tracking-poll-ledger'

export const TRACKING_POLL_LEDGER_MAX_ENTRIES = 720

/**
 * Re-check backlog ranges kept per reconciliation entry. The counts describe
 * the whole backlog; only the oldest ranges are kept, so a full ledger stays
 * small enough to write without starving the renderer [DON-367].
 */
export const TRACKING_POLL_LEDGER_MAX_BACKLOG_RANGES = 3

/** Longest a recorded entry waits before the ledger is written to session storage [DON-367]. */
export const TRACKING_POLL_LEDGER_FLUSH_DELAY_MS = 1_000

export type TrackingPollFailureKind =
  | 'authentication'
  | 'timeout'
  | 'network'
  | 'http_4xx'
  | 'http_5xx'
  | 'invalid_response'
  | 'unknown'

export type TrackingPollPhase =
  | 'authentication'
  | 'devices'
  | 'current_positions'
  | 'breadcrumbs'

type TrackingPollCycleEntry = {
  readonly ts: string
  readonly kind: 'poll_cycle'
  readonly outcome: 'success' | 'failure' | 'recovered'
  readonly phase: TrackingPollPhase
  readonly durationMs: number
  readonly consecutiveFailures: number
  readonly retryDelayMs: number
  readonly outageDurationMs?: number
  readonly failureKind?: TrackingPollFailureKind
  readonly deviceCount?: number
  readonly currentPositionCount?: number
  readonly breadcrumbRequestedDeviceCount?: number
  readonly breadcrumbReturnedCount?: number
  readonly breadcrumbAcceptedCount?: number
  readonly breadcrumbDuplicateCount?: number
  readonly breadcrumbRejectedCount?: number
  readonly breadcrumbFailedDeviceCount?: number
  readonly breadcrumbWindow?: TrackingBreadcrumbWindowSummary
}

export type TrackingBreadcrumbWindowSummary = {
  readonly previousCursorEarliest?: string
  readonly previousCursorLatest?: string
  readonly requestedFromEarliest: string
  readonly requestedFromLatest: string
  readonly requestedTo: string
  readonly newestReturnedEarliest?: string
  readonly newestReturnedLatest?: string
}

export type TrackingRequestAttemptEntry = {
  readonly ts: string
  readonly kind: 'request_attempt'
  readonly outcome: 'failure' | 'recovered'
  readonly phase: TrackingPollPhase
  readonly durationMs: number
  readonly attempt: number
  readonly maxAttempts: number
  readonly failureKind: TrackingPollFailureKind
  readonly httpStatus: number | null
}

export type TrackingBreadcrumbReconciliationEntry = {
  readonly ts: string
  readonly kind: 'breadcrumb_reconciliation'
  readonly outcome: 'progress' | 'complete'
  readonly reconciliationPhase: 'initial' | 'anti_entropy'
  readonly targetFrom: string
  readonly targetTo: string
  readonly totalDeviceCount: number
  readonly completedDeviceCount: number
  readonly totalChunkCount: number
  readonly completedChunkCount: number
  readonly pendingDeviceCount: number
  readonly failedDeviceCount: number
  readonly elapsedMs: number
  /**
   * The oldest re-check ranges still to be re-read (device id and range only),
   * at most TRACKING_POLL_LEDGER_MAX_BACKLOG_RANGES of them [DON-338, DON-367].
   */
  readonly recheckBacklog?: readonly TrackingRecheckBacklogRange[]
  /** Devices with re-check ranges outstanding, counted over the whole backlog. */
  readonly recheckBacklogDeviceCount?: number
  /** Re-check ranges outstanding, counted over the whole backlog. */
  readonly recheckBacklogRangeCount?: number
  /** Outstanding ranges not kept in `recheckBacklog`. */
  readonly recheckBacklogOmittedRangeCount?: number
}

/** One device range the 5-minute re-check has not re-read yet. */
export type TrackingRecheckBacklogRange = {
  readonly deviceId: string
  readonly from: string
  readonly to: string
}

export type TrackingPollLedgerEntry =
  | TrackingPollCycleEntry
  | TrackingRequestAttemptEntry
  | TrackingBreadcrumbReconciliationEntry

/** Classifies a request failure without retaining its message or request URL. */
export function classifyTrackingFailure(error: unknown): TrackingPollFailureKind {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'TraccarAuthenticationError'
  ) {
    return 'authentication'
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  ) {
    return 'timeout'
  }
  if (!(error instanceof Error)) {
    return 'unknown'
  }
  if (/authentication failed|HTTP 401|HTTP 403/iu.test(error.message)) {
    return 'authentication'
  }
  if (/abort|timed?\s*out|timeout/iu.test(error.message)) {
    return 'timeout'
  }
  const statusMatch = error.message.match(/(?:HTTP|status)\s+(\d{3})/iu)
  const status = statusMatch?.[1] === undefined ? null : Number(statusMatch[1])
  if (status !== null && status >= 500) {
    return 'http_5xx'
  }
  if (status !== null && status >= 400) {
    return 'http_4xx'
  }
  if (error instanceof SyntaxError || /json|response.*invalid|malformed/iu.test(error.message)) {
    return 'invalid_response'
  }
  if (
    error instanceof TypeError ||
    /fetch|network|econn|enotfound|dns|tls|socket/iu.test(error.message)
  ) {
    return 'network'
  }
  return 'unknown'
}

/**
 * The ledger lives in memory and is written to session storage at most once
 * per TRACKING_POLL_LEDGER_FLUSH_DELAY_MS and when the page is hidden. Before
 * DON-367 every diagnostic re-read, re-validated and re-wrote the whole stored
 * ledger, which used most of the renderer once the 5-minute re-check started.
 * Session storage is read once, when the ledger is first used.
 */
let retainedEntries: TrackingPollLedgerEntry[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pageHideListenerInstalled = false

/** Stores one identity-free tracking diagnostic entry in a bounded session ledger. */
export function recordTrackingPollLedgerEntry(entry: TrackingPollLedgerEntry): void {
  const normalized = normalizeTrackingPollLedgerEntry(entry)
  if (typeof window === 'undefined' || normalized === null) {
    return
  }
  const entries = loadRetainedEntries()
  entries.push(normalized)
  if (entries.length > TRACKING_POLL_LEDGER_MAX_ENTRIES) {
    entries.splice(0, entries.length - TRACKING_POLL_LEDGER_MAX_ENTRIES)
  }
  scheduleFlush()
}

/** Reads the bounded tracking poll ledger for diagnostics export. */
export function readTrackingPollLedger(): readonly TrackingPollLedgerEntry[] {
  if (typeof window === 'undefined') {
    return []
  }
  return [...loadRetainedEntries()]
}

/** Writes any recorded entries to session storage now. */
export function flushTrackingPollLedger(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (typeof window === 'undefined' || retainedEntries === null) {
    return
  }
  try {
    window.sessionStorage.setItem(TRACKING_POLL_LEDGER_STORAGE_KEY, JSON.stringify(retainedEntries))
  } catch {
    // Diagnostic retention must never interfere with live tracking.
  }
}

/** Clears the tracking poll ledger for tests and validation harness resets. */
export function clearTrackingPollLedger(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  retainedEntries = null
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(TRACKING_POLL_LEDGER_STORAGE_KEY)
  }
}

function loadRetainedEntries(): TrackingPollLedgerEntry[] {
  if (retainedEntries === null) {
    retainedEntries = readStoredEntries().slice(-TRACKING_POLL_LEDGER_MAX_ENTRIES)
  }
  return retainedEntries
}

function readStoredEntries(): TrackingPollLedgerEntry[] {
  try {
    const raw = window.sessionStorage.getItem(TRACKING_POLL_LEDGER_STORAGE_KEY)
    if (raw === null) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.flatMap((entry: unknown) => {
          const normalized = normalizeTrackingPollLedgerEntry(entry)
          return normalized === null ? [] : [normalized]
        })
      : []
  } catch {
    return []
  }
}

function scheduleFlush(): void {
  installPageHideFlush()
  if (flushTimer !== null) {
    return
  }
  flushTimer = setTimeout(flushTrackingPollLedger, TRACKING_POLL_LEDGER_FLUSH_DELAY_MS)
}

function installPageHideFlush(): void {
  if (pageHideListenerInstalled) {
    return
  }
  pageHideListenerInstalled = true
  window.addEventListener('pagehide', flushTrackingPollLedger)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTrackingPollLedger()
  })
}

/** Formats tracking poll evidence and states whether an incident falls inside retained coverage. */
export function formatTrackingPollLedger(
  entries: readonly TrackingPollLedgerEntry[],
  timeFrame?: SupportBundleTimeFrame,
): string {
  const ordered = [...entries].sort((left, right) => Date.parse(left.ts) - Date.parse(right.ts))
  const scoped = filterLedgerByTimeFrame(ordered, timeFrame)
  const lines = [
    '[tracking-poll-ledger]',
    `retention limit: ${TRACKING_POLL_LEDGER_MAX_ENTRIES}`,
    `retained entry count: ${ordered.length}`,
    `coverage start: ${ordered[0]?.ts ?? 'none'}`,
    `coverage end: ${ordered.at(-1)?.ts ?? 'none'}`,
  ]
  if (timeFrame !== undefined) {
    lines.push(`incident coverage: ${describeIncidentCoverage(ordered, timeFrame)}`)
    lines.push(`scoped entry count: ${scoped.length}`)
  }
  if (scoped.length === 0) {
    lines.push('no tracking poll entries in scope')
    return lines.join('\n')
  }
  for (const entry of scoped) {
    lines.push(JSON.stringify(entry))
  }
  return lines.join('\n')
}

function filterLedgerByTimeFrame(
  entries: readonly TrackingPollLedgerEntry[],
  timeFrame: SupportBundleTimeFrame | undefined,
): readonly TrackingPollLedgerEntry[] {
  if (timeFrame === undefined) {
    return entries
  }
  const incidentMs = Date.parse(timeFrame.incidentAt)
  if (!Number.isFinite(incidentMs)) {
    return entries
  }
  const startMs = incidentMs - Math.max(0, timeFrame.beforeMinutes) * 60_000
  const endMs = incidentMs + Math.max(0, timeFrame.afterMinutes) * 60_000
  return entries.filter((entry) => {
    const timestampMs = Date.parse(entry.ts)
    return timestampMs >= startMs && timestampMs <= endMs
  })
}

function describeIncidentCoverage(
  entries: readonly TrackingPollLedgerEntry[],
  timeFrame: SupportBundleTimeFrame,
): 'inside retained range' | 'partially retained' | 'outside retained range' | 'unavailable' {
  const firstMs = Date.parse(entries[0]?.ts ?? '')
  const lastMs = Date.parse(entries.at(-1)?.ts ?? '')
  const incidentMs = Date.parse(timeFrame.incidentAt)
  if (![firstMs, lastMs, incidentMs].every(Number.isFinite)) {
    return 'unavailable'
  }
  const startMs = incidentMs - Math.max(0, timeFrame.beforeMinutes) * 60_000
  const endMs = incidentMs + Math.max(0, timeFrame.afterMinutes) * 60_000
  if (endMs < firstMs || startMs > lastMs) {
    return 'outside retained range'
  }
  if (startMs < firstMs || endMs > lastMs) {
    return 'partially retained'
  }
  return 'inside retained range'
}

type NormalizedRecheckBacklog = {
  readonly recheckBacklog?: readonly TrackingRecheckBacklogRange[]
  readonly recheckBacklogDeviceCount?: number
  readonly recheckBacklogRangeCount?: number
  readonly recheckBacklogOmittedRangeCount?: number
}

/**
 * Keeps the oldest well-formed re-check backlog ranges of a ledger entry, with
 * counts over the whole backlog. Counts already stored with a trimmed entry are
 * kept; otherwise they are counted from the ranges given [DON-367].
 */
function normalizeRecheckBacklog(candidate: Record<string, unknown>): NormalizedRecheckBacklog {
  const input = candidate.recheckBacklog
  if (!Array.isArray(input)) return {}
  const ranges: TrackingRecheckBacklogRange[] = []
  const deviceIds = new Set<string>()
  let omitted = 0
  for (const entry of input as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const range = entry as Record<string, unknown>
    if (typeof range.deviceId !== 'string') continue
    if (ranges.length >= TRACKING_POLL_LEDGER_MAX_BACKLOG_RANGES) {
      // Counted, not kept: no timestamp work for ranges that are left out.
      if (typeof range.from === 'string' && typeof range.to === 'string') {
        deviceIds.add(range.deviceId)
        omitted += 1
      }
      continue
    }
    const from = normalizeTimestamp(range.from)
    const to = normalizeTimestamp(range.to)
    if (from === null || to === null) continue
    deviceIds.add(range.deviceId)
    ranges.push({ deviceId: range.deviceId, from, to })
  }
  const storedRangeCount = normalizeCount(candidate.recheckBacklogRangeCount)
  const storedDeviceCount = normalizeCount(candidate.recheckBacklogDeviceCount)
  const storedOmitted = normalizeCount(candidate.recheckBacklogOmittedRangeCount)
  const trimmedBefore = storedRangeCount !== null && storedOmitted !== null && storedDeviceCount !== null
  return {
    recheckBacklog: ranges,
    recheckBacklogDeviceCount: trimmedBefore ? storedDeviceCount : deviceIds.size,
    recheckBacklogRangeCount: trimmedBefore ? storedRangeCount : ranges.length + omitted,
    recheckBacklogOmittedRangeCount: trimmedBefore ? storedOmitted : omitted,
  }
}

function normalizeTrackingPollLedgerEntry(input: unknown): TrackingPollLedgerEntry | null {
  if (typeof input !== 'object' || input === null) {
    return null
  }
  const candidate = input as Record<string, unknown>
  const timestampMs = typeof candidate.ts === 'string' ? Date.parse(candidate.ts) : Number.NaN
  if (candidate.kind === 'breadcrumb_reconciliation') {
    const targetFrom = normalizeTimestamp(candidate.targetFrom)
    const targetTo = normalizeTimestamp(candidate.targetTo)
    const reconciliationPhase =
      candidate.reconciliationPhase === 'initial' ||
      candidate.reconciliationPhase === 'anti_entropy'
        ? candidate.reconciliationPhase
        : null
    const counts = [
      normalizeCount(candidate.totalDeviceCount),
      normalizeCount(candidate.completedDeviceCount),
      normalizeCount(candidate.totalChunkCount),
      normalizeCount(candidate.completedChunkCount),
      normalizeCount(candidate.pendingDeviceCount),
      normalizeCount(candidate.failedDeviceCount),
      normalizeCount(candidate.elapsedMs),
    ]
    if (
      !Number.isFinite(timestampMs) ||
      (candidate.outcome !== 'progress' && candidate.outcome !== 'complete') ||
      reconciliationPhase === null ||
      targetFrom === null ||
      targetTo === null ||
      counts.some((count) => count === null)
    ) {
      return null
    }
    return {
      ts: new Date(timestampMs).toISOString(),
      kind: 'breadcrumb_reconciliation',
      outcome: candidate.outcome,
      reconciliationPhase,
      targetFrom,
      targetTo,
      totalDeviceCount: counts[0]!,
      completedDeviceCount: counts[1]!,
      totalChunkCount: counts[2]!,
      completedChunkCount: counts[3]!,
      pendingDeviceCount: counts[4]!,
      failedDeviceCount: counts[5]!,
      elapsedMs: counts[6]!,
      ...normalizeRecheckBacklog(candidate),
    }
  }
  const phase = normalizePhase(candidate.phase)
  const durationMs = normalizeCount(candidate.durationMs)
  if (!Number.isFinite(timestampMs) || phase === null || durationMs === null) {
    return null
  }
  const ts = new Date(timestampMs).toISOString()

  if (candidate.kind === 'request_attempt') {
    const attempt = normalizeCount(candidate.attempt)
    const maxAttempts = normalizeCount(candidate.maxAttempts)
    const failureKind = normalizeFailureKind(candidate.failureKind)
    if (
      (candidate.outcome !== 'failure' && candidate.outcome !== 'recovered') ||
      attempt === null ||
      maxAttempts === null ||
      failureKind === null
    ) {
      return null
    }
    return {
      ts,
      kind: 'request_attempt',
      outcome: candidate.outcome,
      phase,
      durationMs,
      attempt,
      maxAttempts,
      failureKind,
      httpStatus: normalizeHttpStatus(candidate.httpStatus),
    }
  }

  if (
    candidate.kind !== 'poll_cycle' ||
    (candidate.outcome !== 'success' &&
      candidate.outcome !== 'failure' &&
      candidate.outcome !== 'recovered')
  ) {
    return null
  }
  const consecutiveFailures = normalizeCount(candidate.consecutiveFailures)
  const retryDelayMs = normalizeCount(candidate.retryDelayMs)
  if (consecutiveFailures === null || retryDelayMs === null) {
    return null
  }
  return {
    ts,
    kind: 'poll_cycle',
    outcome: candidate.outcome,
    phase,
    durationMs,
    consecutiveFailures,
    retryDelayMs,
    ...copyOptionalCount(candidate, 'outageDurationMs'),
    ...copyOptionalFailureKind(candidate),
    ...copyOptionalCount(candidate, 'deviceCount'),
    ...copyOptionalCount(candidate, 'currentPositionCount'),
    ...copyOptionalCount(candidate, 'breadcrumbRequestedDeviceCount'),
    ...copyOptionalCount(candidate, 'breadcrumbReturnedCount'),
    ...copyOptionalCount(candidate, 'breadcrumbAcceptedCount'),
    ...copyOptionalCount(candidate, 'breadcrumbDuplicateCount'),
    ...copyOptionalCount(candidate, 'breadcrumbRejectedCount'),
    ...copyOptionalCount(candidate, 'breadcrumbFailedDeviceCount'),
    ...copyOptionalBreadcrumbWindow(candidate),
  }
}

function normalizePhase(input: unknown): TrackingPollPhase | null {
  return input === 'authentication' ||
    input === 'devices' ||
    input === 'current_positions' ||
    input === 'breadcrumbs'
    ? input
    : null
}

function normalizeFailureKind(input: unknown): TrackingPollFailureKind | null {
  return input === 'authentication' ||
    input === 'timeout' ||
    input === 'network' ||
    input === 'http_4xx' ||
    input === 'http_5xx' ||
    input === 'invalid_response' ||
    input === 'unknown'
    ? input
    : null
}

function normalizeCount(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input)
    ? Math.max(0, Math.round(input))
    : null
}

function normalizeHttpStatus(input: unknown): number | null {
  const status = normalizeCount(input)
  return status !== null && status >= 100 && status <= 599 ? status : null
}

function copyOptionalCount(
  candidate: Record<string, unknown>,
  key:
    | 'outageDurationMs'
    | 'deviceCount'
    | 'currentPositionCount'
    | 'breadcrumbRequestedDeviceCount'
    | 'breadcrumbReturnedCount'
    | 'breadcrumbAcceptedCount'
    | 'breadcrumbDuplicateCount'
    | 'breadcrumbRejectedCount'
    | 'breadcrumbFailedDeviceCount',
): Partial<TrackingPollCycleEntry> {
  const value = normalizeCount(candidate[key])
  return value === null ? {} : { [key]: value }
}

function copyOptionalFailureKind(
  candidate: Record<string, unknown>,
): Partial<TrackingPollCycleEntry> {
  const failureKind = normalizeFailureKind(candidate.failureKind)
  return failureKind === null ? {} : { failureKind }
}

function copyOptionalBreadcrumbWindow(
  candidate: Record<string, unknown>,
): Partial<TrackingPollCycleEntry> {
  if (typeof candidate.breadcrumbWindow !== 'object' || candidate.breadcrumbWindow === null) {
    return {}
  }
  const window = candidate.breadcrumbWindow as Record<string, unknown>
  const requestedFromEarliest = normalizeTimestamp(window.requestedFromEarliest)
  const requestedFromLatest = normalizeTimestamp(window.requestedFromLatest)
  const requestedTo = normalizeTimestamp(window.requestedTo)
  if (
    requestedFromEarliest === null ||
    requestedFromLatest === null ||
    requestedTo === null
  ) {
    return {}
  }
  const previousCursorEarliest = normalizeTimestamp(window.previousCursorEarliest)
  const previousCursorLatest = normalizeTimestamp(window.previousCursorLatest)
  const newestReturnedEarliest = normalizeTimestamp(window.newestReturnedEarliest)
  const newestReturnedLatest = normalizeTimestamp(window.newestReturnedLatest)
  return {
    breadcrumbWindow: {
      requestedFromEarliest,
      requestedFromLatest,
      requestedTo,
      ...(previousCursorEarliest === null ? {} : { previousCursorEarliest }),
      ...(previousCursorLatest === null ? {} : { previousCursorLatest }),
      ...(newestReturnedEarliest === null ? {} : { newestReturnedEarliest }),
      ...(newestReturnedLatest === null ? {} : { newestReturnedLatest }),
    },
  }
}

function normalizeTimestamp(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }
  const timestampMs = Date.parse(input)
  return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null
}
