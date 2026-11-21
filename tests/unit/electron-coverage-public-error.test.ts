import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

import { classifyCoverageError, isCoverageCancellation } from '../../src/features/tracking/coverage-diagnostics'

/**
 * DON-338 round 3: a coverage RPC failure crosses IPC only as a fixed,
 * bounded public error. Raw detail (file paths from the tile cache, worker
 * text) stays in the main-process log, and the renderer classifies the
 * public error exactly as it classified the raw one.
 */

const require = createRequire(import.meta.url)
const { PUBLIC_COVERAGE_ERROR_MESSAGES, toPublicCoverageError } = require('../../electron/coverage-public-error.cjs') as {
  readonly PUBLIC_COVERAGE_ERROR_MESSAGES: readonly string[]
  readonly toPublicCoverageError: (error: unknown) => Error & { readonly code?: string }
}
const { registerCoverageIpcHandlers } = require('../../electron/coverage-ipc.cjs') as {
  readonly registerCoverageIpcHandlers: (input: Record<string, unknown>) => void
}

const HOSTILE_PATH = '/Users/volunteer/Library/Application Support/sar-tracker/coverage-tiles/mission-1/8/120/80.pbf'

/** Electron passes only the message across invoke; the name and code are lost. */
function acrossIpc(error: Error): Error {
  return new Error(`Error invoking remote method 'coverage': ${String(error)}`)
}

/** Builds the coverage IPC handlers over a store whose every method rejects with `failure`. */
function registerFailing(failure: unknown, onCoverageRpcFailure?: (error: unknown, context: unknown) => void) {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const reject = vi.fn(async () => { throw failure })
  registerCoverageIpcHandlers({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, handler) },
    readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
    activationChannels: { activate: 'activate', finalize: 'finalize', discard: 'discard' },
    tileChannels: { read: 'tile-read', cancel: 'tile-cancel' },
    cancelChannel: 'cancel',
    missionStore: {
      readCoverageManifest: reject, readCoverageChunk: reject, readCoverageClaim: reject,
      syncCoverageTileCatalog: reject, readCoverageTile: reject,
      cancelCoverageQuery: reject, cancelCoverageTileRead: reject,
    },
    ownerLifecycle: { subscribe: () => () => undefined },
    validateIpcSender: () => undefined,
    ...(onCoverageRpcFailure === undefined ? {} : { onCoverageRpcFailure }),
  })
  return handlers
}

const sender = Object.assign(new EventEmitter(), { id: 7 })

describe('DON-338: coverage RPC failures cross IPC as fixed public errors', () => {
  it('never sends a tile-cache file path to the renderer and logs it in main only', async () => {
    const hostile = new Error(`ENOENT: no such file or directory, open '${HOSTILE_PATH}'`)
    const onCoverageRpcFailure = vi.fn()
    const handlers = registerFailing(hostile, onCoverageRpcFailure)

    const rejection = await handlers.get('tile-read')?.({ sender }, { z: 8 }, 'tile-1').catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(Error)
    const message = (rejection as Error).message
    expect(message).not.toContain('/Users')
    expect(message).not.toContain('ENOENT')
    expect(PUBLIC_COVERAGE_ERROR_MESSAGES).toContain(message)
    expect(onCoverageRpcFailure).toHaveBeenCalledWith(hostile, { channel: 'tile-read' })
  })

  it('applies to every coverage channel', async () => {
    const hostile = new Error(`EACCES: permission denied, '${HOSTILE_PATH}'`)
    const handlers = registerFailing(hostile, () => undefined)
    const calls: readonly [string, readonly unknown[]][] = [
      ['manifest', ['mission-1', 'r-1']],
      ['chunk', [{}, 'r-2']],
      ['claim', [{}, 'r-3']],
      ['catalog', [{ missionId: 'mission-1', chunks: [] }, 'r-4']],
      ['tile-read', [{}, 'r-5']],
      ['tile-cancel', ['r-6']],
      ['cancel', ['r-7']],
    ]
    for (const [channel, args] of calls) {
      const rejection = await Promise.resolve(handlers.get(channel)?.({ sender }, ...args))
        .then(() => null, (error: unknown) => error as Error)
      expect(rejection?.message, channel).not.toContain('/Users')
      expect(PUBLIC_COVERAGE_ERROR_MESSAGES, channel).toContain(rejection?.message)
    }
  })

  it('keeps cancellation exactly: the name, and the prefix only where it was', () => {
    const prefixed = Object.assign(new Error(`coverage-cancelled: renderer gone at ${HOSTILE_PATH}`), { name: 'AbortError' })
    const named = Object.assign(new Error(`Coverage tile request was cancelled at ${HOSTILE_PATH}`), { name: 'AbortError' })
    for (const raw of [prefixed, named]) {
      const publicError = toPublicCoverageError(raw)
      expect(publicError.name).toBe('AbortError')
      expect(publicError.message).not.toContain('/Users')
      expect(isCoverageCancellation(publicError)).toBe(isCoverageCancellation(raw))
      expect(isCoverageCancellation(acrossIpc(publicError))).toBe(isCoverageCancellation(acrossIpc(raw)))
    }
    expect(toPublicCoverageError(prefixed).message.startsWith('coverage-cancelled:')).toBe(true)
    expect(toPublicCoverageError(named).message).not.toContain('coverage-cancelled:')
  })

  it('classifies in the renderer exactly as the raw error did', () => {
    const samples: readonly Error[] = [
      Object.assign(new Error('chunk-stale: coverage chunk revision changed'), { code: 'chunk-stale' }),
      Object.assign(new Error(`coverage-revision-moved: moved under ${HOSTILE_PATH}`), { code: 'coverage-revision-moved' }),
      new Error('Coverage tile worker timed out after 30000 ms.'),
      new Error('Coverage query worker timed out after 30000 ms.'),
      new Error(`Coverage tile worker failed: ENOSPC writing ${HOSTILE_PATH}`),
      new Error('Coverage tile worker is unavailable.'),
      new Error('Coverage tile worker exited with code 1.'),
      Object.assign(new Error('Worker ran out of memory'), { code: 'coverage-worker-out-of-memory' }),
      new Error('Mission store is not available.'),
      new Error('Coverage tile catalog stage is not owned by this renderer.'),
      new Error('Coverage tile catalog activation is no longer current.'),
      new Error('Coverage request ID is invalid.'),
      new Error(`SQLITE_CORRUPT: database disk image is malformed (${HOSTILE_PATH})`),
      new Error(`ENOENT: no such file or directory, open '${HOSTILE_PATH}'`),
    ]
    for (const raw of samples) {
      const publicError = toPublicCoverageError(raw)
      expect(publicError.message, raw.message).not.toContain('/Users')
      expect(publicError.message.length).toBeLessThanOrEqual(120)
      expect(PUBLIC_COVERAGE_ERROR_MESSAGES).toContain(publicError.message)
      expect(classifyCoverageError(acrossIpc(publicError)), raw.message)
        .toBe(classifyCoverageError(acrossIpc(raw)))
    }
  })

  it('turns a thrown non-error into the generic public failure', () => {
    expect(toPublicCoverageError(HOSTILE_PATH).message).toBe('Coverage request failed.')
    expect(toPublicCoverageError(null).message).toBe('Coverage request failed.')
  })
})
