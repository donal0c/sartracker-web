// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  runTimedProfile,
  withDeadline,
  summarizeCpuProfile,
  summarizeSamplingHeapProfile,
} from '../../build/electron-tracking-soak-profile-lib.js'

/**
 * DON-313 / DON-324: the soak names the synchronous work behind main-thread
 * stalls (a CPU profile over the startup catch-up) and the functions that
 * allocate during a checkpoint drain (a sampling heap profile), instead of
 * heap snapshots, which show only the small retained floor.
 */

const frame = (functionName: string, url: string, lineNumber = 0) => ({ functionName, url, lineNumber, columnNumber: 0, scriptId: '1' })

describe('summarizeCpuProfile [DON-313]', () => {
  it('ranks functions by self time and keeps only file basenames', () => {
    const profile = {
      startTime: 0, endTime: 1_000_000,
      nodes: [
        { id: 1, callFrame: frame('(root)', ''), children: [2, 3] },
        { id: 2, callFrame: frame('persistTrackingHistoryBatch', 'file:///opt/SAR Tracker/resources/app.asar/electron/mission-store.cjs', 8645), children: [4] },
        { id: 3, callFrame: frame('(idle)', '') },
        { id: 4, callFrame: frame('run', 'node:internal/sqlite') },
      ],
      samples: [2, 2, 4, 3, 2],
      timeDeltas: [1000, 300_000, 200_000, 400_000, 99_000],
    }
    expect(summarizeCpuProfile(profile, { top: 2 })).toEqual({
      sampledMs: 1000, idleMs: 400,
      top: [
        { functionName: 'persistTrackingHistoryBatch', file: 'mission-store.cjs', line: 8646, selfMs: 400, share: 0.4 },
        { functionName: 'run', file: 'sqlite', line: 1, selfMs: 200, share: 0.2 },
      ],
    })
  })

  it('merges the same function reached through different call paths', () => {
    const profile = {
      startTime: 0, endTime: 30_000,
      nodes: [
        { id: 1, callFrame: frame('(root)', ''), children: [2, 3] },
        { id: 2, callFrame: frame('parse', 'file:///a/b/lib.js', 9) },
        { id: 3, callFrame: frame('parse', 'file:///a/b/lib.js', 9) },
      ],
      samples: [2, 3], timeDeltas: [10_000, 20_000],
    }
    expect(summarizeCpuProfile(profile).top).toEqual([
      { functionName: 'parse', file: 'lib.js', line: 10, selfMs: 30, share: 1 },
    ])
  })
})

describe('summarizeSamplingHeapProfile [DON-324]', () => {
  it('ranks allocating functions by sampled self size', () => {
    const profile = {
      head: {
        callFrame: frame('(root)', ''), selfSize: 0, id: 1,
        children: [
          { callFrame: frame('buildCoverageCatalog', 'file:///x/assets/index-abc.js', 41), selfSize: 3_000_000, id: 2, children: [
            { callFrame: frame('JSON.stringify', ''), selfSize: 1_000_000, id: 3, children: [] },
          ] },
          { callFrame: frame('buildCoverageCatalog', 'file:///x/assets/index-abc.js', 41), selfSize: 1_000_000, id: 4, children: [] },
        ],
      },
      samples: [],
    }
    expect(summarizeSamplingHeapProfile(profile, { top: 5 })).toEqual({
      sampledBytes: 5_000_000,
      top: [
        { functionName: 'buildCoverageCatalog', file: 'index-abc.js', line: 42, selfBytes: 4_000_000, share: 0.8 },
        { functionName: 'JSON.stringify', file: '', line: 1, selfBytes: 1_000_000, share: 0.2 },
      ],
    })
  })
})

describe('runTimedProfile [DON-313]', () => {
  it('starts, waits, stops and returns the profile', async () => {
    const calls: string[] = []
    const send = async (method: string) => {
      calls.push(method)
      return method.endsWith('.stop') ? { profile: { nodes: [] } } : {}
    }
    const result = await runTimedProfile({ send, start: ['Profiler.enable', 'Profiler.start'], stop: 'Profiler.stop', durationMs: 5 })
    expect(calls).toEqual(['Profiler.enable', 'Profiler.start', 'Profiler.stop'])
    expect(result).toEqual({ ok: true, profile: { nodes: [] } })
  })

  it('stops early when asked, and reports a failure as unavailable rather than throwing', async () => {
    const early = new AbortController()
    const pending = runTimedProfile({
      send: async (method: string) => (method.endsWith('.stop') ? { profile: { nodes: [1] } } : {}),
      start: ['Profiler.start'], stop: 'Profiler.stop', durationMs: 60_000, signal: early.signal,
    })
    early.abort()
    await expect(pending).resolves.toEqual({ ok: true, profile: { nodes: [1] } })

    const failing = await runTimedProfile({
      send: async () => { throw new Error('inspector closed') },
      start: ['Profiler.start'], stop: 'Profiler.stop', durationMs: 5,
    })
    expect(failing).toEqual({ ok: false, reason: 'inspector closed' })
  })
})

describe('runTimedProfile after a failed start [DON-313]', () => {
  it('still sends a stop, so a start that succeeded late does not keep profiling (Codex)', async () => {
    const calls: string[] = []
    const result = await runTimedProfile({
      send: async (method: string) => {
        calls.push(method)
        if (method === 'Profiler.start') throw new Error('Profiler.start timed out')
        return {}
      },
      start: ['Profiler.enable', 'Profiler.start'], stop: 'Profiler.stop', durationMs: 5,
    })
    expect(result).toEqual({ ok: false, reason: 'Profiler.start timed out' })
    expect(calls).toEqual(['Profiler.enable', 'Profiler.start', 'Profiler.stop'])
  })

  it('sends the stop even when the start itself failed, and survives the stop failing too', async () => {
    const calls: string[] = []
    await runTimedProfile({
      send: async (method: string) => { calls.push(method); throw new Error('inspector closed') },
      start: ['Profiler.start'], stop: 'Profiler.stop', durationMs: 5,
    })
    expect(calls).toEqual(['Profiler.start', 'Profiler.stop'])
  })
})

describe('withDeadline [DON-313]', () => {
  it('passes a prompt result through and rejects a command that never answers', async () => {
    await expect(withDeadline(Promise.resolve(7), 50, 'HeapProfiler.enable')).resolves.toBe(7)
    await expect(withDeadline(new Promise(() => undefined), 20, 'HeapProfiler.stopSampling'))
      .rejects.toThrow('HeapProfiler.stopSampling timed out after 20 ms')
  })

  it('leaves no unhandled rejection when the command fails after its deadline', async () => {
    let fail: (error: Error) => void = () => undefined
    const late = new Promise((_, reject) => { fail = reject })
    await expect(withDeadline(late, 10, 'late')).rejects.toThrow('timed out')
    fail(new Error('target closed'))
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
})
