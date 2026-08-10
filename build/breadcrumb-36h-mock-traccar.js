import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const DEFAULT_SOURCE_NOW = '2026-08-09T12:00:00.000Z'
const DEFAULT_LOOKBACK_HOURS = 36
const SESSION_COOKIE = 'JSESSIONID=breadcrumb-36h-proof'
const MAX_POSITION_ORDINAL = 999_999
const FIELD_VEHICLE_DEVICE_ID = 1
const FIELD_VEHICLE_LATITUDE = 52.2407
const FIELD_VEHICLE_START_LONGITUDE = -10
const FIELD_VEHICLE_SLOW_START_HOURS = 31
const FIELD_VEHICLE_SLOW_END_HOURS = 32
const FIELD_VEHICLE_FAST_END_HOURS = 33
const FIELD_VEHICLE_SLOW_SPEED_KMH = 12
const FIELD_VEHICLE_FAST_SPEEDS_KMH = Object.freeze([120, 128, 137, 145])

/**
 * Builds the immutable field-scale profile used by the initial-history proof.
 * Position rows are generated from this description on demand; the profile
 * never retains the complete history in memory.
 */
export function createBreadcrumb36HourProfile(options = {}) {
  const sourceNow = normalizeIsoTimestamp(
    options.sourceNow ?? DEFAULT_SOURCE_NOW,
    '36-hour source clock',
  )
  const lookbackHours = boundedInteger(
    options.lookbackHours,
    DEFAULT_LOOKBACK_HOURS,
    1,
    48,
    '36-hour lookback',
  )
  const sourceNowMs = Date.parse(sourceNow)
  const sourceFrom = new Date(
    sourceNowMs - lookbackHours * 60 * 60 * 1000,
  ).toISOString()
  const devices = Array.from({ length: 33 }, (_, index) => {
    const id = index + 1
    const cadenceMs =
      id <= 8 ? 5_000 : id <= 24 ? 30_000 : id <= 32 ? 300_000 : null
    return Object.freeze({
      id,
      name: id === 33 ? 'Offline Reserve 33' : `Synthetic Team ${String(id).padStart(2, '0')}`,
      uniqueId: `breadcrumb-proof-${String(id).padStart(2, '0')}`,
      status: id === 33 ? 'offline' : 'online',
      cadenceMs,
    })
  })
  const variableSpeedJourney = createVariableSpeedJourney(sourceFrom)

  return Object.freeze({
    sourceNow,
    sourceFrom,
    lookbackHours,
    deviceCount: devices.length,
    onlineDeviceCount: devices.filter((device) => device.status === 'online').length,
    devices: Object.freeze(devices),
    variableSpeedJourney,
  })
}

/**
 * Streams every deterministic source position through SHA-256 without
 * materializing the approximately 280,000-row fixture.
 */
export function buildBreadcrumb36HourTruthEvidence(
  profile = createBreadcrumb36HourProfile(),
  window = {},
) {
  validateProfile(profile)
  const from = normalizeIsoTimestamp(
    window.from ?? profile.sourceFrom,
    'source-truth window start',
  )
  const to = normalizeIsoTimestamp(
    window.to ?? profile.sourceNow,
    'source-truth window end',
  )
  if (Date.parse(to) < Date.parse(from)) {
    throw new Error('Source-truth window is reversed.')
  }
  const fullDigest = createHash('sha256')
  const devices = []
  let totalPositionCount = 0

  for (const device of profile.devices) {
    const deviceDigest = createHash('sha256')
    let positionCount = 0
    for (const position of iterateDevicePositions(
      profile,
      device,
      Date.parse(from),
      Date.parse(to),
    )) {
      const line = toCanonicalPositionLine(position)
      fullDigest.update(line)
      deviceDigest.update(line)
      positionCount += 1
    }
    totalPositionCount += positionCount
    devices.push({
      deviceId: device.id,
      positionCount,
      sha256: deviceDigest.digest('hex'),
    })
  }

  return {
    from,
    to,
    totalPositionCount,
    sha256: fullDigest.digest('hex'),
    // IDs use a device-owned million-row range and the largest supported
    // ordinal is checked below. Uniqueness is therefore proven structurally
    // without retaining a Set containing every source identity.
    missingOrDuplicateIdentityCount: 0,
    devices,
  }
}

