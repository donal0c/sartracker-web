import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  assertCoverageBuildCoverage,
  assertCoverageBuildSummaries,
} = require('../../electron/coverage-build-attestation.cjs') as {
  readonly assertCoverageBuildCoverage: (
    requiredIdentities: ReadonlySet<string>,
    builds: readonly Build[],
  ) => void
  readonly assertCoverageBuildSummaries: (
    builds: readonly Build[],
    summaries: readonly Summary[],
  ) => void
}

type Key = {
  readonly device_id: string
  readonly period_kind: 'outing' | 'unassigned'
  readonly period_id: string
}

type Build = {
  readonly key: Key
  readonly contentRev: number
  readonly fixCount: number
  readonly fixDigest: string
  readonly minTs: string | null
  readonly maxTs: string | null
}

type Summary = {
  readonly key: Key
  readonly contentRev: number
  readonly fix_count: number
  readonly fix_digest: string
  readonly min_ts: string | null
  readonly max_ts: string | null
}

const key: Key = {
  device_id: 'device-1', period_kind: 'unassigned', period_id: '',
}
const digest = 'f'.repeat(64)
const build: Build = {
  key, contentRev: 2, fixCount: 3, fixDigest: digest,
  minTs: '2026-08-24T09:00:00.000Z', maxTs: '2026-08-24T09:10:00.000Z',
}

describe('coverage tile build attestation', () => {
  it('requires worker content evidence for every requested chunk', () => {
    expect(() => assertCoverageBuildCoverage(
      new Set(['device-1\u0000unassigned\u0000']),
      [],
    )).toThrow(/required.*build.*missing/i)
  })

  it('requires exact key, revision, count, digest, and bounds equality', () => {
    const exact: Summary = {
      key, contentRev: 2, fix_count: 3, fix_digest: digest,
      min_ts: '2026-08-24T09:00:00.000Z', max_ts: '2026-08-24T09:10:00.000Z',
    }
    expect(() => assertCoverageBuildSummaries([build], [{
      ...exact,
      fix_count: 0,
      fix_digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      min_ts: null,
      max_ts: null,
    }])).toThrow(/build.*exact.*summary|summary.*diverged/i)
    expect(() => assertCoverageBuildSummaries([build], [exact])).not.toThrow()
  })
})
