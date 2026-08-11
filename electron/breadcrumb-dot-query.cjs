const { isStrictTrackingTimestamp } = require('./tracking-timestamp.cjs')
const {
  compareStringsByCodeUnit,
} = require('./deterministic-string-order.cjs')

const CURSOR_VERSION = 2
const MAX_PAGE_SIZE = 10_000
const MAX_CURSOR_LENGTH = 4_096
const POSITION_IDENTITY_SQL = `CASE
  WHEN source_position_id IS NOT NULL AND TRIM(source_position_id) <> ''
    THEN 'source:' || TRIM(source_position_id)
  ELSE 'local:' || id
END`

/**
 * Returns one exact, chronological page of persisted breadcrumb fixes.
 *
 * This query is intentionally independent from the bounded line projection.
 * Every returned row is a durable source fix; no representative or geometric
 * substitution is permitted on this path.
 */
function listExactBreadcrumbDotPage(db, input) {
  const query = normalizeQuery(input)
  throwIfAborted(query.signal)

  return db.transaction(() => listExactBreadcrumbDotPageSnapshot(db, query))()
}

/** Reads count, page rows, and navigation flags from one SQLite snapshot. */
function listExactBreadcrumbDotPageSnapshot(db, query) {
  throwIfAborted(query.signal)

  const missionStart = resolveMissionStart(db, query.missionId)
  const deviceIds = resolveDeviceIds(
    db,
    query.missionId,
    query.activeDeviceIds,
  )
  const countDevicePositions = db.prepare(
    `SELECT COUNT(*) AS total
     FROM positions
     WHERE mission_id = ? AND device_id = ? AND timestamp >= ?`,
  )
  const totalPositionCount = deviceIds.reduce(
    (total, deviceId) =>
      total + Number(
        countDevicePositions.get(query.missionId, deviceId, missionStart).total,
      ),
    0,
  )
  throwIfAborted(query.signal)

  const cursor = query.cursor === null
    ? null
    : decodeCursor(
        query.cursor,
        query.missionId,
        query.activeDeviceIds,
        deviceIds,
      )
  const order = query.direction === 'later' ? 'ASC' : 'DESC'
  const entries = mergeDeviceIterators(
    deviceIds.map((deviceId) => {
      const pageSelection = createDevicePageSelection(query.direction, cursor, deviceId)
      // better-sqlite3 intentionally permits one active iterator per prepared
      // statement, so each lazy device stream owns its statement instance.
      const selectDevicePage = db.prepare(
        `SELECT id, source_position_id, device_id, lat, lon, timestamp, data_origin,
                ${POSITION_IDENTITY_SQL} AS position_identity
         FROM positions
         WHERE mission_id = ? AND device_id = ? AND timestamp >= ?${pageSelection.whereSql}
         ORDER BY timestamp ${pageSelection.order},
                  position_identity ${pageSelection.order}
         LIMIT ?`,
      )
      return selectDevicePage.iterate(
          query.missionId,
          deviceId,
          missionStart,
          ...pageSelection.parameters,
          query.limit,
        )
    }),
    query.limit,
    order,
    query.signal,
  )
  throwIfAborted(query.signal)

  if (query.direction !== 'later') {
    entries.reverse()
  }
  const positions = entries.map((entry) => entry.position)
  const first = entries[0] ?? null
  const last = entries.at(-1) ?? null
  const hasEarlier = first === null
    ? false
    : hasPositionBeyond(
        db,
        query.missionId,
        missionStart,
        deviceIds,
        first.key,
        'earlier',
      )
  const hasLater = last === null
    ? false
    : hasPositionBeyond(
        db,
        query.missionId,
        missionStart,
        deviceIds,
        last.key,
        'later',
      )
  throwIfAborted(query.signal)

  return {
    positions,
    totalPositionCount,
    pagePositionCount: positions.length,
    fromTimestamp: first?.position.timestamp ?? null,
    toTimestamp: last?.position.timestamp ?? null,
    hasEarlier,
    hasLater,
    earlierCursor: hasEarlier
      ? encodeCursor(query.missionId, query.activeDeviceIds, first.key)
      : null,
    laterCursor: hasLater
      ? encodeCursor(query.missionId, query.activeDeviceIds, last.key)
      : null,
  }
}

