import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import { createBreadcrumb36HourSourceDatabase } from './breadcrumb-36h-mock-traccar.js'

const require = createRequire(import.meta.url)
const { listBreadcrumbPositions } = require('../electron/breadcrumb-query.cjs')

const DEFAULT_NORMAL_POLL_INTERVAL_MS = 30_000
const DEFAULT_RECONCILIATION_TIMEOUT_MS = 60_000
const DEFAULT_PERSISTENCE_TIMEOUT_MS = 120_000
const DEFAULT_MOCK_LATENCY_MS = 20
const DEFAULT_POST_COMPLETION_RESTART_COUNT = 3
const MAX_CURRENT_FIX_MS = 5_000
const MAX_FIRST_BREADCRUMB_MS = 10_000
const MAX_FULL_RECONCILIATION_MS = 60_000
const MAX_HISTORY_CONCURRENCY = 8
const RENDER_BREADCRUMB_LIMIT_PER_DEVICE = 5_000
const RENDER_BREADCRUMB_GAP_THRESHOLD_MS = 30 * 60 * 1_000
const EARTH_RADIUS_METRES = 6_371_008.8
export const MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_METRES = 8
// MapLibre 5.22 encodes GeoJSON at extent 8192 and displays vector tiles at
// 512 CSS pixels. geojson-vt rounds X/Y independently to at most half a grid
// interval at the integer tile zoom. Fractional map zoom magnifies that error
// by less than 2, so the public queryRenderedFeatures -> map.project audit can
// approach one complete interval on each axis. The radial limit is therefore
// the diagonal of that square, not the per-axis interval.
const MAPLIBRE_GEOJSON_TILE_EXTENT = 8_192
const MAPLIBRE_TILE_SIZE_SCREEN_PIXELS = 512
export const MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_PER_AXIS =
  MAPLIBRE_TILE_SIZE_SCREEN_PIXELS / MAPLIBRE_GEOJSON_TILE_EXTENT
export const MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_EUCLIDEAN =
  Math.SQRT2 * MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_PER_AXIS

/**
 * Reads only the two first-publication counts needed by the timed milestone
 * loop. The function is deliberately self-contained because Playwright
 * serializes it into the renderer; no GeoJSON rows cross CDP.
 */
export async function readCompactBreadcrumbMilestoneEvidenceInRenderer(input) {
  let currentPositionCount = null
  let exactBreadcrumbPointCount = null

  if (input?.readCurrentPositions === true) {
    const trackingData = window.__SARTRACKER_TRACKING_SET_DATA_CAPTURE__?.latest
    currentPositionCount =
      trackingData?.type === 'FeatureCollection' && Array.isArray(trackingData.features)
        ? trackingData.features.filter(
            (feature) => feature?.properties?.featureKind === 'device',
          ).length
        : 0
  }

  if (input?.readExactBreadcrumbs === true) {
    const exactSource = window.__SARTRACKER_MAP__?.getSource(
      'tracking-breadcrumb-dots-exact',
    )
    const exactData =
      exactSource === undefined
        ? null
        : typeof exactSource.getData === 'function'
          ? await exactSource.getData()
          : typeof exactSource.serialize === 'function'
            ? exactSource.serialize()?.data
            : null
    exactBreadcrumbPointCount =
      exactData?.type === 'FeatureCollection' && Array.isArray(exactData.features)
        ? exactData.features.filter(
            (feature) =>
              feature?.properties?.featureKind === 'breadcrumb' &&
              feature?.geometry?.type === 'Point',
          ).length
        : 0
  }

  return {
    sampledAtUnixMs: Date.now(),
    currentPositionCount,
    exactBreadcrumbPointCount,
  }
}

/**
 * Normalizes MapLibre rendered exact-dot features around the authoritative
 * device/source identity properties. GeoJSON-VT can omit string Feature.id
 * values from rendered-query results, so the audit derives the same stable
 * identity while retaining explicit ID transport diagnostics.
 */
export function normalizeRenderedExactBreadcrumbDotFeaturesForAudit(features) {
  const idTypeCounts = { undefined: 0, number: 0, string: 0, other: 0 }
  const byStableIdentity = new Map()
  let derivedIdentityCount = 0
  let missingStableIdentityCount = 0
  let explicitStringIdMismatchCount = 0
  let duplicateConflictCount = 0

  for (const [index, feature] of features.entries()) {
    const rawIdType = typeof feature?.id
    if (rawIdType === 'undefined' || rawIdType === 'number' || rawIdType === 'string') {
      idTypeCounts[rawIdType] += 1
    } else {
      idTypeCounts.other += 1
    }
    const stableIdentity = getExactDotAuditIdentity(feature)
    if (stableIdentity === null) {
      missingStableIdentityCount += 1
      byStableIdentity.set(`invalid:${index}`, feature)
      continue
    }
    derivedIdentityCount += 1
    if (typeof feature.id === 'string' && feature.id !== stableIdentity) {
      explicitStringIdMismatchCount += 1
    }
    const normalizedFeature = {
      type: 'Feature',
      id: stableIdentity,
      geometry: feature.geometry,
      properties: feature.properties,
      auditScreenPixelErrorX: feature.auditScreenPixelErrorX,
      auditScreenPixelErrorY: feature.auditScreenPixelErrorY,
    }
    const existingFeature = byStableIdentity.get(stableIdentity)
    if (
      existingFeature !== undefined &&
      !exactRenderedTileCopiesMatch(existingFeature, normalizedFeature)
    ) {
      duplicateConflictCount += 1
      continue
    }
    byStableIdentity.set(stableIdentity, normalizedFeature)
  }

  return {
    type: 'FeatureCollection',
    features: [...byStableIdentity.values()],
    rawFeatureCount: features.length,
    derivedIdentityCount,
    missingStableIdentityCount,
    duplicateDerivedIdentityCount:
      derivedIdentityCount -
      [...byStableIdentity.keys()].filter((identity) => !identity.startsWith('invalid:')).length,
    duplicateConflictCount,
    explicitStringIdMismatchCount,
    identityValidationErrorCount:
      explicitStringIdMismatchCount + duplicateConflictCount,
    idTypeCounts,
  }
}

function exactRenderedTileCopiesMatch(left, right) {
  const leftCoordinates = left.geometry?.coordinates
  const rightCoordinates = right.geometry?.coordinates
  return (
    left.properties?.timestamp === right.properties?.timestamp &&
    isFinitePoint(leftCoordinates) &&
    isFinitePoint(rightCoordinates) &&
    leftCoordinates[0] === rightCoordinates[0] &&
    leftCoordinates[1] === rightCoordinates[1]
  )
}

/**
 * Joins rendered exact dots back to source identity/time and quantifies only
 * the coordinate displacement introduced by MapLibre's rendered tile path.
 */
export function measureExactBreadcrumbDotRenderedDeviation(
  sourceFeatures,
  renderedFeatures,
  options = {},
) {
  const maximumAllowedMetres =
    options.maximumAllowedMetres ?? MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_METRES
  const maximumAllowedScreenPixelsPerAxis =
    options.maximumAllowedScreenPixelsPerAxis ??
    MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_PER_AXIS
  const maximumAllowedScreenPixelsEuclidean =
    options.maximumAllowedScreenPixelsEuclidean ??
    MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_EUCLIDEAN
  const source = indexExactDotAuditFeatures(sourceFeatures)
  const rendered = indexExactDotAuditFeatures(renderedFeatures)
  let missingIdentityCount = 0
  let unexpectedIdentityCount = 0
  let timestampConflictCount = 0
  let coordinateConflictCount = 0
  const deviations = []

  for (const [identity, sourceFeature] of source.byIdentity) {
    const renderedFeature = rendered.byIdentity.get(identity)
    if (renderedFeature === undefined) {
      missingIdentityCount += 1
      continue
    }
    if (renderedFeature.properties?.timestamp !== sourceFeature.properties?.timestamp) {
      timestampConflictCount += 1
    }
    const sourceCoordinates = sourceFeature.geometry?.coordinates
    const renderedCoordinates = renderedFeature.geometry?.coordinates
    const screenPixelsX = renderedFeature.auditScreenPixelErrorX
    const screenPixelsY = renderedFeature.auditScreenPixelErrorY
    if (
      !isFinitePoint(sourceCoordinates) ||
      !isFinitePoint(renderedCoordinates) ||
      !Number.isFinite(screenPixelsX) ||
      !Number.isFinite(screenPixelsY) ||
      screenPixelsX < 0 ||
      screenPixelsY < 0
    ) {
      coordinateConflictCount += 1
      continue
    }
    deviations.push({
      identity,
      metres: haversineDistanceMetres(
        { lat: sourceCoordinates[1], lon: sourceCoordinates[0] },
        { lat: renderedCoordinates[1], lon: renderedCoordinates[0] },
      ),
      screenPixelsX,
      screenPixelsY,
      screenPixelsEuclidean: Math.hypot(screenPixelsX, screenPixelsY),
    })
  }
  for (const identity of rendered.byIdentity.keys()) {
    if (!source.byIdentity.has(identity)) {
      unexpectedIdentityCount += 1
    }
  }

  const metreValues = deviations.map((entry) => entry.metres).sort(compareNumbers)
  const screenPixelXValues = deviations
    .map((entry) => entry.screenPixelsX)
    .sort(compareNumbers)
  const screenPixelYValues = deviations
    .map((entry) => entry.screenPixelsY)
    .sort(compareNumbers)
  const screenPixelEuclideanValues = deviations
    .map((entry) => entry.screenPixelsEuclidean)
    .sort(compareNumbers)
  const worstMetres = deviations.reduce(
    (selected, entry) => selected === null || entry.metres > selected.metres
      ? entry
      : selected,
    null,
  )
  const worstScreenPixels = deviations.reduce(
    (selected, entry) =>
      selected === null || entry.screenPixelsEuclidean > selected.screenPixelsEuclidean
        ? entry
        : selected,
    null,
  )
  const metres = summarizeDeviationValues(metreValues)
  const screenPixels = {
    x: summarizeDeviationValues(screenPixelXValues),
    y: summarizeDeviationValues(screenPixelYValues),
    euclidean: summarizeDeviationValues(screenPixelEuclideanValues),
  }
  const conflictCount =
    source.invalidIdentityCount +
    rendered.invalidIdentityCount +
    source.duplicateIdentityCount +
    rendered.duplicateIdentityCount
  return {
    passed:
      missingIdentityCount === 0 &&
      unexpectedIdentityCount === 0 &&
      timestampConflictCount === 0 &&
      coordinateConflictCount === 0 &&
      conflictCount === 0 &&
      deviations.length === source.byIdentity.size &&
      (metres.max ?? Infinity) <= maximumAllowedMetres &&
      (screenPixels.x.max ?? Infinity) <= maximumAllowedScreenPixelsPerAxis &&
      (screenPixels.y.max ?? Infinity) <= maximumAllowedScreenPixelsPerAxis &&
      (screenPixels.euclidean.max ?? Infinity) <=
        maximumAllowedScreenPixelsEuclidean,
    comparedIdentityCount: deviations.length,
    missingIdentityCount,
    unexpectedIdentityCount,
    timestampConflictCount,
    coordinateConflictCount,
    invalidIdentityCount:
      source.invalidIdentityCount + rendered.invalidIdentityCount,
    duplicateIdentityCount:
      source.duplicateIdentityCount + rendered.duplicateIdentityCount,
    maximumAllowedMetres,
    maximumAllowedScreenPixelsPerAxis,
    maximumAllowedScreenPixelsEuclidean,
    metres,
    screenPixels,
    worstMetreIdentity: worstMetres?.identity ?? null,
    worstScreenPixelIdentity: worstScreenPixels?.identity ?? null,
  }
}

