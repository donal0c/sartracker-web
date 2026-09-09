import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type SweepTicket = Readonly<{
  operationId: string
  reviewRoot: string
  rootIdentity: Readonly<{ dev: number; ino: number }>
  quarantineDirectory: string
  quarantineIdentity: Readonly<{ dev: number; ino: number }>
  archiveDirectory: string
  archiveDirectoryIdentity: Readonly<{ dev: number; ino: number; realPath: string }>
}>

type SweepResult = Readonly<{
  status: 'clean'
  removedEntryCount: number
}>

const {
  mapFailureCode,
  normalizeTicket,
  sweepArchiveReviewQuarantine,
} = require('../../electron/archive-review-sweep-worker.cjs') as {
  readonly mapFailureCode: (error: unknown) => string
  readonly normalizeTicket: (ticket: unknown) => SweepTicket
  readonly sweepArchiveReviewQuarantine: (input: {
    readonly ticket: SweepTicket
    readonly cancellationFlag: Int32Array
    readonly onProgress: (removedEntryCount: number) => void
  }) => SweepResult
}

const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const temporaryRoots = new Set<string>()

/** Creates real custody-separated paths plus their exact inode ticket. */
function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sartracker-review-sweep-worker-'))
  temporaryRoots.add(root)
  const reviewRoot = path.join(root, 'review')
  const archiveDirectory = path.join(root, 'archives')
  const quarantineDirectory = path.join(reviewRoot, `.sweep-${SESSION_ID}`)
  mkdirSync(quarantineDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(archiveDirectory, { mode: 0o700 })
  const reviewStat = lstatSync(reviewRoot)
  const quarantineStat = lstatSync(quarantineDirectory)
  const archiveStat = lstatSync(archiveDirectory)
  const ticket = {
    operationId: OPERATION_ID,
    reviewRoot,
    rootIdentity: { dev: reviewStat.dev, ino: reviewStat.ino },
    quarantineDirectory,
    quarantineIdentity: { dev: quarantineStat.dev, ino: quarantineStat.ino },
    archiveDirectory,
    archiveDirectoryIdentity: {
      dev: archiveStat.dev,
      ino: archiveStat.ino,
      realPath: realpathSync(archiveDirectory),
    },
  }
  return { root, reviewRoot, archiveDirectory, quarantineDirectory, ticket }
}

/** Runs the pure worker function with one fresh shared cancellation flag. */
function sweep(ticket: SweepTicket, onProgress: (removedEntryCount: number) => void = () => undefined) {
  return sweepArchiveReviewQuarantine({
    ticket,
    cancellationFlag: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    onProgress,
  })
}

/** Captures one expected synchronous worker failure for exact-code assertions. */
function captureFailure(action: () => unknown) {
  try {
    action()
  } catch (error) {
    return error as Error & { readonly code?: string }
  }
  throw new Error('Expected archive review sweep to fail.')
}

afterEach(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true })
  temporaryRoots.clear()
})

