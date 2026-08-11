import { createHmac } from 'node:crypto'

const TARGET_DEVICE_ID_PATTERN = /^[1-9]\d{0,31}$/u
const EXPLICIT_ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const STAGE_NAMES = [
  'provider',
  'sqlite',
  'exactPages',
  'exactGeoJson',
]
const RENDERED_METRE_LIMIT = 8
const RENDERED_PER_AXIS_PIXEL_LIMIT = 1 / 16
const RENDERED_RADIAL_PIXEL_LIMIT = Math.SQRT2 / 16

/**
 * Reads one target identifier only when its source is an owner-only regular
 * file. The identifier must never be supplied directly through argv or env.
 */
export function parsePrivateTargetSelector(contents, metadata) {
  if (
    metadata?.isFile !== true ||
    metadata.isSymbolicLink === true ||
    (Number(metadata.mode) & 0o777) !== 0o600
  ) {
    throw new Error('The live exact target selector must be a mode-0600 regular file.')
  }
  if (
    !Number.isSafeInteger(metadata.uid) ||
    !Number.isSafeInteger(metadata.expectedUid) ||
    metadata.uid !== metadata.expectedUid
  ) {
    throw new Error('The live exact target selector owner is invalid.')
  }
  if (typeof contents !== 'string') {
    throw new Error('The live exact target selector must contain text.')
  }
  const lines = contents.split(/\r?\n/u)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  if (lines.length !== 1 || !isPositiveSafeIdentity(lines[0] ?? '')) {
    throw new Error('The live exact target selector must contain one positive device ID.')
  }
  return lines[0]
}

/**
 * Independently normalizes raw GET response rows without importing the app's
 * Traccar client or normalizer.
 */
export function normalizeExactProviderRows(rows, targetDeviceId) {
  assertTargetDeviceId(targetDeviceId)
  if (!Array.isArray(rows)) {
    throw new Error('The provider positions response must be an array.')
  }
  const normalized = rows.map((row, index) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error(`Provider fix ${index} is invalid.`)
    }
    if (row.valid === false) {
      throw new Error(`Provider fix ${index} is not valid.`)
    }
    if (String(row.deviceId) !== targetDeviceId) {
      throw new Error(`Provider fix ${index} is not for the target device.`)
    }
    if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) < 1) {
      throw new Error(`Provider fix ${index} source identity is invalid.`)
    }
    if (row.fixTime === undefined || row.fixTime === null) {
      throw new Error(`Provider fix ${index} has no explicit fixTime.`)
    }
    return normalizeExactFix({
      deviceId: targetDeviceId,
      sourcePositionId: String(Number(row.id)),
      timestamp: row.fixTime,
      lat: row.latitude,
      lon: row.longitude,
    }, `Provider fix ${index}`)
  })
  assertUniqueFixIdentities(normalized, 'Provider')
  return normalized
}

/** Normalizes persisted or exact-page rows to the proof record contract. */
export function normalizeExactStoredRows(rows, targetDeviceId) {
  assertTargetDeviceId(targetDeviceId)
  if (!Array.isArray(rows)) {
    throw new Error('Stored exact fixes must be an array.')
  }
  const normalized = rows.map((row, index) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error(`Stored exact fix ${index} is invalid.`)
    }
    if (String(row.device_id) !== targetDeviceId) {
      throw new Error(`Stored exact fix ${index} is not for the target device.`)
    }
    return normalizeExactFix({
      deviceId: targetDeviceId,
      sourcePositionId: row.source_position_id,
      timestamp: row.timestamp,
      lat: row.lat,
      lon: row.lon,
    }, `Stored exact fix ${index}`)
  })
  assertUniqueFixIdentities(normalized, 'Stored')
  return normalized
}

/**
 * Normalizes the public exact GeoJSON source or MapLibre rendered features and
 * proves each public feature identity is derived from its source fix.
 */
export function normalizeExactGeoJsonFeatures(collectionOrFeatures, targetDeviceId) {
  assertTargetDeviceId(targetDeviceId)
  const features = Array.isArray(collectionOrFeatures)
    ? collectionOrFeatures
    : collectionOrFeatures?.type === 'FeatureCollection' &&
        Array.isArray(collectionOrFeatures.features)
      ? collectionOrFeatures.features
      : null
  if (features === null) {
    throw new Error('Exact breadcrumb-dot GeoJSON must be a FeatureCollection or feature array.')
  }
  const normalized = features.map((feature, index) => {
    const coordinates = feature?.geometry?.coordinates
    const properties = feature?.properties
    if (
      feature?.geometry?.type !== 'Point' ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      properties?.featureKind !== 'breadcrumb' ||
      properties.deviceId !== targetDeviceId ||
      typeof properties.sourcePositionId !== 'string' ||
      feature.id !== `${targetDeviceId}:id:${properties.sourcePositionId}`
    ) {
      throw new Error(`Exact breadcrumb-dot GeoJSON feature ${index} is invalid.`)
    }
    return normalizeExactFix({
      deviceId: properties.deviceId,
      sourcePositionId: properties.sourcePositionId,
      timestamp: properties.timestamp,
      lat: coordinates[1],
      lon: coordinates[0],
    }, `Exact breadcrumb-dot GeoJSON feature ${index}`)
  })
  assertUniqueFixIdentities(normalized, 'Exact breadcrumb-dot GeoJSON')
  return normalized
}

