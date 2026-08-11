import { createHash } from 'node:crypto'

const MISSION_OFFSET_HOURS = 48
const FIXTURE_BASE_LOOKBACK_HOURS = 47
const FIXTURE_FINAL_MARGIN_HOURS = 4
const TRACKING_RECENT_WINDOW_MS = 2 * 60 * 60 * 1_000
const MAXIMUM_QUALIFIED_WALL_ELAPSED_MS = 30 * 60 * 1_000
const MINIMUM_RECENT_WINDOW_SEPARATION_MS = 2 * 60 * 60 * 1_000
const PRODUCTION_POLL_INTERVAL_MS = 5_000
const EXACT_PAGE_LIMIT = 10_000
const EXACT_ACTION_LIMIT_MS = 5_000
const EXACT_P95_LIMIT_MS = 2_000
const EXACT_OUTWARD_LIMIT_MS = 60_000
const EXACT_RETURN_LIMIT_MS = 120_000
const EXACT_RSS_INTERVAL_MS = 250
const EXACT_RSS_LIMIT_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Records one run-scoped deterministic clock whose complete accelerated trail
 * is inside the 48-hour mission and remains older than the recent-poll window
 * for the complete qualified wall-clock duration.
 */
export function createTrackingSoakFixtureClock(profile, recordedNowMs) {
  if (
    !Number.isSafeInteger(recordedNowMs) ||
    !Number.isSafeInteger(profile?.equivalentProductionPolls) ||
    profile.equivalentProductionPolls < 1
  ) {
    throw new Error('Tracking soak fixture clock input is invalid.')
  }
  const baseTimeMs = recordedNowMs - FIXTURE_BASE_LOOKBACK_HOURS * 3_600_000
  const availableSpanMs =
    (FIXTURE_BASE_LOOKBACK_HOURS - FIXTURE_FINAL_MARGIN_HOURS) * 3_600_000
  const intervalMs = profile.equivalentProductionPolls === 1
    ? PRODUCTION_POLL_INTERVAL_MS
    : Math.min(
        PRODUCTION_POLL_INTERVAL_MS,
        Math.floor(availableSpanMs / (profile.equivalentProductionPolls - 1)),
      )
  if (intervalMs < 1) {
    throw new Error('Tracking soak fixture interval is too small.')
  }
  const finalTimeMs =
    baseTimeMs + (profile.equivalentProductionPolls - 1) * intervalMs
  const latestQualifiedRecentFromMs =
    recordedNowMs + MAXIMUM_QUALIFIED_WALL_ELAPSED_MS -
    TRACKING_RECENT_WINDOW_MS
  const recentWindowSeparationMs = latestQualifiedRecentFromMs - finalTimeMs
  if (recentWindowSeparationMs < MINIMUM_RECENT_WINDOW_SEPARATION_MS) {
    throw new Error(
      'Tracking soak fixture trail is too close to the recent tracking window.',
    )
  }
  return Object.freeze({
    recordedNowMs,
    recordedNow: new Date(recordedNowMs).toISOString(),
    baseTimeMs,
    baseTime: new Date(baseTimeMs).toISOString(),
    intervalMs,
    finalTimeMs,
    finalTime: new Date(finalTimeMs).toISOString(),
    missionOffsetHours: MISSION_OFFSET_HOURS,
    recentWindowMs: TRACKING_RECENT_WINDOW_MS,
    maximumQualifiedWallElapsedMs: MAXIMUM_QUALIFIED_WALL_ELAPSED_MS,
    latestQualifiedRecentFromMs,
    latestQualifiedRecentFrom:
      new Date(latestQualifiedRecentFromMs).toISOString(),
    recentWindowSeparationMs,
  })
}

/**
 * Creates an independent, random-access formula oracle for exact chronological
 * pages. It intentionally does not import the mock server or production query.
 */
export function createIndependentExactSoakOracle(options) {
  validateOracleOptions(options)
  const productionPollCount =
    options.maximumBatches * options.productionPollsPerBatch
  const stationaryDeviceCount = options.deviceCount - options.movingDeviceCount
  const totalFixCount =
    productionPollCount * options.movingDeviceCount + stationaryDeviceCount
  const pageCount = Math.ceil(totalFixCount / options.pageLimit)
  const movingDeviceIds = sortedDeviceIds(options.movingDeviceCount)
  const initialDeviceIds = sortedDeviceIds(options.deviceCount)

  const rowAtChronologicalOrdinal = (ordinal) => {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= totalFixCount) {
      throw new Error('Exact soak oracle ordinal is outside source truth.')
    }
    if (ordinal < initialDeviceIds.length) {
      const deviceId = Number(initialDeviceIds[ordinal])
      return createFormulaRow(
        options,
        deviceId <= options.movingDeviceCount ? 1 : 0,
        deviceId,
        0,
        0,
      )
    }
    const movingOrdinal = ordinal - initialDeviceIds.length
    const productionPollIndex = Math.floor(movingOrdinal / options.movingDeviceCount) + 1
    const deviceId = Number(movingDeviceIds[movingOrdinal % options.movingDeviceCount])
    const batch = Math.floor(productionPollIndex / options.productionPollsPerBatch) + 1
    const offset = productionPollIndex % options.productionPollsPerBatch
    return createFormulaRow(
      options,
      batch,
      deviceId,
      offset,
      productionPollIndex,
    )
  }

  return Object.freeze({
    totalFixCount,
    pageCount,
    pageLimit: options.pageLimit,
    createPage: (pageIndexFromLatest) => {
      if (
        !Number.isSafeInteger(pageIndexFromLatest) ||
        pageIndexFromLatest < 0 ||
        pageIndexFromLatest >= pageCount
      ) {
        throw new Error('Exact soak page index is outside source truth.')
      }
      const endOrdinal = totalFixCount - pageIndexFromLatest * options.pageLimit
      const startOrdinal = Math.max(0, endOrdinal - options.pageLimit)
      return Array.from(
        { length: endOrdinal - startOrdinal },
        (_entry, index) => rowAtChronologicalOrdinal(startOrdinal + index),
      )
    },
  })
}