describe('archive review plaintext sweep worker', () => {
  it('accepts only an exact closed ticket and exact inode identities', () => {
    const fixture = createFixture()

    expect(normalizeTicket(fixture.ticket)).toEqual(fixture.ticket)
    expect(() => normalizeTicket({ ...fixture.ticket, reflectedPath: fixture.root }))
      .toThrow(/ticket|invalid/iu)
    expect(() => normalizeTicket({
      ...fixture.ticket,
      quarantineIdentity: { ...fixture.ticket.quarantineIdentity, mode: 0o700 },
    })).toThrow(/identity|invalid/iu)
    expect(() => normalizeTicket({
      ...fixture.ticket,
      quarantineDirectory: path.join(fixture.root, `.sweep-${SESSION_ID}`),
    })).toThrow(/scope|invalid/iu)
  })

  it('sweeps a large traversal with strictly increasing progress', () => {
    const fixture = createFixture()
    for (let index = 0; index < 5_000; index += 1) {
      writeFileSync(
        path.join(fixture.quarantineDirectory, `entry-${index.toString().padStart(5, '0')}.json`),
        `plaintext-${index}`,
      )
    }
    const progress: number[] = []

    const result = sweep(fixture.ticket, (removedEntryCount) => progress.push(removedEntryCount))

    expect(result).toEqual({ status: 'clean', removedEntryCount: 5_001 })
    expect(progress.at(-1)).toBe(5_001)
    expect(progress.every((value, index) => index === 0 || value > progress[index - 1]!)).toBe(true)
    expect(existsSync(fixture.quarantineDirectory)).toBe(false)
  }, 30_000)

  it('unlinks symlinks without following or changing their external targets', () => {
    const fixture = createFixture()
    const outsideDirectory = path.join(fixture.root, 'outside')
    const outsideFile = path.join(outsideDirectory, 'preserve.txt')
    mkdirSync(outsideDirectory)
    writeFileSync(outsideFile, 'must survive')
    symlinkSync(outsideDirectory, path.join(fixture.quarantineDirectory, 'outside-link'))

    const result = sweep(fixture.ticket)

    expect(result).toEqual({ status: 'clean', removedEntryCount: 2 })
    expect(readFileSync(outsideFile, 'utf8')).toBe('must survive')
    expect(existsSync(outsideDirectory)).toBe(true)
    expect(existsSync(fixture.quarantineDirectory)).toBe(false)
  })

  it('refuses hard-linked plaintext and leaves every linked byte intact', () => {
    const fixture = createFixture()
    const outsideFile = path.join(fixture.root, 'outside-plaintext')
    const linkedFile = path.join(fixture.quarantineDirectory, 'linked-plaintext')
    writeFileSync(outsideFile, 'must survive')
    linkSync(outsideFile, linkedFile)

    expect(captureFailure(() => sweep(fixture.ticket))).toMatchObject({
      code: 'ARCHIVE_REVIEW_SWEEP_ENTRY_UNSAFE',
    })
    expect(readFileSync(outsideFile, 'utf8')).toBe('must survive')
    expect(readFileSync(linkedFile, 'utf8')).toBe('must survive')
    expect(existsSync(fixture.quarantineDirectory)).toBe(true)
  })

  it('refuses ciphertext-shaped top-level entries without deleting them', () => {
    for (const ciphertextName of ['mission.sararch', 'legacy.ZIP']) {
      const fixture = createFixture()
      const ciphertextPath = path.join(fixture.quarantineDirectory, ciphertextName)
      writeFileSync(ciphertextPath, 'sealed bytes')

      expect(captureFailure(() => sweep(fixture.ticket))).toMatchObject({
        code: 'ARCHIVE_REVIEW_SWEEP_CIPHERTEXT_BOUNDARY',
      })
      expect(readFileSync(ciphertextPath, 'utf8')).toBe('sealed bytes')
      expect(existsSync(fixture.quarantineDirectory)).toBe(true)
    }
  })

  it('refuses a substituted quarantine inode without traversing either tree', () => {
    const fixture = createFixture()
    const displaced = path.join(fixture.reviewRoot, 'displaced-session')
    writeFileSync(path.join(fixture.quarantineDirectory, 'original.txt'), 'original')
    renameSync(fixture.quarantineDirectory, displaced)
    mkdirSync(fixture.quarantineDirectory, { mode: 0o700 })
    writeFileSync(path.join(fixture.quarantineDirectory, 'substitute.txt'), 'substitute')

    expect(captureFailure(() => sweep(fixture.ticket))).toMatchObject({
      code: 'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
    })
    expect(readFileSync(path.join(displaced, 'original.txt'), 'utf8')).toBe('original')
    expect(readFileSync(path.join(fixture.quarantineDirectory, 'substitute.txt'), 'utf8'))
      .toBe('substitute')
  })

  it('refuses a substituted ciphertext-custody inode before removing plaintext', () => {
    const fixture = createFixture()
    const displacedArchiveDirectory = `${fixture.archiveDirectory}-displaced`
    writeFileSync(path.join(fixture.quarantineDirectory, 'plaintext.txt'), 'preserve')
    renameSync(fixture.archiveDirectory, displacedArchiveDirectory)
    mkdirSync(fixture.archiveDirectory, { mode: 0o700 })

    expect(captureFailure(() => sweep(fixture.ticket))).toMatchObject({
      code: 'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
    })
    expect(readFileSync(path.join(fixture.quarantineDirectory, 'plaintext.txt'), 'utf8'))
      .toBe('preserve')
  })

  it('honours cancellation before the first destructive mutation', () => {
    const fixture = createFixture()
    const plaintextPath = path.join(fixture.quarantineDirectory, 'plaintext.txt')
    writeFileSync(plaintextPath, 'preserve')
    const cancellationFlag = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    )
    Atomics.store(cancellationFlag, 0, 1)

    expect(captureFailure(() => sweepArchiveReviewQuarantine({
      ticket: fixture.ticket,
      cancellationFlag,
      onProgress: () => undefined,
    }))).toMatchObject({ code: 'ARCHIVE_CANCELLED' })
    expect(readFileSync(plaintextPath, 'utf8')).toBe('preserve')
  })

  it('maps unexpected failures to one stable closed code without reflecting secrets', () => {
    const fixture = createFixture()
    const secret = `${fixture.root}/SECRET-PATH`

    expect(mapFailureCode(new Error(secret))).toBe('ARCHIVE_REVIEW_SWEEP_FAILED')
    try {
      sweep({
        ...fixture.ticket,
        quarantineIdentity: {
          ...fixture.ticket.quarantineIdentity,
          ino: fixture.ticket.quarantineIdentity.ino + 1,
        },
      })
      throw new Error('expected the sweep to fail')
    } catch (error) {
      expect(error).toMatchObject({ code: 'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED' })
      expect((error as Error).message).not.toContain(fixture.root)
      expect((error as Error).message).not.toContain(secret)
    }
  })
})