function indexExactDotAuditFeatures(features) {
  const byIdentity = new Map()
  let invalidIdentityCount = 0
  let duplicateIdentityCount = 0
  for (const feature of features) {
    const identity = getExactDotAuditIdentity(feature)
    if (identity === null) {
      invalidIdentityCount += 1
      continue
    }
    if (byIdentity.has(identity)) {
      duplicateIdentityCount += 1
    }
    byIdentity.set(identity, feature)
  }
  return { byIdentity, invalidIdentityCount, duplicateIdentityCount }
}

function getExactDotAuditIdentity(feature) {
  const deviceId = typeof feature?.properties?.deviceId === 'string'
    ? feature.properties.deviceId.trim()
    : ''
  const sourcePositionId = typeof feature?.properties?.sourcePositionId === 'string'
    ? feature.properties.sourcePositionId.trim()
    : ''
  return deviceId === '' || sourcePositionId === ''
    ? null
    : `${deviceId}:id:${sourcePositionId}`
}

function isFinitePoint(coordinates) {
  return (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1])
  )
}

function summarizeDeviationValues(values) {
  return {
    p50: selectDeviationPercentile(values, 0.5),
    p95: selectDeviationPercentile(values, 0.95),
    max: values.at(-1) ?? null,
  }
}

function selectDeviationPercentile(values, percentile) {
  return values[Math.floor((values.length - 1) * percentile)] ?? null
}

function compareNumbers(left, right) {
  return left - right
}

/** Returns true once a child has either exited normally or by signal. */
export function processExited(process) {
  return process.exitCode !== null || process.signalCode !== null
}

/** Terminates one proof-owned child and returns fail-closed exit evidence. */
export async function cleanupOwnedProcess(process, options) {
  if (!processExited(process)) {
    process.kill('SIGTERM')
    await options.waitForExit(process, options.gracefulTimeoutMs ?? 5_000)
  }
  if (!processExited(process)) {
    process.kill('SIGKILL')
    await options.waitForExit(process, options.forceTimeoutMs ?? 5_000)
  }
  return {
    exitCode: process.exitCode,
    signalCode: process.signalCode,
    cleanupComplete: processExited(process),
  }
}

/** Parses the explicit packaged 36-hour proof command line. */
export function parseBreadcrumb36HourProofArgs(argv) {
  const parsed = { extraArgs: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
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
      case '--poll-interval-ms':
        parsed.normalPollIntervalMs = Number(nextValue())
        break
      case '--reconciliation-timeout-ms':
        parsed.reconciliationTimeoutMs = Number(nextValue())
        break
      case '--persistence-timeout-ms':
        parsed.persistenceTimeoutMs = Number(nextValue())
        break
      case '--latency-ms':
        parsed.latencyMs = Number(nextValue())
        break
      case '--post-completion-restarts':
        parsed.postCompletionRestartCount = Number(nextValue())
        break
      case '--':
        parsed.extraArgs.push(...argv.slice(index + 1))
        index = argv.length
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (typeof parsed.appPath !== 'string' || parsed.appPath.trim() === '') {
    throw new Error('--app <packaged Electron binary> is required.')
  }
  const normalPollIntervalMs = boundedInteger(
    parsed.normalPollIntervalMs,
    DEFAULT_NORMAL_POLL_INTERVAL_MS,
    5_000,
    3_600_000,
    '--poll-interval-ms',
  )
  const reconciliationTimeoutMs = boundedInteger(
    parsed.reconciliationTimeoutMs,
    DEFAULT_RECONCILIATION_TIMEOUT_MS,
    1,
    120_000,
    '--reconciliation-timeout-ms',
  )

  return {
    appPath: parsed.appPath,
    evidenceDir: parsed.evidenceDir ?? 'output/electron-breadcrumb-36h-proof',
    normalPollIntervalMs,
    reconciliationTimeoutMs,
    persistenceTimeoutMs: boundedInteger(
      parsed.persistenceTimeoutMs,
      DEFAULT_PERSISTENCE_TIMEOUT_MS,
      1_000,
      10 * 60_000,
      '--persistence-timeout-ms',
    ),
    latencyMs: boundedInteger(
      parsed.latencyMs,
      DEFAULT_MOCK_LATENCY_MS,
      0,
      60_000,
      '--latency-ms',
    ),
    postCompletionRestartCount: boundedInteger(
      parsed.postCompletionRestartCount,
      DEFAULT_POST_COMPLETION_RESTART_COUNT,
      1,
      10,
      '--post-completion-restarts',
    ),
    extraArgs: parsed.extraArgs,
  }
}

/**
 * Merges successful request intervals and proves whole-window coverage for
 * each required device. Failed attempts remain in the raw ledger but cannot
 * satisfy coverage.
 */
export function analyzeBreadcrumbRequestCoverage(input) {
  const requiredFrom = normalizeTimestamp(input.requiredFrom, 'required coverage start')
  const requiredTo = normalizeTimestamp(input.requiredTo, 'required coverage end')
  const requiredFromMs = Date.parse(requiredFrom)
  const requiredToMs = Date.parse(requiredTo)
  if (requiredToMs < requiredFromMs) {
    throw new Error('Required breadcrumb coverage window is reversed.')
  }

  const devices = [...input.deviceIds]
    .sort(compareDeviceIds)
    .map((deviceId) => {
      const intervals = input.requestLedger
        .filter(
          (entry) =>
            entry.kind === 'history' &&
            entry.deviceId === deviceId &&
            entry.outcome === 'success' &&
            entry.httpStatus === 200,
        )
        .flatMap((entry) => {
          const fromMs = Date.parse(entry.from)
          const toMs = Date.parse(entry.to)
          if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
            return []
          }
          const clippedFromMs = Math.max(requiredFromMs, fromMs)
          const clippedToMs = Math.min(requiredToMs, toMs)
          return clippedToMs < clippedFromMs
            ? []
            : [{ fromMs: clippedFromMs, toMs: clippedToMs }]
        })
        .sort((left, right) => left.fromMs - right.fromMs || left.toMs - right.toMs)

      const gaps = []
      let coveredUntilMs = requiredFromMs
      for (const interval of intervals) {
        if (interval.fromMs > coveredUntilMs) {
          gaps.push({
            from: new Date(coveredUntilMs).toISOString(),
            to: new Date(interval.fromMs).toISOString(),
          })
        }
        coveredUntilMs = Math.max(coveredUntilMs, interval.toMs)
      }
      if (coveredUntilMs < requiredToMs) {
        gaps.push({
          from: new Date(coveredUntilMs).toISOString(),
          to: requiredTo,
        })
      }

      return {
        deviceId,
        requestCount: intervals.length,
        complete: gaps.length === 0,
        gaps,
      }
    })
  const incompleteDeviceIds = devices
    .filter((device) => !device.complete)
    .map((device) => device.deviceId)

  return {
    complete: incompleteDeviceIds.length === 0,
    requiredFrom,
    requiredTo,
    requiredDeviceCount: devices.length,
    completeDeviceCount: devices.length - incompleteDeviceIds.length,
    incompleteDeviceIds,
    devices,
  }
}

/**
 * Summarizes the mock request ledger without discarding failed attempts.
 * Latency describes the HTTP boundary itself; request-start gaps expose time
 * spent outside that boundary (for example persistence acknowledgement or
 * work-queue scheduling) without pretending to attribute the cause.
 */
