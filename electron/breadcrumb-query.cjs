const { isStrictTrackingTimestamp } = require('./tracking-timestamp.cjs')
const {
  compareStringsByCodeUnit,
} = require('./deterministic-string-order.cjs')

const TARGET_BREADCRUMB_GEOMETRY_ERROR_METRES = 25
const METRES_PER_DEGREE_AT_EQUATOR = 111_320
const BASE_SPATIAL_BUCKET_WIDTH_DEGREES =
  TARGET_BREADCRUMB_GEOMETRY_ERROR_METRES /
  Math.SQRT2 /
  METRES_PER_DEGREE_AT_EQUATOR
const MAX_SELECTOR_ITERATIONS = 2_048
const SQLITE_ROW_ID_PARAMETER_CHUNK = 500
const ROW_ID_INDEX = 0
const SOURCE_POSITION_ID_INDEX = 1
const TIMESTAMP_INDEX = 2
const LATITUDE_INDEX = 3
const LONGITUDE_INDEX = 4

/** Returns a deterministic, bounded, whole-route breadcrumb representation. */
function listBreadcrumbPositions(db, missionId, perDeviceLimit) {
  validatePerDevicePositionLimit(perDeviceLimit)
  const deviceTotals = db
    .prepare(
      `SELECT device_id, COUNT(*) AS total
       FROM positions
       WHERE mission_id = ?
       GROUP BY device_id
       ORDER BY device_id ASC`,
    )
    .all(missionId)
  const selectDevicePositions = db.prepare(
    `SELECT rowid, source_position_id, timestamp, lat, lon FROM positions
     WHERE mission_id = ? AND device_id = ?
     ORDER BY timestamp ASC, rowid ASC`,
  )
  const positions = []
  const deviceSelections = []
  let droppedPositionCount = 0

  for (const total of deviceTotals) {
    const compactRows = []
    const fallbackRowsByRowId = new Map()
    const rawStatement =
      typeof selectDevicePositions.raw === 'function'
        ? selectDevicePositions.raw(true)
        : null
    const rows = rawStatement === null
      ? selectDevicePositions.iterate(missionId, total.device_id)
      : rawStatement.iterate(missionId, total.device_id)
    let fallbackRowId = 0
    for (const position of rows) {
      const compact = Array.isArray(position)
        ? position
        : [
            ++fallbackRowId,
            position.source_position_id,
            position.timestamp,
            position.lat,
            position.lon,
          ]
      if (!isValidCompactPosition(compact)) {
        droppedPositionCount += 1
        continue
      }
      compactRows.push(compact)
      if (!Array.isArray(position)) {
        fallbackRowsByRowId.set(compact[ROW_ID_INDEX], position)
      }
    }
    const selection = retainCompactPositionRowsAcrossWindow(
      compactRows,
      total.device_id,
      perDeviceLimit,
    )
    positions.push(...(
      fallbackRowsByRowId.size > 0
        ? selection.rowIds.map((rowId) => fallbackRowsByRowId.get(rowId))
        : fetchPositionRowsByRowId(db, missionId, selection.rowIds)
    ).filter(Boolean))
    deviceSelections.push({
      device_id: total.device_id,
      geometryErrorBoundMetres: selection.geometryErrorBoundMetres,
      timeBucketWidthMs: selection.timeBucketWidthMs,
      spatialBucketWidthDegrees: selection.spatialBucketWidthDegrees,
      targetGeometryErrorSatisfied:
        selection.geometryErrorBoundMetres !== null &&
        selection.geometryErrorBoundMetres <= TARGET_BREADCRUMB_GEOMETRY_ERROR_METRES,
    })
  }

  positions.sort(comparePositionRows)
  return { positions, deviceTotals, deviceSelections, droppedPositionCount }
}

function validatePerDevicePositionLimit(perDeviceLimit) {
  if (!Number.isInteger(perDeviceLimit) || perDeviceLimit < 1 || perDeviceLimit > 5_000) {
    throw new Error('Breadcrumb position limit must be a positive integer no greater than 5000.')
  }
}

function isValidCompactPosition(position) {
  if (
    !Number.isFinite(position[LATITUDE_INDEX]) ||
    position[LATITUDE_INDEX] < -90 ||
    position[LATITUDE_INDEX] > 90 ||
    !Number.isFinite(position[LONGITUDE_INDEX]) ||
    position[LONGITUDE_INDEX] < -180 ||
    position[LONGITUDE_INDEX] > 180
  ) {
    return false
  }
  if (!isStrictTrackingTimestamp(position[TIMESTAMP_INDEX])) {
    return false
  }
  return true
}