/**
 * Exposes the deterministic source as the minimal read-only database contract
 * consumed by the production CJS breadcrumb selector. Rows remain generated
 * on demand, so full 36-hour proof data is never materialized as one array.
 */
export function createBreadcrumb36HourSourceDatabase(
  profile = createBreadcrumb36HourProfile(),
  window = {},
) {
  validateProfile(profile)
  const from = normalizeIsoTimestamp(
    window.from ?? profile.sourceFrom,
    'selector source window start',
  )
  const to = normalizeIsoTimestamp(
    window.to ?? profile.sourceNow,
    'selector source window end',
  )
  if (Date.parse(to) < Date.parse(from)) {
    throw new Error('Selector source window is reversed.')
  }
  const fromMs = Date.parse(from)
  const toMs = Date.parse(to)
  const totals = profile.devices
    .map((device) => ({
      device_id: String(device.id),
      total: countDevicePositionsInWindow(profile, device, fromMs, toMs),
    }))
    .filter((entry) => entry.total > 0)
    .sort((left, right) => compareStringsByCodeUnit(left.device_id, right.device_id))

  return {
    prepare: (query) => {
      if (/GROUP BY device_id/u.test(query)) {
        return {
          all: () => totals.map((entry) => ({ ...entry })),
        }
      }
      if (/device_id = \?/u.test(query)) {
        return {
          iterate: function* (_missionId, deviceId) {
            const device = profile.devices.find(
              (candidate) => String(candidate.id) === String(deviceId),
            )
            if (device === undefined) {
              return
            }
            for (const position of iterateDevicePositions(
              profile,
              device,
              fromMs,
              toMs,
            )) {
              yield {
                id: `source-${position.id}`,
                mission_id: 'source-truth',
                device_id: String(position.deviceId),
                source_position_id: String(position.id),
                lat: position.latitude,
                lon: position.longitude,
                timestamp: position.fixTime,
                data_origin: 'live',
              }
            }
          },
        }
      }
      throw new Error('Unsupported deterministic source database query.')
    },
  }
}

/** Returns the canonical source-identity/time/coordinate digest for rows. */
export function createBreadcrumbPositionDigest(positions) {
  const digest = createHash('sha256')
  for (const position of positions) {
    digest.update(toCanonicalPositionLine(position))
  }
  return digest.digest('hex')
}

/**
 * Starts a local deterministic Traccar HTTP boundary for the 36-hour proof.
 * Latency and faults are explicit inputs and every request produces a bounded
 * ledger entry suitable for coverage and concurrency assertions.
 */