export function summarizeBreadcrumbRequestLedger(requestLedger, options = {}) {
  const bucketMs = boundedInteger(
    options.bucketMs,
    10_000,
    1,
    60 * 60 * 1_000,
    'request-ledger bucket',
  )
  const ordered = [...requestLedger].sort(
    (left, right) =>
      Number(left.startedAtMs) - Number(right.startedAtMs) ||
      Number(left.sequence) - Number(right.sequence),
  )
  const startedAtValues = ordered
    .map((entry) => Number(entry.startedAtMs))
    .filter(Number.isFinite)
  const completedAtValues = ordered
    .map((entry) => Number(entry.completedAtMs))
    .filter(Number.isFinite)
  const byKind = {}
  for (const kind of [...new Set(ordered.map((entry) => String(entry.kind)))].sort()) {
    byKind[kind] = summarizeRequestGroup(
      ordered.filter((entry) => String(entry.kind) === kind),
    )
  }

  const historyRequests = ordered.filter((entry) => entry.kind === 'history')
  const firstHistoryStartMs = historyRequests
    .map((entry) => Number(entry.startedAtMs))
    .find(Number.isFinite)
  const bucketCounts = new Map()
  if (firstHistoryStartMs !== undefined) {
    for (const entry of historyRequests) {
      const startedAtMs = Number(entry.startedAtMs)
      if (!Number.isFinite(startedAtMs)) {
        continue
      }
      const bucketOffset = Math.floor(
        (startedAtMs - firstHistoryStartMs) / bucketMs,
      ) * bucketMs
      bucketCounts.set(bucketOffset, (bucketCounts.get(bucketOffset) ?? 0) + 1)
    }
  }

  return {
    ...summarizeRequestGroup(ordered),
    elapsedMs:
      startedAtValues.length === 0 || completedAtValues.length === 0
        ? 0
        : Math.max(...completedAtValues) - Math.min(...startedAtValues),
    bucketMs,
    byKind,
    historyStartBuckets: [...bucketCounts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([offsetFromFirstHistoryStartMs, requestCount]) => ({
        offsetFromFirstHistoryStartMs,
        requestCount,
      })),
  }
}

/**
 * Freezes the completed-request truth at the acceptance deadline. Requests
 * that settle while failure screenshots and cleanup run remain visible in the
 * final ledger, but cannot improve this deadline-scoped verdict.
 */
export function createBreadcrumbReconciliationDeadlineEvidence(input) {
  const observedFromUnixMs = normalizeFiniteEpoch(
    input.observedFromUnixMs,
    'reconciliation observation start',
  )
  const deadlineAtUnixMs = normalizeFiniteEpoch(
    input.deadlineAtUnixMs,
    'reconciliation deadline',
  )
  const observedAtUnixMs = normalizeFiniteEpoch(
    input.observedAtUnixMs,
    'reconciliation deadline observation',
  )
  if (deadlineAtUnixMs < observedFromUnixMs) {
    throw new Error('Reconciliation deadline precedes its observation start.')
  }
  if (observedAtUnixMs < deadlineAtUnixMs) {
    throw new Error('Reconciliation deadline evidence was captured before the deadline.')
  }

  const requestLedger = Array.isArray(input.requestSnapshot?.requestLedger)
    ? input.requestSnapshot.requestLedger
    : []
  const completedByDeadline = requestLedger.filter(
    (entry) =>
      Number.isFinite(Number(entry?.completedAtMs)) &&
      Number(entry.completedAtMs) <= deadlineAtUnixMs,
  )
  const startedByDeadline = requestLedger.filter(
    (entry) =>
      Number.isFinite(Number(entry?.startedAtMs)) &&
      Number(entry.startedAtMs) <= deadlineAtUnixMs,
  )
  const requestCoverage = analyzeBreadcrumbRequestCoverage({
    requestLedger: completedByDeadline,
    deviceIds: input.deviceIds,
    requiredFrom: input.requiredFrom,
    requiredTo: input.requiredTo,
  })

  return {
    observedFromUnixMs,
    deadlineAtUnixMs,
    observedAtUnixMs,
    observedAfterDeadlineMs: observedAtUnixMs - deadlineAtUnixMs,
    currentFixMs: Number.isFinite(input.currentFixMs) ? input.currentFixMs : null,
    firstBreadcrumbMs:
      Number.isFinite(input.firstBreadcrumbMs) ? input.firstBreadcrumbMs : null,
    completedRequestCount: completedByDeadline.length,
    completedHistoryRequestCount: completedByDeadline.filter(
      (entry) => entry.kind === 'history',
    ).length,
    settledRequestStartedByDeadlineCount: startedByDeadline.length,
    settledHistoryRequestStartedByDeadlineCount: startedByDeadline.filter(
      (entry) => entry.kind === 'history',
    ).length,
    postDeadlineCompletedRequestCountAtObservation: requestLedger.filter(
      (entry) =>
        Number.isFinite(Number(entry?.completedAtMs)) &&
        Number(entry.completedAtMs) > deadlineAtUnixMs &&
        Number(entry.completedAtMs) <= observedAtUnixMs,
    ).length,
    activeRequestsAtObservation:
      Number.isSafeInteger(input.requestSnapshot?.activeRequests)
        ? input.requestSnapshot.activeRequests
        : null,
    activeHistoryRequestsAtObservation:
      Number.isSafeInteger(input.requestSnapshot?.activeHistoryRequests)
        ? input.requestSnapshot.activeHistoryRequests
        : null,
    trackingStatusText: String(input.trackingStatusText ?? '').slice(0, 1_000),
    requestCoverage,
    requestSummary: summarizeBreadcrumbRequestLedger(completedByDeadline),
  }
}

/**
 * Records product publication timing separately from the proof work needed to
 * transport, hash, render, and confirm the sampled source a second time.
 */
export function createBreadcrumbPublicationTimingEvidence(input) {
  const timestamps = [
    input.observedFromUnixMs,
    input.firstExactSampledAtUnixMs,
    input.proofCompletedAtUnixMs,
  ]
  if (!timestamps.every(Number.isFinite)) {
    throw new Error('Breadcrumb publication timing requires finite timestamps.')
  }
  if (input.firstExactSampledAtUnixMs < input.observedFromUnixMs) {
    throw new Error(
      'Breadcrumb source was sampled before the timing observation began.',
    )
  }
  if (input.proofCompletedAtUnixMs < input.firstExactSampledAtUnixMs) {
    throw new Error(
      'Breadcrumb proof completed before the exact source sample.',
    )
  }
  return {
    firstExactPublicationMs:
      input.firstExactSampledAtUnixMs - input.observedFromUnixMs,
    proofCompletedMs:
      input.proofCompletedAtUnixMs - input.observedFromUnixMs,
    proofDurationMs:
      input.proofCompletedAtUnixMs - input.firstExactSampledAtUnixMs,
  }
}

/**
 * Distinguishes the non-empty source needed to start catch-up observation from
 * the final exact-page equality required after reconciliation completes.
 */
export function breadcrumbDotActivationSourceIsReady(input) {
  if (
    input.sourceRequirement !== 'nonempty' &&
    input.sourceRequirement !== 'exact'
  ) {
    throw new Error('Breadcrumb Dots source requirement must be nonempty or exact.')
  }
  const countsMatch =
    Number.isSafeInteger(input.operatorPagePositionCount) &&
    input.operatorPagePositionCount > 0 &&
    Number.isSafeInteger(input.sourceFeatureCount) &&
    input.sourceFeatureCount === input.operatorPagePositionCount
  if (!countsMatch) {
    return false
  }
  return input.sourceRequirement === 'nonempty' ||
    input.exactSourceMatchesExpected === true
}

function normalizeFiniteEpoch(value, label) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(`${label} must be a finite non-negative epoch.`)
  }
  return normalized
}