/** Converts the authoritative exact MapLibre source page to proof rows. */
export function normalizeExactSoakSourcePage(collection) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Exact soak source page must be a GeoJSON FeatureCollection.')
  }
  return collection.features.map((feature) => {
    const properties = feature?.properties
    const coordinates = feature?.geometry?.coordinates
    if (
      feature?.geometry?.type !== 'Point' ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      properties?.featureKind !== 'breadcrumb' ||
      typeof properties.deviceId !== 'string' ||
      properties.deviceId.trim() === '' ||
      typeof properties.sourcePositionId !== 'string' ||
      !/^[1-9]\d*$/u.test(properties.sourcePositionId) ||
      feature.id !== `${properties.deviceId}:id:${properties.sourcePositionId}`
    ) {
      throw new Error('Exact soak source page lacks a literal feature identity.')
    }
    const timestampMs = Date.parse(properties.timestamp)
    const lat = Number(coordinates[1])
    const lon = Number(coordinates[0])
    if (
      !Number.isFinite(timestampMs) ||
      new Date(timestampMs).toISOString() !== properties.timestamp ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180
    ) {
      throw new Error('Exact soak source page contains invalid time or coordinates.')
    }
    return {
      sourcePositionId: properties.sourcePositionId,
      deviceId: properties.deviceId,
      timestamp: properties.timestamp,
      lat,
      lon,
    }
  })
}

/**
 * Reduces one potentially mismatched exact publication to bounded evidence.
 * Coordinates, device identities, raw summary text, and malformed values are
 * intentionally excluded from the returned failure-safe structure.
 */
export function createExactSoakMismatchObservation(input) {
  let source
  if (input?.sourceEvidence !== undefined) {
    source = sanitizeCompactMismatchSource(input.sourceEvidence)
  } else {
    try {
      const rows = normalizeExactSoakSourcePage(input?.collection)
      const evidence = summarizeExactSoakRows(rows)
      source = {
        valid: true,
        positionCount: evidence.positionCount,
        sha256: evidence.sha256,
        range: evidence.range,
      }
    } catch {
      source = summarizeInvalidExactSoakCollection(input?.collection)
    }
  }
  return {
    loading: input?.loading === true,
    refreshing:
      typeof input?.refreshing === 'boolean' ? input.refreshing : null,
    unavailable: input?.unavailable === true,
    baselineBreadcrumbPointCount: boundedCount(
      input?.baselineBreadcrumbPointCount,
    ),
    source,
    operator: input?.operatorEvidence === undefined
      ? parseBoundedExactSoakSummary(input?.summaryText)
      : sanitizeCompactMismatchOperator(input.operatorEvidence),
  }
}

/**
 * Revalidates the complete extended exact-dot evidence structure so a caller
 * cannot turn an incomplete soak into a pass with one trusted boolean.
 */
