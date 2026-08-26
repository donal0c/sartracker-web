import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { replaceCoverageTileCacheEntry } = require(
  '../../electron/coverage-tile-cache-ledger.cjs',
) as {
  readonly replaceCoverageTileCacheEntry: (
    entries: Map<string, { readonly size: number }>,
    tilePath: string,
    entry: { readonly size: number },
    cacheBytes: number,
  ) => number
}

describe('coverage tile cache ledger [DON-276]', () => {
  it('counts a concurrently replaced path exactly once', () => {
    const entries = new Map<string, { readonly size: number }>()
    let cacheBytes = replaceCoverageTileCacheEntry(
      entries, '/cache/shared.pbf', { size: 128 }, 0,
    )

    cacheBytes = replaceCoverageTileCacheEntry(
      entries, '/cache/shared.pbf', { size: 128 }, cacheBytes,
    )

    expect(entries).toHaveLength(1)
    expect(cacheBytes).toBe(128)
  })

  it('replaces the prior size instead of accumulating phantom bytes', () => {
    const entries = new Map<string, { readonly size: number }>()
    let cacheBytes = replaceCoverageTileCacheEntry(
      entries, '/cache/shared.pbf', { size: 128 }, 0,
    )

    cacheBytes = replaceCoverageTileCacheEntry(
      entries, '/cache/shared.pbf', { size: 192 }, cacheBytes,
    )

    expect(cacheBytes).toBe(192)
  })
})
