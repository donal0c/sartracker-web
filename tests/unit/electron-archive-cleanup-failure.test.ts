import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  cleanupCauseClassForCode,
  cleanupCauseClassForError,
  decodeCleanupFailureDiagnosticToken,
  encodeCleanupFailureDiagnosticToken,
  readCleanupFailureDiagnosticFromMessage,
} = require('../../electron/archive-cleanup-failure.cjs') as {
  readonly cleanupCauseClassForCode: (code: unknown) => string
  readonly cleanupCauseClassForError: (error: unknown) => string
  readonly decodeCleanupFailureDiagnosticToken: (token: unknown) => unknown
  readonly encodeCleanupFailureDiagnosticToken: (diagnostic: unknown) => string
  readonly readCleanupFailureDiagnosticFromMessage: (message: unknown) => unknown
}

const diagnostic = Object.freeze({
  substage: 'delete_page',
  causeClass: 'sqlite_busy',
  tableName: 'positions',
  cursor: Object.freeze({
    tableIndex: 1,
    tableCount: 49,
    tableBatch: 2,
    deletedRows: 512,
    totalDeletedRows: 1_024,
  }),
  workerExit: Object.freeze({ observed: true, event: 'message', code: 0 }),
})

describe('archive cleanup failure diagnostic codec [DON-253]', () => {
  it('round-trips only the canonical bounded non-secret diagnostic', () => {
    const token = encodeCleanupFailureDiagnosticToken(diagnostic)

    expect(token).toMatch(/^SARCD1\.[A-Za-z0-9_-]+$/u)
    expect(Buffer.byteLength(token, 'utf8')).toBeLessThanOrEqual(512)
    expect(decodeCleanupFailureDiagnosticToken(token)).toEqual(diagnostic)
    expect(readCleanupFailureDiagnosticFromMessage(
      `Error invoking remote method: Mission archive operation failed safely [${token}] `
      + '(ARCHIVE_CLEANUP_FAILED).',
    )).toEqual(diagnostic)
    expect(readCleanupFailureDiagnosticFromMessage(
      `page.evaluate: Error invoking remote method: Mission archive operation failed safely `
      + `[${token}] (ARCHIVE_CLEANUP_FAILED).\n    at evaluate (:291:30)`,
    )).toEqual(diagnostic)
    expect(token).not.toMatch(/private|secret|mission\.sqlite/iu)
  })

  it('fails closed for malformed, oversized, unknown, or noncanonical tokens', () => {
    const encodeRaw = (value: unknown) => `SARCD1.${Buffer.from(
      JSON.stringify(value),
      'utf8',
    ).toString('base64url')}`
    const wire = [
      diagnostic.substage,
      diagnostic.causeClass,
      diagnostic.tableName,
      [1, 49, 2, 512, 1_024],
      [true, 'message', 0],
    ]
    const invalid = [
      null,
      '',
      'SARCD1.!',
      `SARCD1.${'a'.repeat(513)}`,
      encodeRaw(['private_path', ...wire.slice(1)]),
      encodeRaw([wire[0], 'secret_failure', ...wire.slice(2)]),
      encodeRaw([...wire, 'extra']),
      encodeRaw([wire[0], wire[1], wire[2], [1, 49, 2, 512, 1], wire[4]]),
      encodeRaw([wire[0], wire[1], wire[2], wire[3], [true, 'private', 0]]),
      encodeRaw([wire[1], wire[0], wire[2], wire[3], wire[4]]),
    ]

    for (const token of invalid) {
      expect(decodeCleanupFailureDiagnosticToken(token)).toBeNull()
    }
    expect(readCleanupFailureDiagnosticFromMessage(
      'Mission archive operation failed safely (ARCHIVE_CLEANUP_FAILED).',
    )).toBeNull()
    expect(readCleanupFailureDiagnosticFromMessage(
      `page.evaluate: unrelated failure\nMission archive operation failed safely [${encodeRaw(wire)}] `
      + '(ARCHIVE_CLEANUP_FAILED).',
    )).toBeNull()
  })

  it('normalizes hostile diagnostic fields before encoding them', () => {
    const token = encodeCleanupFailureDiagnosticToken({
      substage: 'unknown-stage',
      causeClass: 'unknown-cause',
      tableName: '/Users/private/mission.sqlite',
      cursor: { deletedRows: Number.POSITIVE_INFINITY },
      workerExit: { observed: true, event: 'unknown', code: -1 },
      secret: 'must-not-cross',
    })

    expect(decodeCleanupFailureDiagnosticToken(token)).toEqual({
      substage: 'worker_protocol',
      causeClass: 'internal_failure',
      tableName: null,
      cursor: null,
      workerExit: { observed: true, event: 'none', code: null },
    })
    expect(token).not.toContain('must-not-cross')
  })

  it('accepts table identities only from the authoritative archive inventory', () => {
    expect(decodeCleanupFailureDiagnosticToken(encodeCleanupFailureDiagnosticToken({
      ...diagnostic,
      tableName: 'OperatorRecoveryPhrase2026',
    }))).toMatchObject({ tableName: null })
    expect(decodeCleanupFailureDiagnosticToken(encodeCleanupFailureDiagnosticToken({
      ...diagnostic,
      tableName: 'positions',
    }))).toMatchObject({ tableName: 'positions' })
  })

  it('classifies every retryable SQLite busy-family code consistently', () => {
    expect(cleanupCauseClassForCode('SQLITE_BUSY')).toBe('sqlite_busy')
    expect(cleanupCauseClassForCode('SQLITE_BUSY_SNAPSHOT')).toBe('sqlite_busy')
    expect(cleanupCauseClassForCode('SQLITE_BUSY_RECOVERY')).toBe('sqlite_busy')
  })

  it('retains a bounded nested SQLite cause hidden by a stable public wrapper', () => {
    const sqliteCause = Object.assign(new Error('private database detail'), {
      code: 'SQLITE_BUSY_SNAPSHOT',
      path: '/Users/private/mission-store.sqlite',
    })
    const membershipFailure = Object.assign(new Error('stable membership failure'), {
      code: 'ARCHIVE_CLEANUP_MEMBERSHIP_BYPASS_ACTIVE',
      cause: sqliteCause,
    })
    const publicFailure = Object.assign(new Error('stable cleanup failure'), {
      code: 'ARCHIVE_CLEANUP_FAILED',
      cause: membershipFailure,
    })

    expect(cleanupCauseClassForError(publicFailure)).toBe('sqlite_busy')
    expect(cleanupCauseClassForError({
      code: 'ARCHIVE_CLEANUP_FAILED',
      cause: { code: 'PRIVATE_FAILURE', cause: { code: 'SQLITE_BUSY', cause: {} } },
    })).toBe('sqlite_busy')
    expect(cleanupCauseClassForError({
      code: 'ARCHIVE_CLEANUP_FAILED',
      cause: { code: 'PRIVATE_FAILURE', cause: { code: 'PRIVATE_FAILURE', cause: {
        code: 'PRIVATE_FAILURE', cause: { code: 'SQLITE_BUSY' },
      } } },
    })).toBe('internal_failure')
  })

  it('classifies hostile and cyclic cause objects without replacing the original failure', () => {
    const throwingCode = Object.create(null)
    Object.defineProperty(throwingCode, 'code', {
      get: () => { throw new Error('private getter failure') },
    })
    const throwingCause = Object.assign(Object.create(null), {
      code: 'ARCHIVE_CLEANUP_FAILED',
    })
    Object.defineProperty(throwingCause, 'cause', {
      get: () => { throw new Error('private cause failure') },
    })
    const cyclic: { code: string; cause?: unknown } = { code: 'ARCHIVE_CLEANUP_FAILED' }
    cyclic.cause = cyclic
    const revoked = Proxy.revocable({ code: 'SQLITE_BUSY' }, {})
    revoked.revoke()

    expect(cleanupCauseClassForError(throwingCode)).toBe('internal_failure')
    expect(cleanupCauseClassForError(throwingCause)).toBe('internal_failure')
    expect(cleanupCauseClassForError(cyclic)).toBe('internal_failure')
    expect(cleanupCauseClassForError(revoked.proxy)).toBe('internal_failure')
  })
})