/**
 * Audits MapLibre rendered features without assuming that query results retain
 * the source feature ID representation. Durable identity remains the explicit
 * device/source-position property pair.
 */
export function auditRenderedExactGeoJsonFeatures(features, targetDeviceId) {
  assertTargetDeviceId(targetDeviceId)
  if (!Array.isArray(features)) {
    throw new Error('RENDERED_FEATURES_INVALID')
  }
  const diagnostics = {
    renderedFeatureCount: 0,
    uniqueFixCount: 0,
    duplicateTileCopyCount: 0,
    missingFeatureIdCount: 0,
    numericFeatureIdCount: 0,
    stringFeatureIdCount: 0,
    otherFeatureIdCount: 0,
    mismatchedStringFeatureIdCount: 0,
    conflictingDuplicateCount: 0,
  }
  const uniqueFixes = new Map()
  for (const feature of features) {
    diagnostics.renderedFeatureCount += 1
    recordRenderedFeatureIdType(feature?.id, diagnostics)
    const properties = feature?.properties
    const coordinates = feature?.geometry?.coordinates
    if (
      feature?.geometry?.type !== 'Point' ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      properties?.featureKind !== 'breadcrumb' ||
      properties.deviceId !== targetDeviceId ||
      typeof properties.sourcePositionId !== 'string' ||
      properties.sourcePositionId.trim() === ''
    ) {
      throw createRenderedAuditError('RENDERED_FEATURE_INVALID', diagnostics)
    }
    const expectedFeatureId = `${properties.deviceId}:id:${properties.sourcePositionId}`
    if (typeof feature.id === 'string' && feature.id !== expectedFeatureId) {
      diagnostics.mismatchedStringFeatureIdCount += 1
      throw createRenderedAuditError('RENDERED_EXPLICIT_ID_MISMATCH', diagnostics)
    }
    let normalized
    try {
      normalized = normalizeExactFix({
        deviceId: properties.deviceId,
        sourcePositionId: properties.sourcePositionId,
        timestamp: properties.timestamp,
        lat: coordinates[1],
        lon: coordinates[0],
      }, 'Rendered exact breadcrumb')
    } catch {
      throw createRenderedAuditError('RENDERED_FEATURE_INVALID', diagnostics)
    }
    if (
      feature.screenDisplacementX !== undefined ||
      feature.screenDisplacementY !== undefined
    ) {
      const screenDisplacementX = Number(feature.screenDisplacementX)
      const screenDisplacementY = Number(feature.screenDisplacementY)
      if (
        feature.screenDisplacementX === null ||
        feature.screenDisplacementY === null ||
        !Number.isFinite(screenDisplacementX) ||
        !Number.isFinite(screenDisplacementY) ||
        screenDisplacementX < 0 ||
        screenDisplacementY < 0
      ) {
        throw createRenderedAuditError('RENDERED_FEATURE_INVALID', diagnostics)
      }
      normalized.screenDisplacementX = screenDisplacementX
      normalized.screenDisplacementY = screenDisplacementY
    }
    const identity = `${normalized.deviceId}\u0000${normalized.sourcePositionId}`
    const existing = uniqueFixes.get(identity)
    if (existing !== undefined) {
      if (!sameExactFixPayload(existing, normalized)) {
        diagnostics.conflictingDuplicateCount += 1
        throw createRenderedAuditError('RENDERED_DUPLICATE_PAYLOAD_CONFLICT', diagnostics)
      }
      if (
        Number.isFinite(normalized.screenDisplacementX) &&
        (!Number.isFinite(existing.screenDisplacementX) ||
          normalized.screenDisplacementX > existing.screenDisplacementX)
      ) {
        existing.screenDisplacementX = normalized.screenDisplacementX
      }
      if (
        Number.isFinite(normalized.screenDisplacementY) &&
        (!Number.isFinite(existing.screenDisplacementY) ||
          normalized.screenDisplacementY > existing.screenDisplacementY)
      ) {
        existing.screenDisplacementY = normalized.screenDisplacementY
      }
      diagnostics.duplicateTileCopyCount += 1
      continue
    }
    uniqueFixes.set(identity, normalized)
  }
  diagnostics.uniqueFixCount = uniqueFixes.size
  return {
    fixes: [...uniqueFixes.values()],
    diagnostics,
  }
}