/** Reports durable reconciliation cursor coverage for every required device. */
export function analyzeBreadcrumbCheckpointProgress(input) {
  const requiredFrom = normalizeTimestamp(input.requiredFrom, 'checkpoint coverage start')
  const requiredTo = normalizeTimestamp(input.requiredTo, 'checkpoint coverage end')
  const requiredFromMs = Date.parse(requiredFrom)
  const requiredToMs = Date.parse(requiredTo)
  if (requiredToMs < requiredFromMs) {
    throw new Error('Required checkpoint coverage window is reversed.')
  }
  const missionId = String(input.missionId ?? '')
  const requiredDeviceIdStrings = input.deviceIds.map(String)
  const requiredDeviceIds = new Set(requiredDeviceIdStrings)
  const checkpointByDeviceId = new Map()
  let invalidCheckpointCount = 0
  let unexpectedCheckpointCount = 0
  let duplicateCheckpointCount = 0
  let historyFromMismatchCount = 0
  for (const checkpoint of input.checkpoints) {
    const deviceId = String(checkpoint?.device_id ?? '')
    const missionMatches = String(checkpoint?.mission_id ?? '') === missionId
    const deviceExpected = requiredDeviceIds.has(deviceId)
    const historyFromMatches = checkpoint?.history_from === requiredFrom
    const reconciledUntilValid = Number.isFinite(Date.parse(checkpoint?.reconciled_until))
    const updatedAtValid = Number.isFinite(Date.parse(checkpoint?.updated_at))
    if (!deviceExpected) {
      unexpectedCheckpointCount += 1
    }
    if (!historyFromMatches) {
      historyFromMismatchCount += 1
    }
    if (
      !missionMatches ||
      !deviceExpected ||
      !historyFromMatches ||
      !reconciledUntilValid ||
      !updatedAtValid
    ) {
      invalidCheckpointCount += 1
    }
    if (!missionMatches || !deviceExpected) {
      continue
    }
    if (checkpointByDeviceId.has(deviceId)) {
      duplicateCheckpointCount += 1
      invalidCheckpointCount += 1
      continue
    }
    checkpointByDeviceId.set(deviceId, checkpoint)
  }
  const devices = [...input.deviceIds]
    .sort(compareDeviceIds)
    .map((deviceId) => {
      const checkpoint = checkpointByDeviceId.get(String(deviceId))
      const reconciledUntilMs = checkpoint === undefined
        ? requiredFromMs
        : Math.min(
            requiredToMs,
            Math.max(requiredFromMs, Date.parse(checkpoint.reconciled_until)),
          )
      const safeReconciledUntilMs = Number.isFinite(reconciledUntilMs)
        ? reconciledUntilMs
        : requiredFromMs
      const coveredMs = Math.max(0, safeReconciledUntilMs - requiredFromMs)
      const remainingMs = Math.max(0, requiredToMs - safeReconciledUntilMs)
      return {
        deviceId,
        checkpointPresent: checkpoint !== undefined,
        historyFrom: checkpoint?.history_from ?? null,
        reconciledUntil: checkpoint?.reconciled_until ?? null,
        updatedAt: checkpoint?.updated_at ?? null,
        historyFromMatches: checkpoint?.history_from === requiredFrom,
        coveredMs,
        remainingMs,
        complete:
          checkpoint !== undefined &&
          checkpoint.history_from === requiredFrom &&
          Number.isFinite(Date.parse(checkpoint.reconciled_until)) &&
          Date.parse(checkpoint.reconciled_until) >= requiredToMs,
      }
    })

  const missingCheckpointCount = devices.filter(
    (device) => !device.checkpointPresent,
  ).length
  const incompleteCheckpointCount = devices.filter(
    (device) => !device.complete,
  ).length
  return {
    missionId,
    requiredFrom,
    requiredTo,
    requiredDeviceCount: devices.length,
    checkpointCount: input.checkpoints.length,
    checkpointedDeviceCount: devices.filter((device) => device.checkpointPresent).length,
    completedDeviceCount: devices.filter((device) => device.complete).length,
    remainingDeviceCount: incompleteCheckpointCount,
    missingCheckpointCount,
    incompleteCheckpointCount,
    invalidCheckpointCount,
    unexpectedCheckpointCount,
    duplicateCheckpointCount,
    historyFromMismatchCount,
    exactScope:
      input.checkpoints.length === devices.length &&
      missingCheckpointCount === 0 &&
      unexpectedCheckpointCount === 0 &&
      duplicateCheckpointCount === 0,
    complete:
      missingCheckpointCount === 0 &&
      incompleteCheckpointCount === 0 &&
      invalidCheckpointCount === 0 &&
      unexpectedCheckpointCount === 0 &&
      duplicateCheckpointCount === 0 &&
      historyFromMismatchCount === 0,
    totalCoveredMs: devices.reduce((total, device) => total + device.coveredMs, 0),
    totalRemainingMs: devices.reduce((total, device) => total + device.remainingMs, 0),
    devices,
  }
}

function summarizeRequestGroup(entries) {
  const durations = entries
    .map((entry) => Number(entry.durationMs))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const starts = entries
    .map((entry) => Number(entry.startedAtMs))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const gaps = starts
    .slice(1)
    .map((startedAtMs, index) => startedAtMs - starts[index])
    .sort((left, right) => left - right)
  return {
    requestCount: entries.length,
    successfulRequestCount: entries.filter((entry) => entry.outcome === 'success').length,
    failedRequestCount: entries.filter((entry) => entry.outcome !== 'success').length,
    returnedPositionCount: entries.reduce(
      (total, entry) => total + (Number.isFinite(Number(entry.returnedCount))
        ? Number(entry.returnedCount)
        : 0),
      0,
    ),
    latencyMs: summarizeNumericDistribution(durations),
    requestStartGapMs: summarizeNumericDistribution(gaps),
  }
}

function summarizeNumericDistribution(values) {
  if (values.length === 0) {
    return { min: null, p50: null, p95: null, max: null }
  }
  const medianIndex = Math.floor(values.length / 2)
  const p50 = values.length % 2 === 0
    ? (values[medianIndex - 1] + values[medianIndex]) / 2
    : values[medianIndex]
  const p95Index = Math.max(0, Math.ceil(values.length * 0.95) - 1)
  return {
    min: values[0],
    p50,
    p95: values[p95Index],
    max: values.at(-1),
  }
}

/** Matches each failed history request to a later exact-window success. */
export function analyzeTransientHistoryRetries(requestLedger) {
  const ordered = [...requestLedger].sort(
    (left, right) => Number(left.sequence) - Number(right.sequence),
  )
  const failedRequests = ordered.filter(
    (entry) => entry.kind === 'history' && entry.outcome === 'failure',
  )
  const failures = failedRequests.map((failure) => {
    const retry = ordered.find(
      (candidate) =>
        Number(candidate.sequence) > Number(failure.sequence) &&
        candidate.kind === 'history' &&
        candidate.deviceId === failure.deviceId &&
        candidate.from === failure.from &&
        candidate.to === failure.to &&
        candidate.outcome === 'success' &&
        candidate.httpStatus === 200,
    )
    return {
      failedSequence: failure.sequence,
      retrySequence: retry?.sequence ?? null,
      deviceId: failure.deviceId,
      from: failure.from,
      to: failure.to,
      failedHttpStatus: failure.httpStatus,
    }
  })
  const retriedFailureCount = failures.filter(
    (failure) => failure.retrySequence !== null,
  ).length

  return {
    failedRequestCount: failures.length,
    retriedFailureCount,
    allFailuresRetried:
      failures.length > 0 && retriedFailureCount === failures.length,
    failures,
  }
}

/** Builds exact persisted source-identity/time/coordinate evidence. */
export function createPersistedBreadcrumbEvidence(rows) {
  const ordered = [...rows].sort(comparePersistedPositions)
  const accumulator = createPersistedBreadcrumbEvidenceAccumulator()
  for (const row of ordered) {
    accumulator.add(row)
  }
  return accumulator.finish()
}

/** Accumulates already-ordered SQLite rows without retaining the full mission. */
export function createPersistedBreadcrumbEvidenceAccumulator() {
  const digest = createHash('sha256')
  const deviceCounts = {}
  let rowCount = 0
  let missingSourceIdentityRows = 0
  return {
    add: (row) => {
      const sourcePositionId = String(row.source_position_id ?? '').trim()
      if (sourcePositionId === '') {
        missingSourceIdentityRows += 1
      }
      const deviceId = String(row.device_id)
      deviceCounts[deviceId] = (deviceCounts[deviceId] ?? 0) + 1
      digest.update(
        [
          sourcePositionId,
          deviceId,
          normalizeTimestamp(row.timestamp, 'persisted breadcrumb timestamp'),
          Number(row.lat).toFixed(7),
          Number(row.lon).toFixed(7),
        ].join('|') + '\n',
      )
      rowCount += 1
    },
    finish: () => ({
      rowCount,
      missingSourceIdentityRows,
      sha256: digest.digest('hex'),
      deviceCounts: { ...deviceCounts },
    }),
  }
}

/**
 * Captures exact rendered geometry evidence from the public MapLibre source.
 * Source position IDs and timestamps are intentionally not exposed by the
 * production GeoJSON contract, so the report states that limitation rather
 * than pretending geometry is source identity.
 */
export function createRenderedBreadcrumbEvidence(featureCollection) {
  const normalizedFeatures = (featureCollection?.features ?? [])
    .flatMap((feature) => {
      const featureKind = feature?.properties?.featureKind
      const deviceId = String(feature?.properties?.deviceId ?? '')
      if (featureKind === 'breadcrumbLine' && feature?.geometry?.type === 'LineString') {
        return [{
          deviceId,
          coordinates: normalizeCoordinates(feature.geometry.coordinates),
        }]
      }
      if (featureKind === 'breadcrumb' && feature?.geometry?.type === 'Point') {
        return [{
          deviceId,
          coordinates: normalizeCoordinates([feature.geometry.coordinates]),
        }]
      }
      return []
    })
    .sort(
      (left, right) =>
        compareDeviceIds(left.deviceId, right.deviceId) ||
        JSON.stringify(left.coordinates).localeCompare(JSON.stringify(right.coordinates)),
    )
  const digest = createHash('sha256')
  const deviceDigests = new Map()
  const nextDeviceCoordinateIndex = new Map()
  const deviceCoordinateCounts = {}
  let coordinateCount = 0
  for (let featureIndex = 0; featureIndex < normalizedFeatures.length; featureIndex += 1) {
    const feature = normalizedFeatures[featureIndex]
    for (let coordinateIndex = 0; coordinateIndex < feature.coordinates.length; coordinateIndex += 1) {
      const [lon, lat] = feature.coordinates[coordinateIndex]
      digest.update(
        [
          feature.deviceId,
          featureIndex,
          coordinateIndex,
          lon.toFixed(7),
          lat.toFixed(7),
        ].join('|') + '\n',
      )
      const deviceDigest = deviceDigests.get(feature.deviceId) ?? createHash('sha256')
      const deviceCoordinateIndex = nextDeviceCoordinateIndex.get(feature.deviceId) ?? 0
      deviceDigest.update(
        [
          feature.deviceId,
          deviceCoordinateIndex,
          lon.toFixed(7),
          lat.toFixed(7),
        ].join('|') + '\n',
      )
      deviceDigests.set(feature.deviceId, deviceDigest)
      nextDeviceCoordinateIndex.set(feature.deviceId, deviceCoordinateIndex + 1)
      coordinateCount += 1
      deviceCoordinateCounts[feature.deviceId] =
        (deviceCoordinateCounts[feature.deviceId] ?? 0) + 1
    }
  }

  return {
    featureCount: normalizedFeatures.length,
    coordinateCount,
    deviceCount: Object.keys(deviceCoordinateCounts).length,
    coordinateSha256: digest.digest('hex'),
    deviceCoordinateCounts,
    deviceCoordinateSha256: Object.fromEntries(
      [...deviceDigests.entries()]
        .sort(([left], [right]) => compareDeviceIds(left, right))
        .map(([deviceId, deviceDigest]) => [deviceId, deviceDigest.digest('hex')]),
    ),
    sourceIdentityExposed: false,
  }
}