function normalizeQuery(input) {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Exact breadcrumb-dot query input is required.')
  }
  if (typeof input.missionId !== 'string' || input.missionId.trim() === '') {
    throw new Error('Exact breadcrumb-dot mission ID is required.')
  }
  if (!Array.isArray(input.activeDeviceIds)) {
    throw new Error('Exact breadcrumb-dot active device IDs must be an array.')
  }
  const activeDeviceIds = [...new Set(input.activeDeviceIds.map((deviceId) => {
    if (typeof deviceId !== 'string' || deviceId.trim() === '') {
      throw new Error('Exact breadcrumb-dot device ID is invalid.')
    }
    return deviceId
  }))].sort(compareStringsByCodeUnit)
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_PAGE_SIZE
  ) {
    throw new Error(`Exact breadcrumb-dot page limit must be between 1 and ${MAX_PAGE_SIZE}.`)
  }
  if (!['earlier', 'later', 'latest'].includes(input.direction)) {
    throw new Error('Exact breadcrumb-dot page direction is invalid.')
  }
  const cursor = input.cursor ?? null
  if (cursor !== null && typeof cursor !== 'string') {
    throw new Error('Exact breadcrumb-dot cursor is invalid.')
  }
  if (input.direction === 'latest' && cursor !== null) {
    throw new Error('The latest exact breadcrumb-dot page does not accept a cursor.')
  }
  if (input.direction !== 'latest' && cursor === null) {
    throw new Error('Earlier and later exact breadcrumb-dot pages require a cursor.')
  }
  return {
    missionId: input.missionId,
    activeDeviceIds,
    limit: input.limit,
    cursor,
    direction: input.direction,
    signal: input.signal,
  }
}

function resolveMissionStart(db, missionId) {
  const row = db.prepare(
    'SELECT start_time FROM missions WHERE id = ?',
  ).get(missionId)
  if (row === undefined || !isStrictTrackingTimestamp(row.start_time)) {
    throw new Error('Exact breadcrumb-dot mission start is unavailable or invalid.')
  }
  return row.start_time
}

function resolveDeviceIds(db, missionId, activeDeviceIds) {
  if (activeDeviceIds.length > 0) {
    return activeDeviceIds
  }
  return db.prepare(
    `SELECT device_id
     FROM devices
     WHERE mission_id = ?
     ORDER BY device_id ASC`,
  ).all(missionId).map((row) => row.device_id)
}

function createDevicePageSelection(direction, cursor, deviceId) {
  if (direction === 'latest') {
    return {
      whereSql: '',
      parameters: [],
      order: 'DESC',
      reverseResult: true,
    }
  }
  const boundary = createDeviceCursorBoundary(direction, cursor, deviceId)
  return {
    whereSql: ` AND ${boundary.sql}`,
    parameters: boundary.parameters,
    order: direction === 'earlier' ? 'DESC' : 'ASC',
    reverseResult: direction === 'earlier',
  }
}

function createDeviceCursorBoundary(direction, cursor, deviceId) {
  const deviceComparison = compareStringsByCodeUnit(deviceId, cursor.deviceId)
  if (direction === 'earlier') {
    if (deviceComparison < 0) {
      return { sql: 'timestamp <= ?', parameters: [cursor.timestamp] }
    }
    if (deviceComparison > 0) {
      return { sql: 'timestamp < ?', parameters: [cursor.timestamp] }
    }
    return {
      sql: `(timestamp, ${POSITION_IDENTITY_SQL}) < (?, ?)`,
      parameters: [cursor.timestamp, cursor.stableIdentity],
    }
  }
  if (deviceComparison > 0) {
    return { sql: 'timestamp >= ?', parameters: [cursor.timestamp] }
  }
  if (deviceComparison < 0) {
    return { sql: 'timestamp > ?', parameters: [cursor.timestamp] }
  }
  return {
    sql: `(timestamp, ${POSITION_IDENTITY_SQL}) > (?, ?)`,
    parameters: [cursor.timestamp, cursor.stableIdentity],
  }
}

function hasPositionBeyond(db, missionId, missionStart, deviceIds, key, direction) {
  return deviceIds.some((deviceId) => {
    const boundary = createDeviceCursorBoundary(direction, key, deviceId)
    return db.prepare(
      `SELECT 1 AS found
       FROM positions
       WHERE mission_id = ? AND device_id = ? AND timestamp >= ? AND ${boundary.sql}
       LIMIT 1`,
    ).get(missionId, deviceId, missionStart, ...boundary.parameters) !== undefined
  })
}

function mergeDeviceIterators(iterators, limit, order, signal) {
  const heap = []
  try {
    for (const iterator of iterators) {
      const next = iterator.next()
      if (!next.done) {
        pushHeap(heap, { iterator, ...normalizeExactPositionEntry(next.value) }, order)
      }
    }
    const entries = []
    while (heap.length > 0 && entries.length < limit) {
      throwIfAborted(signal)
      const entry = popHeap(heap, order)
      entries.push(entry)
      const next = entry.iterator.next()
      if (!next.done) {
        pushHeap(
          heap,
          { iterator: entry.iterator, ...normalizeExactPositionEntry(next.value) },
          order,
        )
      }
    }
    return entries
  } finally {
    for (const iterator of iterators) {
      iterator.return?.()
    }
  }
}