/** Creates count plus a privacy-preserving HMAC over exact fix truth. */
export function createExactFixEvidence(rows, hmacKey) {
  if (!Array.isArray(rows)) {
    throw new Error('Exact fix evidence rows must be an array.')
  }
  if (!ArrayBuffer.isView(hmacKey) || hmacKey.byteLength < 32) {
    throw new Error('Exact fix evidence requires an ephemeral key of at least 256 bits.')
  }
  const normalized = rows.map((row, index) => normalizeExactFix(row, `Exact fix ${index}`))
  assertUniqueFixIdentities(normalized, 'Exact fix evidence')
  normalized.sort(compareExactFixes)
  const hmac = createHmac('sha256', hmacKey)
  for (const row of normalized) {
    hmac.update(createCanonicalFixLine(row))
  }
  return {
    count: normalized.length,
    hmacSha256: hmac.digest('hex'),
  }
}

/** Creates a privacy-preserving HMAC over durable identity and exact fix time. */
export function createExactIdentityTimeEvidence(rows, hmacKey) {
  if (!Array.isArray(rows)) {
    throw new Error('Exact identity-time evidence rows must be an array.')
  }
  if (!ArrayBuffer.isView(hmacKey) || hmacKey.byteLength < 32) {
    throw new Error('Exact identity-time evidence requires an ephemeral 256-bit key.')
  }
  const normalized = rows.map((row, index) =>
    normalizeExactFix(row, `Exact identity-time fix ${index}`),
  )
  assertUniqueFixIdentities(normalized, 'Exact identity-time evidence')
  normalized.sort(compareExactFixes)
  const hmac = createHmac('sha256', hmacKey)
  for (const row of normalized) {
    hmac.update(`${JSON.stringify([
      row.deviceId,
      row.sourcePositionId,
      row.timestamp,
    ])}\n`)
  }
  return { count: normalized.length, hmacSha256: hmac.digest('hex') }
}

/**
 * Joins rendered fixes to exact source truth and permits only the measured,
 * independently bounded MapLibre coordinate quantization.
 */
export function auditRenderedCoordinateDeviation(sourceRows, renderedRows) {
  if (!Array.isArray(sourceRows) || !Array.isArray(renderedRows)) {
    throw new Error('RENDERED_COORDINATE_JOIN_INVALID')
  }
  const source = sourceRows.map((row, index) => normalizeExactFix(row, `Source fix ${index}`))
  const rendered = renderedRows.map((row, index) => ({
    ...normalizeExactFix(row, `Rendered fix ${index}`),
    screenDisplacementX: Number(row?.screenDisplacementX),
    screenDisplacementY: Number(row?.screenDisplacementY),
  }))
  assertUniqueFixIdentities(source, 'Rendered coordinate source')
  assertUniqueFixIdentities(rendered, 'Rendered coordinate observations')
  const renderedByIdentity = new Map(
    rendered.map((row) => [`${row.deviceId}\u0000${row.sourcePositionId}`, row]),
  )
  const metreDisplacements = []
  const pixelDisplacements = []
  const pixelXDisplacements = []
  const pixelYDisplacements = []
  let missingFixCount = 0
  let conflictingFixCount = 0
  for (const sourceRow of source) {
    const renderedRow = renderedByIdentity.get(
      `${sourceRow.deviceId}\u0000${sourceRow.sourcePositionId}`,
    )
    if (renderedRow === undefined) {
      missingFixCount += 1
      continue
    }
    if (
      renderedRow.timestamp !== sourceRow.timestamp ||
      !Number.isFinite(renderedRow.screenDisplacementX) ||
      !Number.isFinite(renderedRow.screenDisplacementY) ||
      renderedRow.screenDisplacementX < 0 ||
      renderedRow.screenDisplacementY < 0
    ) {
      conflictingFixCount += 1
      continue
    }
    const metres = haversineMetres(sourceRow, renderedRow)
    metreDisplacements.push(metres)
    const radialPixels = Math.hypot(
      renderedRow.screenDisplacementX,
      renderedRow.screenDisplacementY,
    )
    pixelXDisplacements.push(renderedRow.screenDisplacementX)
    pixelYDisplacements.push(renderedRow.screenDisplacementY)
    pixelDisplacements.push(radialPixels)
    if (
      metres > RENDERED_METRE_LIMIT ||
      renderedRow.screenDisplacementX > RENDERED_PER_AXIS_PIXEL_LIMIT ||
      renderedRow.screenDisplacementY > RENDERED_PER_AXIS_PIXEL_LIMIT ||
      radialPixels > RENDERED_RADIAL_PIXEL_LIMIT
    ) {
      throw new Error('RENDERED_COORDINATE_DEVIATION_EXCEEDED')
    }
  }
  if (
    source.length !== rendered.length ||
    missingFixCount !== 0 ||
    conflictingFixCount !== 0 ||
    metreDisplacements.length !== source.length
  ) {
    throw new Error('RENDERED_COORDINATE_JOIN_INCOMPLETE')
  }
  return {
    joinedFixCount: source.length,
    missingFixCount: 0,
    conflictingFixCount: 0,
    metreLimit: RENDERED_METRE_LIMIT,
    perAxisPixelLimit: RENDERED_PER_AXIS_PIXEL_LIMIT,
    radialPixelLimit: RENDERED_RADIAL_PIXEL_LIMIT,
    metres: summarizeDistribution(metreDisplacements),
    screenPixels: summarizeDistribution(pixelDisplacements),
    screenPixelAxes: {
      maxX: Math.max(...pixelXDisplacements),
      maxY: Math.max(...pixelYDisplacements),
    },
  }
}

