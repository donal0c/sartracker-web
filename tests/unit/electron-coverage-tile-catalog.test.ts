import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  createCoverageTileCatalog,
  diffCoverageTileCatalog,
  selectInvalidatedCoverageTilePaths,
} = require('../../electron/coverage-tile-catalog.cjs') as {
  readonly createCoverageTileCatalog: (input: {
    readonly missionId: string
    readonly chunks: readonly Chunk[]
  }) => Catalog
  readonly diffCoverageTileCatalog: (before: Catalog, after: Catalog) => {
    readonly invalidatedPeriodKeys: readonly string[]
    readonly retainedPeriodKeys: readonly string[]
    readonly changedChunkKeys: readonly string[]
  }
  readonly selectInvalidatedCoverageTilePaths: (
    entries: readonly { readonly path: string; readonly contributors: readonly string[] }[],
    changedChunkKeys: readonly string[],
  ) => readonly string[]
}

type Chunk = {
  readonly key: {
    readonly device_id: string
    readonly period_kind: 'outing' | 'unassigned'
    readonly period_id: string
  }
  readonly contentRev: number
}

type Catalog = {
  readonly missionId: string
  readonly periods: readonly {
    readonly periodKey: string
    readonly revisionDigest: string
    readonly contributors: readonly string[]
  }[]
}

describe('Candidate B coverage tile catalog [DON-276]', () => {
  it('changes only the contributing period when one unrelated chunk revision moves', () => {
    const before = createCoverageTileCatalog({
      missionId: 'mission-1',
      chunks: [chunk('device-a', 'outing-a', 1), chunk('device-b', 'outing-b', 1)],
    })
    const after = createCoverageTileCatalog({
      missionId: 'mission-1',
      chunks: [chunk('device-a', 'outing-a', 2), chunk('device-b', 'outing-b', 1)],
    })

    expect(diffCoverageTileCatalog(before, after)).toEqual({
      invalidatedPeriodKeys: ['outing\u0000outing-a'],
      retainedPeriodKeys: ['outing\u0000outing-b'],
      changedChunkKeys: ['device-a\u0000outing\u0000outing-a'],
    })
    expect(after.periods.find((period) => period.periodKey.endsWith('outing-b')))
      .toEqual(before.periods.find((period) => period.periodKey.endsWith('outing-b')))
  })

  it('invalidates cached tiles by exact contributing chunk instead of a mission epoch', () => {
    const invalidated = selectInvalidatedCoverageTilePaths([
      {
        path: '/cache/affected.pbf',
        contributors: ['device-a\u0000outing\u0000outing-a@1'],
      },
      {
        path: '/cache/unrelated.pbf',
        contributors: ['device-b\u0000outing\u0000outing-b@1'],
      },
      {
        path: '/cache/shared.pbf',
        contributors: [
          'device-a\u0000outing\u0000outing-a@1',
          'device-b\u0000outing\u0000outing-b@1',
        ],
      },
    ], ['device-a\u0000outing\u0000outing-a'])

    expect(invalidated).toEqual(['/cache/affected.pbf', '/cache/shared.pbf'])
  })
})

function chunk(deviceId: string, outingId: string, contentRev: number): Chunk {
  return {
    key: { device_id: deviceId, period_kind: 'outing', period_id: outingId },
    contentRev,
  }
}
