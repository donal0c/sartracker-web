import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import { createBreadcrumb36HourSourceDatabase } from './breadcrumb-36h-mock-traccar.js'

const require = createRequire(import.meta.url)
const { listBreadcrumbPositions } = require('../electron/breadcrumb-query.cjs')

const DEFAULT_NORMAL_POLL_INTERVAL_MS = 30_000
const DEFAULT_RECONCILIATION_TIMEOUT_MS = 60_000
const DEFAULT_PERSISTENCE_TIMEOUT_MS = 120_000
const DEFAULT_MOCK_LATENCY_MS = 20
const MAX_CURRENT_FIX_MS = 5_000
const MAX_FIRST_BREADCRUMB_MS = 10_000
const MAX_FULL_RECONCILIATION_MS = 60_000
const MAX_HISTORY_CONCURRENCY = 8
const RENDER_BREADCRUMB_LIMIT_PER_DEVICE = 5_000
const RENDER_BREADCRUMB_GAP_THRESHOLD_MS = 30 * 60 * 1_000
const EARTH_RADIUS_METRES = 6_371_008.8

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

/** Reports durable reconciliation cursor coverage for every required device. */
export function analyzeBreadcrumbCheckpointProgress(input) {
  const requiredFrom = normalizeTimestamp(input.requiredFrom, 'checkpoint coverage start')
  const requiredTo = normalizeTimestamp(input.requiredTo, 'checkpoint coverage end')
  const requiredFromMs = Date.parse(requiredFrom)
  const requiredToMs = Date.parse(requiredTo)
  if (requiredToMs < requiredFromMs) {
    throw new Error('Required checkpoint coverage window is reversed.')
  }
  const checkpointByDeviceId = new Map(
    input.checkpoints.map((checkpoint) => [String(checkpoint.device_id), checkpoint]),
  )
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
        coveredMs,
        remainingMs,
        complete: remainingMs === 0,
      }
    })

  return {
    requiredFrom,
    requiredTo,
    requiredDeviceCount: devices.length,
    checkpointedDeviceCount: devices.filter((device) => device.checkpointPresent).length,
    completedDeviceCount: devices.filter((device) => device.complete).length,
    remainingDeviceCount: devices.filter((device) => !device.complete).length,
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
  validateRenderedOracle(
    failureReasons,
    input.rendered,
    input.renderedOracle,
    input.sourceTruth,
  )
  validateRenderedDotOracle(
    failureReasons,
    input.renderedDots,
    input.renderedOracle?.dotRendered,
  )
  validateVariableSpeedEvidence(failureReasons, input.variableSpeedEvidence)

  return {
    passed: failureReasons.length === 0,
    failureReasons,
  }
}

function validateRenderedDotOracle(reasons, rendered, oracle) {
  if (rendered === null || rendered === undefined) {
    reasons.push('Packaged breadcrumb-dot evidence was not provided.')
    return
  }
  if (oracle === null || oracle === undefined) {
    reasons.push('Canonical breadcrumb-dot source-truth oracle was not provided.')
    return
  }
  if (rendered.stable !== true) {
    reasons.push('Packaged breadcrumb-dot count/digest did not remain stable.')
  }
  if (
    rendered.featureCount !== oracle.featureCount ||
    rendered.coordinateCount !== oracle.coordinateCount ||
    rendered.deviceCount !== oracle.deviceCount ||
    rendered.coordinateSha256 !== oracle.coordinateSha256 ||
    !recordsEqual(rendered.deviceCoordinateCounts, oracle.deviceCoordinateCounts) ||
    !recordsEqual(rendered.deviceCoordinateSha256, oracle.deviceCoordinateSha256)
  ) {
    reasons.push('Packaged breadcrumb-dot geometry did not match the source-truth dot oracle.')
  }
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
  requireAtMost(
    failureReasons,
    input.postCompletionRenderMs,
    MAX_FIRST_BREADCRUMB_MS,
    'post-completion restart render',
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

  return {
    passed: failureReasons.length === 0,
    failureReasons,
  }
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