/**
 * Derives the expected bounded MapLibre trail from immutable source truth by
 * running the production persisted-restart selector unchanged.
 */
export function buildBreadcrumb36HourRenderedOracle(
  profile,
  window = {},
  options = {},
) {
  const perDeviceLimit = options.perDeviceLimit ?? RENDER_BREADCRUMB_LIMIT_PER_DEVICE
  const database = createBreadcrumb36HourSourceDatabase(profile, window)
  const selection = listBreadcrumbPositions(
    database,
    'source-truth',
    perDeviceLimit,
  )
  const positionsByDevice = new Map()
  const retainedIdentityDigest = createHash('sha256')
  const deviceIdentityDigests = new Map()

  for (const position of selection.positions) {
    const deviceId = String(position.device_id)
    const existing = positionsByDevice.get(deviceId)
    if (existing === undefined) {
      positionsByDevice.set(deviceId, [position])
    } else {
      existing.push(position)
    }
    const identityLine = createRetainedIdentityLine(position)
    retainedIdentityDigest.update(identityLine)
    const deviceDigest = deviceIdentityDigests.get(deviceId) ?? createHash('sha256')
    deviceDigest.update(identityLine)
    deviceIdentityDigests.set(deviceId, deviceDigest)
  }

  const featureCollection = createOracleBreadcrumbFeatureCollection(
    positionsByDevice,
    options.gapThresholdMs ?? RENDER_BREADCRUMB_GAP_THRESHOLD_MS,
  )
  const rendered = createRenderedBreadcrumbEvidence(featureCollection)
  const dotRendered = createRenderedBreadcrumbEvidence(
    createOracleBreadcrumbPointFeatureCollection(positionsByDevice),
  )
  const totalByDevice = new Map(
    selection.deviceTotals.map((entry) => [String(entry.device_id), Number(entry.total)]),
  )
  const selectionByDevice = new Map(
    selection.deviceSelections.map((entry) => [String(entry.device_id), entry]),
  )
  const devices = [...totalByDevice.keys()]
    .sort(compareDeviceIds)
    .map((deviceId) => {
      const retained = positionsByDevice.get(deviceId) ?? []
      const metadata = selectionByDevice.get(deviceId)
      return {
        deviceId,
        sourcePositionCount: totalByDevice.get(deviceId),
        retainedPositionCount: retained.length,
        retainedIdentitySha256:
          deviceIdentityDigests.get(deviceId)?.digest('hex') ?? createHash('sha256').digest('hex'),
        firstSourcePositionId:
          retained.length === 0 ? null : String(retained[0].source_position_id ?? ''),
        lastSourcePositionId:
          retained.length === 0 ? null : String(retained.at(-1).source_position_id ?? ''),
        firstTimestamp: retained[0]?.timestamp ?? null,
        lastTimestamp: retained.at(-1)?.timestamp ?? null,
        coordinateCount: rendered.deviceCoordinateCounts[deviceId] ?? 0,
        coordinateSha256: rendered.deviceCoordinateSha256[deviceId] ?? null,
        geometryErrorBoundMetres: metadata?.geometryErrorBoundMetres ?? null,
        targetGeometryErrorSatisfied:
          metadata?.targetGeometryErrorSatisfied === true,
      }
    })

  return {
    selector: 'electron/breadcrumb-query.cjs#listBreadcrumbPositions',
    perDeviceLimit,
    from: window.from ?? profile.sourceFrom,
    to: window.to ?? profile.sourceNow,
    sourcePositionCount: [...totalByDevice.values()].reduce(
      (total, count) => total + count,
      0,
    ),
    sourceDeviceCount: totalByDevice.size,
    retainedIdentityCount: selection.positions.length,
    retainedIdentitySha256: retainedIdentityDigest.digest('hex'),
    droppedPositionCount: selection.droppedPositionCount,
    devices,
    rendered,
    dotRendered,
  }
}

/**
 * Builds a bounded exact-dot paging oracle directly from deterministic raw
 * source truth. The line selector is intentionally not involved.
 */
export function buildBreadcrumb36HourExactDotPageOracle(
  profile,
  window = {},
  options = {},
) {
  const pageLimit = boundedInteger(
    options.pageLimit,
    10_000,
    1,
    100_000,
    'exact breadcrumb-dot page limit',
  )
  const database = options.sourceDatabase ??
    createBreadcrumb36HourSourceDatabase(profile, window)
  const deviceTotals = database.prepare(
    `SELECT device_id, COUNT(*) AS total
     FROM positions
     WHERE mission_id = ?
     GROUP BY device_id
     ORDER BY device_id ASC`,
  ).all('source-truth')
  const selectDevicePositions = database.prepare(
    `SELECT rowid AS sqlite_row_id, * FROM positions
     WHERE mission_id = ? AND device_id = ?
     ORDER BY timestamp ASC`,
  )
  const positions = []
  for (const device of deviceTotals) {
    positions.push(...selectDevicePositions.iterate('source-truth', device.device_id))
  }
  positions.sort(compareExactBreadcrumbDotPositions)

  const pages = []
  const pageRows = []
  for (let end = positions.length; end > 0; end -= pageLimit) {
    const page = positions
      .slice(Math.max(0, end - pageLimit), end)
      .sort(compareExactBreadcrumbDotDigestPositions)
    pageRows.push(page)
    const rawDigest = createHash('sha256')
    const renderedDigest = createHash('sha256')
    const identityTimestampDigest = createHash('sha256')
    for (const position of page) {
      const line = createRetainedIdentityLine(position)
      rawDigest.update(line)
      renderedDigest.update(line)
      identityTimestampDigest.update(createIdentityTimestampLine(position))
    }
    const rawSha256 = rawDigest.digest('hex')
    pages.push({
      raw: {
        positionCount: page.length,
        sha256: rawSha256,
        identityTimestampSha256: identityTimestampDigest.digest('hex'),
      },
      rendered: {
        featureCount: page.length,
        coordinateCount: page.length,
        sourceTruthSha256: renderedDigest.digest('hex'),
      },
    })
  }

  const unionRawDigest = createHash('sha256')
  const unionRenderedDigest = createHash('sha256')
  for (const page of [...pageRows].reverse()) {
    for (const position of page) {
      const line = createRetainedIdentityLine(position)
      unionRawDigest.update(line)
      unionRenderedDigest.update(line)
    }
  }
  const activePage = pages[0] ?? {
    raw: { positionCount: 0 },
    rendered: { featureCount: 0 },
  }
  return {
    pageLimit,
    totalPositionCount: positions.length,
    pageCount: pages.length,
    activePage: {
      pagePositionCount: activePage.raw.positionCount,
      renderedFeatureCount: activePage.rendered.featureCount,
    },
    pageUnion: {
      rawPositionCount: positions.length,
      renderedPositionCount: positions.length,
      rawSourceTruthSha256: unionRawDigest.digest('hex'),
      renderedSourceTruthSha256: unionRenderedDigest.digest('hex'),
    },
    pages,
  }
}

/**
 * Measures whether representative selection adds gaps to Eamonn's reported
 * slow-to-motorway-speed journey. The source cadence remains authoritative:
 * the app must not invent fixes, but it must not remove additional fixes from
 * the 120–145 km/h leg either.
 */
export function buildBreadcrumb36HourVariableSpeedEvidence(
  profile,
  window = {},
  options = {},
) {
  const journey = profile.variableSpeedJourney
  if (journey === null || typeof journey !== 'object') {
    throw new Error('36-hour profile has no variable-speed field journey.')
  }
  const database = createBreadcrumb36HourSourceDatabase(profile, window)
  const deviceId = String(journey.deviceId)
  const sourcePositions = [...database
    .prepare('WHERE mission_id = ? AND device_id = ?')
    .iterate('source-truth', deviceId)]
  const selection = listBreadcrumbPositions(
    database,
    'source-truth',
    options.perDeviceLimit ?? RENDER_BREADCRUMB_LIMIT_PER_DEVICE,
  )
  const retainedPositions = selection.positions.filter(
    (position) => String(position.device_id) === deviceId,
  )

  return {
    deviceId,
    slow: analyzeVariableSpeedPhase(
      sourcePositions,
      retainedPositions,
      journey.slow,
    ),
    fast: analyzeVariableSpeedPhase(
      sourcePositions,
      retainedPositions,
      journey.fast,
    ),
  }
}

function analyzeVariableSpeedPhase(sourcePositions, retainedPositions, phase) {
  const fromMs = Date.parse(phase.from)
  const toMs = Date.parse(phase.to)
  const inPhase = (position) => {
    const timestampMs = Date.parse(position.timestamp)
    return timestampMs >= fromMs && timestampMs < toMs
  }
  const source = sourcePositions.filter(inPhase)
  const retained = retainedPositions.filter(inPhase)
  const maximumSourceGapMetres = maximumAdjacentDistanceMetres(source)
  const maximumRenderedGapMetres = maximumAdjacentDistanceMetres(retained)

  return {
    from: phase.from,
    to: phase.to,
    minimumSpeedKmh: phase.minimumSpeedKmh,
    maximumSpeedKmh: phase.maximumSpeedKmh,
    sourcePositionCount: source.length,
    retainedPositionCount: retained.length,
    omittedSourcePositionCount: source.length - retained.length,
    maximumSourceGapMetres,
    maximumRenderedGapMetres,
    maximumRenderedGapInflation:
      maximumSourceGapMetres === 0
        ? maximumRenderedGapMetres === 0 ? 1 : null
        : maximumRenderedGapMetres / maximumSourceGapMetres,
  }
}