export function validateExtendedExactSoakProof(proof, profile) {
  const failureReasons = []
  const expectedPages = Math.ceil(profile?.expectedPositionRows / EXACT_PAGE_LIMIT)
  const expectedLatestObservations = (profile?.restartCheckpoints?.length ?? 0) * 2 + 2
  const expectedDirectIpcQueryCount = 6
  const expectedPageObservations = expectedPages + (expectedPages - 1) +
    expectedLatestObservations
  if (
    profile?.name !== 'extended' ||
    profile.expectedPositionRows !== 1_935_384 ||
    expectedPages !== 194
  ) {
    failureReasons.push('Exact soak proof profile is not the frozen 14-day workload.')
  }
  if (proof?.required !== true || proof?.passed !== true) {
    failureReasons.push('Extended exact breadcrumb dot proof did not pass.')
  }
  if (!isQualifiedFixtureClock(proof?.fixtureClock, profile)) {
    failureReasons.push(
      'Exact soak fixture clock can cross the production recent window.',
    )
  }
  const traversal = proof?.finalTraversal
  if (
    traversal?.passed !== true ||
    traversal.totalFixCount !== profile?.expectedPositionRows ||
    traversal.pageCount !== expectedPages ||
    traversal.maximumPageCount !== EXACT_PAGE_LIMIT ||
    traversal.gapCount !== 0 ||
    traversal.duplicateCount !== 0 ||
    traversal.exactIdentityTimeCoordinateMatch !== true ||
    !isMatchingSha256(traversal.expectedSha256, traversal.observedSha256)
  ) {
    failureReasons.push(
      'Exact traversal count, 10,000-fix cap, union digest, gap, or duplicate evidence is invalid.',
    )
  }
  const ranges = Array.isArray(traversal?.ranges) ? traversal.ranges : []
  const rangeFixCount = ranges.reduce(
    (total, range) => total + (Number.isSafeInteger(range?.positionCount)
      ? range.positionCount
      : 0),
    0,
  )
  if (
    ranges.length !== expectedPages ||
    rangeFixCount !== profile?.expectedPositionRows ||
    ranges.some(
      (range, index) =>
        range?.pageIndexFromLatest !== index ||
        range.positionCount < 1 ||
        range.positionCount > EXACT_PAGE_LIMIT,
    )
  ) {
    failureReasons.push('Exact traversal page ranges do not cover all 194 pages.')
  }
  if (
    proof?.returnedToLatest !== true ||
    proof?.earlierDisabledAtOldest !== true ||
    proof?.laterDisabledAtLatest !== true ||
    proof?.baselineBreadcrumbPointCount !== 0
  ) {
    failureReasons.push(
      'Exact traversal terminal controls, latest return, or baseline breadcrumb Points are invalid.',
    )
  }
  const restartAudits = Array.isArray(proof?.restartAudits)
    ? proof.restartAudits
    : []
  if (
    restartAudits.length !== (profile?.restartCheckpoints?.length ?? 0) ||
    restartAudits.some(
      (audit, index) => {
        const checkpoint = profile.restartCheckpoints[index]
        const expectedFixCount = checkpointFixCount(profile, checkpoint)
        return (
          audit?.passed !== true ||
          audit.checkpoint !== checkpoint ||
          !latestAuditPairMatches(
            audit.beforeRestart,
            audit.afterRestart,
            expectedFixCount,
            Math.ceil(expectedFixCount / EXACT_PAGE_LIMIT),
          )
        )
      },
    )
  ) {
    failureReasons.push('Both restart exact latest-page parity records are required.')
  }
  const directIpcLatestAudits = Array.isArray(proof?.directIpcLatestAudits)
    ? proof.directIpcLatestAudits
    : []
  const expectedDirectIpcBoundaries = [
    ...(profile?.restartCheckpoints ?? []).flatMap((checkpoint) => [
      `checkpoint-${checkpoint}-before-restart`,
      `checkpoint-${checkpoint}-after-restart`,
    ]),
    'final-before-traversal',
    'final-after-traversal',
  ]
  if (
    expectedLatestObservations !== expectedDirectIpcQueryCount ||
    directIpcLatestAudits.length !== expectedDirectIpcQueryCount ||
    directIpcLatestAudits.some(
      (audit, index) => {
        const checkpointIndex = Math.floor(index / 2)
        const checkpoint = profile?.restartCheckpoints?.[checkpointIndex]
        const expectedFixCount = checkpoint === undefined
          ? profile?.expectedPositionRows
          : checkpointFixCount(profile, checkpoint)
        return (
          audit?.boundary !== expectedDirectIpcBoundaries[index] ||
          !isValidLatestAudit(
            audit,
            expectedFixCount,
            Math.ceil(expectedFixCount / EXACT_PAGE_LIMIT),
          )
        )
      },
    )
  ) {
    failureReasons.push(
      'Exactly 6 named direct IPC latest-page audits are required.',
    )
  }
  const launchNumbers = new Set([
    ...directIpcLatestAudits.map((audit) => audit?.launchNumber),
    proof?.metrics?.rss?.launchNumber,
  ])
  for (let launchNumber = 1; launchNumber <= (profile?.restartCheckpoints?.length ?? 0) + 1; launchNumber += 1) {
    if (!launchNumbers.has(launchNumber)) {
      failureReasons.push(`Exact phase RSS evidence is missing for launch ${launchNumber}.`)
    }
  }
  if (
    proof?.explicitPageObservationCount !== expectedPageObservations
  ) {
    failureReasons.push(
      `Exact proof requires exactly ${expectedPageObservations} explicit page observations.`,
    )
  }
  if (
    proof?.directIpcQueryCount !== expectedDirectIpcQueryCount ||
    proof?.metrics?.exactDotDirectIpcQueryDurationMs?.count !==
      expectedDirectIpcQueryCount ||
    !Number.isFinite(
      proof?.metrics?.exactDotDirectIpcQueryDurationMs?.maxMs,
    ) ||
    proof.metrics.exactDotDirectIpcQueryDurationMs.maxMs >
      EXACT_ACTION_LIMIT_MS ||
    !Number.isFinite(
      proof?.metrics?.exactDotDirectIpcQueryDurationMs?.p95Ms,
    ) ||
    proof.metrics.exactDotDirectIpcQueryDurationMs.p95Ms > EXACT_P95_LIMIT_MS
  ) {
    failureReasons.push(
      'Exact proof requires exactly 6 direct IPC queries with max <= 5,000ms and p95 <= 2,000ms.',
    )
  }
  for (const [label, metric] of [
    ['publication', proof?.metrics?.exactDotPublicationDurationMs],
    ['page action', proof?.metrics?.exactDotPageDurationMs],
  ]) {
    if (
      metric?.count !== expectedPageObservations ||
      !Number.isFinite(metric?.maxMs) ||
      metric.maxMs > EXACT_ACTION_LIMIT_MS ||
      !Number.isFinite(metric?.p95Ms) ||
      metric.p95Ms > EXACT_P95_LIMIT_MS
    ) {
      failureReasons.push(
        `Exact ${label} metrics require ${expectedPageObservations} observations, max <= 5,000ms, and p95 <= 2,000ms.`,
      )
    }
  }
  for (const [label, metric] of [
    ['stable verification', proof?.metrics?.exactDotStableVerificationDurationMs],
    ['renderer fingerprint', proof?.metrics?.exactDotFingerprintDurationMs],
    ['proof overhead', proof?.metrics?.exactDotProofOverheadDurationMs],
  ]) {
    if (
      metric?.count !== expectedPageObservations ||
      !Number.isFinite(metric?.maxMs) ||
      metric.maxMs < 0 ||
      metric.maxMs > EXACT_ACTION_LIMIT_MS ||
      !Number.isFinite(metric?.p95Ms) ||
      metric.p95Ms < 0 ||
      metric.p95Ms > metric.maxMs
    ) {
      failureReasons.push(
        `Exact ${label} proof evidence requires ${expectedPageObservations} observations and finite timings with max <= 5,000ms.`,
      )
    }
  }
  if (
    !Number.isFinite(proof?.metrics?.proofWallDurationMs) ||
    proof.metrics.proofWallDurationMs < 0 ||
    proof.metrics.proofWallDurationMs > MAXIMUM_QUALIFIED_WALL_ELAPSED_MS
  ) {
    failureReasons.push(
      'Exact proof wall duration must be finite and inside the qualified run window.',
    )
  }
  if (
    !Number.isFinite(proof?.outwardTraversalDurationMs) ||
    proof.outwardTraversalDurationMs > EXACT_OUTWARD_LIMIT_MS ||
    !Number.isFinite(proof?.laterTraversalDurationMs) ||
    proof.laterTraversalDurationMs > EXACT_RETURN_LIMIT_MS
  ) {
    failureReasons.push(
      'Exact outward traversal must be <= 60,000ms and Later return <= 120,000ms.',
    )
  }
  if (
    proof?.unavailableCount !== 0 ||
    proof?.failureCount !== 0 ||
    proof?.unexplainedPublicationCount !== 0
  ) {
    failureReasons.push(
      'Exact traversal recorded unavailable, failed, or unexplained publications.',
    )
  }
  if (!isValidRssEvidence(proof?.metrics?.rss)) {
    failureReasons.push(
      'Exact traversal requires bounded 250ms RSS evidence below 2GiB.',
    )
  }
  return { passed: failureReasons.length === 0, failureReasons }
}