/**
 * Requires a page to already be in stable chronological/device/source order.
 * The proof must not sort a malformed production page into apparent health.
 */
export function assertExactFixSequence(rows, label = 'Exact fix page') {
  if (!Array.isArray(rows)) {
    throw new Error(`${label} must be an array.`)
  }
  const normalized = rows.map((row, index) =>
    normalizeExactFix(row, `${label} fix ${index}`),
  )
  assertUniqueFixIdentities(normalized, label)
  for (let index = 1; index < normalized.length; index += 1) {
    if (compareExactFixSequenceEntries(normalized[index - 1], normalized[index]) > 0) {
      throw new Error(`${label} is not in stable chronological identity order.`)
    }
  }
  return normalized
}

/** Requires all five independent proof lanes to have the same count and HMAC. */
export function assertExactFixEvidenceChain(chain) {
  const provider = validateFixEvidence(chain?.provider, 'provider')
  for (const stageName of STAGE_NAMES.slice(1)) {
    const stage = validateFixEvidence(chain?.[stageName], stageName)
    if (
      stage.count !== provider.count ||
      stage.hmacSha256 !== provider.hmacSha256
    ) {
      throw new Error(`Exact breadcrumb evidence stage ${stageName} did not match provider truth.`)
    }
  }
  return {
    count: provider.count,
    hmacSha256: provider.hmacSha256,
    matched: true,
  }
}

/**
 * Audits the production newest-to-oldest cursor walk before its page union is
 * allowed into the source-to-rendered evidence chain.
 */
export function validateExactPageTraversal(pages, expectedTotal, pageLimit) {
  const totalPositionCount = positiveInteger(expectedTotal, 'exact traversal total')
  const limit = positiveInteger(pageLimit, 'exact traversal page limit')
  if (!Array.isArray(pages) || pages.length < 1) {
    throw new Error('Exact page traversal produced no pages.')
  }
  const earlierCursors = new Set()
  const laterCursors = new Set()
  const identities = new Set()
  let coveredPositionCount = 0
  let maximumPageCount = 0
  let previousNewerFirstFix = null
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    if (
      typeof page !== 'object' ||
      page === null ||
      !Array.isArray(page.positions) ||
      page.positions.length < 1 ||
      page.positions.length > limit ||
      page.totalPositionCount !== totalPositionCount
    ) {
      throw new Error(`Exact page traversal page ${index} is invalid.`)
    }
    const shouldHaveEarlier = index < pages.length - 1
    const shouldHaveLater = index > 0
    if (
      page.hasEarlier !== shouldHaveEarlier ||
      page.hasLater !== shouldHaveLater ||
      (shouldHaveEarlier ? typeof page.earlierCursor !== 'string' : page.earlierCursor !== null) ||
      (shouldHaveLater ? typeof page.laterCursor !== 'string' : page.laterCursor !== null)
    ) {
      throw new Error(`Exact page traversal direction flags are invalid at page ${index}.`)
    }
    if (shouldHaveEarlier) {
      if (page.earlierCursor === '' || earlierCursors.has(page.earlierCursor)) {
        throw new Error('Exact page traversal repeated an earlier cursor.')
      }
      earlierCursors.add(page.earlierCursor)
    }
    if (shouldHaveLater) {
      if (page.laterCursor === '' || laterCursors.has(page.laterCursor)) {
        throw new Error('Exact page traversal repeated a later cursor.')
      }
      laterCursors.add(page.laterCursor)
    }
    const normalized = assertExactFixSequence(page.positions, `Exact page ${index}`)
    if (
      previousNewerFirstFix !== null &&
      compareExactFixSequenceEntries(normalized.at(-1), previousNewerFirstFix) > 0
    ) {
      throw new Error('Exact page traversal chronology overlaps out of order.')
    }
    previousNewerFirstFix = normalized[0]
    for (const row of normalized) {
      const identity = `${row.deviceId}\u0000${row.sourcePositionId}`
      if (identities.has(identity)) {
        throw new Error('Exact page traversal repeated a source fix identity.')
      }
      identities.add(identity)
    }
    coveredPositionCount += normalized.length
    maximumPageCount = Math.max(maximumPageCount, normalized.length)
  }
  if (coveredPositionCount !== totalPositionCount) {
    throw new Error('Exact page traversal did not cover the declared source fix total.')
  }
  return {
    pageCount: pages.length,
    maximumPageCount,
    totalPositionCount,
  }
}