function maximumAdjacentDistanceMetres(positions) {
  let maximum = 0
  for (let index = 1; index < positions.length; index += 1) {
    maximum = Math.max(
      maximum,
      haversineDistanceMetres(positions[index - 1], positions[index]),
    )
  }
  return maximum
}

function haversineDistanceMetres(left, right) {
  const leftLatitude = Number(left.lat) * Math.PI / 180
  const rightLatitude = Number(right.lat) * Math.PI / 180
  const latitudeDelta = rightLatitude - leftLatitude
  const longitudeDelta = (Number(right.lon) - Number(left.lon)) * Math.PI / 180
  const sineLatitude = Math.sin(latitudeDelta / 2)
  const sineLongitude = Math.sin(longitudeDelta / 2)
  const haversine = sineLatitude * sineLatitude +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) *
    sineLongitude * sineLongitude
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function createRetainedIdentityLine(position) {
  return [
    position.device_id,
    position.source_position_id ?? '',
    position.timestamp,
    Number(position.lat).toFixed(7),
    Number(position.lon).toFixed(7),
  ].join('|') + '\n'
}

function createIdentityTimestampLine(position) {
  return [
    position.device_id,
    position.source_position_id ?? position.id ?? '',
    position.timestamp,
  ].join('|') + '\n'
}

function compareExactBreadcrumbDotPositions(left, right) {
  return (
    compareExactDotOracleStrings(String(left.timestamp), String(right.timestamp)) ||
    compareExactDotOracleStrings(String(left.device_id), String(right.device_id)) ||
    compareExactDotOracleStrings(
      createExactDotOracleStableIdentity(left),
      createExactDotOracleStableIdentity(right),
    )
  )
}

function createExactDotOracleStableIdentity(position) {
  const sourcePositionId = String(position.source_position_id ?? '').trim()
  return sourcePositionId === ''
    ? `local:${String(position.id)}`
    : `source:${sourcePositionId}`
}

function compareExactBreadcrumbDotDigestPositions(left, right) {
  return (
    compareExactDotOracleStrings(String(left.timestamp), String(right.timestamp)) ||
    compareExactDotOracleStrings(String(left.device_id), String(right.device_id)) ||
    compareExactDotOracleStrings(
      String(left.source_position_id ?? left.id),
      String(right.source_position_id ?? right.id),
    )
  )
}

/** Mirrors the exact-query key contract without importing production query code. */
function compareExactDotOracleStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function createOracleBreadcrumbFeatureCollection(positionsByDevice, gapThresholdMs) {
  const features = []
  for (const [deviceId, positions] of positionsByDevice.entries()) {
    let segment = []
    let previousTimestampMs = null
    const appendSegment = () => {
      if (segment.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: segment.map((position) => [position.lon, position.lat]),
          },
          properties: {
            deviceId,
            featureKind: 'breadcrumbLine',
          },
        })
      }
    }
    for (const position of positions) {
      const timestampMs = Date.parse(position.timestamp)
      if (
        previousTimestampMs !== null &&
        timestampMs - previousTimestampMs > gapThresholdMs
      ) {
        appendSegment()
        segment = []
      }
      segment.push(position)
      previousTimestampMs = timestampMs
    }
    appendSegment()
  }
  return { type: 'FeatureCollection', features }
}