/**
 * Streams a newest-to-oldest page traversal into bounded digests while every
 * page is compared directly with the independent formula oracle.
 */
export function createExactSoakTraversalAccumulator(oracle) {
  if (
    typeof oracle?.createPage !== 'function' ||
    !Number.isSafeInteger(oracle.totalFixCount) ||
    !Number.isSafeInteger(oracle.pageCount)
  ) {
    throw new Error('Exact soak traversal requires an independent oracle.')
  }
  const expectedHash = createHash('sha256')
  const observedHash = createHash('sha256')
  const ranges = []
  let nextPageIndex = 0
  let observedFixCount = 0
  let finished = false

  return {
    addPage: (pageIndexFromLatest, observedRows) => {
      if (finished) throw new Error('Exact soak traversal is already finalized.')
      if (pageIndexFromLatest !== nextPageIndex) {
        throw new Error('Exact soak page sequence has a gap or duplicate.')
      }
      if (!Array.isArray(observedRows)) {
        throw new Error('Exact soak observed page is invalid.')
      }
      const pageEvidence = auditIndependentExactSoakPage(
        oracle,
        pageIndexFromLatest,
        observedRows,
      )
      const expectedRows = oracle.createPage(pageIndexFromLatest)
      for (let index = 0; index < expectedRows.length; index += 1) {
        const expected = expectedRows[index]
        const observed = observedRows[index]
        const expectedLine = canonicalExactRow(expected)
        const observedLine = canonicalExactRow(observed)
        expectedHash.update(expectedLine)
        observedHash.update(observedLine)
      }
      observedFixCount += observedRows.length
      ranges.push({
        pageIndexFromLatest,
        ...pageEvidence.range,
      })
      nextPageIndex += 1
    },
    finish: () => {
      if (finished) throw new Error('Exact soak traversal is already finalized.')
      finished = true
      if (
        nextPageIndex !== oracle.pageCount ||
        observedFixCount !== oracle.totalFixCount
      ) {
        throw new Error('Exact soak traversal did not cover every source fix.')
      }
      const expectedSha256 = expectedHash.digest('hex')
      const observedSha256 = observedHash.digest('hex')
      if (expectedSha256 !== observedSha256) {
        throw new Error('Exact soak traversal digest did not match source truth.')
      }
      return {
        passed: true,
        totalFixCount: observedFixCount,
        pageCount: nextPageIndex,
        maximumPageCount: oracle.pageLimit,
        gapCount: 0,
        duplicateCount: 0,
        exactIdentityTimeCoordinateMatch: true,
        expectedSha256,
        observedSha256,
        ranges,
      }
    },
  }
}

