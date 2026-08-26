const FAILURE_CLASSES = new Set([
  'action_unavailable',
  'browser_target_closed',
  'graceful_app_quit_failed',
  'host_sleep_guard_unavailable',
  'later_traversal_limit',
  'observation_metrics_invalid',
  'owned_harness_click_unverified',
  'owned_process_cleanup_failed',
  'outward_traversal_limit',
  'publication_mismatch',
  'rss_evidence_invalid',
  'terminal_control_invalid',
  'ui_page_action_limit',
  'unclassified_harness_error',
])

const PHASES = new Set([
  'initializing',
  'tracking',
  'checkpoint_latest',
  'final_latest_before',
  'outward',
  'later',
  'final_latest_after',
  'line_total',
  'closeout',
])

const DIRECTIONS = new Set(['earlier', 'later', 'latest'])
const ACTION_FAILURE_CLASSES = new Set(['click_timeout_or_interception'])
const TIMING_KEYS = [
  'pageActionDurationMs',
  'publicationDurationMs',
  'stableVerificationDurationMs',
  'fingerprintDurationMs',
  'proofOverheadDurationMs',
  'outwardTraversalDurationMs',
  'laterTraversalDurationMs',
  'proofWallDurationMs',
]

/**
 * Creates a terminal failure artifact containing only allowlisted proof state.
 * Raw exceptions and caller-owned nested objects are never serialized.
 */
export function createTrackingSoakFailureReport(input) {
  const explicitClass = input?.error?.exactDotGateFailure?.failureClass
  const lifecycleClass = input?.error?.trackingSoakLifecycleFailure?.failureClass
  const auditClass = input?.error?.trackingSoakAuditFailure?.failureClass
  const rendererLifecycle = sanitizeRendererLifecycle(input?.rendererLifecycle)
  const browserTargetClosed =
    rendererLifecycle.pageCloseCount > 0 ||
    rendererLifecycle.pageCrashCount > 0 ||
    rendererLifecycle.browserDisconnectCount > 0 ||
    rendererLifecycle.replacementPageCount > 0
  const failureClass = browserTargetClosed
    ? 'browser_target_closed'
    : FAILURE_CLASSES.has(auditClass)
      ? auditClass
    : FAILURE_CLASSES.has(lifecycleClass)
      ? lifecycleClass
      : FAILURE_CLASSES.has(explicitClass)
    ? explicitClass
    : input?.error?.exactDotPublicationFailure !== undefined
      ? 'publication_mismatch'
      : input?.error?.exactDotActionFailure !== undefined
        ? 'action_unavailable'
        : 'unclassified_harness_error'
  const report = {
    schemaVersion: 1,
    issue: 'DON-260',
    recordedAt: canonicalTimestamp(input?.recordedAt) ??
      new Date().toISOString(),
    profileName: ['ci', 'normal', 'extended'].includes(input?.profileName)
      ? input.profileName
      : 'unknown',
    passed: false,
    failureClass,
    progress: sanitizeProgress(input?.progress),
  }
  if (input?.rendererLifecycle !== undefined) {
    report.rendererLifecycle = rendererLifecycle
  }
  if (input?.hostSleepGuard !== undefined) {
    report.hostSleepGuard = sanitizeHostSleepGuard(input.hostSleepGuard)
  }
  const publication = sanitizePublicationFailure(
    input?.error?.exactDotPublicationFailure,
  )
  if (publication !== null) report.exactDotPublicationFailure = publication
  const action = sanitizeActionFailure(input?.error?.exactDotActionFailure)
  if (action !== null) report.exactDotActionFailure = action
  return report
}

/** Retains only known progress fields and bounded timing aggregates. */
function sanitizeProgress(value) {
  const progress = {
    phase: PHASES.has(value?.phase) ? value.phase : 'initializing',
  }
  if (DIRECTIONS.has(value?.direction)) progress.direction = value.direction
  const pageIndexFromLatest = boundedInteger(value?.pageIndexFromLatest, 10_000)
  if (pageIndexFromLatest !== null) {
    progress.pageIndexFromLatest = pageIndexFromLatest
  }
  const completedUiPageObservations = boundedInteger(
    value?.completedUiPageObservations,
    10_000,
  )
  if (completedUiPageObservations !== null) {
    progress.completedUiPageObservations = completedUiPageObservations
  }
  const completedDirectIpcQueries = boundedInteger(
    value?.completedDirectIpcQueries,
    100,
  )
  if (completedDirectIpcQueries !== null) {
    progress.completedDirectIpcQueries = completedDirectIpcQueries
  }
  for (const [key, maximum] of [
    ['launchNumber', 100],
    ['targetBatch', 10_000],
    ['currentBatch', 10_000],
  ]) {
    const bounded = boundedInteger(value?.[key], maximum)
    if (bounded !== null) progress[key] = bounded
  }
  const timing = {}
  for (const key of TIMING_KEYS) {
    const duration = boundedDuration(value?.timing?.[key])
    if (duration !== null) timing[key] = duration
  }
  if (Object.keys(timing).length > 0) progress.timing = timing
  return progress
}