export async function startBreadcrumb36HourMockTraccarServer(options = {}) {
  const profile = options.profile ?? createBreadcrumb36HourProfile(options)
  validateProfile(profile)
  const latencyMs = boundedInteger(options.latencyMs, 0, 0, 60_000, 'mock latency')
  const faults = normalizeFaults(options.faults ?? [])
  const faultMatchCounts = new Map()
  const requestLedger = []
  let activeRequests = 0
  let maximumConcurrentRequests = 0
  let activeHistoryRequests = 0
  let maximumConcurrentHistoryRequests = 0
  let nextSequence = 1
  let closed = false

  const server = createServer(async (request, response) => {
    const startedAtMs = Date.now()
    const sequence = nextSequence
    nextSequence += 1
    activeRequests += 1
    maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests)
    const concurrencyAtStart = activeRequests
    let descriptor = {
      kind: 'unknown',
      deviceId: null,
      from: null,
      to: null,
    }
    let historyConcurrencyAtStart = null
    let httpStatus = 500
    let outcome = 'failure'
    let returnedPositions = []

    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      descriptor = classifyRequest(request, requestUrl, profile)
      if (descriptor.kind === 'history') {
        activeHistoryRequests += 1
        maximumConcurrentHistoryRequests = Math.max(
          maximumConcurrentHistoryRequests,
          activeHistoryRequests,
        )
        historyConcurrencyAtStart = activeHistoryRequests
      }
      const fault = selectFault(faults, faultMatchCounts, descriptor)
      await delay(fault?.latencyMs ?? latencyMs)

      if (fault !== null) {
        httpStatus = fault.status
        sendJson(response, httpStatus, { error: `synthetic ${descriptor.kind} fault` })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/session') {
        httpStatus = 200
        outcome = 'success'
        response.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': `${SESSION_COOKIE}; Path=/; HttpOnly`,
        })
        response.end('{}')
        return
      }

      if (!isAuthorized(request.headers)) {
        httpStatus = 401
        sendJson(response, httpStatus, { error: 'synthetic authentication required' })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/devices') {
        const devices = buildDevices(profile)
        httpStatus = 200
        outcome = 'success'
        sendJson(response, httpStatus, devices)
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/positions') {
        if (
          descriptor.kind === 'history' ||
          descriptor.kind === 'recent_breadcrumbs'
        ) {
          const historyInput = readHistoryInput(requestUrl, profile)
          if (historyInput.error !== null) {
            httpStatus = 400
            sendJson(response, httpStatus, { error: historyInput.error })
            return
          }
          returnedPositions = buildDevicePositionsInWindow(
            profile,
            historyInput.device,
            historyInput.fromMs,
            historyInput.toMs,
          )
        } else {
          returnedPositions = buildCurrentPositions(profile)
        }
        httpStatus = 200
        outcome = 'success'
        sendJson(response, httpStatus, returnedPositions)
        return
      }

      httpStatus = 404
      sendJson(response, httpStatus, { error: 'not found' })
    } catch (error) {
      if (!response.headersSent) {
        httpStatus = 500
        sendJson(response, httpStatus, {
          error: error instanceof Error ? error.message : String(error),
        })
      } else {
        response.end()
      }
    } finally {
      activeRequests -= 1
      if (descriptor.kind === 'history') {
        activeHistoryRequests -= 1
      }
      const completedAtMs = Date.now()
      requestLedger.push({
        sequence,
        method: request.method ?? null,
        path: safeRequestPath(request.url),
        kind: descriptor.kind,
        deviceId: descriptor.deviceId,
        from: descriptor.from,
        to: descriptor.to,
        startedAtMs,
        completedAtMs,
        durationMs: Math.max(0, completedAtMs - startedAtMs),
        concurrencyAtStart,
        historyConcurrencyAtStart,
        outcome,
        httpStatus,
        returnedCount: returnedPositions.length,
        returnedIdentityDigest:
          returnedPositions.length === 0
            ? null
            : createBreadcrumbPositionDigest(returnedPositions),
      })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('36-hour mock Traccar did not receive a TCP port.')
  }

  return {
    baseUrl: `http://${options.host ?? '127.0.0.1'}:${address.port}`,
    profile,
    truth: () => buildBreadcrumb36HourTruthEvidence(profile),
    snapshot: () => ({
      activeRequests,
      maximumConcurrentRequests,
      activeHistoryRequests,
      maximumConcurrentHistoryRequests,
      requestLedger: requestLedger
        .slice()
        .sort((left, right) => left.sequence - right.sequence)
        .map((entry) => ({ ...entry })),
    }),
    close: async () => {
      if (closed) {
        return
      }
      closed = true
      await new Promise((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    },
  }
}

function classifyRequest(request, requestUrl, profile) {
  if (request.method === 'POST' && requestUrl.pathname === '/api/session') {
    return { kind: 'session', deviceId: null, from: null, to: null }
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/devices') {
    return { kind: 'devices', deviceId: null, from: null, to: null }
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/positions') {
    const deviceId = parseInteger(requestUrl.searchParams.get('deviceId'))
    const from = normalizeOptionalIsoTimestamp(requestUrl.searchParams.get('from'))
    const to = normalizeOptionalIsoTimestamp(requestUrl.searchParams.get('to'))
    if (deviceId !== null && from !== null && to !== null) {
      const recentBoundaryMs = Date.parse(profile.sourceNow) - 10 * 60 * 1_000
      return {
        kind:
          Date.parse(from) >= recentBoundaryMs
            ? 'recent_breadcrumbs'
            : 'history',
        deviceId,
        from,
        to,
      }
    }
    return { kind: 'current_positions', deviceId, from, to }
  }
  return { kind: 'unknown', deviceId: null, from: null, to: null }
}

function readHistoryInput(requestUrl, profile) {
  const deviceId = parseInteger(requestUrl.searchParams.get('deviceId'))
  const from = requestUrl.searchParams.get('from')
  const to = requestUrl.searchParams.get('to')
  const fromMs = from === null ? Number.NaN : Date.parse(from)
  const toMs = to === null ? Number.NaN : Date.parse(to)
  const device = profile.devices.find((candidate) => candidate.id === deviceId)
  if (device === undefined) {
    return { error: 'History request has an unknown deviceId.' }
  }
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return { error: 'History request requires a valid ordered from/to window.' }
  }
  return { error: null, device, fromMs, toMs }
}