/**
 * Streams renderer-computed page fingerprints against independent formula
 * truth without moving the underlying 10,000-fix pages across CDP.
 */
export function createExactSoakPageEvidenceAccumulator(oracle) {
  if (
    typeof oracle?.createPage !== 'function' ||
    !Number.isSafeInteger(oracle.totalFixCount) ||
    !Number.isSafeInteger(oracle.pageCount)
  ) {
    throw new Error('Exact soak page evidence requires an independent oracle.')
  }
  const expectedHash = createHash('sha256')
  const observedHash = createHash('sha256')
  const ranges = []
  let nextPageIndex = 0
  let observedFixCount = 0
  let finished = false

  return {
    addPageEvidence: (pageIndexFromLatest, observedEvidence) => {
      if (finished) {
        throw new Error('Exact soak page evidence is already finalized.')
      }
      if (pageIndexFromLatest !== nextPageIndex) {
        throw new Error('Exact soak page evidence sequence has a gap or duplicate.')
      }
      const expectedEvidence = auditIndependentExactSoakPage(
        oracle,
        pageIndexFromLatest,
        oracle.createPage(pageIndexFromLatest),
      )
      assertCompactPageEvidence(observedEvidence)
      if (!sameCompactPageEvidence(observedEvidence, expectedEvidence)) {
        throw new Error(
          'Exact soak page evidence does not match independent formula truth.',
        )
      }
      expectedHash.update(canonicalPageEvidence(expectedEvidence))
      observedHash.update(canonicalPageEvidence({
        pageIndexFromLatest,
        ...observedEvidence,
      }))
      observedFixCount += observedEvidence.positionCount
      ranges.push({
        pageIndexFromLatest,
        ...observedEvidence.range,
      })
      nextPageIndex += 1
    },
    finish: () => {
      if (finished) {
        throw new Error('Exact soak page evidence is already finalized.')
      }
      finished = true
      if (
        nextPageIndex !== oracle.pageCount ||
        observedFixCount !== oracle.totalFixCount
      ) {
        throw new Error('Exact soak page evidence did not cover every source fix.')
      }
      const expectedSha256 = expectedHash.digest('hex')
      const observedSha256 = observedHash.digest('hex')
      if (expectedSha256 !== observedSha256) {
        throw new Error('Exact soak page evidence digest did not match source truth.')
      }
      return {
        passed: true,
        totalFixCount: observedFixCount,
        pageCount: nextPageIndex,
        maximumPageCount: oracle.pageLimit,
        gapCount: 0,
        duplicateCount: 0,
        exactIdentityTimeCoordinateMatch: true,
        expectedSha256,
        observedSha256,
        ranges,
      }
    },
  }
}

/**
 * Separates first formula-exact publication time from proof confirmation cost.
 */
export function createExactSoakPageTiming(input) {
  const values = [
    input?.pageStartedAtEpochMs,
    input?.sourceReadStartedAtEpochMs,
    input?.firstFormulaExactSampledAtEpochMs,
    input?.stableVerificationDurationMs,
  ]
  if (
    !values.every(Number.isFinite) ||
    input.pageStartedAtEpochMs > input.sourceReadStartedAtEpochMs ||
    input.sourceReadStartedAtEpochMs > input.firstFormulaExactSampledAtEpochMs ||
    input.stableVerificationDurationMs < 0
  ) {
    throw new Error('Exact soak page timing evidence is invalid.')
  }
  const publicationDurationMs =
    input.firstFormulaExactSampledAtEpochMs -
    input.sourceReadStartedAtEpochMs
  const pageActionDurationMs =
    input.firstFormulaExactSampledAtEpochMs - input.pageStartedAtEpochMs
  if (input.stableVerificationDurationMs < publicationDurationMs) {
    throw new Error('Exact soak page timing evidence is contradictory.')
  }
  return {
    publicationDurationMs,
    pageActionDurationMs,
    stableVerificationDurationMs: input.stableVerificationDurationMs,
    proofOverheadDurationMs:
      input.stableVerificationDurationMs - publicationDurationMs,
  }
}