/** Builds the only failure JSON shape permitted in archiveable real-field evidence. */
export function buildAllowlistedLiveExactFailureReport(input) {
  assertSha256(input?.artifactSha256, 'artifact SHA-256')
  if (
    typeof input?.expectedVersion !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u.test(input.expectedVersion)
  ) {
    throw new Error('Expected app version is invalid.')
  }
  if (
    typeof input.failureClass !== 'string' ||
    !/^[A-Z][A-Z0-9_]{2,80}$/u.test(input.failureClass)
  ) {
    throw new Error('Live exact failure class is invalid.')
  }
  const progress = input.progress
  const phase = allowlistedEnum(progress?.phase, [
    'launch',
    'targetSelection',
    'reconciliation',
    'pausedStability',
    'provider',
    'directExactPages',
    'exactGeoJson',
    'renderedMap',
    'cleanup',
    'sqlite',
    'report',
  ], 'live exact failure phase')

  return {
    schemaVersion: 1,
    proof: 'packaged-real-traccar-exact-breadcrumb-dots',
    result: 'fail',
    artifact: {
      sha256: input.artifactSha256,
      version: input.expectedVersion,
    },
    failure: {
      failureClass: input.failureClass,
      phase,
      direction: nullableAllowlistedEnum(
        progress?.direction,
        ['latest', 'earlier', 'later'],
        'live exact failure direction',
      ),
      pageIndex: nullableNonNegativeInteger(
        progress?.pageIndex,
        'live exact failure page index',
      ),
      completedPageCount: nullableNonNegativeInteger(
        progress?.completedPageCount,
        'live exact completed page count',
      ),
      targetActive: nullableBoolean(progress?.targetActive),
      activeDeviceCount: nullableNonNegativeInteger(
        progress?.activeDeviceCount,
        'live exact active-device count',
      ),
      dotsActive: nullableBoolean(progress?.dotsActive),
      workspaceHidden: nullableBoolean(progress?.workspaceHidden),
      controllerState: allowlistedEnum(
        progress?.controllerState ?? 'unknown',
        ['inactive', 'loading', 'ready', 'unavailable', 'unknown'],
        'live exact controller state',
      ),
      expectedPageCount: nullableNonNegativeInteger(
        progress?.expectedPageCount,
        'live exact expected page count',
      ),
      expectedTotalCount: nullableNonNegativeInteger(
        progress?.expectedTotalCount,
        'live exact expected total count',
      ),
      mismatchObservationCount: nullableNonNegativeInteger(
        progress?.mismatchObservationCount,
        'live exact mismatch observation count',
      ),
      firstMismatch: sanitizeLiveExactMismatch(progress?.firstMismatch),
      lastMismatch: sanitizeLiveExactMismatch(progress?.lastMismatch),
      actionFailure: sanitizeLiveExactActionFailure(progress?.actionFailure),
    },
    safety: {
      providerGetOnly: true,
      privateTargetSelectorVerified: true,
      rawOperationalDataArchived: false,
    },
  }
}

