/**
 * Reads and fingerprints the exact breadcrumb source inside the renderer.
 *
 * This function is deliberately self-contained: Playwright serializes only
 * its function body for `page.evaluate`. The returned object is bounded proof
 * evidence and never contains source rows, device identities, or coordinates.
 */
export async function readCompactExactSoakMapEvidenceInRenderer() {
  const fingerprintStartedAt = performance.now()
  const invalidSource = (positionCount = null) => ({
    valid: false,
    positionCount:
      Number.isSafeInteger(positionCount) &&
      positionCount >= 0 &&
      positionCount <= 10_000
        ? positionCount
        : null,
    sha256: null,
    range: {
      positionCount: null,
      fromTimestamp: null,
      toTimestamp: null,
      firstSourcePositionId: null,
      lastSourcePositionId: null,
    },
  })
  const invalidOperator = () => ({
    valid: false,
    pagePositionCount: null,
    totalPositionCount: null,
    fromTimestamp: null,
    toTimestamp: null,
  })
  const canonicalTimestamp = (value) => {
    if (typeof value !== 'string' || value.length > 32) return null
    const milliseconds = Date.parse(value)
    return Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value
      ? value
      : null
  }
  const parseCount = (value) => {
    if (typeof value !== 'string' || value.length > 20) return null
    const parsed = Number(value.replaceAll(',', ''))
    return Number.isSafeInteger(parsed) &&
      parsed >= 0 &&
      parsed <= 10_000_000
      ? parsed
      : null
  }
  const parseOperator = (value) => {
    const normalized = typeof value === 'string'
      ? value.trim().replaceAll(/\s+/gu, ' ')
      : ''
    const match = /^Showing ([\d,]+) exact fixes of ([\d,]+)(?: — (.+) to (.+))?$/u.exec(
      normalized,
    )
    if (match === null) return invalidOperator()
    const pagePositionCount = parseCount(match[1])
    const totalPositionCount = parseCount(match[2])
    const fromTimestamp = canonicalTimestamp(match[3])
    const toTimestamp = canonicalTimestamp(match[4])
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
  const readSource = async (source) => {
    if (typeof source?.getData === 'function') return source.getData()
    if (typeof source?.serialize === 'function') return source.serialize()?.data
    return undefined
  }

  const map = window.__SARTRACKER_MAP__
  const exactSource = map?.getSource('tracking-breadcrumb-dots-exact')
  const baselineSource = map?.getSource('tracking')
  const unavailable =
    exactSource === undefined ||
    baselineSource === undefined ||
    document.querySelector(
      '[data-testid="exact-breadcrumb-dots-unavailable"]',
    ) !== null
  const loading = document.querySelector(
    '[data-testid="exact-breadcrumb-dots-loading"]',
  ) !== null
  if (unavailable) {
    return {
      source: invalidSource(),
      operator: invalidOperator(),
      baselineBreadcrumbPointCount: null,
      loading,
      refreshing: null,
      unavailable: true,
      sampledAtEpochMs: Date.now(),
      fingerprintDurationMs: performance.now() - fingerprintStartedAt,
    }
  }

  let exact
  let baseline
  let sampledAtEpochMs
  try {
    const [exactRead, baselineRead] = await Promise.all([
      readSource(exactSource).then((data) => ({
        data,
        sampledAtEpochMs: Date.now(),
      })),
      readSource(baselineSource),
    ])
    exact = exactRead.data
    sampledAtEpochMs = exactRead.sampledAtEpochMs
    baseline = baselineRead
  } catch {
    return {
      source: invalidSource(),
      operator: invalidOperator(),
      baselineBreadcrumbPointCount: null,
      loading,
      refreshing: null,
      unavailable: false,
      sampledAtEpochMs: Date.now(),
      fingerprintDurationMs: performance.now() - fingerprintStartedAt,
    }
  }
  // Product publication timing stops here. Canonicalization, hashing,
  // transport, and the second stable observation are proof overhead.
  const baselineBreadcrumbPointCount =
    baseline?.type === 'FeatureCollection' && Array.isArray(baseline.features)
      ? baseline.features.filter(
          (feature) =>
            feature?.geometry?.type === 'Point' &&
            feature?.properties?.featureKind === 'breadcrumb',
        ).length
      : null
  const operator = parseOperator(
    document.querySelector(
      '[data-testid="exact-breadcrumb-dot-page-summary"]',
    )?.textContent ?? '',
  )

  let source = invalidSource(
    Array.isArray(exact?.features) ? exact.features.length : null,
  )
  if (
    exact?.type === 'FeatureCollection' &&
    Array.isArray(exact.features) &&
    exact.features.length <= 10_000
  ) {
    const lines = []
    let valid = true
    let firstTimestamp = null
    let lastTimestamp = null
    let firstSourcePositionId = null
    let lastSourcePositionId = null
    for (const feature of exact.features) {
      const properties = feature?.properties
      const coordinates = feature?.geometry?.coordinates
      const sourcePositionId = properties?.sourcePositionId
      const deviceId = properties?.deviceId
      const timestamp = canonicalTimestamp(properties?.timestamp)
      const lon = Array.isArray(coordinates) ? coordinates[0] : Number.NaN
      const lat = Array.isArray(coordinates) ? coordinates[1] : Number.NaN
      if (
        feature?.geometry?.type !== 'Point' ||
        !Array.isArray(coordinates) ||
        coordinates.length < 2 ||
        properties?.featureKind !== 'breadcrumb' ||
        typeof deviceId !== 'string' ||
        deviceId.trim() === '' ||
        typeof sourcePositionId !== 'string' ||
        !/^[1-9]\d*$/u.test(sourcePositionId) ||
        feature.id !== `${deviceId}:id:${sourcePositionId}` ||
        timestamp === null ||
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lon) ||
        lon < -180 ||
        lon > 180
      ) {
        valid = false
        break
      }
      lines.push(`${JSON.stringify([
        sourcePositionId,
        deviceId,
        timestamp,
        lat,
        lon,
      ])}\n`)
      firstTimestamp ??= timestamp
      firstSourcePositionId ??= sourcePositionId
      lastTimestamp = timestamp
      lastSourcePositionId = sourcePositionId
    }
    if (valid) {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(lines.join('')),
      )
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')).join('')
      source = {
        valid: true,
        positionCount: exact.features.length,
        sha256,
        range: {
          positionCount: exact.features.length,
          fromTimestamp: firstTimestamp,
          toTimestamp: lastTimestamp,
          firstSourcePositionId,
          lastSourcePositionId,
        },
      }
    }
  }

  return {
    source,
    operator,
    baselineBreadcrumbPointCount:
      Number.isSafeInteger(baselineBreadcrumbPointCount) &&
      baselineBreadcrumbPointCount >= 0 &&
      baselineBreadcrumbPointCount <= 10_000_000
        ? baselineBreadcrumbPointCount
        : null,
    loading,
    refreshing: null,
    unavailable: false,
    sampledAtEpochMs,
    fingerprintDurationMs: performance.now() - fingerprintStartedAt,
  }
}
