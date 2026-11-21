import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

import {
  COVERAGE_RENDERER_FAILURE_CODES,
  parseCoverageRendererFailure,
} from '../../src/features/tracking/coverage-renderer-failure'

const require = createRequire(import.meta.url)
const CHANNEL = 'sartracker:coverage-renderer-failed'

type Projection = { projectCoverageRendererFailure: (error: unknown) => unknown; COVERAGE_RENDERER_FAILURE_CODES: readonly string[] }
const main = require('../../electron/coverage-renderer-failure.cjs') as Projection

/** Runs the real sandbox preload and returns its coverage-failure subscription plus the IPC listeners. */
function preloadHarness() {
  const preload = readFileSync('electron/preload.cjs', 'utf8')
  const listeners = new Map<string, (_event: unknown, payload?: unknown) => void>()
  let bridge: Readonly<Record<string, unknown>> | undefined
  runInNewContext(preload, {
    process: { platform: 'linux' },
    TextEncoder,
    require: (specifier: string) => {
      if (specifier !== 'electron') throw new Error(`Unexpected preload require: ${specifier}`)
      return {
        contextBridge: { exposeInMainWorld: (_name: string, value: Readonly<Record<string, unknown>>) => { bridge = value } },
        ipcRenderer: {
          invoke: vi.fn(), sendSync: vi.fn(() => ({ ok: true })), send: vi.fn(), removeListener: vi.fn(),
          on: vi.fn((channel: string, listener: (_event: unknown, payload?: unknown) => void) => listeners.set(channel, listener)),
        },
      }
    },
    window: { addEventListener: vi.fn() },
  })
  const subscribe = bridge?.onCoverageRendererFailed as (listener: (failure: unknown) => void) => () => void
  return { subscribe, listeners }
}

describe('DON-338: the tile-worker failure code crosses main → preload → renderer allow-listed', () => {
  it('main projects a worker error to one allow-listed code and nothing else', () => {
    const oom = Object.assign(new Error('Coverage tile worker failed: it ran out of memory at /home/someone/db'), {
      code: 'coverage-worker-out-of-memory',
    })
    expect(main.projectCoverageRendererFailure(oom)).toEqual({ code: 'coverage-worker-out-of-memory' })

    for (const other of [
      new Error('Coverage tile worker exited with code 1 at /home/someone/db'),
      Object.assign(new Error('x'), { code: 'ERR_SOMETHING_ELSE' }),
      undefined,
      'raw text',
    ]) {
      const projected = main.projectCoverageRendererFailure(other)
      expect(projected).toEqual({ code: 'coverage-worker-failed' })
      expect(JSON.stringify(projected)).not.toContain('/home')
    }
  })

  it('main, preload and renderer share one allow-list', () => {
    expect([...main.COVERAGE_RENDERER_FAILURE_CODES]).toEqual([...COVERAGE_RENDERER_FAILURE_CODES])
    const preload = readFileSync('electron/preload.cjs', 'utf8')
    for (const code of COVERAGE_RENDERER_FAILURE_CODES) expect(preload).toContain(`'${code}'`)
  })

  it('preload hands the renderer only an allow-listed code, whatever main sends', () => {
    const { subscribe, listeners } = preloadHarness()
    const received: unknown[] = []
    subscribe((failure) => received.push(failure))
    const handler = listeners.get(CHANNEL)
    expect(handler).toBeTypeOf('function')

    handler?.({}, { code: 'coverage-worker-out-of-memory' })
    handler?.({}, { code: 'coverage-worker-out-of-memory', message: '/home/someone/db', stack: 'x' })
    handler?.({}, { code: 'made-up-code' })
    handler?.({})
    handler?.({}, 'raw text')

    expect(received).toEqual([
      { code: 'coverage-worker-out-of-memory' },
      { code: 'coverage-worker-out-of-memory' },
      { code: 'coverage-worker-failed' },
      { code: 'coverage-worker-failed' },
      { code: 'coverage-worker-failed' },
    ])
  })

  it('the renderer re-checks the code it is given', () => {
    expect(parseCoverageRendererFailure({ code: 'coverage-worker-out-of-memory' })).toEqual({ code: 'coverage-worker-out-of-memory' })
    expect(parseCoverageRendererFailure({ code: 'other' })).toEqual({ code: 'coverage-worker-failed' })
    expect(parseCoverageRendererFailure(null)).toEqual({ code: 'coverage-worker-failed' })
  })

  it('mission store and main forward the projected failure, not a bare signal', () => {
    const missionStore = readFileSync('electron/mission-store.cjs', 'utf8')
    expect(missionStore).toContain(
      'onFailure: (error) => options.onCoverageRendererFailed?.(projectCoverageRendererFailure(error))',
    )
    const mainSource = readFileSync('electron/main.cjs', 'utf8')
    expect(mainSource).toMatch(
      /onCoverageRendererFailed: \(failure\) => \{[\s\S]{0,300}send\(COVERAGE_RENDERER_FAILED_CHANNEL, projectCoverageRendererFailure\(failure\)\)/u,
    )
  })
})