/** Builds the only pass JSON shape permitted in archiveable real-field evidence. */
export function buildAllowlistedLiveExactReport(input) {
  assertSha256(input.artifactSha256, 'artifact SHA-256')
  assertSha256(input.screenshotSha256, 'screenshot SHA-256')
  if (
    typeof input.expectedVersion !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u.test(input.expectedVersion)
  ) {
    throw new Error('Expected app version is invalid.')
  }
  const fixEvidence = validateFixEvidence(input.fixEvidence, 'matched fix evidence')
  if (input.fixEvidence?.matched !== true) {
    throw new Error('The exact fix evidence chain did not match.')
  }
  if (input.lookbackHours !== 48 || input.exactPageLimit !== 10_000) {
    throw new Error('The real-field gate requires a 48-hour lookback and 10,000-fix pages.')
  }
  if (
    input.returnedToLatest !== true ||
    input.baselineBreadcrumbPointCount !== 0 ||
    input.providerGetOnly !== true ||
    input.sqliteIntegrityOk !== true
  ) {
    throw new Error('A real-field safety invariant was not proven.')
  }
  const pageCount = positiveInteger(input.pageCount, 'exact page count')
  const maximumPageCount = positiveInteger(
    input.maximumPageCount,
    'maximum exact page count',
  )
  if (maximumPageCount > input.exactPageLimit) {
    throw new Error('An exact page exceeded the 10,000-fix limit.')
  }
  const renderedAudit = validateRenderedAudit(input.renderedAudit, fixEvidence.count)
  const renderedIdentityTimeEvidence = validateFixEvidence(
    input.renderedIdentityTimeEvidence,
    'rendered identity-time',
  )
  if (
    input.renderedIdentityTimeEvidence?.matched !== true ||
    renderedIdentityTimeEvidence.count !== fixEvidence.count
  ) {
    throw new Error('Rendered identity-time evidence did not match exact source truth.')
  }
  const renderedCoordinateDeviation = validateRenderedCoordinateDeviation(
    input.renderedCoordinateDeviation,
    fixEvidence.count,
  )

  return {
    schemaVersion: 1,
    proof: 'packaged-real-traccar-exact-breadcrumb-dots',
    result: 'pass',
    artifact: {
      sha256: input.artifactSha256,
      version: input.expectedVersion,
    },
    workload: {
      lookbackHours: input.lookbackHours,
      fixCount: fixEvidence.count,
      exactPageLimit: input.exactPageLimit,
      pageCount,
      maximumPageCount,
    },
    reconciliation: {
      algorithm: 'hmac-sha256-ephemeral-key-v1',
      hmacSha256: fixEvidence.hmacSha256,
      sourceToRenderedMatched: true,
      returnedToLatest: true,
      baselineBreadcrumbPointCount: 0,
      mapLibreRenderedAudit: renderedAudit,
      renderedIdentityTimeHmacSha256: renderedIdentityTimeEvidence.hmacSha256,
      renderedCoordinateDeviation,
    },
    safety: {
      providerGetOnly: true,
      sqliteIntegrityOk: true,
      privateTargetSelectorVerified: true,
      rawOperationalDataArchived: false,
    },
    timingsMs: {
      sourceFetch: nonNegativeInteger(input.sourceFetchMs, 'source fetch time'),
      sqliteRead: nonNegativeInteger(input.sqliteReadMs, 'SQLite read time'),
      exactPages: nonNegativeInteger(input.exactPageMs, 'exact-page time'),
      exactGeoJson: nonNegativeInteger(input.geoJsonMs, 'exact GeoJSON time'),
      renderedMap: nonNegativeInteger(input.renderedMapMs, 'rendered-map time'),
    },
    visual: {
      dotsScreenshotSha256: input.screenshotSha256,
      archiveContainsScreenshot: false,
    },
  }
}

function sanitizeLiveExactMismatch(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Live exact mismatch evidence is invalid.')
  }
  return {
    sourceAvailable: nullableBoolean(value.sourceAvailable),
    sourceValid: nullableBoolean(value.sourceValid),
    observedPageCount: nullableNonNegativeInteger(
      value.observedPageCount,
      'live exact observed page count',
    ),
    observedTotalCount: nullableNonNegativeInteger(
      value.observedTotalCount,
      'live exact observed total count',
    ),
    targetFeatureCount: nullableNonNegativeInteger(
      value.targetFeatureCount,
      'live exact target-feature count',
    ),
    otherFeatureCount: nullableNonNegativeInteger(
      value.otherFeatureCount,
      'live exact other-feature count',
    ),
    baselineBreadcrumbPointCount: nullableNonNegativeInteger(
      value.baselineBreadcrumbPointCount,
      'live exact baseline breadcrumb-point count',
    ),
    countMatched: nullableBoolean(value.countMatched),
    hmacMatched: nullableBoolean(value.hmacMatched),
  }
}

function sanitizeLiveExactActionFailure(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Live exact action failure is invalid.')
  }
  return {
    action: allowlistedEnum(value.action, ['earlier', 'later'], 'live exact action'),
    pageIndexFromLatest: nonNegativeInteger(
      value.pageIndexFromLatest,
      'live exact action page index',
    ),
    failureClass: allowlistedEnum(
      value.failureClass,
      ['click_timeout_or_interception'],
      'live exact action failure class',
    ),
    first: sanitizeLiveExactControlObservation(value.first),
    last: sanitizeLiveExactControlObservation(value.last),
  }
}

function sanitizeLiveExactControlObservation(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Live exact control observation is invalid.')
  }
  const bbox = value.bbox
  if (
    typeof bbox !== 'object' ||
    bbox === null ||
    [bbox.x, bbox.y, bbox.width, bbox.height].some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error('Live exact control bounding box is invalid.')
  }
  return {
    bbox: {
      x: boundedDiagnosticNumber(bbox.x),
      y: boundedDiagnosticNumber(bbox.y),
      width: boundedDiagnosticNumber(bbox.width),
      height: boundedDiagnosticNumber(bbox.height),
    },
    intercept: sanitizeLiveExactIntercept(value.intercept),
  }
}

const LIVE_EXACT_STATIC_INTERCEPT_TEST_IDS = new Set([
  'breadcrumb-mode-dots',
  'devices-inspector',
  'devices-workspace',
  'exact-breadcrumb-dots-earlier',
  'exact-breadcrumb-dots-later',
  'open-devices-workspace',
  'workspace-close-btn',
])

