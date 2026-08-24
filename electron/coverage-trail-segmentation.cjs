const parsedTimestampByPosition = new WeakMap()

/** Splits one ordered fix array only on real gaps above the threshold. */
function createTrailSegments(positions, gapThresholdMs) {
  const segmenter = createPagedTrailSegmenter(gapThresholdMs)
  return [...segmenter.append(positions), ...segmenter.finish()]
}

/** Segments cursor pages while retaining only the unfinished final segment. */
function createPagedTrailSegmenter(gapThresholdMs) {
  let currentSegment = []
  let finished = false
  return {
    append(positions) {
      if (finished) throw new Error('Cannot append to a finished trail segmenter.')
      const completed = []
      for (const position of positions) {
        const previous = currentSegment.at(-1)
        if (
          previous !== undefined &&
          getParsedTimestamp(position) - getParsedTimestamp(previous) > gapThresholdMs
        ) {
          completed.push(currentSegment)
          currentSegment = []
        }
        currentSegment.push(position)
      }
      return completed
    },
    finish() {
      if (finished) return []
      finished = true
      if (currentSegment.length === 0) return []
      const finalSegment = currentSegment
      currentSegment = []
      return [finalSegment]
    },
  }
}

function getParsedTimestamp(position) {
  const cached = parsedTimestampByPosition.get(position)
  if (cached !== undefined) return cached
  const parsed = Date.parse(position.timestamp)
  parsedTimestampByPosition.set(position, parsed)
  return parsed
}

module.exports = { createPagedTrailSegmenter, createTrailSegments }
