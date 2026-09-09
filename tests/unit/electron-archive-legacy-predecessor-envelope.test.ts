import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  normalizeArchiveLegacyPredecessorResult,
  normalizeArchiveLegacyPredecessorTicket,
} = require('../../electron/archive-legacy-predecessor-envelope.cjs') as {
  readonly normalizeArchiveLegacyPredecessorResult: (
    input: Readonly<Record<string, unknown>>,
    expected: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>
  readonly normalizeArchiveLegacyPredecessorTicket: (
    input: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>
}

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const archiveId = `legacy-v1-${'b'.repeat(64)}`

/** Creates one exact registry-derived legacy-predecessor ticket. */
function ticket(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId,
    archiveId,
    missionId: 'mission-legacy-predecessor',
    archiveDirectory: path.resolve('/tmp/sartracker-legacy-predecessor/archives'),
    archiveRelativePath: 'mission-legacy-predecessor.zip',
    expectedFileIdentity: {
      changedTimeNanoseconds: '200',
      device: '1',
      inode: '2',
      linkCount: 1,
      modifiedTimeNanoseconds: '100',
      sizeBytes: 4_096,
    },
    ...overrides,
  }
}

/** Creates one exact identity-bound worker terminal result. */
function result(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    type: 'complete',
    operationId,
    archiveId,
    missionId: 'mission-legacy-predecessor',
    archiveRelativePath: 'mission-legacy-predecessor.zip',
    sha256: 'c'.repeat(64),
    sizeBytes: 4_096,
    fileIdentity: {
      changedTimeNanoseconds: '200',
      device: '1',
      inode: '2',
      linkCount: 1,
      modifiedTimeNanoseconds: '100',
      sizeBytes: 4_096,
    },
    ...overrides,
  }
}

describe('legacy archive predecessor worker envelopes', () => {
  it('accepts only a canonical custody path and a deterministic legacy archive identity', () => {
    expect(normalizeArchiveLegacyPredecessorTicket(ticket())).toEqual(ticket())

    for (const invalid of [
      ticket({ archiveId: 'legacy-v1-archive' }),
      ticket({ archiveRelativePath: '../mission.zip' }),
      ticket({ archiveRelativePath: '/tmp/mission.zip' }),
      ticket({ archiveRelativePath: 'nested\\mission.zip' }),
      { ...ticket(), extra: true },
    ]) {
      expect(() => normalizeArchiveLegacyPredecessorTicket(invalid)).toThrowError(
        expect.objectContaining({ code: 'ARCHIVE_LEGACY_PREDECESSOR_ENVELOPE_INVALID' }),
      )
    }
  })

  it('binds the terminal digest and every filesystem identity field to the issued ticket', () => {
    const normalized = normalizeArchiveLegacyPredecessorResult(result(), ticket())
    expect(normalized).toEqual(result())
    expect(Object.isFrozen(normalized)).toBe(true)

    for (const substituted of [
      result({ archiveId: `legacy-v1-${'d'.repeat(64)}` }),
      result({ sha256: 'not-a-digest' }),
      result({ sizeBytes: 4_095 }),
      result({
        fileIdentity: {
          ...(result().fileIdentity as Readonly<Record<string, unknown>>),
          inode: '99',
        },
      }),
      { ...result(), unissued: true },
    ]) {
      expect(() => normalizeArchiveLegacyPredecessorResult(substituted, ticket()))
        .toThrowError(expect.objectContaining({
          code: 'ARCHIVE_LEGACY_PREDECESSOR_ENVELOPE_INVALID',
        }))
    }
  })
})
