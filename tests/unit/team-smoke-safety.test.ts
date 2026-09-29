// @vitest-environment node
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { launchApp, observeStartup } from '../../scripts/team-smoke/lib/app.mjs'
import { participantFirstIndices, verifyFixes, verifyLookbackFixes } from '../../scripts/team-smoke/checks/tracking.mjs'
import { startHistoryTraccar } from '../../scripts/team-smoke/lib/history-traccar.mjs'
import { completedCheck, renderResultTable } from '../../scripts/team-smoke/lib/results.mjs'
import workflows from '../../scripts/team-smoke/checks/workflows.mjs'
import tracking from '../../scripts/team-smoke/checks/tracking.mjs'
import identity from '../../scripts/team-smoke/checks/identity.mjs'
import { startMockTraccar } from '../../scripts/team-smoke/lib/mock-traccar.mjs'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))
const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }))
vi.mock('playwright', () => ({ chromium: { connectOverCDP: connectMock } }))
const dirs: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('team smoke process ownership', () => {
  it.each(['ENOENT', 'EACCES'])('rejects %s without signalling a sentinel process group', async (code) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: undefined })
    child.on('error', () => {})
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('error', Object.assign(new Error(code), { code })))
      return child
    })
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smoke-spawn-test-')); dirs.push(dir)
    await expect(observeStartup({ app: '/missing', appArgs: [], runDir: dir }, {
      profile: dir, label: code, timeoutMs: 0,
    })).rejects.toThrow(code)
    expect(kill).not.toHaveBeenCalled()
    const running = new Set()
    await expect(launchApp({ app: '/missing', appArgs: [], runDir: dir, running }, {
      profile: dir, label: code,
    })).rejects.toThrow(code)
    expect(running.size).toBe(0)
    expect(kill).not.toHaveBeenCalled()
  })
  it('cleans up only the successfully spawned group and surfaces missing screenshots', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 43210 })
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    })
    const page = Object.assign(new EventEmitter(), {
      url: () => 'file:///app/index.html',
      screenshot: vi.fn().mockRejectedValue(new Error('Screenshot unavailable')),
    })
    connectMock.mockResolvedValue({ contexts: () => [{ pages: () => [page] }] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const dir = await mkdtemp(path.join(os.tmpdir(), 'smoke-owned-test-')); dirs.push(dir)
    const ctx = { app: '/synthetic', appArgs: [], runDir: dir, running: new Set() }
    const app = await launchApp(ctx, { profile: dir, label: 'owned', waitForShell: false })
    await expect(app.shot('required')).rejects.toThrow('Screenshot unavailable')
    await app.kill()
    expect(kill).toHaveBeenCalledExactlyOnceWith(-43210, 'SIGKILL')
    expect(ctx.running.size).toBe(0)
    child.emit('exit', 0); child.emit('close')
    kill.mockImplementation(() => { throw Object.assign(new Error('Already gone'), { code: 'ESRCH' }) })
    await expect(app.kill()).resolves.toBeUndefined()
  })
})

