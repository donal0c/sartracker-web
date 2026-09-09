import { createHash } from 'node:crypto'
import {
  linkSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { readArchiveCustodyFileIdentity } = require(
  '../../electron/archive-custody-file.cjs',
) as {
  readonly readArchiveCustodyFileIdentity: (input: {
    readonly archiveDirectory: string
    readonly archiveRelativePath: string
  }) => CustodyIdentity
}
const {
  hashArchiveLegacyPredecessor,
  mapFailureCode,
} = require('../../electron/archive-legacy-predecessor-worker.cjs') as {
  readonly hashArchiveLegacyPredecessor: (input: {
    readonly ticket: Readonly<Record<string, unknown>>
    readonly cancellationFlag: Int32Array
    readonly onProgress: (completedBytes: number, totalBytes: number) => void
  }) => Readonly<Record<string, unknown>>
  readonly mapFailureCode: (error: Readonly<{ code?: string }>) => string
}

type CustodyIdentity = Readonly<{
  changedTimeNanoseconds: string
  device: string
  inode: string
  linkCount: number
  modifiedTimeNanoseconds: string
  sizeBytes: number
}>

const temporaryDirectories = new Set<string>()
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const archiveId = `legacy-v1-${'b'.repeat(64)}`

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates one permission-restricted legacy archive and its registry identity. */
function createFixture(sizeBytes = 3 * 1024 * 1024 + 37) {
  const archiveDirectory = mkdtempSync(path.join(tmpdir(), 'sartracker-legacy-hash-'))
  temporaryDirectories.add(archiveDirectory)
  const archiveRelativePath = 'mission-legacy-predecessor.zip'
  const archivePath = path.join(archiveDirectory, archiveRelativePath)
  const bytes = Buffer.alloc(sizeBytes, 0x5a)
  bytes.set(Buffer.from('full-byte-tail-proof'), sizeBytes - 20)
  writeFileSync(archivePath, bytes, { mode: 0o600 })
  const expectedFileIdentity = readArchiveCustodyFileIdentity({
    archiveDirectory,
    archiveRelativePath,
  })
  return { archiveDirectory, archiveRelativePath, archivePath, bytes, expectedFileIdentity }
}

/** Creates one exact legacy-predecessor hash ticket. */
function ticket(fixture: ReturnType<typeof createFixture>, overrides = {}) {
  return {
    operationId,
    archiveId,
    missionId: 'mission-legacy-predecessor',
    archiveDirectory: fixture.archiveDirectory,
    archiveRelativePath: fixture.archiveRelativePath,
    expectedFileIdentity: fixture.expectedFileIdentity,
    ...overrides,
  }
}

/** Creates one clear cooperative cancellation flag. */
function cancellationFlag() {
  return new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
}

describe('legacy archive predecessor hash worker', () => {
  it('hashes every byte of the exact pinned predecessor and returns its closed identity', () => {
    const fixture = createFixture()
    const progress: Array<readonly [number, number]> = []
    const proof = hashArchiveLegacyPredecessor({
      ticket: ticket(fixture),
      cancellationFlag: cancellationFlag(),
      onProgress: (completed, total) => progress.push([completed, total]),
    })

    expect(proof).toEqual({
      type: 'complete',
      operationId,
      archiveId,
      missionId: 'mission-legacy-predecessor',
      archiveRelativePath: fixture.archiveRelativePath,
      sha256: createHash('sha256').update(fixture.bytes).digest('hex'),
      sizeBytes: fixture.bytes.byteLength,
      fileIdentity: fixture.expectedFileIdentity,
    })
    expect(progress.at(-1)).toEqual([fixture.bytes.byteLength, fixture.bytes.byteLength])
  })

  it('rejects a stale registry identity and a same-size replacement during hashing', () => {
    const staleFixture = createFixture()
    const replacement = path.join(staleFixture.archiveDirectory, 'replacement.tmp')
    writeFileSync(replacement, Buffer.alloc(staleFixture.bytes.byteLength, 0x42), { mode: 0o600 })
    renameSync(replacement, staleFixture.archivePath)
    expect(() => hashArchiveLegacyPredecessor({
      ticket: ticket(staleFixture),
      cancellationFlag: cancellationFlag(),
      onProgress: () => undefined,
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_LEGACY_PREDECESSOR_CHANGED' }))

    const liveFixture = createFixture()
    let replaced = false
    expect(() => hashArchiveLegacyPredecessor({
      ticket: ticket(liveFixture),
      cancellationFlag: cancellationFlag(),
      onProgress: (completed) => {
        if (replaced || completed < 1024 * 1024) return
        replaced = true
        const changed = path.join(liveFixture.archiveDirectory, 'changed.tmp')
        writeFileSync(changed, Buffer.alloc(liveFixture.bytes.byteLength, 0x31), { mode: 0o600 })
        renameSync(changed, liveFixture.archivePath)
      },
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_CUSTODY_IDENTITY_CHANGED' }))
  })

  it('fails closed for missing, linked, and cooperatively cancelled predecessors', () => {
    const missing = createFixture()
    unlinkSync(missing.archivePath)
    expect(() => hashArchiveLegacyPredecessor({
      ticket: ticket(missing),
      cancellationFlag: cancellationFlag(),
      onProgress: () => undefined,
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_CUSTODY_MISSING' }))

    const symlinked = createFixture()
    const targetPath = path.join(symlinked.archiveDirectory, 'target.zip')
    renameSync(symlinked.archivePath, targetPath)
    symlinkSync(targetPath, symlinked.archivePath)
    expect(() => hashArchiveLegacyPredecessor({
      ticket: ticket(symlinked),
      cancellationFlag: cancellationFlag(),
      onProgress: () => undefined,
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_CUSTODY_NOT_REGULAR' }))

    const hardlinked = createFixture()
    linkSync(hardlinked.archivePath, path.join(hardlinked.archiveDirectory, 'second-link.zip'))
    expect(() => hashArchiveLegacyPredecessor({
      ticket: ticket(hardlinked),
      cancellationFlag: cancellationFlag(),
      onProgress: () => undefined,
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_CUSTODY_NOT_REGULAR' }))

    const cancelled = createFixture()
    const flag = cancellationFlag()
    Atomics.store(flag, 0, 1)
    expect(() => hashArchiveLegacyPredecessor({
      ticket: ticket(cancelled),
      cancellationFlag: flag,
      onProgress: () => undefined,
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_CUSTODY_CANCELLED' }))
  })

  it('maps worker failures to the closed legacy-predecessor vocabulary', () => {
    expect(mapFailureCode({ code: 'ARCHIVE_CUSTODY_MISSING' }))
      .toBe('ARCHIVE_LEGACY_PREDECESSOR_MISSING')
    for (const code of ['ARCHIVE_CUSTODY_NOT_REGULAR', 'ARCHIVE_CUSTODY_INVALID_PATH']) {
      expect(mapFailureCode({ code })).toBe('ARCHIVE_LEGACY_PREDECESSOR_UNSAFE')
    }
    for (const code of [
      'ARCHIVE_LEGACY_PREDECESSOR_CHANGED',
      'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
    ]) {
      expect(mapFailureCode({ code })).toBe('ARCHIVE_LEGACY_PREDECESSOR_CHANGED')
    }
    expect(mapFailureCode({ code: 'ARCHIVE_CUSTODY_CANCELLED' })).toBe('ARCHIVE_CANCELLED')
    expect(mapFailureCode({ code: 'UNREFLECTED_PRIVATE_FAILURE' }))
      .toBe('ARCHIVE_LEGACY_PREDECESSOR_FAILED')
  })
})