/** Audits one bounded exact page directly against independent formula truth. */
export function auditIndependentExactSoakPage(oracle, pageIndexFromLatest, observedRows) {
  if (typeof oracle?.createPage !== 'function' || !Array.isArray(observedRows)) {
    throw new Error('Exact soak page audit input is invalid.')
  }
  const expectedRows = oracle.createPage(pageIndexFromLatest)
  if (observedRows.length !== expectedRows.length) {
    throw new Error('Exact soak page count does not match source truth.')
  }
  const hash = createHash('sha256')
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index]
    const observed = observedRows[index]
    if (!sameExactRow(observed, expected)) {
      throw new Error(
        'Exact soak page identity, time, and coordinate truth did not match.',
      )
    }
    hash.update(canonicalExactRow(observed))
  }
  return {
    pageIndexFromLatest,
    positionCount: observedRows.length,
    sha256: hash.digest('hex'),
    range: {
      positionCount: observedRows.length,
      fromTimestamp: observedRows[0]?.timestamp ?? null,
      toTimestamp: observedRows.at(-1)?.timestamp ?? null,
      firstSourcePositionId: observedRows[0]?.sourcePositionId ?? null,
      lastSourcePositionId: observedRows.at(-1)?.sourcePositionId ?? null,
    },
  }
}

/** Validates one compact renderer fingerprint before comparison. */
function assertCompactPageEvidence(evidence) {
  const range = evidence?.range
  if (
    !Number.isSafeInteger(evidence?.positionCount) ||
    evidence.positionCount < 0 ||
    evidence.positionCount > EXACT_PAGE_LIMIT ||
    typeof evidence.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(evidence.sha256) ||
    range?.positionCount !== evidence.positionCount ||
    boundedTimestamp(range.fromTimestamp) !== range.fromTimestamp ||
    boundedTimestamp(range.toTimestamp) !== range.toTimestamp ||
    boundedSourcePositionId(range.firstSourcePositionId) !==
      range.firstSourcePositionId ||
    boundedSourcePositionId(range.lastSourcePositionId) !==
      range.lastSourcePositionId
  ) {
    throw new Error('Exact soak compact page evidence is invalid.')
  }
}

/** Compares the complete bounded page contract. */
function sameCompactPageEvidence(left, right) {
  return (
    left.positionCount === right.positionCount &&
    left.sha256 === right.sha256 &&
    JSON.stringify(left.range) === JSON.stringify(right.range)
  )
}

/** Creates the bounded union-digest line for one exact source page. */
function canonicalPageEvidence(evidence) {
  return `${JSON.stringify([
    evidence.pageIndexFromLatest,
    evidence.positionCount,
    evidence.sha256,
    evidence.range.positionCount,
    evidence.range.fromTimestamp,
    evidence.range.toTimestamp,
    evidence.range.firstSourcePositionId,
    evidence.range.lastSourcePositionId,
  ])}\n`
}

/** Creates a bounded digest/range without treating the observed rows as truth. */
function summarizeExactSoakRows(rows) {
  const hash = createHash('sha256')
  for (const row of rows) hash.update(canonicalExactRow(row))
  return {
    positionCount: rows.length,
    sha256: hash.digest('hex'),
    range: {
      fromTimestamp: boundedTimestamp(rows[0]?.timestamp),
      toTimestamp: boundedTimestamp(rows.at(-1)?.timestamp),
      firstSourcePositionId: boundedSourcePositionId(
        rows[0]?.sourcePositionId,
      ),
      lastSourcePositionId: boundedSourcePositionId(
        rows.at(-1)?.sourcePositionId,
      ),
    },
  }
}

/** Preserves only safe envelope fields when strict source normalization fails. */
function summarizeInvalidExactSoakCollection(collection) {
  const features = Array.isArray(collection?.features)
    ? collection.features
    : []
  const first = features[0]
  const last = features.at(-1)
  return {
    valid: false,
    positionCount: boundedCount(features.length),
    sha256: null,
    range: {
      fromTimestamp: boundedTimestamp(first?.properties?.timestamp),
      toTimestamp: boundedTimestamp(last?.properties?.timestamp),
      firstSourcePositionId: boundedSourcePositionId(
        first?.properties?.sourcePositionId,
      ),
      lastSourcePositionId: boundedSourcePositionId(
        last?.properties?.sourcePositionId,
      ),
    },
  }
}

/** Revalidates renderer-computed mismatch source evidence without raw rows. */
function sanitizeCompactMismatchSource(value) {
  const positionCount = boundedCount(value?.positionCount)
  const sha256 = typeof value?.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.sha256)
    ? value.sha256
    : null
  return {
    valid: value?.valid === true && positionCount !== null && sha256 !== null,
    positionCount,
    sha256,
    range: {
      positionCount: boundedCount(value?.range?.positionCount),
      fromTimestamp: boundedTimestamp(value?.range?.fromTimestamp),
      toTimestamp: boundedTimestamp(value?.range?.toTimestamp),
      firstSourcePositionId: boundedSourcePositionId(
        value?.range?.firstSourcePositionId,
      ),
      lastSourcePositionId: boundedSourcePositionId(
        value?.range?.lastSourcePositionId,
      ),
    },
  }
}

