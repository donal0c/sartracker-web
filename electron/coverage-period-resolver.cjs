/**
 * Finds the half-open outing window containing one ordered timestamp.
 *
 * Outings must be ordered by `started_at` ascending. Mission-store validation
 * prevents overlaps, so the latest start at or before the timestamp is the
 * only possible match.
 */
function findContainingOutingIndex(outings, timestamp) {
  let low = 0
  let high = outings.length - 1
  let candidate = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (outings[middle].started_at <= timestamp) {
      candidate = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (candidate === -1) return -1
  const endedAt = outings[candidate].ended_at
  return endedAt === null || timestamp < endedAt ? candidate : -1
}

/** Resolves one accepted fix to a tagged outing or Unassigned period key. */
function resolveCoveragePeriod(outings, timestamp) {
  const outingIndex = findContainingOutingIndex(outings, timestamp)
  if (outingIndex === -1) {
    return { period_kind: 'unassigned', period_id: '' }
  }
  return { period_kind: 'outing', period_id: outings[outingIndex].id }
}

module.exports = {
  findContainingOutingIndex,
  resolveCoveragePeriod,
}