/** Retains only bounded renderer target lifecycle counters and enum state. */
function sanitizeRendererLifecycle(value) {
  return {
    pageCloseCount: boundedInteger(value?.pageCloseCount, 100) ?? 0,
    pageCrashCount: boundedInteger(value?.pageCrashCount, 100) ?? 0,
    browserDisconnectCount:
      boundedInteger(value?.browserDisconnectCount, 100) ?? 0,
    replacementPageCount:
      boundedInteger(value?.replacementPageCount, 100) ?? 0,
    mainFrameNavigationCount:
      boundedInteger(value?.mainFrameNavigationCount, 10_000) ?? 0,
    lastEvent: [
      'none',
      'page_closed',
      'page_crashed',
      'browser_disconnected',
      'replacement_page',
      'main_frame_navigation',
    ].includes(value?.lastEvent)
      ? value.lastEvent
      : 'none',
  }
}

/** Retains only boolean run-owned sleep-guard lifecycle state. */
function sanitizeHostSleepGuard(value) {
  return {
    required: value?.required === true,
    started: value?.started === true,
    active: value?.active === true,
    earlyExit: value?.earlyExit === true,
    stopped: value?.stopped === true,
    forced: value?.forced === true,
  }
}

/** Rebuilds one publication mismatch envelope field by field. */
function sanitizePublicationFailure(value) {
  if (typeof value !== 'object' || value === null) return null
  return {
    pageIndexFromLatest: boundedInteger(value.pageIndexFromLatest, 10_000),
    mismatchObservationCount: boundedInteger(
      value.mismatchObservationCount,
      100_000,
    ),
    expected: sanitizeSourceEvidence(value.expected, true),
    firstMismatch: sanitizeMismatchObservation(value.firstMismatch),
    lastMismatch: sanitizeMismatchObservation(value.lastMismatch),
  }
}

/** Retains only non-identifying source/operator mismatch proof. */
function sanitizeMismatchObservation(value) {
  if (typeof value !== 'object' || value === null) return null
  return {
    loading: value.loading === true,
    refreshing:
      typeof value.refreshing === 'boolean' ? value.refreshing : null,
    unavailable: value.unavailable === true,
    baselineBreadcrumbPointCount: boundedInteger(
      value.baselineBreadcrumbPointCount,
      10_000_000,
    ),
    source: sanitizeSourceEvidence(value.source),
    operator: sanitizeOperatorEvidence(value.operator),
  }
}

/** Retains only count/digest/timestamp-range source evidence. */
function sanitizeSourceEvidence(value, assumeValid = false) {
  const positionCount = boundedInteger(value?.positionCount, 10_000)
  const sha256 = typeof value?.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sha256)
    ? value.sha256
    : null
  return {
    valid: (assumeValid || value?.valid === true) &&
      positionCount !== null && sha256 !== null,
    positionCount,
    sha256,
    range: {
      positionCount: boundedInteger(value?.range?.positionCount, 10_000),
      fromTimestamp: canonicalTimestamp(value?.range?.fromTimestamp),
      toTimestamp: canonicalTimestamp(value?.range?.toTimestamp),
    },
  }
}

/** Retains only operator counts and canonical timestamps. */
function sanitizeOperatorEvidence(value) {
  return {
    valid: value?.valid === true,
    pagePositionCount: boundedInteger(value?.pagePositionCount, 10_000),
    totalPositionCount: boundedInteger(value?.totalPositionCount, 10_000_000),
    fromTimestamp: canonicalTimestamp(value?.fromTimestamp),
    toTimestamp: canonicalTimestamp(value?.toTimestamp),
  }
}

/** Rebuilds one action envelope without raw selector, text, or error data. */
function sanitizeActionFailure(value) {
  if (typeof value !== 'object' || value === null) return null
  return {
    action: ['earlier', 'later'].includes(value.action) ? value.action : null,
    pageIndexFromLatest: boundedInteger(value.pageIndexFromLatest, 10_000),
    failureClass: FAILURE_CLASSES.has(value.failureClass)
      ? value.failureClass
      : ACTION_FAILURE_CLASSES.has(value.failureClass)
        ? value.failureClass
        : 'action_unavailable',
    first: sanitizeActionObservation(value.first),
    last: sanitizeActionObservation(value.last),
  }
}

/** Retains only bounded, non-textual UI geometry evidence. */
function sanitizeActionObservation(value) {
  if (typeof value !== 'object' || value === null) return null
  const box = value.bbox
  return {
    bbox: box === null || typeof box !== 'object'
      ? null
      : {
          x: boundedScreenCoordinate(box.x),
          y: boundedScreenCoordinate(box.y),
          width: boundedScreenCoordinate(box.width),
          height: boundedScreenCoordinate(box.height),
        },
    intercept: value.intercept === null || typeof value.intercept !== 'object'
      ? null
      : {
          tag: boundedToken(value.intercept.tag)?.toLowerCase() ?? null,
          testId: boundedToken(value.intercept.testId),
          className: boundedToken(value.intercept.className),
        },
  }
}

/** Bounds a non-negative evidence integer. */
function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null
}

/** Bounds and rounds one duration without preserving raw numeric payloads. */
function boundedDuration(value) {
  return Number.isFinite(value) && value >= 0 && value <= 86_400_000
    ? Math.round(value * 1_000) / 1_000
    : null
}

/** Bounds non-geographic screenshot geometry to the desktop surface. */
function boundedScreenCoordinate(value) {
  return Number.isFinite(value) && value >= -100_000 && value <= 100_000
    ? Math.round(value * 10) / 10
    : null
}

/** Allows diagnostic DOM tokens, never arbitrary visible text. */
function boundedToken(value) {
  return typeof value === 'string' && /^[a-z0-9 _-]{1,80}$/iu.test(value)
    ? value
    : null
}

/** Retains canonical ISO instants only. */
function canonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length > 32) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
    ? value
    : null
}