function pushHeap(heap, value, order) {
  heap.push(value)
  let index = heap.length - 1
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2)
    if (compareHeapEntries(heap[parentIndex], value, order) <= 0) break
    heap[index] = heap[parentIndex]
    index = parentIndex
  }
  heap[index] = value
}

function popHeap(heap, order) {
  const root = heap[0]
  const last = heap.pop()
  if (heap.length === 0) return root
  let index = 0
  while (true) {
    const left = index * 2 + 1
    if (left >= heap.length) break
    const right = left + 1
    const smallest =
      right < heap.length && compareHeapEntries(heap[right], heap[left], order) < 0
        ? right
        : left
    if (compareHeapEntries(last, heap[smallest], order) <= 0) break
    heap[index] = heap[smallest]
    index = smallest
  }
  heap[index] = last
  return root
}

function compareHeapEntries(left, right, order) {
  const comparison = comparePositionKeys(left.key, right.key)
  return order === 'ASC' ? comparison : -comparison
}

function comparePositionKeys(left, right) {
  return (
    compareStringsByCodeUnit(left.timestamp, right.timestamp) ||
    compareStringsByCodeUnit(left.deviceId, right.deviceId) ||
    compareStringsByCodeUnit(left.stableIdentity, right.stableIdentity)
  )
}

function normalizeExactPositionEntry(row) {
  if (
    typeof row.position_identity !== 'string' ||
    row.position_identity.length < 1 ||
    typeof row.id !== 'string' ||
    typeof row.device_id !== 'string' ||
    (row.source_position_id !== null && typeof row.source_position_id !== 'string') ||
    !Number.isFinite(row.lat) ||
    row.lat < -90 ||
    row.lat > 90 ||
    !Number.isFinite(row.lon) ||
    row.lon < -180 ||
    row.lon > 180 ||
    !isStrictTrackingTimestamp(row.timestamp) ||
    (row.data_origin !== 'live' && row.data_origin !== 'cache')
  ) {
    throw new Error('Persisted exact breadcrumb-dot position is invalid.')
  }
  return {
    position: {
      id: row.id,
      source_position_id: row.source_position_id,
      device_id: row.device_id,
      lat: row.lat,
      lon: row.lon,
      timestamp: row.timestamp,
      data_origin: row.data_origin,
    },
    key: {
      timestamp: row.timestamp,
      deviceId: row.device_id,
      stableIdentity: row.position_identity,
    },
  }
}

function encodeCursor(missionId, activeDeviceIds, key) {
  return Buffer.from(JSON.stringify({
    v: CURSOR_VERSION,
    missionId,
    activeDeviceIds,
    ...key,
  }), 'utf8').toString('base64url')
}

function decodeCursor(value, missionId, activeDeviceIds, resolvedDeviceIds) {
  if (
    value.length < 1 ||
    value.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new Error('Exact breadcrumb-dot cursor is malformed.')
  }
  let decoded
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Exact breadcrumb-dot cursor is malformed.')
  }
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    decoded.v !== CURSOR_VERSION ||
    decoded.missionId !== missionId ||
    !Array.isArray(decoded.activeDeviceIds) ||
    decoded.activeDeviceIds.length !== activeDeviceIds.length ||
    decoded.activeDeviceIds.some((deviceId, index) => deviceId !== activeDeviceIds[index])
  ) {
    throw new Error('Exact breadcrumb-dot cursor does not match the mission or device context.')
  }
  if (
    !isStrictTrackingTimestamp(decoded.timestamp) ||
    typeof decoded.deviceId !== 'string' ||
    !resolvedDeviceIds.includes(decoded.deviceId) ||
    typeof decoded.stableIdentity !== 'string' ||
    decoded.stableIdentity.length < 1 ||
    decoded.stableIdentity.length > 2_048
  ) {
    throw new Error('Exact breadcrumb-dot cursor is malformed.')
  }
  return {
    timestamp: decoded.timestamp,
    deviceId: decoded.deviceId,
    stableIdentity: decoded.stableIdentity,
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted !== true) {
    return
  }
  const error = new Error('Exact breadcrumb-dot query was cancelled.')
  error.name = 'AbortError'
  throw error
}

module.exports = {
  listExactBreadcrumbDotPage,
}
