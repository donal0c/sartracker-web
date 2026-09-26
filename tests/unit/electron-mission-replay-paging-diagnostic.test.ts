import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const diagnostic = require('../../electron/mission-replay-paging-diagnostic.cjs') as {
  createReplayPagingChangedError(guard: string, expected: number, observed: number): Error
  readReplayPagingDiagnostic(error: unknown): unknown
  validateReplayPagingDiagnostic(value: unknown): unknown
  emitReplayPagingDiagnostic(value: unknown, options?: { enabled?: boolean; write?: (line: string) => void }): boolean
}

describe('closed replay paging diagnostics', () => {
  it('retains the original public error and keeps internal metadata out of serialization', () => {
    const error = diagnostic.createReplayPagingChangedError('generation', 1, 2)
    expect(error.message).toBe('Mission replay evidence changed while paging. Re-seek the selected time.')
    expect(JSON.stringify(error)).toBe('{}')
    expect(diagnostic.readReplayPagingDiagnostic(error)).toEqual({ guard: 'generation', expected: 1, observed: 2 })
    expect(diagnostic.readReplayPagingDiagnostic(new Error(error.message))).toBe(null)
  })

  it.each([
    null, [], { guard: 'private-path', expected: 1, observed: 2 },
    { guard: 'generation', expected: -1, observed: 2 },
    { guard: 'generation', expected: 1.2, observed: 2 },
    { guard: 'generation', expected: Infinity, observed: 2 },
    { guard: 'generation', expected: 1, observed: Number.MAX_SAFE_INTEGER + 1 },
    { guard: 'generation', expected: '1', observed: 2 },
    { guard: 'generation', expected: 1, observed: 1 },
    { guard: 'generation', expected: 1, observed: 2, missionId: 'private-canary' },
  ])('rejects invalid or extra metadata without printing it: %j', value => {
    const write = vi.fn()
    expect(diagnostic.validateReplayPagingDiagnostic(value)).toBe(null)
    expect(diagnostic.emitReplayPagingDiagnostic(value, { enabled: true, write })).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })

  it('is disabled by default and emits only the closed record when enabled', () => {
    const value = { guard: 'eligible-position-count', expected: 2, observed: 3 }
    const write = vi.fn()
    vi.stubEnv('SARTRACKER_REPLAY_PAGING_DIAGNOSTICS', undefined)
    try { expect(diagnostic.emitReplayPagingDiagnostic(value, { write })).toBe(false) }
    finally { vi.unstubAllEnvs() }
    expect(write).not.toHaveBeenCalled()
    expect(diagnostic.emitReplayPagingDiagnostic(value, { enabled: true, write })).toBe(true)
    expect(write).toHaveBeenCalledWith('sartracker-replay-paging-guard={"guard":"eligible-position-count","expected":2,"observed":3}\n')
  })

  it('never replaces the primary failure when diagnostic output fails', () => {
    expect(diagnostic.emitReplayPagingDiagnostic({ guard: 'generation', expected: 1, observed: 2 }, {
      enabled: true, write: () => { throw new Error('private write failure') },
    })).toBe(false)
  })
})