function retainCompactPositionRowsAcrossWindow(
  rows,
  deviceId,
  maxPositions,
  diagnostics = null,
) {
  const chronological = [...rows].sort((left, right) =>
    compareCompactPositionRows(left, right, deviceId),
  )
  if (chronological.length <= maxPositions) {
    return {
      rowIds: chronological.map((position) => position[ROW_ID_INDEX]),
      geometryErrorBoundMetres: 0,
      timeBucketWidthMs: null,
      spatialBucketWidthDegrees: null,
    }
  }
  if (maxPositions === 1) {
    return {
      rowIds: [chronological.at(-1)[ROW_ID_INDEX]],
      geometryErrorBoundMetres: null,
      timeBucketWidthMs: null,
      spatialBucketWidthDegrees: null,
    }
  }

  let bucketWidthMs = 1
  let spatialBucketWidthDegrees = BASE_SPATIAL_BUCKET_WIDTH_DEGREES
  const fullWindowMs = Math.max(
    1,
    Date.parse(chronological.at(-1)[TIMESTAMP_INDEX]) -
      Date.parse(chronological[0][TIMESTAMP_INDEX]) +
      1,
  )

  for (let iteration = 0; iteration < MAX_SELECTOR_ITERATIONS; iteration += 1) {
    const candidateCount = countCompactCandidateIdentities(
      chronological,
      deviceId,
      bucketWidthMs,
      spatialBucketWidthDegrees,
      maxPositions,
      diagnostics,
    )
    if (!candidateCount.exceeded) {
      const retainedByKey = collectCompactCandidateRowIds(
        chronological,
        deviceId,
        bucketWidthMs,
        spatialBucketWidthDegrees,
      )
      return {
        rowIds: [...retainedByKey.values()],
        geometryErrorBoundMetres:
          spatialBucketWidthDegrees *
          Math.SQRT2 *
          METRES_PER_DEGREE_AT_EQUATOR,
        timeBucketWidthMs: bucketWidthMs,
        spatialBucketWidthDegrees,
      }
    }
    if (bucketWidthMs < fullWindowMs) {
      bucketWidthMs *= 2
    } else {
      spatialBucketWidthDegrees *= 2
    }
  }

  return {
    rowIds: retainUniformlyAcrossWindow(chronological, maxPositions).map(
      (position) => position[ROW_ID_INDEX],
    ),
    geometryErrorBoundMetres: null,
    timeBucketWidthMs: null,
    spatialBucketWidthDegrees: null,
  }
}

function scanCompactRunBoundaries(
  chronological,
  deviceId,
  bucketWidthMs,
  spatialBucketWidthDegrees,
  retainPosition,
) {
  let runBucket = null
  let runFirst = null
  let runLast = null

  const retainRun = () => {
    if (runFirst !== null && runLast !== null) {
      if (retainPosition(runFirst, deviceId) || retainPosition(runLast, deviceId)) {
        return true
      }
    }
    return false
  }

  for (const position of chronological) {
    const bucket = createCompactSpatiotemporalBucketKey(
      position,
      Date.parse(position[TIMESTAMP_INDEX]),
      bucketWidthMs,
      spatialBucketWidthDegrees,
    )
    if (bucket !== runBucket) {
      if (retainRun()) {
        return true
      }
      runBucket = bucket
      runFirst = position
    }
    runLast = position
  }
  return retainRun()
}

function countCompactCandidateIdentities(
  chronological,
  deviceId,
  bucketWidthMs,
  spatialBucketWidthDegrees,
  maxPositions,
  diagnostics,
) {
  const identities = new Set()
  const retainPosition = (position) => {
    identities.add(createCompactPositionIdentityKey(position, deviceId))
    if (diagnostics !== null) {
      diagnostics.maximumCandidateIdentityCount = Math.max(
        diagnostics.maximumCandidateIdentityCount,
        identities.size,
      )
    }
    return identities.size > maxPositions
  }
  if (scanCompactRunBoundaries(
    chronological,
    deviceId,
    bucketWidthMs,
    spatialBucketWidthDegrees,
    retainPosition,
  )) {
    return { exceeded: true }
  }
  if (retainPosition(chronological[0]) || retainPosition(chronological.at(-1))) {
    return { exceeded: true }
  }
  return { exceeded: false }
}