function createOracleBreadcrumbPointFeatureCollection(positionsByDevice) {
  const features = []
  for (const [deviceId, positions] of positionsByDevice.entries()) {
    for (const position of positions) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [position.lon, position.lat],
        },
        properties: {
          deviceId,
          featureKind: 'breadcrumb',
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Verifies that the packaged main process accepted the seeded runtime
 * settings and credential. The returned evidence deliberately excludes the
 * credential value.
 */
export function verifyBreadcrumbRuntimeConfiguration(input) {
  const runtime = input.runtime
  if (runtime?.trackingPollIntervalMs !== input.expectedPollIntervalMs) {
    throw new Error(
      `Packaged runtime poll interval was ${String(runtime?.trackingPollIntervalMs)} ms, expected ${input.expectedPollIntervalMs} ms.`,
    )
  }
  const config = runtime?.trackingConfig
  if (config === null || config === undefined) {
    throw new Error('Packaged runtime rejected the seeded Traccar configuration or credential.')
  }
  const normalizedBaseUrl = String(config.baseUrl ?? '').replace(/\/+$/u, '')
  const expectedBaseUrl = String(input.expectedBaseUrl).replace(/\/+$/u, '')
  if (normalizedBaseUrl !== expectedBaseUrl) {
    throw new Error(
      `Packaged runtime Traccar URL was ${normalizedBaseUrl || 'empty'}, expected ${expectedBaseUrl}.`,
    )
  }
  if (config.email !== input.expectedEmail) {
    throw new Error('Packaged runtime did not accept the seeded basic-auth email.')
  }
  if (config.password !== input.expectedSecret) {
    throw new Error('Packaged runtime did not accept the seeded basic-auth credential.')
  }

  return {
    trackingConfigured: true,
    trackingPollIntervalMs: runtime.trackingPollIntervalMs,
    baseUrl: normalizedBaseUrl,
    authMode: 'basic',
    email: config.email,
    secretPresent: true,
  }
}

/** Returns the fail-closed packaged proof verdict. */
export function buildBreadcrumb36HourProofVerdict(input) {
  const failureReasons = []
  requireAtMost(failureReasons, input.timings.currentFixMs, MAX_CURRENT_FIX_MS, 'current fix')
  requireAtMost(
    failureReasons,
    input.timings.firstBreadcrumbMs,
    MAX_FIRST_BREADCRUMB_MS,
    'first breadcrumb',
  )
  requireAtMost(
    failureReasons,
    input.timings.fullReconciliationMs,
    MAX_FULL_RECONCILIATION_MS,
    'full reconciliation',
  )
  requireAtMost(
    failureReasons,
    input.timings.persistenceCompleteMs,
    DEFAULT_PERSISTENCE_TIMEOUT_MS,
    'persistence completion',
  )
  if (input.coverage.complete !== true) {
    failureReasons.push(
      `Breadcrumb request coverage is incomplete for devices: ${input.coverage.incompleteDeviceIds.join(', ') || 'unknown'}.`,
    )
  }
  validateFinalHistoryCheckpoints(failureReasons, input.historyCheckpoints)
  requireAtMost(
    failureReasons,
    input.requestEvidence.maximumConcurrentHistoryRequests,
    MAX_HISTORY_CONCURRENCY,
    'history request concurrency',
  )
  if (input.persisted.rowCount !== input.sourceTruth.totalPositionCount) {
    failureReasons.push(
      `Persisted position count ${input.persisted.rowCount} did not match source truth ${input.sourceTruth.totalPositionCount}.`,
    )
  }
  if (input.persisted.sha256 !== input.sourceTruth.sha256) {
    failureReasons.push('Persisted source identity/time/coordinate digest did not match source truth.')
  }
  if (input.persisted.missingSourceIdentityRows !== 0) {
    failureReasons.push(
      `${input.persisted.missingSourceIdentityRows} persisted rows lack source position identity.`,
    )
  }
  if (input.persisted.integrityResult !== 'ok') {
    failureReasons.push(`SQLite integrity result was ${input.persisted.integrityResult}, not ok.`)
  }
  if (input.rendered.featureCount < 1 || input.rendered.coordinateCount < 1) {
    failureReasons.push('No breadcrumb geometry was exposed by the MapLibre tracking source.')
  }
  if (input.rendered.deviceCount !== 32) {
    failureReasons.push(
      `Rendered breadcrumb geometry covered ${input.rendered.deviceCount} devices, expected 32.`,
    )
  }
  if (input.rendered.stable !== true) {
    failureReasons.push('Rendered breadcrumb count/digest did not remain stable across observations.')
  }
  if (input.rendered.reportedTotalObserved !== input.sourceTruth.totalPositionCount) {
    failureReasons.push(
      `Reported Line known-fix total ${String(input.rendered.reportedTotalObserved)} ` +
        `did not equal authoritative source truth ${input.sourceTruth.totalPositionCount}.`,
    )
  }
  validateRenderedOracle(
    failureReasons,
    input.rendered,
    input.renderedOracle,
    input.sourceTruth,
  )
  validateRenderedDotOracle(
    failureReasons,
    input.renderedDots,
    input.exactDotOracle,
  )
  validateVariableSpeedEvidence(failureReasons, input.variableSpeedEvidence)

  return {
    passed: failureReasons.length === 0,
    failureReasons,
  }
}

function validateFinalHistoryCheckpoints(reasons, evidence) {
  if (
    evidence === null ||
    evidence === undefined ||
    !Array.isArray(evidence.checkpoints) ||
    !Array.isArray(evidence.requiredDeviceIds)
  ) {
    reasons.push('Final durable history checkpoint evidence was not provided.')
    return
  }
  if (evidence.integrityResult !== 'ok') {
    reasons.push(
      `Final history checkpoint SQLite integrity result was ${String(evidence.integrityResult)}, not ok.`,
    )
  }
  const progress = analyzeBreadcrumbCheckpointProgress({
    checkpoints: evidence.checkpoints,
    missionId: evidence.missionId,
    deviceIds: evidence.requiredDeviceIds,
    requiredFrom: evidence.requiredFrom,
    requiredTo: evidence.requiredTo,
  })
  if (!progress.exactScope) {
    reasons.push(
      `Final history checkpoint scope was not exact: ${progress.missingCheckpointCount} missing, ` +
        `${progress.unexpectedCheckpointCount} unexpected, ${progress.duplicateCheckpointCount} duplicate.`,
    )
  }
  if (progress.invalidCheckpointCount !== 0) {
    reasons.push(
      `Final history checkpoints contained ${progress.invalidCheckpointCount} invalid rows ` +
        `(${progress.historyFromMismatchCount} history_from mismatches).`,
    )
  }
  if (progress.incompleteCheckpointCount !== 0) {
    reasons.push(
      `Final history checkpoints left ${progress.incompleteCheckpointCount} devices incomplete.`,
    )
  }
}

function validateRenderedDotOracle(reasons, rendered, exactOracle) {
  if (rendered === null || rendered === undefined) {
    reasons.push('Packaged breadcrumb-dot evidence was not provided.')
    return
  }
  if (exactOracle === null || exactOracle === undefined) {
    reasons.push('The independent exact breadcrumb-dot oracle is required.')
    return
  }
  validateExactRenderedDotOracle(reasons, rendered, exactOracle)
}

function validateExactRenderedDotOracle(reasons, rendered, oracle) {
  if (rendered.stable !== true) {
    reasons.push('Packaged exact breadcrumb-dot pages did not remain stable.')
  }
  if (
    rendered.pageLimit !== oracle.pageLimit ||
    rendered.totalPositionCount !== oracle.totalPositionCount ||
    rendered.pageCount !== oracle.pageCount ||
    rendered.pages?.length !== oracle.pages.length ||
    rendered.maximumPagePositionCount > oracle.pageLimit
  ) {
    reasons.push('Packaged exact breadcrumb-dot paging bounds did not match raw source truth.')
  }
  if (
    rendered.invalidFeatureCount !== 0 ||
    rendered.duplicateFeatureIdCount !== 0 ||
    rendered.uniqueFeatureIdCount !== oracle.totalPositionCount ||
    rendered.pageUnion?.renderedPositionCount !== oracle.pageUnion.rawPositionCount ||
    rendered.pageUnion?.renderedSourceTruthSha256 !==
      oracle.pageUnion.rawSourceTruthSha256
  ) {
    reasons.push(
      'Packaged exact breadcrumb-dot page union had invalid, missing, duplicate, or changed source fixes.',
    )
  }
  if (rendered.returnedToLatest !== true) {
    reasons.push('Packaged exact breadcrumb-dot navigation did not return to the latest page.')
  }
  const pagesMatch = oracle.pages.every((expected, index) => {
    const observed = rendered.pages?.[index]
    return (
      observed?.featureCount === expected.raw.positionCount &&
      observed.coordinateCount === expected.raw.positionCount &&
      observed.sourceTruthSha256 === expected.raw.sha256 &&
      observed.identityTimestampSha256 === expected.raw.identityTimestampSha256 &&
      observed.invalidFeatureCount === 0 &&
      observed.renderedLayer?.featureCount === expected.raw.positionCount &&
      observed.renderedLayer.coordinateCount === expected.raw.positionCount &&
      observed.renderedLayer.identityTimestampSha256 ===
        expected.raw.identityTimestampSha256 &&
      observed.renderedLayer.invalidFeatureCount === 0 &&
      observed.renderedLayer.rawRenderedFeatureCount === expected.raw.positionCount &&
      observed.renderedLayer.duplicateRenderedFeatureCount === 0 &&
      observed.renderedLayer.duplicateConflictCount === 0 &&
      renderedCoordinateDeviationIsBounded(
        observed.renderedLayer.coordinateDeviation,
        expected.raw.positionCount,
      ) &&
      observed.operatorPage?.pagePositionCount === observed.featureCount &&
      observed.operatorPage.totalPositionCount === oracle.totalPositionCount &&
      observed.operatorPage.fromTimestamp === observed.fromTimestamp &&
      observed.operatorPage.toTimestamp === observed.toTimestamp
    )
  })
  if (!pagesMatch) {
    reasons.push(
      'One or more packaged exact breadcrumb-dot pages differed from the independent raw-source oracle.',
    )
  }
  const expectedReturnCount = Math.max(0, oracle.pages.length - 1)
  const returnNavigationMatches =
    Array.isArray(rendered.returnNavigation) &&
    rendered.returnNavigation.length === expectedReturnCount &&
    rendered.returnNavigation.every((observation, index) =>
      observation?.pageIndex === expectedReturnCount - 1 - index &&
      Number.isFinite(observation.observedMs) &&
      observation.observedMs >= 0 &&
      observation.observedMs <= MAX_FIRST_BREADCRUMB_MS)
  if (!returnNavigationMatches) {
    reasons.push(
      'Packaged exact breadcrumb-dot return navigation did not prove every page within the deadline.',
    )
  }
  if (typeof rendered.supportingScreenshot !== 'string' || rendered.supportingScreenshot === '') {
    reasons.push('Packaged exact breadcrumb-dot supporting screenshot was not captured.')
  }
}

function renderedCoordinateDeviationIsBounded(deviation, expectedPositionCount) {
  return (
    deviation?.passed === true &&
    deviation.comparedIdentityCount === expectedPositionCount &&
    deviation.missingIdentityCount === 0 &&
    deviation.unexpectedIdentityCount === 0 &&
    deviation.timestampConflictCount === 0 &&
    deviation.coordinateConflictCount === 0 &&
    deviation.invalidIdentityCount === 0 &&
    deviation.duplicateIdentityCount === 0 &&
    deviation.maximumAllowedMetres ===
      MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_METRES &&
    deviation.maximumAllowedScreenPixelsPerAxis ===
      MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_PER_AXIS &&
    deviation.maximumAllowedScreenPixelsEuclidean ===
      MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_EUCLIDEAN &&
    Number.isFinite(deviation.metres?.max) &&
    deviation.metres.max <= MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_METRES &&
    Number.isFinite(deviation.screenPixels?.x?.max) &&
    deviation.screenPixels.x.max <=
      MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_PER_AXIS &&
    Number.isFinite(deviation.screenPixels?.y?.max) &&
    deviation.screenPixels.y.max <=
      MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_PER_AXIS &&
    Number.isFinite(deviation.screenPixels?.euclidean?.max) &&
    deviation.screenPixels.euclidean.max <=
      MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_EUCLIDEAN &&
    typeof deviation.worstMetreIdentity === 'string' &&
    deviation.worstMetreIdentity !== '' &&
    typeof deviation.worstScreenPixelIdentity === 'string' &&
    deviation.worstScreenPixelIdentity !== ''
  )
}

function validateVariableSpeedEvidence(reasons, evidence) {
  if (evidence === null || evidence === undefined) {
    reasons.push('Variable-speed breadcrumb fidelity evidence was not provided.')
    return
  }
  const phases = [evidence.slow, evidence.fast]
  if (phases.some((phase) =>
    phase === null ||
    phase === undefined ||
    phase.sourcePositionCount < 1 ||
    phase.retainedPositionCount !== phase.sourcePositionCount ||
    phase.omittedSourcePositionCount !== 0
  )) {
    reasons.push('Variable-speed proof omitted source fixes from a slow or high-speed field leg.')
  }
  if (
    evidence.fast?.minimumSpeedKmh !== 120 ||
    evidence.fast?.maximumSpeedKmh !== 145 ||
    !Number.isFinite(evidence.fast?.maximumRenderedGapInflation) ||
    evidence.fast.maximumRenderedGapInflation > 1.01
  ) {
    reasons.push('High-speed 120–145 km/h proof amplified the authoritative source gap.')
  }
}

function validateRenderedOracle(reasons, rendered, oracle, sourceTruth) {
  if (oracle === null || oracle === undefined) {
    reasons.push('Canonical rendered source-truth oracle was not provided.')
    return
  }
  if (oracle.droppedPositionCount !== 0) {
    reasons.push(
      `Canonical rendered oracle dropped ${oracle.droppedPositionCount} deterministic source positions as invalid.`,
    )
  }
  if (oracle.sourcePositionCount !== sourceTruth.totalPositionCount) {
    reasons.push(
      `Canonical rendered oracle source count ${String(oracle.sourcePositionCount)} did not match source truth ${sourceTruth.totalPositionCount}.`,
    )
  }
  if (
    oracle.sourceDeviceCount !== oracle.devices.length ||
    oracle.sourceDeviceCount !== oracle.rendered.deviceCount
  ) {
    reasons.push('Canonical rendered oracle has inconsistent per-device metadata coverage.')
  }
  if (oracle.retainedIdentityCount !== oracle.rendered.coordinateCount) {
    reasons.push(
      'Canonical retained source-identity count did not match its rendered coordinate count.',
    )
  }
  const degradedDevices = oracle.devices.filter(
    (device) =>
      device.targetGeometryErrorSatisfied !== true ||
      device.geometryErrorBoundMetres === null ||
      device.geometryErrorBoundMetres > 25,
  )
  if (degradedDevices.length > 0) {
    reasons.push(
      `Canonical rendered oracle exceeded the 25 metre geometry bound for devices: ${degradedDevices.map((device) => device.deviceId).join(', ')}.`,
    )
  }
  if (
    rendered.featureCount !== oracle.rendered.featureCount ||
    rendered.coordinateCount !== oracle.rendered.coordinateCount ||
    rendered.deviceCount !== oracle.rendered.deviceCount
  ) {
    reasons.push('Packaged rendered feature/coordinate/device counts did not match the source-truth oracle.')
  }
  if (rendered.coordinateSha256 !== oracle.rendered.coordinateSha256) {
    reasons.push('Packaged rendered coordinate digest did not match the source-truth oracle.')
  }
  if (
    !recordsEqual(
      rendered.deviceCoordinateCounts,
      oracle.rendered.deviceCoordinateCounts,
    ) ||
    !recordsEqual(
      rendered.deviceCoordinateSha256,
      oracle.rendered.deviceCoordinateSha256,
    )
  ) {
    reasons.push('Packaged rendered per-device coordinate evidence did not match the source-truth oracle.')
  }
}

function recordsEqual(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false
  }
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    compareDeviceIds(leftKey, rightKey),
  )
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    compareDeviceIds(leftKey, rightKey),
  )
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