const mock = {
  latestIndex: () => 100,
  fixFor: (id: number) => ({ latitude: 52 + id / 1e9, longitude: -9, fixTime: new Date(id * 1000).toISOString() }),
}
/** Generates two walkers' exact provider fixtures. */
function fixes(indices: number[]) {
  return [1, 2].flatMap(device => indices.map(index => {
    const sourcePositionId = device * 1_000_000 + index
    const served = mock.fixFor(sourcePositionId)
    return { sourcePositionId, lat: served.latitude, lon: served.longitude, time: Date.parse(served.fixTime) }
  }))
}
describe('team smoke history oracle', () => {
  it('does not require a fix before that participant became eligible', () => {
    const rows = fixes([98, 99, 100]).filter(row => row.sourcePositionId !== 1_000_098)
    expect(verifyFixes(mock, rows, { firstExpectedByDevice: { 1: 99, 2: 98 } }).fixes).toBe(5)
    expect(() => verifyFixes(mock, rows.filter(row => row.sourcePositionId !== 1_000_099), {
      firstExpectedByDevice: { 1: 99, 2: 98 },
    })).toThrow(/missing fixes/)
  })
  it('captures staggered participant boundaries instead of using mission start for everyone', () => {
    const provider = { firstIndexAtOrAfter: (time: number) => Math.ceil(time / 10_000) }
    const starts = participantFirstIndices(provider, '1970-01-01T00:00:15.000Z', [
      { kind: 'device', traccar_device_id: '1', effective_from: '1970-01-01T00:00:18.000Z', removed_at: null },
      { kind: 'device', traccar_device_id: '2', effective_from: '1970-01-01T00:00:21.000Z', removed_at: null },
    ])
    expect(starts).toEqual({ 1: 2, 2: 3 })
    expect(() => participantFirstIndices(provider, '1970-01-01T00:00:15.000Z', [])).toThrow(/participant/)
  })
  it('rejects a deleted prefix even when the latest fix remains', () => {
    expect(() => verifyFixes(mock, fixes([100]), { firstExpectedIndex: 1 })).toThrow(/missing fixes/)
  })
  it('rejects a missing backfill interval', () => {
    expect(() => verifyFixes(mock, fixes([98, 100]), { firstExpectedIndex: 98 })).toThrow(/missing fixes/)
  })
  it('accepts a complete independently bounded interval without requiring pre-mission fixes', () => {
    expect(verifyFixes(mock, fixes([98, 99, 100]), { firstExpectedIndex: 98 }).fixes).toBe(6)
  })
  it('requires an independent start boundary', () => {
    expect(() => verifyFixes(mock, fixes([100]))).toThrow(/expected/i)
  })
  it('still rejects wrong coordinates', () => {
    const rows = fixes([100]); rows[0].lat = 0
    expect(() => verifyFixes(mock, rows, { firstExpectedIndex: 100 })).toThrow(/differ/)
  })
  it('preserves stationary as well as walking evidence captured before interruption', () => {
    const stationary = { ...fixes([100])[0], sourcePositionId: 3_000_100 }
    expect(() => verifyFixes(mock, fixes([100]), {
      firstExpectedIndex: 100, preservedFixes: [stationary],
    })).toThrow(/lost or changed/)
  })
  it('uses mission time, including exact step boundaries, to exclude pre-mission fixes', async () => {
    const provider = await startMockTraccar()
    try {
      expect(provider.firstIndexAtOrAfter(provider.startMs + 10_000)).toBe(1)
      expect(provider.firstIndexAtOrAfter(provider.startMs + 10_001)).toBe(2)
      expect(() => provider.firstIndexAtOrAfter(NaN)).toThrow(/invalid/)
    } finally { await provider.close() }
  })
})

describe('team smoke incomplete evidence', () => {
  it('keeps mixed rows untested until the remaining operator checks are performed', () => {
    for (const id of ['lifecycle', 'markers-gpx', 'replay-basemaps']) {
      const check = [...tracking, ...workflows].find(entry => entry.id === id)
      expect(check?.manualSteps?.length).toBeGreaterThan(0)
      const result = completedCheck(check, 'Automated subset succeeded')
      expect(result.result).toBe('NOT TESTED')
      const table = renderResultTable([{ name: check.check }], new Map([[check.check, result]]))
      expect(table).toContain('Automated subset succeeded')
      expect(table).not.toContain('| PASS |')
    }
  })
  it('allows a fully automated completed check to pass', () => {
    expect(completedCheck({ id: 'fully-automated' }, 'Exact comparison succeeded')).toEqual({
      result: 'PASS', evidence: 'Exact comparison succeeded',
    })
  })
  it('does not infer CI custody from a local checksum match', () => {
    for (const check of identity.filter(entry => entry.id.startsWith('identity-'))) {
      expect(completedCheck(check, 'Local hash matches').result).toBe('NOT TESTED')
    }
  })
})

describe('team-smoke lookback verification [DON-291]', () => {
  it('passes only an exact in-window copy and rejects leaks, gaps and unselected devices', async () => {
    const mock = await startHistoryTraccar()
    try {
      const missionStart = mock.denseBand.from + 30_500
      const until = mock.t0
      const stored = (deviceId: number, from = missionStart) => mock.fixesBetween(deviceId, from, until)
        .map((fix) => ({ sourcePositionId: fix.id, lat: fix.latitude, lon: fix.longitude, time: Date.parse(fix.fixTime) }))
      const exact = [...stored(11), ...stored(12)]
      const options = { missionStart, until, expectedDevices: [11, 12], excludedDevices: [13], tailToleranceMs: 0 }
      expect(verifyLookbackFixes(mock, exact, options)[11]).toMatchObject({
        first: new Date(mock.denseBand.from + 31_000).toISOString(),
      })
      const earlier = stored(11, missionStart - 1000)[0]!
      expect(() => verifyLookbackFixes(mock, [earlier, ...exact], options)).toThrow(/predate mission start/)
      expect(() => verifyLookbackFixes(mock, exact.slice(1), options)).toThrow(/missing/)
      expect(() => verifyLookbackFixes(mock, [...exact, ...stored(13)], options)).toThrow(/never selected/)
      expect(() => verifyLookbackFixes(mock, [{ ...exact[0]!, lat: exact[0]!.lat + 0.001 }, ...exact.slice(1)], options))
        .toThrow(/differ/)
      expect(() => verifyLookbackFixes(mock, exact, { ...options, missionStart: mock.t0 - 3_600_000 }))
        .toThrow(/boundary band/)
    } finally {
      await mock.close()
    }
  })
})