function collectCompactCandidateRowIds(
  chronological,
  deviceId,
  bucketWidthMs,
  spatialBucketWidthDegrees,
) {
  const retainedByKey = new Map()
  const retainPosition = (position) => {
    retainedByKey.set(
      createCompactPositionIdentityKey(position, deviceId),
      position[ROW_ID_INDEX],
    )
    return false
  }
  scanCompactRunBoundaries(
    chronological,
    deviceId,
    bucketWidthMs,
    spatialBucketWidthDegrees,
    retainPosition,
  )
  retainPosition(chronological[0])
  retainPosition(chronological.at(-1))
  return retainedByKey
}

function createCompactSpatiotemporalBucketKey(
  position,
  timestampMs,
  bucketWidthMs,
  spatialBucketWidthDegrees,
) {
  const timeBucket = Math.floor(timestampMs / bucketWidthMs)
  const latitudeBucket = Math.floor(
    (position[LATITUDE_INDEX] + 90) / spatialBucketWidthDegrees,
  )
  const longitudeBucket = Math.floor(
    (position[LONGITUDE_INDEX] + 180) / spatialBucketWidthDegrees,
  )
  return `${timeBucket}:${latitudeBucket}:${longitudeBucket}`
}

function retainUniformlyAcrossWindow(chronological, maxPositions) {
  if (chronological.length <= maxPositions) {
    return chronological
  }
  return Array.from({ length: maxPositions }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (chronological.length - 1)) / (maxPositions - 1),
    )
    return chronological[sourceIndex]
  })
}

function fetchPositionRowsByRowId(db, missionId, rowIds) {
  const positionsByRowId = new Map()
  for (
    let offset = 0;
    offset < rowIds.length;
    offset += SQLITE_ROW_ID_PARAMETER_CHUNK
  ) {
    const chunk = rowIds.slice(offset, offset + SQLITE_ROW_ID_PARAMETER_CHUNK)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(
      `SELECT rowid AS __sartracker_breadcrumb_rowid, positions.* FROM positions NOT INDEXED
       WHERE mission_id = ? AND rowid IN (${placeholders})`,
    ).all(missionId, ...chunk)
    for (const row of rows) {
      const { __sartracker_breadcrumb_rowid: rowId, ...position } = row
      positionsByRowId.set(rowId, position)
    }
  }
  return rowIds.flatMap((rowId) => {
    const position = positionsByRowId.get(rowId)
    return position === undefined ? [] : [position]
  })
}

function compareCompactPositionRows(left, right, deviceId) {
  return (
    Date.parse(left[TIMESTAMP_INDEX]) - Date.parse(right[TIMESTAMP_INDEX]) ||
    compareStringsByCodeUnit(
      createCompactPositionIdentityKey(left, deviceId),
      createCompactPositionIdentityKey(right, deviceId),
    )
  )
}

function createCompactPositionIdentityKey(position, deviceId) {
  const sourcePositionId = position[SOURCE_POSITION_ID_INDEX]?.trim()
  if (sourcePositionId) {
    return `${deviceId}:id:${sourcePositionId}`
  }
  return [
    deviceId,
    'fix',
    position[TIMESTAMP_INDEX],
    Number(position[LATITUDE_INDEX]).toFixed(7),
    Number(position[LONGITUDE_INDEX]).toFixed(7),
  ].join(':')
}

function comparePositionRows(left, right) {
  return (
    Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
    compareStringsByCodeUnit(left.device_id, right.device_id) ||
    compareStringsByCodeUnit(
      createStoredPositionIdentityKey(left),
      createStoredPositionIdentityKey(right),
    )
  )
}

function createStoredPositionIdentityKey(position) {
  const sourcePositionId = position.source_position_id?.trim()
  if (sourcePositionId) {
    return `${position.device_id}:id:${sourcePositionId}`
  }
  return [
    position.device_id,
    'fix',
    position.timestamp,
    Number(position.lat).toFixed(7),
    Number(position.lon).toFixed(7),
  ].join(':')
}

module.exports = {
  listBreadcrumbPositions,
  retainCompactPositionRowsAcrossWindow,
}