/** Returns the fail-closed crash/restart extension verdict. */
export function buildBreadcrumbRestartProofVerdict(input) {
  const failureReasons = []
  const midBackfillCount = input.midBackfill.persistedRowCount
  if (
    !Number.isSafeInteger(midBackfillCount) ||
    midBackfillCount <= 0 ||
    midBackfillCount >= input.sourcePositionCount
  ) {
    failureReasons.push(
      `Mid-backfill persisted count ${String(midBackfillCount)} was not a non-empty proper subset of source truth ${input.sourcePositionCount}.`,
    )
  }
  if (input.midBackfill.databaseIntegrityResult !== 'ok') {
    failureReasons.push(
      `Mid-backfill crash database integrity was ${String(input.midBackfill.databaseIntegrityResult)}, not ok.`,
    )
  }
  if (input.midBackfill.coverageComplete !== false) {
    failureReasons.push('The forced termination did not occur during incomplete request coverage.')
  }
  if (input.midBackfill.processTerminated !== true) {
    failureReasons.push('The mid-backfill packaged process was not proven terminated.')
  }
  if (
    input.retryEvidence.failedRequestCount !== 1 ||
    input.retryEvidence.retriedFailureCount !== 1 ||
    input.retryEvidence.allFailuresRetried !== true
  ) {
    failureReasons.push(
      `Expected one transient history failure and one exact-window retry; observed ${input.retryEvidence.failedRequestCount} failures and ${input.retryEvidence.retriedFailureCount} retries.`,
    )
  }
  if (input.restoredMissionMatches !== true) {
    failureReasons.push('The completed restart did not restore the same active mission.')
  }
  validateRestartPublicationTiming(
    failureReasons,
    input.postCompletionRendered,
    'Line',
  )
  comparePersistenceEvidence(
    failureReasons,
    input.completedPersisted,
    input.postCompletionPersisted,
  )
  compareRenderedEvidence(
    failureReasons,
    input.completedRendered,
    input.postCompletionRendered,
  )
  if (input.postCompletionRendered.reportedTotalObserved !== input.sourcePositionCount) {
    failureReasons.push(
      'Post-restart reported Line known-fix total did not equal authoritative source truth.',
    )
  }
  validatePostCompletionRestartExactDots(
    failureReasons,
    input.postCompletionExactDots,
    input.exactDotOracle,
  )

  return {
    passed: failureReasons.length === 0,
    failureReasons,
  }
}

function validatePostCompletionRestartExactDots(reasons, observed, oracle) {
  const expected = oracle?.pages?.[0]?.raw
  if (observed === null || observed === undefined || expected === undefined) {
    reasons.push('Post-completion restart exact-dot evidence was not provided.')
    return
  }
  validateRestartPublicationTiming(reasons, observed, 'Dots')
  const explicitModeActivationMatches =
    observed.modeActivation?.selectedMode === 'dots' &&
    typeof observed.modeActivation?.sizeLabel === 'string' &&
    observed.modeActivation.sizeLabel.includes('dot diameter')
  const frozenReportModeActivationMatches =
    typeof observed.modeActivation?.selectedModeLabel === 'string' &&
    observed.modeActivation.selectedModeLabel.includes('dot diameter') &&
    observed.modeActivation.sourceFeatureCount === expected.positionCount &&
    observed.modeActivation.operatorPage?.pagePositionCount ===
      expected.positionCount &&
    observed.modeActivation.operatorPage.totalPositionCount ===
      oracle.totalPositionCount
  const sourceMatches =
    (explicitModeActivationMatches || frozenReportModeActivationMatches) &&
    observed.stable === true &&
    observed.featureCount === expected.positionCount &&
    observed.coordinateCount === expected.positionCount &&
    observed.sourceTruthSha256 === expected.sha256 &&
    observed.identityTimestampSha256 === expected.identityTimestampSha256 &&
    observed.invalidFeatureCount === 0
  const renderedMatches =
    observed.renderedLayer?.featureCount === expected.positionCount &&
    observed.renderedLayer.coordinateCount === expected.positionCount &&
    observed.renderedLayer.identityTimestampSha256 ===
      expected.identityTimestampSha256 &&
    observed.renderedLayer.invalidFeatureCount === 0 &&
    observed.renderedLayer.rawRenderedFeatureCount === expected.positionCount &&
    observed.renderedLayer.duplicateRenderedFeatureCount === 0 &&
    observed.renderedLayer.duplicateConflictCount === 0 &&
    renderedCoordinateDeviationIsBounded(
      observed.renderedLayer.coordinateDeviation,
      expected.positionCount,
    )
  const operatorMatches =
    observed.operatorPage?.pagePositionCount === expected.positionCount &&
    observed.operatorPage.totalPositionCount === oracle.totalPositionCount &&
    observed.operatorPage.fromTimestamp === observed.fromTimestamp &&
    observed.operatorPage.toTimestamp === observed.toTimestamp
  if (!sourceMatches || !renderedMatches || !operatorMatches) {
    reasons.push(
      'Post-completion restart exact-dot source, rendered layer, or operator page differed from the independent latest-page oracle.',
    )
  }
}

function validateRestartPublicationTiming(reasons, observed, label) {
  const firstExactPublicationMs = observed?.firstExactPublicationMs
  const proofCompletedMs = observed?.proofCompletedMs
  const proofDurationMs = observed?.proofDurationMs
  const stableConfirmedMs = observed?.stableConfirmedMs
  const timingIsCoherent =
    Number.isFinite(firstExactPublicationMs) &&
    firstExactPublicationMs >= 0 &&
    Number.isFinite(proofCompletedMs) &&
    proofCompletedMs >= firstExactPublicationMs &&
    Number.isFinite(proofDurationMs) &&
    proofDurationMs >= 0 &&
    proofDurationMs === proofCompletedMs - firstExactPublicationMs &&
    Number.isFinite(stableConfirmedMs) &&
    stableConfirmedMs === proofCompletedMs &&
    Number.isFinite(observed?.observedMs) &&
    observed.observedMs === proofCompletedMs
  if (!timingIsCoherent) {
    reasons.push(
      `Post-completion restart ${label} timing/proof evidence was missing or contradictory.`,
    )
    return
  }
  requireAtMost(
    reasons,
    firstExactPublicationMs,
    MAX_FIRST_BREADCRUMB_MS,
    `post-completion restart ${label} first exact publication`,
  )
}

function comparePersistenceEvidence(reasons, completed, restarted) {
  if (restarted.rowCount !== completed.rowCount) {
    reasons.push(
      `Post-restart persisted count ${restarted.rowCount} did not match completed count ${completed.rowCount}.`,
    )
  }
  if (restarted.sha256 !== completed.sha256) {
    reasons.push('Post-restart persisted identity/time/coordinate digest changed.')
  }
  if (restarted.missingSourceIdentityRows !== 0) {
    reasons.push(
      `${restarted.missingSourceIdentityRows} post-restart rows lack source position identity.`,
    )
  }
  if (restarted.integrityResult !== 'ok') {
    reasons.push(`Post-restart SQLite integrity result was ${restarted.integrityResult}, not ok.`)
  }
}

function compareRenderedEvidence(reasons, completed, restarted) {
  if (
    restarted.featureCount !== completed.featureCount ||
    restarted.coordinateCount !== completed.coordinateCount ||
    restarted.deviceCount !== completed.deviceCount
  ) {
    reasons.push('Post-restart rendered feature/coordinate/device counts changed.')
  }
  if (restarted.coordinateSha256 !== completed.coordinateSha256) {
    reasons.push('Post-restart rendered coordinate digest changed.')
  }
  if (restarted.reportedTotalObserved !== completed.reportedTotalObserved) {
    reasons.push('Post-restart reported Line known-fix total changed.')
  }
  if (restarted.stable !== true) {
    reasons.push('Post-restart rendered geometry did not remain stable across observations.')
  }
}

function normalizeCoordinates(coordinates) {
  return coordinates.map((coordinate) => {
    const lon = Number(coordinate?.[0])
    const lat = Number(coordinate?.[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error('Rendered breadcrumb geometry contains a non-finite coordinate.')
    }
    return [lon, lat]
  })
}

function comparePersistedPositions(left, right) {
  return (
    compareDeviceIds(left.device_id, right.device_id) ||
    Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
    String(left.source_position_id ?? '').localeCompare(String(right.source_position_id ?? ''))
  )
}

function compareDeviceIds(left, right) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber
  }
  return String(left).localeCompare(String(right))
}

function normalizeTimestamp(value, label) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp.`)
  }
  return new Date(parsed).toISOString()
}

function requireAtMost(reasons, value, maximum, label) {
  if (!Number.isFinite(value) || value > maximum) {
    reasons.push(`${label} timing ${String(value)} ms exceeded ${maximum} ms.`)
  }
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`)
  }
  return selected
}
