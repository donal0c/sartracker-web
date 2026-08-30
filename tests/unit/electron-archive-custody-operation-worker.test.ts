import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, linkSync, mkdirSync, readFileSync, statSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startArchiveCustodyOperation } = require('../../electron/archive-custody-operation-runner.cjs') as {
  startArchiveCustodyOperation: (input: Record<string, unknown>) => Promise<Record<string, unknown>> & {
    readonly workerExited: Promise<void>
    readonly cancel: () => void
    readonly prepareClose: () => Promise<void>
  }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function projectIdentity(filePath: string) {
  const stat = lstatSync(filePath, { bigint: true })
  return {
    changedTimeNanoseconds: stat.ctimeNs.toString(),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    linkCount: Number(stat.nlink),
    modifiedTimeNanoseconds: stat.mtimeNs.toString(),
    sizeBytes: Number(stat.size),
  }
}

async function createFixture(content = Buffer.from('sealed mission archive bytes')) {
  const root = await mkdtemp(path.join(tmpdir(), 'sartracker-custody-operation-'))
  roots.push(root)
  const creationOperationId = randomUUID()
  const archiveId = randomUUID()
  const stagingRelativePath = `.staging/${creationOperationId}/${archiveId}.sararch.tmp`
  const finalRelativePath = `${archiveId}.sararch`
  const sourcePath = path.join(root, stagingRelativePath)
  const targetPath = path.join(root, finalRelativePath)
  mkdirSync(path.dirname(sourcePath), { recursive: true, mode: 0o700 })
  writeFileSync(sourcePath, content, { mode: 0o600 })
  const expectedFileIdentity = projectIdentity(sourcePath)
  const expectedCiphertextSha256 = createHash('sha256').update(content).digest('hex')
  const ticket = {
    protocolVersion: 1,
    maintenanceOperationId: randomUUID(),
    creationOperationId,
    journalRevision: 2,
    action: 'publish',
    archiveDirectory: root,
    sourceRelativePath: stagingRelativePath,
    targetRelativePath: finalRelativePath,
    stagingRelativePath,
    finalRelativePath,
    expectedSizeBytes: content.length,
    expectedCiphertextSha256,
    expectedFileIdentity,
  }
  return { root, sourcePath, targetPath, ticket, content, creationOperationId, archiveId }
}

async function run(ticket: Record<string, unknown>, input: Record<string, unknown> = {}) {
  const operation = startArchiveCustodyOperation({ ticket, ...input })
  const result = await operation
  await operation.workerExited
  return result
}

describe('archive custody operation worker', () => {
  it('publishes with no overwrite, exact byte proof, restrictive permissions, and durable parents', async () => {
    const fixture = await createFixture()
    const siblingOperation = path.join(fixture.root, '.staging', randomUUID())
    mkdirSync(siblingOperation, { mode: 0o700 })
    const progress: Array<Record<string, unknown>> = []
    const result = await run(fixture.ticket, {
      onProgress: (entry: Record<string, unknown>) => progress.push(entry),
    })

    expect(result).toMatchObject({
      type: 'complete',
      outcome: 'moved',
      sourceIdentity: null,
      directoriesSynced: true,
    })
    expect(existsSync(fixture.sourcePath)).toBe(false)
    expect(existsSync(path.dirname(fixture.sourcePath))).toBe(false)
    expect(existsSync(path.join(fixture.root, '.staging'))).toBe(true)
    expect(existsSync(siblingOperation)).toBe(true)
    expect(readFileSync(fixture.targetPath)).toEqual(fixture.content)
    expect(statSync(fixture.targetPath).mode & 0o777).toBe(0o600)
    expect(statSync(fixture.root).mode & 0o777).toBe(0o700)
    expect(progress.map((entry) => entry.phase)).toEqual(
      expect.arrayContaining(['inspect', 'hash', 'transfer', 'cleanup', 'sync']),
    )
  })

  it('validates an already-published target and safely completes an interrupted link', async () => {
    const targetOnly = await createFixture()
    linkSync(targetOnly.sourcePath, targetOnly.targetPath)
    unlinkSync(targetOnly.sourcePath)
    expect(existsSync(path.dirname(targetOnly.sourcePath))).toBe(true)
    const resumedTarget = await run({
      ...targetOnly.ticket,
      maintenanceOperationId: randomUUID(),
    })
    expect(resumedTarget).toMatchObject({ outcome: 'target_only', sourceIdentity: null })
    expect(existsSync(path.dirname(targetOnly.sourcePath))).toBe(false)

    const interrupted = await createFixture()
    linkSync(interrupted.sourcePath, interrupted.targetPath)
    expect(statSync(interrupted.sourcePath).nlink).toBe(2)
    const completed = await run(interrupted.ticket)
    expect(completed).toMatchObject({ outcome: 'moved', sourceIdentity: null })
    expect(existsSync(interrupted.sourcePath)).toBe(false)
    expect(statSync(interrupted.targetPath).nlink).toBe(1)
    expect(readFileSync(interrupted.targetPath)).toEqual(interrupted.content)
  })

  it('preserves two different files and never overwrites the target', async () => {
    const fixture = await createFixture()
    writeFileSync(fixture.targetPath, 'different archive', { mode: 0o600 })
    const result = await run(fixture.ticket)

    expect(result).toMatchObject({ outcome: 'both_present' })
    expect(readFileSync(fixture.sourcePath)).toEqual(fixture.content)
    expect(readFileSync(fixture.targetPath, 'utf8')).toBe('different archive')
  })

  it('never removes or publishes across unexpected operation-directory entries', async () => {
    const sourceOnly = await createFixture()
    const sourceUnexpected = path.join(path.dirname(sourceOnly.sourcePath), 'unexpected.txt')
    writeFileSync(sourceUnexpected, 'preserve me', { mode: 0o600 })
    await expect(run(sourceOnly.ticket)).resolves.toMatchObject({ outcome: 'changed' })
    expect(readFileSync(sourceOnly.sourcePath)).toEqual(sourceOnly.content)
    expect(readFileSync(sourceUnexpected, 'utf8')).toBe('preserve me')
    expect(existsSync(sourceOnly.targetPath)).toBe(false)

    const targetOnly = await createFixture()
    linkSync(targetOnly.sourcePath, targetOnly.targetPath)
    unlinkSync(targetOnly.sourcePath)
    const targetUnexpected = path.join(path.dirname(targetOnly.sourcePath), 'unexpected.txt')
    writeFileSync(targetUnexpected, 'preserve me', { mode: 0o600 })
    await expect(run(targetOnly.ticket)).resolves.toMatchObject({ outcome: 'changed' })
    expect(readFileSync(targetOnly.targetPath)).toEqual(targetOnly.content)
    expect(readFileSync(targetUnexpected, 'utf8')).toBe('preserve me')
    expect(existsSync(path.dirname(targetOnly.sourcePath))).toBe(true)
  })

  it('closes missing and changed source states without publishing', async () => {
    const missing = await createFixture()
    await rm(missing.sourcePath)
    await expect(run(missing.ticket)).resolves.toMatchObject({ outcome: 'neither_present' })

    const substituted = await createFixture()
    writeFileSync(substituted.sourcePath, 'substituted bytes', { mode: 0o600 })
    await expect(run(substituted.ticket)).resolves.toMatchObject({ outcome: 'changed' })
    expect(existsSync(substituted.targetPath)).toBe(false)

    const corrupt = await createFixture(Buffer.from('same-size-content'))
    writeFileSync(corrupt.sourcePath, Buffer.from('wrong-size-bytes!'), { mode: 0o600 })
    expect(statSync(corrupt.sourcePath).size).toBe(corrupt.content.length)
    await expect(run(corrupt.ticket)).resolves.toMatchObject({ outcome: 'changed' })
    expect(existsSync(corrupt.targetPath)).toBe(false)
  })

  it('rejects symlink ancestors, symlink files, hardlinks, and non-regular files', async () => {
    const ancestor = await createFixture()
    const outside = await mkdtemp(path.join(tmpdir(), 'sartracker-custody-outside-'))
    roots.push(outside)
    await rm(path.join(ancestor.root, '.staging'), { recursive: true })
    symlinkSync(outside, path.join(ancestor.root, '.staging'))
    await expect(run(ancestor.ticket)).resolves.toMatchObject({ outcome: 'not_regular' })

    const finalSymlink = await createFixture()
    symlinkSync(finalSymlink.sourcePath, finalSymlink.targetPath)
    await expect(run(finalSymlink.ticket)).resolves.toMatchObject({ outcome: 'not_regular' })
    expect(readFileSync(finalSymlink.sourcePath)).toEqual(finalSymlink.content)

    const hardlinked = await createFixture()
    linkSync(hardlinked.sourcePath, path.join(hardlinked.root, 'extra-link'))
    await expect(run(hardlinked.ticket)).resolves.toMatchObject({ outcome: 'not_regular' })
    expect(existsSync(hardlinked.targetPath)).toBe(false)

    const directorySource = await createFixture()
    await rm(directorySource.sourcePath)
    mkdirSync(directorySource.sourcePath)
    await expect(run(directorySource.ticket)).resolves.toMatchObject({ outcome: 'not_regular' })
  })

  it('quarantines only the journalled final file and handles target-only and staging-only recovery', async () => {
    const fixture = await createFixture()
    await run(fixture.ticket)
    const quarantineId = randomUUID()
    const quarantineRelativePath = `quarantine/orphan-${quarantineId}/${fixture.archiveId}.sararch`
    const quarantineTicket = {
      ...fixture.ticket,
      maintenanceOperationId: randomUUID(),
      journalRevision: 3,
      action: 'quarantine',
      sourceRelativePath: fixture.ticket.finalRelativePath,
      targetRelativePath: quarantineRelativePath,
    }
    const quarantined = await run(quarantineTicket)
    const quarantinePath = path.join(fixture.root, quarantineRelativePath)
    expect(quarantined).toMatchObject({ outcome: 'moved', sourceIdentity: null })
    expect(existsSync(fixture.targetPath)).toBe(false)
    expect(readFileSync(quarantinePath)).toEqual(fixture.content)
    expect(statSync(path.dirname(quarantinePath)).mode & 0o777).toBe(0o700)

    await expect(run({
      ...quarantineTicket,
      maintenanceOperationId: randomUUID(),
    })).resolves.toMatchObject({ outcome: 'target_only' })

    const stagingOnly = await createFixture()
    const stagingQuarantineTicket = {
      ...stagingOnly.ticket,
      maintenanceOperationId: randomUUID(),
      journalRevision: 3,
      action: 'quarantine',
      sourceRelativePath: stagingOnly.ticket.finalRelativePath,
      targetRelativePath: `quarantine/orphan-${randomUUID()}/${stagingOnly.archiveId}.sararch`,
    }
    await expect(run(stagingQuarantineTicket)).resolves.toMatchObject({
      outcome: 'staging_only',
    })
    expect(readFileSync(stagingOnly.sourcePath)).toEqual(stagingOnly.content)
  })

  it('removes only the exact abandoned staging directory without following internal symlinks', async () => {
    const fixture = await createFixture()
    const outside = await mkdtemp(path.join(tmpdir(), 'sartracker-custody-cleanup-outside-'))
    roots.push(outside)
    const outsideFile = path.join(outside, 'must-survive.txt')
    writeFileSync(outsideFile, 'survive')
    symlinkSync(outside, path.join(path.dirname(fixture.sourcePath), 'outside-link'))
    const cleanupTicket = {
      ...fixture.ticket,
      maintenanceOperationId: randomUUID(),
      journalRevision: 2,
      action: 'staging_cleanup',
      sourceRelativePath: `.staging/${fixture.creationOperationId}`,
      targetRelativePath: null,
      expectedSizeBytes: null,
      expectedCiphertextSha256: null,
      expectedFileIdentity: null,
    }

    await expect(run(cleanupTicket)).resolves.toMatchObject({ outcome: 'removed' })
    expect(existsSync(path.dirname(fixture.sourcePath))).toBe(false)
    expect(readFileSync(outsideFile, 'utf8')).toBe('survive')

    await expect(run({
      ...cleanupTicket,
      maintenanceOperationId: randomUUID(),
    })).resolves.toMatchObject({ outcome: 'source_absent' })
  })

  it('refuses staging cleanup whenever any final component exists', async () => {
    const fixture = await createFixture()
    writeFileSync(fixture.targetPath, fixture.content, { mode: 0o600 })
    const cleanupTicket = {
      ...fixture.ticket,
      maintenanceOperationId: randomUUID(),
      action: 'staging_cleanup',
      sourceRelativePath: `.staging/${fixture.creationOperationId}`,
      targetRelativePath: null,
      expectedSizeBytes: null,
      expectedCiphertextSha256: null,
      expectedFileIdentity: null,
    }
    await expect(run(cleanupTicket)).resolves.toMatchObject({ outcome: 'unexpected_final' })
    expect(existsSync(fixture.sourcePath)).toBe(true)
  })

  it('settles only absent-root staging cleanup as source_absent', async () => {
    const fixture = await createFixture()
    const cleanupTicket = {
      ...fixture.ticket,
      maintenanceOperationId: randomUUID(),
      action: 'staging_cleanup',
      sourceRelativePath: `.staging/${fixture.creationOperationId}`,
      targetRelativePath: null,
      expectedSizeBytes: null,
      expectedCiphertextSha256: null,
      expectedFileIdentity: null,
    }
    await rm(fixture.root, { recursive: true })
    await expect(run(cleanupTicket)).resolves.toMatchObject({
      outcome: 'source_absent',
      directoriesSynced: true,
    })

    for (const action of ['publish', 'quarantine']) {
      const targetRelativePath = action === 'publish'
        ? fixture.ticket.finalRelativePath
        : `quarantine/orphan-${randomUUID()}/${fixture.archiveId}.sararch`
      const operation = startArchiveCustodyOperation({
        ticket: {
          ...fixture.ticket,
          maintenanceOperationId: randomUUID(),
          journalRevision: 3,
          action,
          sourceRelativePath: action === 'publish'
            ? fixture.ticket.stagingRelativePath
            : fixture.ticket.finalRelativePath,
          targetRelativePath,
        },
        cancelGraceMs: 0,
      })
      await expect(operation).rejects.toThrow(/failed safely|without valid completion/i)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }

    writeFileSync(fixture.root, 'not a directory', { mode: 0o600 })
    const nonDirectory = startArchiveCustodyOperation({
      ticket: { ...cleanupTicket, maintenanceOperationId: randomUUID() },
      cancelGraceMs: 0,
    })
    await expect(nonDirectory).rejects.toThrow(/failed safely|without valid completion/i)
    await expect(nonDirectory.workerExited).resolves.toBeUndefined()

    await rm(fixture.root)
    const outside = await mkdtemp(path.join(tmpdir(), 'sartracker-custody-root-target-'))
    roots.push(outside)
    symlinkSync(outside, fixture.root)
    const symlinkRoot = startArchiveCustodyOperation({
      ticket: { ...cleanupTicket, maintenanceOperationId: randomUUID() },
      cancelGraceMs: 0,
    })
    await expect(symlinkRoot).rejects.toThrow(/failed safely|without valid completion/i)
    await expect(symlinkRoot.workerExited).resolves.toBeUndefined()
  })

  it('cooperatively cancels a large hash before any custody link is created', async () => {
    const fixture = await createFixture(Buffer.alloc(1))
    truncateSync(fixture.sourcePath, 64 * 1024 * 1024)
    const contentHash = createHash('sha256')
    const zeroChunk = Buffer.alloc(1024 * 1024)
    for (let index = 0; index < 64; index += 1) contentHash.update(zeroChunk)
    const ticket = {
      ...fixture.ticket,
      expectedSizeBytes: 64 * 1024 * 1024,
      expectedCiphertextSha256: contentHash.digest('hex'),
      expectedFileIdentity: projectIdentity(fixture.sourcePath),
    }
    const operationHolder: {
      operation: ReturnType<typeof startArchiveCustodyOperation> | null
    } = { operation: null }
    const operation = startArchiveCustodyOperation({
      ticket,
      cancelGraceMs: 5_000,
      onProgress: (progress: Record<string, unknown>) => {
        if (progress.phase === 'hash') operationHolder.operation?.cancel()
      },
    })
    operationHolder.operation = operation

    await expect(operation).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ARCHIVE_CANCELLED',
    })
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(existsSync(fixture.sourcePath)).toBe(true)
    expect(existsSync(fixture.targetPath)).toBe(false)
  })
})