function sanitizeLiveExactIntercept(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Live exact control intercept is invalid.')
  }
  const token = (entry, pattern) =>
    typeof entry === 'string' && pattern.test(entry) ? entry : null
  const className = typeof value.className === 'string'
    ? value.className
        .split(/\s+/u)
        .filter((entry) => /^[a-z0-9_:[\]./%+-]{1,80}$/iu.test(entry))
        .slice(0, 8)
        .join(' ')
    : ''
  return {
    tag: token(value.tag, /^[a-z0-9-]{1,32}$/iu)?.toLowerCase() ?? null,
    testId: LIVE_EXACT_STATIC_INTERCEPT_TEST_IDS.has(value.testId)
      ? value.testId
      : null,
    className,
  }
}

function boundedDiagnosticNumber(value) {
  return Math.max(-100_000, Math.min(100_000, Math.round(value * 1_000) / 1_000))
}

function nullableBoolean(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'boolean') {
    throw new Error('Live exact boolean evidence is invalid.')
  }
  return value
}

function nullableNonNegativeInteger(value, label) {
  if (value === null || value === undefined) return null
  return nonNegativeInteger(value, label)
}

function allowlistedEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

function nullableAllowlistedEnum(value, allowed, label) {
  if (value === null || value === undefined) return null
  return allowlistedEnum(value, allowed, label)
}

function normalizeExactFix(row, label) {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error(`${label} is invalid.`)
  }
  const deviceId = String(row.deviceId ?? '')
  const sourcePositionId = String(row.sourcePositionId ?? '')
  assertTargetDeviceId(deviceId)
  if (!isPositiveSafeIdentity(sourcePositionId)) {
    throw new Error(`${label} source identity is invalid.`)
  }
  const timestamp = normalizeExplicitTimestamp(row.timestamp, `${label} timestamp`)
  const lat = Number(row.lat)
  const lon = Number(row.lon)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`${label} latitude is invalid.`)
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`${label} longitude is invalid.`)
  }
  return { deviceId, sourcePositionId, timestamp, lat, lon }
}

