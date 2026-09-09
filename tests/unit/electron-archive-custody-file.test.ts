import {
  linkSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  ArchiveCustodyFileError,
  inspectArchiveCustodyFile,
  withPinnedCustodyFileIdentity,
} = require('../../electron/archive-custody-file.cjs') as ArchiveCustodyFileModule

type CustodyIdentity = Readonly<{
  changedTimeNanoseconds: string
  device: string
  inode: string
  linkCount: number
  modifiedTimeNanoseconds: string
  sizeBytes: number
}>

type ArchiveCustodyFileModule = {
  readonly ArchiveCustodyFileError: new (...args: readonly unknown[]) => Error & {
    readonly code: string
  }
  readonly inspectArchiveCustodyFile: (input: {
    readonly archiveDirectory: string
    readonly archiveRelativePath: string
    readonly cancellationFlag?: Int32Array
    readonly onChunk?: (completedBytes: number) => void
  }) => {
    readonly ciphertextSha256: string
    readonly fileIdentity: CustodyIdentity
    readonly sizeBytes: number
  }
  readonly withPinnedCustodyFileIdentity: <T>(input: {
    readonly archiveDirectory: string
    readonly archiveRelativePath: string
    readonly expectedFileIdentity: CustodyIdentity
  }, callback: () => T) => T
}

const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates one permission-restricted archive custody fixture. */
function createFixture() {
  const archiveDirectory = mkdtempSync(path.join(tmpdir(), 'sartracker-custody-file-'))
  temporaryDirectories.add(archiveDirectory)
  const archiveRelativePath = '22222222-2222-4222-8222-222222222222-42.sararch'
  const archivePath = path.join(archiveDirectory, archiveRelativePath)
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 0x5a)
  writeFileSync(archivePath, bytes, { mode: 0o600 })
  return { archiveDirectory, archiveRelativePath, archivePath, bytes }
}

describe('archive custody pinned-file identity', () => {
  it('hashes every byte and returns a closed filesystem identity for commit-time pinning', () => {
    const fixture = createFixture()
    const observed = inspectArchiveCustodyFile(fixture)

    expect(observed).toMatchObject({
      sizeBytes: fixture.bytes.byteLength,
      ciphertextSha256: createHash('sha256').update(fixture.bytes).digest('hex'),
      fileIdentity: {
        sizeBytes: fixture.bytes.byteLength,
        linkCount: 1,
        device: expect.stringMatching(/^\d+$/u),
        inode: expect.stringMatching(/^\d+$/u),
        modifiedTimeNanoseconds: expect.stringMatching(/^\d+$/u),
        changedTimeNanoseconds: expect.stringMatching(/^\d+$/u),
      },
    })
    expect(Object.isFrozen(observed)).toBe(true)
    expect(withPinnedCustodyFileIdentity({
      ...fixture,
      expectedFileIdentity: observed.fileIdentity,
    }, () => 'committed')).toBe('committed')
  })

  it('rejects links and a same-size replacement before the commit callback runs', () => {
    const fixture = createFixture()
    const observed = inspectArchiveCustodyFile(fixture)
    const replacementPath = path.join(fixture.archiveDirectory, 'replacement.tmp')
    writeFileSync(replacementPath, Buffer.alloc(fixture.bytes.byteLength, 0x42), { mode: 0o600 })
    renameSync(replacementPath, fixture.archivePath)
    let callbackRan = false

    expect(() => withPinnedCustodyFileIdentity({
      ...fixture,
      expectedFileIdentity: observed.fileIdentity,
    }, () => { callbackRan = true })).toThrowError(expect.objectContaining({
      code: 'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
    }))
    expect(callbackRan).toBe(false)

    const symlinkPath = path.join(fixture.archiveDirectory, 'linked.sararch')
    symlinkSync(fixture.archivePath, symlinkPath)
    expect(() => inspectArchiveCustodyFile({
      archiveDirectory: fixture.archiveDirectory,
      archiveRelativePath: 'linked.sararch',
    })).toThrow(ArchiveCustodyFileError)

    const hardlinkPath = path.join(fixture.archiveDirectory, 'hardlinked.sararch')
    linkSync(fixture.archivePath, hardlinkPath)
    expect(() => inspectArchiveCustodyFile(fixture)).toThrowError(expect.objectContaining({
      code: 'ARCHIVE_CUSTODY_NOT_REGULAR',
    }))
  })

  it('detects replacement during hashing and honours bounded cancellation', () => {
    const fixture = createFixture()
    let replaced = false
    expect(() => inspectArchiveCustodyFile({
      ...fixture,
      onChunk: (completedBytes) => {
        if (replaced || completedBytes < 1024 * 1024) return
        replaced = true
        const replacementPath = path.join(fixture.archiveDirectory, 'during-read.tmp')
        writeFileSync(replacementPath, Buffer.alloc(fixture.bytes.byteLength, 0x31), {
          mode: 0o600,
        })
        renameSync(replacementPath, fixture.archivePath)
      },
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_CUSTODY_IDENTITY_CHANGED' }))

    const cancellationFlag = new Int32Array(new SharedArrayBuffer(4))
    Atomics.store(cancellationFlag, 0, 1)
    expect(() => inspectArchiveCustodyFile({
      ...createFixture(),
      cancellationFlag,
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_CUSTODY_CANCELLED' }))
  })
})
