import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { closeSync, openSync, readSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { evaluateArchiveSecurityProbe } from '../../scripts/qualification/archive-security-packaged-probe.mjs'
import { hashFile } from '../../scripts/qualification/archive-security-probe.cjs'
import { evaluateInvalidSender, normalizeIpcBridgeError } from '../../scripts/qualification/ipc-probe.mjs'
import {
  closeElectronApplication,
  combineProbeFailure,
  createReport,
} from '../../scripts/qualification/settings-probe.mjs'

const HEAD = 'a'.repeat(40)

describe('qualification packaged main-context probes', () => {
  it('initializes C16 session receipt state before the first lifecycle observation', () => {
    const report = createReport({ appPath: '/tmp/app', evidenceDir: '/tmp/evidence', expectedHead: HEAD, extraArgs: [] })
    expect(report.sessions).toEqual({})
  })

  it('loads the C21 controller through the packaged main-process module loader', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'sartracker-c21-main-context-'))
    const probePath = path.join(temporary, 'probe.cjs')
    await writeFile(probePath, 'module.exports = { runArchiveSecurityProbe: async input => ({ loaded: true, input }) }\n')
    try {
      const result = await evaluateArchiveSecurityProbe(
        { app: { getAppPath: () => process.cwd() } },
        { controllerProbePath: probePath, sourceSha: HEAD },
      )
      expect(result).toEqual({ loaded: true, input: { moduleRoot: process.cwd(), tier: 'packaged-module', sourceSha: HEAD } })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('hashes the supplied file through the raw filesystem boundary', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'sartracker-c21-hash-'))
    const filePath = path.join(temporary, 'payload.asar')
    const bytes = Buffer.from('C21 raw package bytes', 'utf8')
    await writeFile(filePath, bytes)
    const calls: string[] = []
    const rawFs = {
      openSync: (...args: Parameters<typeof openSync>) => {
        calls.push('openSync')
        return openSync(...args)
      },
      readSync: (...args: Parameters<typeof readSync>) => {
        calls.push('readSync')
        return readSync(...args)
      },
      closeSync: (...args: Parameters<typeof closeSync>) => {
        calls.push('closeSync')
        return closeSync(...args)
      },
    }
    try {
      expect(hashFile(filePath, rawFs)).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(calls).toContain('openSync')
      expect(calls).toContain('readSync')
      expect(calls).toContain('closeSync')
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })

  it('builds the C23 preload path with main-process builtins', async () => {
    const calls: { preload?: string; destroyed: boolean } = { destroyed: false }
    const child = {
      loadURL: async () => undefined,
      webContents: {
        executeJavaScript: async () => ({ attempted: true, blocked: true, error: 'blocked' }),
      },
      destroy: () => { calls.destroyed = true },
    }
    class FakeBrowserWindow {
      constructor(options: { webPreferences?: { preload?: string } }) {
        calls.preload = options.webPreferences?.preload
        return child
      }
    }
    const result = await evaluateInvalidSender({
      BrowserWindow: FakeBrowserWindow,
      app: { getAppPath: () => '/tmp/app.asar' },
    })
    expect(result).toMatchObject({ attempted: true, blocked: true })
    expect(calls.preload).toBe('/tmp/app.asar/electron/preload.cjs')
    expect(calls.destroyed).toBe(true)
  })

  it('retains the privileged payload error after Electron IPC serialization', () => {
    expect(normalizeIpcBridgeError(
      "Error invoking remote method 'sartracker:write-tracking-cache': Error: Tracking cache contents must be a string.",
    )).toBe('Tracking cache contents must be a string.')
    expect(normalizeIpcBridgeError('unrelated error')).toBe('unrelated error')
  })

  it('kills an unattached Electron process when close hangs after firstWindow failure', async () => {
    let killed = false
    const process = {
      exitCode: null,
      signalCode: null,
      killed: false,
      kill: () => { killed = true },
    }
    const app = {
      close: () => new Promise<void>(() => {}),
      process: () => process,
    }

    await expect(closeElectronApplication(app, 1)).rejects.toThrow(/cleanup|deadline|exit/i)

    expect(killed).toBe(true)
  })

  it('fails closed when SIGTERM does not produce an observed child exit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      const kills: string[] = []
      const child = {
        exitCode: null,
        signalCode: null,
        killed: false,
        kill: (signal: string) => { kills.push(signal) },
      }
      const app = {
        close: () => new Promise<void>(() => {}),
        process: () => child,
      }
      const closing = closeElectronApplication(app, 1)
      const failure = expect(closing).rejects.toThrow(/cleanup|deadline|exit/i)
      await vi.runAllTimersAsync()

      await failure
      expect(kills).toEqual(['SIGTERM', 'SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the original probe failure as the aggregate cause when cleanup also fails', () => {
    const launchError = new Error('firstWindow timeout')
    const cleanupError = new Error('owned Electron child did not exit')
    const combined = combineProbeFailure(launchError, cleanupError)

    expect(combined).toBeInstanceOf(AggregateError)
    expect(combined.cause).toBe(launchError)
    expect(combined.errors).toEqual([launchError, cleanupError])
  })
})
