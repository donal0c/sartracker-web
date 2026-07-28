const { isStrictTrackingTimestamp } = require('./tracking-timestamp.cjs')
const {
  compareStringsByCodeUnit,
} = require('./deterministic-string-order.cjs')

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
    `SELECT * FROM positions
     WHERE mission_id = ? AND device_id = ?
     ORDER BY timestamp ASC, rowid ASC`,
  )
  const positions = []
  let droppedPositionCount = 0

  for (const total of deviceTotals) {
    let retained = []
    let bucketWidthMs = null
    for (const position of selectDevicePositions.iterate(missionId, total.device_id)) {
      if (!isValidStoredPosition(position)) {
        droppedPositionCount += 1
        continue
      }
      retained.push(position)
      if (retained.length > perDeviceLimit * 2) {
        const selection = retainPositionRowsAcrossWindow(
          retained,
          perDeviceLimit,
          bucketWidthMs,
        )
        retained = selection.positions
        bucketWidthMs = selection.bucketWidthMs
      }
    }
    positions.push(
      ...retainPositionRowsAcrossWindow(
        retained,
        perDeviceLimit,
        bucketWidthMs,
      ).positions,
    )
  }

  positions.sort(comparePositionRows)
  return { positions, deviceTotals, droppedPositionCount }
}

function validatePerDevicePositionLimit(perDeviceLimit) {
  if (!Number.isInteger(perDeviceLimit) || perDeviceLimit < 1 || perDeviceLimit > 5_000) {
    throw new Error('Breadcrumb position limit must be a positive integer no greater than 5000.')
  }
}

function isValidStoredPosition(position) {
  if (
    !Number.isFinite(position.lat) ||
    position.lat < -90 ||
    position.lat > 90 ||
    !Number.isFinite(position.lon) ||
    position.lon < -180 ||
    position.lon > 180
  ) {
    return false
  }
  if (!isStrictTrackingTimestamp(position.timestamp)) {
    return false
  }
  return true
}

function retainPositionRowsAcrossWindow(rows, maxPositions, minimumBucketWidthMs) {
  const chronological = [...rows].sort(comparePositionRows)
  if (chronological.length <= maxPositions && minimumBucketWidthMs === null) {
    return { positions: chronological, bucketWidthMs: null }
  }
  if (maxPositions === 1) {
    return {
      positions: [chronological.at(-1)],
      bucketWidthMs: minimumBucketWidthMs ?? 1,
    }
  }

  const latest = chronological.at(-1)
  let bucketWidthMs = minimumBucketWidthMs ?? 1
  while (true) {
    const bucketWinners = new Map()
    for (const position of chronological) {
      const timestampMs = Date.parse(position.timestamp)
      const bucket = Math.floor(timestampMs / bucketWidthMs)
      const existing = bucketWinners.get(bucket)
      if (existing === undefined || comparePositionRows(position, existing) < 0) {
        bucketWinners.set(bucket, position)
      }
    }

    const retained = [...bucketWinners.values()].sort(comparePositionRows)
    if (
      createStoredPositionIdentityKey(retained.at(-1)) !==
      createStoredPositionIdentityKey(latest)
    ) {
      retained.push(latest)
    }
    if (retained.length <= maxPositions) {
      return { positions: retained, bucketWidthMs }
    }
    bucketWidthMs *= 2
  }
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
}