function normalizeExplicitTimestamp(value, label) {
  const match = typeof value === 'string'
    ? value.match(EXPLICIT_ISO_TIMESTAMP_PATTERN)
    : null
  if (match === null || !hasValidCalendarAndClock(match)) {
    throw new Error(`${label} must be an explicit ISO timestamp.`)
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an explicit ISO timestamp.`)
  }
  return new Date(parsed).toISOString()
}

function hasValidCalendarAndClock(match) {
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[7] === undefined ? 0 : Number(match[7])
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const maximumDay = month === 2
    ? leapYear ? 29 : 28
    : [4, 6, 9, 11].includes(month) ? 30 : 31
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= maximumDay &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    offsetMinute <= 59 &&
    (offsetHour < 14 || offsetMinute === 0)
  )
}

function assertTargetDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !isPositiveSafeIdentity(deviceId)) {
    throw new Error('The target device ID is invalid.')
  }
}

function isPositiveSafeIdentity(value) {
  const parsed = Number(value)
  return TARGET_DEVICE_ID_PATTERN.test(value) && Number.isSafeInteger(parsed) && parsed > 0
}

function assertUniqueFixIdentities(rows, label) {
  const identities = new Set()
  for (const row of rows) {
    const identity = `${row.deviceId}\u0000${row.sourcePositionId}`
    if (identities.has(identity)) {
      throw new Error(`${label} contains a duplicate source fix identity.`)
    }
    identities.add(identity)
  }
}

function recordRenderedFeatureIdType(featureId, diagnostics) {
  if (featureId === undefined || featureId === null) {
    diagnostics.missingFeatureIdCount += 1
  } else if (typeof featureId === 'number') {
    diagnostics.numericFeatureIdCount += 1
  } else if (typeof featureId === 'string') {
    diagnostics.stringFeatureIdCount += 1
  } else {
    diagnostics.otherFeatureIdCount += 1
  }
}

function sameExactFixPayload(left, right) {
  return (
    left.deviceId === right.deviceId &&
    left.sourcePositionId === right.sourcePositionId &&
    left.timestamp === right.timestamp &&
    left.lat === right.lat &&
    left.lon === right.lon
  )
}

function haversineMetres(left, right) {
  const radians = (degrees) => degrees * Math.PI / 180
  const latitudeDelta = radians(right.lat - left.lat)
  const longitudeDelta = radians(right.lon - left.lon)
  const leftLatitude = radians(left.lat)
  const rightLatitude = radians(right.lat)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function summarizeDistribution(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('RENDERED_COORDINATE_DISTRIBUTION_EMPTY')
  }
  const sorted = [...values].sort((left, right) => left - right)
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1),
  }
}

function percentile(sorted, proportion) {
  const position = (sorted.length - 1) * proportion
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const fraction = position - lowerIndex
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * fraction
}

function createRenderedAuditError(reasonCode, diagnostics) {
  const error = new Error(reasonCode)
  Object.defineProperty(error, 'diagnostics', {
    value: Object.freeze({ ...diagnostics }),
    enumerable: true,
  })
  return error
}

function compareExactFixes(left, right) {
  return (
    compareCodeUnits(left.timestamp, right.timestamp) ||
    compareCodeUnits(left.deviceId, right.deviceId) ||
    compareCodeUnits(left.sourcePositionId, right.sourcePositionId)
  )
}

function compareExactFixSequenceEntries(left, right) {
  return (
    compareCodeUnits(left.timestamp, right.timestamp) ||
    compareCodeUnits(left.deviceId, right.deviceId) ||
    compareCodeUnits(left.sourcePositionId, right.sourcePositionId)
  )
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function createCanonicalFixLine(row) {
  return [
    row.deviceId,
    row.sourcePositionId,
    row.timestamp,
    row.lat.toFixed(7),
    row.lon.toFixed(7),
  ].join('|') + '\n'
}

function validateFixEvidence(value, label) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Number.isSafeInteger(value.count) ||
    value.count < 1 ||
    !SHA256_PATTERN.test(value.hmacSha256 ?? '')
  ) {
    throw new Error(`${label} exact fix evidence is invalid.`)
  }
  return value
}

function validateRenderedAudit(value, expectedUniqueFixCount) {
  const keys = [
    'renderedFeatureCount',
    'uniqueFixCount',
    'duplicateTileCopyCount',
    'missingFeatureIdCount',
    'numericFeatureIdCount',
    'stringFeatureIdCount',
    'otherFeatureIdCount',
    'mismatchedStringFeatureIdCount',
    'conflictingDuplicateCount',
  ]
  if (typeof value !== 'object' || value === null) {
    throw new Error('Rendered MapLibre audit is invalid.')
  }
  const audit = Object.fromEntries(keys.map((key) => [
    key,
    nonNegativeInteger(value[key], `rendered audit ${key}`),
  ]))
  if (
    audit.uniqueFixCount !== expectedUniqueFixCount ||
    audit.renderedFeatureCount !==
      audit.uniqueFixCount + audit.duplicateTileCopyCount ||
    audit.renderedFeatureCount !==
      audit.missingFeatureIdCount +
        audit.numericFeatureIdCount +
        audit.stringFeatureIdCount +
        audit.otherFeatureIdCount ||
    audit.mismatchedStringFeatureIdCount !== 0 ||
    audit.conflictingDuplicateCount !== 0
  ) {
    throw new Error('Rendered MapLibre audit invariants were not proven.')
  }
  return audit
}

function validateRenderedCoordinateDeviation(value, expectedFixCount) {
  if (
    typeof value !== 'object' ||
    value === null ||
    value.joinedFixCount !== expectedFixCount ||
    value.missingFixCount !== 0 ||
    value.conflictingFixCount !== 0 ||
    value.metreLimit !== RENDERED_METRE_LIMIT ||
    value.perAxisPixelLimit !== RENDERED_PER_AXIS_PIXEL_LIMIT ||
    value.radialPixelLimit !== RENDERED_RADIAL_PIXEL_LIMIT
  ) {
    throw new Error('Rendered coordinate deviation evidence is invalid.')
  }
  const validateAggregate = (aggregate, label, limit) => {
    if (
      typeof aggregate !== 'object' ||
      aggregate === null ||
      !Number.isFinite(aggregate.p50) ||
      !Number.isFinite(aggregate.p95) ||
      !Number.isFinite(aggregate.max) ||
      aggregate.p50 < 0 ||
      aggregate.p50 > aggregate.p95 ||
      aggregate.p95 > aggregate.max ||
      aggregate.max > limit
    ) {
      throw new Error(`Rendered ${label} aggregate is invalid.`)
    }
    return { p50: aggregate.p50, p95: aggregate.p95, max: aggregate.max }
  }
  return {
    joinedFixCount: value.joinedFixCount,
    missingFixCount: 0,
    conflictingFixCount: 0,
    metreLimit: RENDERED_METRE_LIMIT,
    perAxisPixelLimit: RENDERED_PER_AXIS_PIXEL_LIMIT,
    radialPixelLimit: RENDERED_RADIAL_PIXEL_LIMIT,
    metres: validateAggregate(value.metres, 'metre displacement', RENDERED_METRE_LIMIT),
    screenPixels: validateAggregate(
      value.screenPixels,
      'screen-pixel displacement',
      RENDERED_RADIAL_PIXEL_LIMIT,
    ),
    screenPixelAxes: validateScreenPixelAxes(value.screenPixelAxes),
  }
}

function validateScreenPixelAxes(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Number.isFinite(value.maxX) ||
    !Number.isFinite(value.maxY) ||
    value.maxX < 0 ||
    value.maxX > RENDERED_PER_AXIS_PIXEL_LIMIT ||
    value.maxY < 0 ||
    value.maxY > RENDERED_PER_AXIS_PIXEL_LIMIT
  ) {
    throw new Error('Rendered screen-pixel axis aggregate is invalid.')
  }
  return { maxX: value.maxX, maxY: value.maxY }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return value
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}
