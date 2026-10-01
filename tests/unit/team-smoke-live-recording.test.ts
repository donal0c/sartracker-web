// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { isRetryableStoreRead, liveLagFindings, waitForStoredIds } from '../../scripts/team-smoke/lib/live-recording.mjs'
import { NotTested } from '../../scripts/team-smoke/lib/results.mjs'
import { startMockTraccar } from '../../scripts/team-smoke/lib/mock-traccar.mjs'

type Fix = { id: number, deviceId: number, fixTime: string }

const mocks: { close: () => Promise<void> }[] = []

afterEach(async () => {
  for (const mock of mocks.splice(0)) await mock.close()
})

/** Starts the real-time mock with a controllable clock. */
async function start() {
  let now = Date.parse('2026-10-01T12:00:00.000Z')
  const mock = await startMockTraccar({ now: () => now })
  mocks.push(mock)
  return {
    mock,
    advance: (ms: number) => { now += ms },
    positions: async (deviceId: number) => {
      const response = await fetch(`${mock.url}/api/positions?deviceId=${deviceId}&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z`)
      return await response.json() as Fix[]
    },
    latest: async () => {
      const response = await fetch(`${mock.url}/api/positions`)
      return await response.json() as Fix[]
    },
  }
}

describe('mock Traccar device hold (one phone loses signal) [DON-316]', () => {
  it('serves nothing newer for a held device while the others stay live', async () => {
    const { mock, advance, positions, latest } = await start()
    advance(30_000)
    mock.holdDevice(1)
    advance(60_000)

    expect((await positions(1)).at(-1)?.id).toBe(1_000_003)
    expect((await positions(2)).at(-1)?.id).toBe(2_000_009)
    expect((await latest()).find((fix) => fix.deviceId === 1)?.id).toBe(1_000_003)
    expect(mock.latestIndexFor(1)).toBe(3)
    expect(mock.latestIndexFor(2)).toBe(9)
  })

  it('uploads the whole held stretch with its original times on release', async () => {
    const { mock, advance, positions } = await start()
    advance(30_000)
    mock.holdDevice(1)
    advance(60_000)
    mock.releaseDevice(1)

    const fixes = await positions(1)
    expect(fixes.map((fix) => fix.id % 1_000_000)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(fixes[5]?.fixTime).toBe('2026-10-01T12:00:50.000Z')
  })
})

describe('liveLagFindings [DON-315/316]', () => {
  /** A sample where each device's store is `lag` fixes behind a provider at `latest`. */
  const sample = (atMs: number, latest: number, lag: Record<number, number | null>) => ({
    atMs,
    latest: Object.fromEntries(Object.keys(lag).map((device) => [device, latest])),
    stored: Object.fromEntries(Object.entries(lag).map(([device, behind]) => [device, behind === null ? null : latest - behind])),
  })
  /** Samples every 10 s from `fromMs` to `toMs`, the store following `storedAt(ms)` for device 2. */
  const run = (fromMs: number, toMs: number, storedAt: (ms: number) => number) => {
    const samples = []
    for (let atMs = fromMs; atMs <= toMs; atMs += 10_000) {
      samples.push({ atMs, latest: { 2: 10 + atMs / 10_000 }, stored: { 2: storedAt(atMs) } })
    }
    return samples
  }
  /** A healthy store: a 30 s poll stores up to the provider's latest fix. */
  const polling = (ms: number) => 10 + Math.floor(ms / 30_000) * 3
  const options = { label: 'Focus Mode', maxLagSteps: 6, graceMs: 0, durationMs: 80_000, maxSampleGapMs: 25_000 }

  it('accepts a store that keeps up with 30 s polls', () => {
    expect(liveLagFindings(run(10_000, 80_000, polling), options)).toEqual([])
  })

  it('ignores lag inside the grace period', () => {
    const samples = [sample(10_000, 10, { 2: 10 }), ...run(40_000, 90_000, polling)]
    expect(liveLagFindings(samples, { ...options, graceMs: 40_000, durationMs: 90_000 })).toEqual([])
  })

  it('reports the worst lag per device while the control is set', () => {
    const findings = liveLagFindings([sample(10_000, 10, { 1: 2, 2: 8 }), sample(30_000, 14, { 1: 3, 2: 11 }), sample(60_000, 17, { 1: 2, 2: 5 })],
      { ...options, durationMs: 60_000, maxSampleGapMs: 30_000 })
    expect(findings).toEqual(['while Focus Mode, device 2 fell 11 fixes (110 s) behind the provider (limit 6)'])
  })

  it('catches a full stop that starts caught up, before lag reaches the limit (Codex review)', () => {
    expect(liveLagFindings(run(10_000, 60_000, () => 10), { ...options, durationMs: 60_000 })).toEqual([
      'while Focus Mode, device 2 stopped recording: no new stored fix for at least 50 s (limit 40 s)',
    ])
  })

  it('catches one early batch followed by a stop (Codex review 2)', () => {
    const findings = liveLagFindings(run(10_000, 80_000, (ms) => (ms < 20_000 ? 10 : 13)), options)
    expect(findings).toEqual(['while Focus Mode, device 2 stopped recording: no new stored fix for at least 60 s (limit 40 s)'])
  })

  it('measures the silence that ends in a late advance (Codex review 3)', () => {
    const findings = liveLagFindings(run(10_000, 80_000, (ms) => (ms < 70_000 ? 10 : 15)), options)
    expect(findings).toEqual(['while Focus Mode, device 2 stopped recording: no new stored fix for at least 50 s (limit 40 s)'])
  })

  it('does not fail healthy polling because one read was skipped (Codex review 4)', () => {
    const polls = [9_900, 40_100, 70_100]
    const healthy = (ms: number) => 10 + polls.filter((at) => at <= ms).length * 3
    const skipped = run(10_000, 80_000, healthy).filter((entry) => entry.atMs !== 50_000)
    expect(liveLagFindings(skipped, options)).toEqual([])
  })

  it('reports a device with no stored fixes as not recording', () => {
    expect(liveLagFindings([sample(10_000, 10, { 1: null }), sample(60_000, 15, { 1: null })], { ...options, label: 'Replay', durationMs: 60_000, maxSampleGapMs: 50_000 }))
      .toEqual(['while Replay, device 1 had no stored fixes'])
  })

  it('is NOT TESTED, never a pass or a product FAIL, when the watch was not covered', () => {
    expect(() => liveLagFindings([], { ...options, label: 'Review' })).toThrow(NotTested)
    // Readable early, unreadable at the decisive end (Codex review 2).
    expect(() => liveLagFindings(run(40_000, 60_000, polling), { ...options, graceMs: 40_000, durationMs: 90_000 }))
      .toThrow('while Focus Mode, store samples did not cover the watch (read 40-60 s of 40-90 s)')
    // One skipped read at the start leaves too short a span to rule out a stop (Codex review 3).
    expect(() => liveLagFindings(run(50_000, 90_000, () => 10), { ...options, graceMs: 40_000, durationMs: 90_000 }))
      .toThrow('while Focus Mode, store samples did not cover the watch (read 50-90 s of 40-90 s)')
    // A hole in the middle.
    const holed = run(10_000, 80_000, polling).filter((entry) => entry.atMs < 30_000 || entry.atMs > 50_000)
    expect(() => liveLagFindings(holed, options)).toThrow(NotTested)
  })
})

describe('waitForStoredIds [DON-316]', () => {
  const quick = { timeoutMs: 50, intervalMs: 5, maxReadGapMs: 20 }

  it('resolves true once every id is stored', async () => {
    let reads = 0
    await expect(waitForStoredIds({ ids: [1, 2], read: () => (++reads < 3 ? [1] : [1, 2]), ...quick })).resolves.toBe(true)
  })

  it('resolves false when the store was read throughout and the ids never arrived', async () => {
    await expect(waitForStoredIds({ ids: [1, 2], read: () => [1], ...quick })).resolves.toBe(false)
  })

  it('is NOT TESTED when a busy store could not be read (Codex review 2)', async () => {
    const busy = () => { throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }) }
    await expect(waitForStoredIds({ ids: [1], read: busy, ...quick })).rejects.toThrow(NotTested)
  })

  it('propagates a non-busy read error', async () => {
    const broken = () => { throw new Error('no such table: positions') }
    await expect(waitForStoredIds({ ids: [1], read: broken, ...quick })).rejects.toThrow('no such table')
  })
})

describe('isRetryableStoreRead', () => {
  it('retries only a busy or locked store', () => {
    expect(isRetryableStoreRead(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))).toBe(true)
    expect(isRetryableStoreRead(Object.assign(new Error('locked'), { code: 'SQLITE_LOCKED' }))).toBe(true)
    expect(isRetryableStoreRead(new Error('Mission "x" is not in the store.'))).toBe(false)
    expect(isRetryableStoreRead(Object.assign(new Error('no such table'), { code: 'SQLITE_ERROR' }))).toBe(false)
  })
})
