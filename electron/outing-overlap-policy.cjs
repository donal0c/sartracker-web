/** Converts one persisted outing boundary to a comparable millisecond value. */
function boundaryMilliseconds(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Outing ${label} must be a valid ISO8601 date-time.`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Outing ${label} must be a valid ISO8601 date-time.`)
  }
  return milliseconds
}

/** Returns whether two half-open outing windows intersect. */
function outingWindowsOverlap(left, right) {
  const leftStart = boundaryMilliseconds(left.started_at, 'start')
  const rightStart = boundaryMilliseconds(right.started_at, 'start')
  const leftEnd = left.ended_at === null
    ? Number.POSITIVE_INFINITY
    : boundaryMilliseconds(left.ended_at, 'end')
  const rightEnd = right.ended_at === null
    ? Number.POSITIVE_INFINITY
    : boundaryMilliseconds(right.ended_at, 'end')
  return leftStart < rightEnd && rightStart < leftEnd
}

module.exports = {
  outingWindowsOverlap,
}
