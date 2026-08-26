/**
 * Replaces one path's cache accounting without double-counting concurrent
 * misses that finish for the same deterministic tile path.
 */
function replaceCoverageTileCacheEntry(entries, tilePath, entry, cacheBytes) {
  const prior = entries.get(tilePath)
  entries.set(tilePath, entry)
  return cacheBytes - (prior?.size ?? 0) + entry.size
}

module.exports = { replaceCoverageTileCacheEntry }