/** Revalidates renderer-computed operator evidence. */
function sanitizeCompactMismatchOperator(value) {
  const pagePositionCount = boundedCount(value?.pagePositionCount)
  const totalPositionCount = boundedCount(value?.totalPositionCount)
  const fromTimestamp = boundedTimestamp(value?.fromTimestamp)
  const toTimestamp = boundedTimestamp(value?.toTimestamp)
  return {
    valid:
      value?.valid === true &&
      pagePositionCount !== null &&
      totalPositionCount !== null &&
      fromTimestamp !== null &&
      toTimestamp !== null,
    pagePositionCount,
    totalPositionCount,
    fromTimestamp,
    toTimestamp,
  }
}

/** Parses only the bounded numeric/range contract from the operator summary. */
function parseBoundedExactSoakSummary(value) {
  const match = /^Showing ([\d,]+) exact fixes of ([\d,]+)(?: — (.+) to (.+))?$/u.exec(
    typeof value === 'string' ? value.trim().replaceAll(/\s+/gu, ' ') : '',
  )
  if (match === null) {
    return {
      valid: false,
      pagePositionCount: null,
      totalPositionCount: null,
      fromTimestamp: null,
      toTimestamp: null,
    }
  }
  const pagePositionCount = parseBoundedCountText(match[1])
  const totalPositionCount = parseBoundedCountText(match[2])
  const fromTimestamp = boundedTimestamp(match[3])
  const toTimestamp = boundedTimestamp(match[4])
  const rangeValid =
    (match[3] === undefined && match[4] === undefined) ||
    (fromTimestamp !== null && toTimestamp !== null)
  return {
    valid:
      pagePositionCount !== null &&
      totalPositionCount !== null &&
      rangeValid,
    pagePositionCount,
    totalPositionCount,
    fromTimestamp,
    toTimestamp,
  }
}

/** Converts a formatted count without retaining unreasonable input. */
function parseBoundedCountText(value) {
  if (typeof value !== 'string' || value.length > 20) return null
  return boundedCount(Number(value.replaceAll(',', '')))
}

/** Retains only safe non-negative evidence counts. */
function boundedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000
    ? value
    : null
}

/** Retains canonical timestamps without preserving arbitrary raw text. */
function boundedTimestamp(value) {
  if (typeof value !== 'string' || value.length > 32) return null
  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) && new Date(timestampMs).toISOString() === value
    ? value
    : null
}

/** Retains only compact numeric source identities in diagnostic evidence. */
function boundedSourcePositionId(value) {
  return typeof value === 'string' && /^[1-9]\d{0,31}$/u.test(value)
    ? value
    : null
}

function createFormulaRow(options, batch, deviceId, offset, productionPollIndex) {
  const timestamp = new Date(
    options.baseTimeMs + productionPollIndex * options.intervalMs,
  ).toISOString()
  return {
    sourcePositionId: String(batch * 1_000_000 + deviceId * 1_000 + offset),
    deviceId: String(deviceId),
    timestamp,
    lat: 52 + deviceId * 0.0001 + batch * 0.000001 + offset * 0.00000001,
    lon: -9 - deviceId * 0.0001 - batch * 0.000001 - offset * 0.00000001,
  }
}