function buildDevices(profile) {
  const sourceNow = profile.sourceNow
  return profile.devices.map((device) => {
    const latest = device.cadenceMs === null
      ? null
      : createPosition(profile, device, getLastPositionOrdinal(profile, device))
    return {
      id: device.id,
      name: device.name,
      uniqueId: device.uniqueId,
      status: device.status,
      lastUpdate: latest?.fixTime ?? sourceNow,
      positionId: latest?.id ?? 0,
      disabled: false,
      groupId: 0,
      category: 'person',
      attributes: {},
    }
  })
}

function buildCurrentPositions(profile) {
  return profile.devices.flatMap((device) =>
    device.status !== 'online' || device.cadenceMs === null
      ? []
      : [createPosition(profile, device, getLastPositionOrdinal(profile, device))],
  )
}

function buildDevicePositionsInWindow(profile, device, requestedFromMs, requestedToMs) {
  if (device.cadenceMs === null) {
    return []
  }
  const sourceFromMs = Date.parse(profile.sourceFrom)
  const sourceNowMs = Date.parse(profile.sourceNow)
  const fromMs = Math.max(sourceFromMs, requestedFromMs)
  const toMs = Math.min(sourceNowMs, requestedToMs)
  if (toMs < fromMs) {
    return []
  }
  const firstOrdinal = Math.max(
    0,
    Math.ceil((fromMs - sourceFromMs) / device.cadenceMs),
  )
  const lastOrdinal = Math.min(
    getLastPositionOrdinal(profile, device),
    Math.floor((toMs - sourceFromMs) / device.cadenceMs),
  )
  if (lastOrdinal < firstOrdinal) {
    return []
  }

  return Array.from(
    { length: lastOrdinal - firstOrdinal + 1 },
    (_, index) => createPosition(profile, device, firstOrdinal + index),
  )
}

function* iterateDevicePositions(
  profile,
  device,
  requestedFromMs = Date.parse(profile.sourceFrom),
  requestedToMs = Date.parse(profile.sourceNow),
) {
  if (device.cadenceMs === null) {
    return
  }
  const sourceFromMs = Date.parse(profile.sourceFrom)
  const sourceNowMs = Date.parse(profile.sourceNow)
  const fromMs = Math.max(sourceFromMs, requestedFromMs)
  const toMs = Math.min(sourceNowMs, requestedToMs)
  if (toMs < fromMs) {
    return
  }
  const firstOrdinal = Math.max(
    0,
    Math.ceil((fromMs - sourceFromMs) / device.cadenceMs),
  )
  const lastOrdinal = Math.min(
    getLastPositionOrdinal(profile, device),
    Math.floor((toMs - sourceFromMs) / device.cadenceMs),
  )
  for (let ordinal = firstOrdinal; ordinal <= lastOrdinal; ordinal += 1) {
    yield createPosition(profile, device, ordinal)
  }
}

function countDevicePositionsInWindow(profile, device, requestedFromMs, requestedToMs) {
  if (device.cadenceMs === null) {
    return 0
  }
  const sourceFromMs = Date.parse(profile.sourceFrom)
  const sourceNowMs = Date.parse(profile.sourceNow)
  const fromMs = Math.max(sourceFromMs, requestedFromMs)
  const toMs = Math.min(sourceNowMs, requestedToMs)
  if (toMs < fromMs) {
    return 0
  }
  const firstOrdinal = Math.max(
    0,
    Math.ceil((fromMs - sourceFromMs) / device.cadenceMs),
  )
  const lastOrdinal = Math.min(
    getLastPositionOrdinal(profile, device),
    Math.floor((toMs - sourceFromMs) / device.cadenceMs),
  )
  return Math.max(0, lastOrdinal - firstOrdinal + 1)
}

function getLastPositionOrdinal(profile, device) {
  if (device.cadenceMs === null) {
    return -1
  }
  const durationMs = Date.parse(profile.sourceNow) - Date.parse(profile.sourceFrom)
  const ordinal = Math.floor(durationMs / device.cadenceMs)
  if (ordinal > MAX_POSITION_ORDINAL) {
    throw new Error('36-hour source profile exceeds its stable identity range.')
  }
  return ordinal
}

function createPosition(profile, device, ordinal) {
  const fixTime = new Date(
    Date.parse(profile.sourceFrom) + ordinal * device.cadenceMs,
  ).toISOString()
  const fieldVehiclePosition = device.id === FIELD_VEHICLE_DEVICE_ID
    ? createFieldVehiclePosition(profile, device, ordinal)
    : null
  return {
    id: device.id * 1_000_000 + ordinal,
    deviceId: device.id,
    latitude: fieldVehiclePosition?.latitude ??
      Number((52.24 + device.id * 0.0007 + ordinal * 0.00000001).toFixed(7)),
    longitude: fieldVehiclePosition?.longitude ??
      Number((-9.58 + device.id * 0.0005 - ordinal * 0.00000001).toFixed(7)),
    altitude: 120 + device.id,
    speed: fieldVehiclePosition?.speedKnots ?? (device.id <= 8 ? 1.5 : 0.4),
    accuracy: 5 + (device.id % 4),
    fixTime,
    serverTime: new Date(Date.parse(fixTime) + 1_000).toISOString(),
    deviceTime: fixTime,
    valid: true,
    protocol: 'osmand',
    attributes: {
      batteryLevel: 90 - (device.id % 20),
    },
  }
}

function createVariableSpeedJourney(sourceFrom) {
  const sourceFromMs = Date.parse(sourceFrom)
  const atHour = (hour) => new Date(sourceFromMs + hour * 60 * 60 * 1_000).toISOString()
  return Object.freeze({
    deviceId: FIELD_VEHICLE_DEVICE_ID,
    slow: Object.freeze({
      from: atHour(FIELD_VEHICLE_SLOW_START_HOURS),
      to: atHour(FIELD_VEHICLE_SLOW_END_HOURS),
      minimumSpeedKmh: FIELD_VEHICLE_SLOW_SPEED_KMH,
      maximumSpeedKmh: FIELD_VEHICLE_SLOW_SPEED_KMH,
    }),
    fast: Object.freeze({
      from: atHour(FIELD_VEHICLE_SLOW_END_HOURS),
      to: atHour(FIELD_VEHICLE_FAST_END_HOURS),
      minimumSpeedKmh: Math.min(...FIELD_VEHICLE_FAST_SPEEDS_KMH),
      maximumSpeedKmh: Math.max(...FIELD_VEHICLE_FAST_SPEEDS_KMH),
    }),
  })
}

function createFieldVehiclePosition(profile, device, ordinal) {
  const elapsedMs = ordinal * device.cadenceMs
  const slowStartMs = FIELD_VEHICLE_SLOW_START_HOURS * 60 * 60 * 1_000
  const slowEndMs = FIELD_VEHICLE_SLOW_END_HOURS * 60 * 60 * 1_000
  const fastEndMs = FIELD_VEHICLE_FAST_END_HOURS * 60 * 60 * 1_000
  const slowElapsedMs = Math.max(0, Math.min(elapsedMs, slowEndMs) - slowStartMs)
  const slowDistanceKm = slowElapsedMs / (60 * 60 * 1_000) *
    FIELD_VEHICLE_SLOW_SPEED_KMH
  const fastIntervalCount = Math.max(
    0,
    Math.floor((Math.min(elapsedMs, fastEndMs) - slowEndMs) / device.cadenceMs),
  )
  const fastDistanceKm = sumRepeatingSpeeds(
    FIELD_VEHICLE_FAST_SPEEDS_KMH,
    fastIntervalCount,
  ) * device.cadenceMs / (60 * 60 * 1_000)
  const longitudeKilometresPerDegree = 111.32 *
    Math.cos(FIELD_VEHICLE_LATITUDE * Math.PI / 180)
  const speedKmh = elapsedMs >= slowStartMs && elapsedMs < slowEndMs
    ? FIELD_VEHICLE_SLOW_SPEED_KMH
    : elapsedMs >= slowEndMs && elapsedMs < fastEndMs
      ? FIELD_VEHICLE_FAST_SPEEDS_KMH[fastIntervalCount % FIELD_VEHICLE_FAST_SPEEDS_KMH.length]
      : 0

  return {
    latitude: FIELD_VEHICLE_LATITUDE,
    longitude: Number((
      FIELD_VEHICLE_START_LONGITUDE +
      (slowDistanceKm + fastDistanceKm) / longitudeKilometresPerDegree
    ).toFixed(7)),
    // Traccar reports speed in knots. Production normalization converts this
    // back to km/h; the proof metadata above keeps the operator-facing speeds
    // explicit.
    speedKnots: speedKmh / 1.852,
  }
}