function sortedDeviceIds(count) {
  return Array.from({ length: count }, (_entry, index) => String(index + 1))
    .sort(compareCodeUnits)
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sameExactRow(left, right) {
  return (
    typeof left === 'object' &&
    left !== null &&
    left.sourcePositionId === right.sourcePositionId &&
    left.deviceId === right.deviceId &&
    left.timestamp === right.timestamp &&
    left.lat === right.lat &&
    left.lon === right.lon
  )
}

function canonicalExactRow(row) {
  return `${JSON.stringify([
    row.sourcePositionId,
    row.deviceId,
    row.timestamp,
    row.lat,
    row.lon,
  ])}\n`
}

function latestAuditPairMatches(
  beforeRestart,
  afterRestart,
  expectedTotalCount,
  expectedPageCount,
) {
  return (
    isValidLatestAudit(
      beforeRestart,
      expectedTotalCount,
      expectedPageCount,
    ) &&
    isValidLatestAudit(
      afterRestart,
      expectedTotalCount,
      expectedPageCount,
    ) &&
    beforeRestart.latestPage.sha256 === afterRestart.latestPage.sha256 &&
    JSON.stringify(beforeRestart.latestPage.range) ===
      JSON.stringify(afterRestart.latestPage.range)
  )
}

function checkpointFixCount(profile, checkpoint) {
  return (
    checkpoint * profile.productionPollsPerBatch * profile.movingDeviceCount +
    (profile.deviceCount - profile.movingDeviceCount)
  )
}

/** Revalidates that the accelerated fixture cannot cross the recent-window branch. */
function isQualifiedFixtureClock(clock, profile) {
  if (
    !Number.isSafeInteger(profile?.equivalentProductionPolls) ||
    profile.equivalentProductionPolls < 1 ||
    !Number.isSafeInteger(clock?.recordedNowMs) ||
    !Number.isSafeInteger(clock?.baseTimeMs) ||
    !Number.isSafeInteger(clock?.intervalMs) ||
    clock.intervalMs < 1 ||
    clock.intervalMs > PRODUCTION_POLL_INTERVAL_MS ||
    !Number.isSafeInteger(clock?.finalTimeMs) ||
    !Number.isSafeInteger(clock?.latestQualifiedRecentFromMs) ||
    !Number.isSafeInteger(clock?.recentWindowSeparationMs)
  ) {
    return false
  }
  const expectedFinalTimeMs =
    clock.baseTimeMs +
    (profile.equivalentProductionPolls - 1) * clock.intervalMs
  const expectedLatestQualifiedRecentFromMs =
    clock.recordedNowMs + MAXIMUM_QUALIFIED_WALL_ELAPSED_MS -
    TRACKING_RECENT_WINDOW_MS
  return (
    clock.missionOffsetHours === MISSION_OFFSET_HOURS &&
    clock.recentWindowMs === TRACKING_RECENT_WINDOW_MS &&
    clock.maximumQualifiedWallElapsedMs ===
      MAXIMUM_QUALIFIED_WALL_ELAPSED_MS &&
    clock.baseTimeMs ===
      clock.recordedNowMs - FIXTURE_BASE_LOOKBACK_HOURS * 3_600_000 &&
    clock.baseTimeMs >
      clock.recordedNowMs - MISSION_OFFSET_HOURS * 3_600_000 &&
    clock.finalTimeMs === expectedFinalTimeMs &&
    clock.finalTimeMs <=
      clock.recordedNowMs - FIXTURE_FINAL_MARGIN_HOURS * 3_600_000 &&
    clock.latestQualifiedRecentFromMs ===
      expectedLatestQualifiedRecentFromMs &&
    clock.latestQualifiedRecentFromMs > clock.finalTimeMs &&
    clock.recentWindowSeparationMs ===
      clock.latestQualifiedRecentFromMs - clock.finalTimeMs &&
    clock.recentWindowSeparationMs >=
      MINIMUM_RECENT_WINDOW_SEPARATION_MS &&
    isCanonicalIso(clock.recordedNow, clock.recordedNowMs) &&
    isCanonicalIso(clock.baseTime, clock.baseTimeMs) &&
    isCanonicalIso(clock.finalTime, clock.finalTimeMs) &&
    isCanonicalIso(
      clock.latestQualifiedRecentFrom,
      clock.latestQualifiedRecentFromMs,
    )
  )
}

/** Checks that a timestamp string is the exact canonical form of its epoch. */
function isCanonicalIso(value, epochMs) {
  try {
    return typeof value === 'string' && new Date(epochMs).toISOString() === value
  } catch {
    return false
  }
}

function isValidLatestAudit(audit, expectedTotalCount, expectedPageCount) {
  return (
    audit?.passed === true &&
    Number.isSafeInteger(audit.launchNumber) &&
    audit.launchNumber > 0 &&
    audit.totalPositionCount === expectedTotalCount &&
    audit.pageCount === expectedPageCount &&
    audit.baselineBreadcrumbPointCount === 0 &&
    audit.latestPage?.positionCount > 0 &&
    audit.latestPage.positionCount <= EXACT_PAGE_LIMIT &&
    /^[a-f0-9]{64}$/u.test(audit.latestPage.sha256) &&
    audit.latestPage.range?.positionCount === audit.latestPage.positionCount &&
    isBoundedActionDuration(audit.exactDotQueryDurationMs) &&
    isBoundedActionDuration(audit.exactDotPublicationDurationMs) &&
    isBoundedActionDuration(audit.exactDotPageDurationMs) &&
    audit.rss?.launchNumber === audit.launchNumber &&
    isValidRssEvidence(audit.rss)
  )
}

function isBoundedActionDuration(value) {
  return Number.isFinite(value) && value >= 0 && value <= EXACT_ACTION_LIMIT_MS
}

function isValidRssEvidence(rss) {
  return (
    Number.isSafeInteger(rss?.sampleCount) &&
    rss.sampleCount > 0 &&
    rss.sampleIntervalMs === EXACT_RSS_INTERVAL_MS &&
    Number.isFinite(rss.maximumProcessTreeResidentBytes) &&
    rss.maximumProcessTreeResidentBytes > 0 &&
    rss.maximumProcessTreeResidentBytes <= EXACT_RSS_LIMIT_BYTES
  )
}

function isMatchingSha256(expected, observed) {
  return (
    typeof expected === 'string' &&
    /^[a-f0-9]{64}$/u.test(expected) &&
    expected === observed
  )
}

function validateOracleOptions(options) {
  for (const key of [
    'deviceCount',
    'movingDeviceCount',
    'productionPollsPerBatch',
    'maximumBatches',
    'baseTimeMs',
    'intervalMs',
    'pageLimit',
  ]) {
    if (!Number.isSafeInteger(options?.[key]) || options[key] < 1) {
      throw new Error(`Exact soak oracle requires a positive integer ${key}.`)
    }
  }
  if (options.movingDeviceCount > options.deviceCount || options.pageLimit > 10_000) {
    throw new Error('Exact soak oracle device or page bounds are invalid.')
  }
}