function sumRepeatingSpeeds(speeds, intervalCount) {
  const completeCycles = Math.floor(intervalCount / speeds.length)
  const remainder = intervalCount % speeds.length
  const cycleTotal = speeds.reduce((total, speed) => total + speed, 0)
  return completeCycles * cycleTotal +
    speeds.slice(0, remainder).reduce((total, speed) => total + speed, 0)
}

function toCanonicalPositionLine(position) {
  return [
    position.id,
    position.deviceId,
    position.fixTime,
    Number(position.latitude).toFixed(7),
    Number(position.longitude).toFixed(7),
  ].join('|') + '\n'
}

function normalizeFaults(faults) {
  if (!Array.isArray(faults)) {
    throw new Error('36-hour mock faults must be an array.')
  }
  return faults.map((fault, index) => {
    if (!['session', 'devices', 'current_positions', 'history'].includes(fault.kind)) {
      throw new Error(`36-hour mock fault ${index + 1} has an invalid request kind.`)
    }
    return {
      kind: fault.kind,
      deviceId:
        fault.deviceId === undefined
          ? null
          : boundedInteger(fault.deviceId, undefined, 1, 33, 'fault deviceId'),
      occurrence: boundedInteger(fault.occurrence, 1, 1, 1_000_000, 'fault occurrence'),
      status: boundedInteger(fault.status, 503, 400, 599, 'fault status'),
      latencyMs:
        fault.latencyMs === undefined
          ? null
          : boundedInteger(fault.latencyMs, undefined, 0, 60_000, 'fault latency'),
    }
  })
}

function selectFault(faults, matchCounts, descriptor) {
  for (let index = 0; index < faults.length; index += 1) {
    const fault = faults[index]
    if (
      fault.kind !== descriptor.kind ||
      (fault.deviceId !== null && fault.deviceId !== descriptor.deviceId)
    ) {
      continue
    }
    const nextCount = (matchCounts.get(index) ?? 0) + 1
    matchCounts.set(index, nextCount)
    if (nextCount === fault.occurrence) {
      return fault
    }
  }
  return null
}

function validateProfile(profile) {
  if (
    !Array.isArray(profile.devices) ||
    profile.devices.length !== 33 ||
    profile.devices.some((device, index) => device.id !== index + 1)
  ) {
    throw new Error('36-hour mock profile requires exactly 33 ordered devices.')
  }
  const durationMs = Date.parse(profile.sourceNow) - Date.parse(profile.sourceFrom)
  if (durationMs !== profile.lookbackHours * 60 * 60 * 1000) {
    throw new Error('36-hour mock profile has inconsistent source bounds.')
  }
  for (const device of profile.devices) {
    getLastPositionOrdinal(profile, device)
  }
}

function isAuthorized(headers) {
  return (
    typeof headers.authorization === 'string' ||
    String(headers.cookie ?? '').includes(SESSION_COOKIE)
  )
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function delay(delayMs) {
  return delayMs === 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, delayMs))
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`)
  }
  return selected
}

function normalizeIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid ISO timestamp.`)
  }
  return new Date(Date.parse(value)).toISOString()
}

function normalizeOptionalIsoTimestamp(value) {
  if (value === null || !Number.isFinite(Date.parse(value))) {
    return null
  }
  return new Date(Date.parse(value)).toISOString()
}

function parseInteger(value) {
  if (value === null || !/^[0-9]+$/u.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function compareStringsByCodeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function safeRequestPath(value) {
  try {
    return new URL(value ?? '/', 'http://127.0.0.1').pathname
  } catch {
    return '/invalid'
  }
}
