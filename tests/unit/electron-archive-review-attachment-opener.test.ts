import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  openVerifiedRestoredAttachment,
} = require('../../electron/archive-review-attachment-opener.cjs') as {
  readonly openVerifiedRestoredAttachment: (input: {
    readonly restoredPath: string
    readonly sessionDirectory: string
    readonly displayName: string
    readonly expectedSha256: string
    readonly expectedSizeBytes: number
    readonly openPath: (stagePath: string) => Promise<string>
    readonly randomUUID?: () => string
    readonly beforeCopy?: () => Promise<void>
    readonly getAvailableDiskBytes?: () => number
    readonly signal?: AbortSignal
    readonly openFile?: typeof open
  }) => Promise<boolean | {
    readonly opened: true
    readonly close: () => Promise<void>
  }>
}

const roots: string[] = []

afterEach(async () => {
  await Promise.allSettled(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })))
})

describe('archive review descriptor-bound attachment opening [DON-253]', () => {
  it('launches a verified private stage copied from the pinned source descriptor after a path swap', async () => {
    const fixture = await createFixture()
    const displacedPath = path.join(fixture.sessionDirectory, 'displaced-briefing.pdf')
    let openedBytes: Buffer | null = null
    let openedPath: string | null = null
    const openPath = vi.fn(async (stagePath: string) => {
      openedPath = stagePath
      openedBytes = await readFile(stagePath)
      return ''
    })

    const lease = await openVerifiedRestoredAttachment({
      restoredPath: fixture.restoredPath,
      sessionDirectory: fixture.sessionDirectory,
      displayName: 'briefing.pdf',
      expectedSha256: fixture.sha256,
      expectedSizeBytes: fixture.archivedBytes.length,
      openPath,
      randomUUID: () => '987c24da-d3cf-4cac-84d2-b1df45a0e94c',
      beforeCopy: async () => {
        await rename(fixture.restoredPath, displacedPath)
        await symlink(fixture.outsidePath, fixture.restoredPath)
      },
    })

    expect(openPath).toHaveBeenCalledOnce()
    expect(openedPath).not.toBe(fixture.restoredPath)
    expect(path.dirname(openedPath as string)).toBe(
      path.join(
        fixture.sessionDirectory,
        '.attachment-launch',
        '987c24da-d3cf-4cac-84d2-b1df45a0e94c',
      ),
    )
    expect(openedBytes?.equals(fixture.archivedBytes)).toBe(true)
    expect(openedBytes?.equals(fixture.outsideBytes)).toBe(false)
    expect(await readFile(fixture.outsidePath)).toEqual(fixture.outsideBytes)
    expect(lease).toMatchObject({ opened: true, close: expect.any(Function) })
    await expect(readFile(openedPath as string)).resolves.toEqual(fixture.archivedBytes)
    if (typeof lease === 'object') await lease.close()
    await expect(readFile(openedPath as string)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retries stage descriptor close after the verified stage pathname is already quarantined', async () => {
    const fixture = await createFixture()
    let stageCloseCalls = 0
    const openFile = (async (...args: Parameters<typeof open>) => {
      const handle = await open(...args)
      if (String(args[0]).includes('.attachment-launch')) {
        const close = handle.close.bind(handle)
        handle.close = async () => {
          stageCloseCalls += 1
          if (stageCloseCalls === 1) throw new Error('transient stage descriptor close failure')
          await close()
        }
      }
      return handle
    }) as typeof open
    const operationId = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
    const stagePath = path.join(
      fixture.sessionDirectory,
      '.attachment-launch',
      operationId,
      'briefing.pdf',
    )

    const lease = await openVerifiedRestoredAttachment({
      restoredPath: fixture.restoredPath,
      sessionDirectory: fixture.sessionDirectory,
      displayName: 'briefing.pdf',
      expectedSha256: fixture.sha256,
      expectedSizeBytes: fixture.archivedBytes.length,
      openPath: async () => '',
      openFile,
      randomUUID: () => operationId,
    })
    expect(typeof lease).toBe('object')
    if (typeof lease !== 'object') throw new Error('Expected attachment cleanup lease.')

    await expect(lease.close()).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
    })
    await expect(readFile(stagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lease.close()).resolves.toBeUndefined()
    expect(stageCloseCalls).toBe(2)
  })

  it('defers a viewer sidecar directory to the session sweep after unlinking the staged bytes', async () => {
    const fixture = await createFixture()
    const operationId = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
    const operationDirectory = path.join(
      fixture.sessionDirectory,
      '.attachment-launch',
      operationId,
    )
    const stagePath = path.join(operationDirectory, 'briefing.pdf')
    const sidecarPath = path.join(operationDirectory, '.briefing.pdf.lock')

    const lease = await openVerifiedRestoredAttachment({
      restoredPath: fixture.restoredPath,
      sessionDirectory: fixture.sessionDirectory,
      displayName: 'briefing.pdf',
      expectedSha256: fixture.sha256,
      expectedSizeBytes: fixture.archivedBytes.length,
      openPath: async () => {
        await writeFile(sidecarPath, 'viewer-owned-sidecar', { mode: 0o600 })
        return ''
      },
      randomUUID: () => operationId,
    })
    expect(typeof lease).toBe('object')
    if (typeof lease !== 'object') throw new Error('Expected attachment cleanup lease.')

    await expect(lease.close()).resolves.toBeUndefined()
    await expect(readFile(stagePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(sidecarPath, 'utf8')).resolves.toBe('viewer-owned-sidecar')
  })

  it('does not lose stage-unlink ownership when directory removal would fail transiently', async () => {
    const fixture = await createFixture()
    const operationId = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
    const operationDirectory = path.join(
      fixture.sessionDirectory,
      '.attachment-launch',
      operationId,
    )
    const stagePath = path.join(operationDirectory, 'briefing.pdf')
    const rmdirSpy = vi.spyOn(fs, 'rmdirSync').mockImplementation(() => {
      const failure = new Error('transient directory removal failure') as NodeJS.ErrnoException
      failure.code = 'EIO'
      throw failure
    })
    try {
      const lease = await openVerifiedRestoredAttachment({
        restoredPath: fixture.restoredPath,
        sessionDirectory: fixture.sessionDirectory,
        displayName: 'briefing.pdf',
        expectedSha256: fixture.sha256,
        expectedSizeBytes: fixture.archivedBytes.length,
        openPath: async () => '',
        randomUUID: () => operationId,
      })
      expect(typeof lease).toBe('object')
      if (typeof lease !== 'object') throw new Error('Expected attachment cleanup lease.')

      await expect(lease.close()).resolves.toBeUndefined()
      await expect(readFile(stagePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(rmdirSpy).not.toHaveBeenCalled()
    } finally {
      rmdirSpy.mockRestore()
    }
  })

  it('returns retryable cleanup ownership when failed-open source descriptor close is transient', async () => {
    const fixture = await createFixture()
    let sourceCloseCalls = 0
    let sourceHandle: Awaited<ReturnType<typeof open>> | null = null
    const openFile = (async (...args: Parameters<typeof open>) => {
      const handle = await open(...args)
      if (String(args[0]) === fixture.restoredPath) {
        sourceHandle = handle
        const close = handle.close.bind(handle)
        handle.close = async () => {
          sourceCloseCalls += 1
          if (sourceCloseCalls === 1) throw new Error('transient source descriptor close failure')
          await close()
        }
      }
      return handle
    }) as typeof open

    let observedError: unknown
    try {
      await openVerifiedRestoredAttachment({
        restoredPath: fixture.restoredPath,
        sessionDirectory: fixture.sessionDirectory,
        displayName: 'briefing.pdf',
        expectedSha256: fixture.sha256,
        expectedSizeBytes: fixture.archivedBytes.length,
        openPath: async () => '',
        openFile,
        beforeCopy: async () => { throw new Error('injected failed open') },
      })
    } catch (error) {
      observedError = error
    }

    try {
      expect(observedError).toMatchObject({
        code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
        cleanupLease: { close: expect.any(Function) },
      })
      const cleanupLease = (observedError as {
        readonly cleanupLease: { readonly close: () => Promise<void> }
      }).cleanupLease
      await expect(cleanupLease.close()).resolves.toBeUndefined()
      expect(sourceCloseCalls).toBe(2)
    } finally {
      await sourceHandle?.close().catch(() => undefined)
    }
  })

  it('rejects a substituted source before shell launch when its digest differs', async () => {
    const fixture = await createFixture()
    await rm(fixture.restoredPath)
    await writeFile(fixture.restoredPath, fixture.outsideBytes, { mode: 0o600 })
    const openPath = vi.fn(async () => '')

    await expect(openVerifiedRestoredAttachment({
      restoredPath: fixture.restoredPath,
      sessionDirectory: fixture.sessionDirectory,
      displayName: 'briefing.pdf',
      expectedSha256: fixture.sha256,
      expectedSizeBytes: fixture.archivedBytes.length,
      openPath,
      randomUUID,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('fails closed when the session path is rebound between its identity check and stage creation', async () => {
    const fixture = await createFixture()
    const outsideDirectory = path.join(fixture.root, 'outside-stage-target')
    const displacedSession = path.join(fixture.root, 'displaced-session')
    await mkdir(outsideDirectory, { mode: 0o700 })
    const originalMkdirSync = fs.mkdirSync
    let rebound = false
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation((target, options) => {
      if (!rebound && target === path.join(fixture.sessionDirectory, '.attachment-launch')) {
        rebound = true
        fs.renameSync(fixture.sessionDirectory, displacedSession)
        fs.symlinkSync(outsideDirectory, fixture.sessionDirectory, 'dir')
      }
      return originalMkdirSync(target, options as never)
    })
    const openPath = vi.fn(async () => '')

    try {
      await expect(openVerifiedRestoredAttachment({
        restoredPath: fixture.restoredPath,
        sessionDirectory: fixture.sessionDirectory,
        displayName: 'briefing.pdf',
        expectedSha256: fixture.sha256,
        expectedSizeBytes: fixture.archivedBytes.length,
        openPath,
        randomUUID: () => '987c24da-d3cf-4cac-84d2-b1df45a0e94c',
      })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' })
    } finally {
      mkdirSpy.mockRestore()
    }

    expect(openPath).not.toHaveBeenCalled()
    await expect(readFile(path.join(
      outsideDirectory,
      '.attachment-launch',
      '987c24da-d3cf-4cac-84d2-b1df45a0e94c',
      'briefing.pdf',
    ))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never deletes through a rebound failed-stage path', async () => {
    const fixture = await createFixture()
    const operationId = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
    const operationDirectory = path.join(
      fixture.sessionDirectory,
      '.attachment-launch',
      operationId,
    )
    const displacedOperation = path.join(fixture.root, 'displaced-launch-operation')
    const outsideDirectory = path.join(fixture.root, 'outside-must-survive')
    const outsideFile = path.join(outsideDirectory, 'briefing.pdf')
    await mkdir(outsideDirectory, { mode: 0o700 })
    await writeFile(outsideFile, 'OUTSIDE-MUST-SURVIVE', { mode: 0o600 })
    const openPath = vi.fn(async () => {
      fs.renameSync(operationDirectory, displacedOperation)
      fs.symlinkSync(outsideDirectory, operationDirectory, 'dir')
      return 'launch failed'
    })

    await expect(openVerifiedRestoredAttachment({
      restoredPath: fixture.restoredPath,
      sessionDirectory: fixture.sessionDirectory,
      displayName: 'briefing.pdf',
      expectedSha256: fixture.sha256,
      expectedSizeBytes: fixture.archivedBytes.length,
      openPath,
      randomUUID: () => operationId,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' })

    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('OUTSIDE-MUST-SURVIVE')
  })

  it('zeroes a pinned stage if its operation directory moves during shell handoff', async () => {
    const fixture = await createFixture()
    const operationId = '987c24da-d3cf-4cac-84d2-b1df45a0e94c'
    const operationDirectory = path.join(
      fixture.sessionDirectory,
      '.attachment-launch',
      operationId,
    )
    const displacedOperation = path.join(fixture.root, 'displaced-successful-handoff')
    const openPath = vi.fn(async () => {
      await rename(operationDirectory, displacedOperation)
      return ''
    })

    await expect(openVerifiedRestoredAttachment({
      restoredPath: fixture.restoredPath,
      sessionDirectory: fixture.sessionDirectory,
      displayName: 'briefing.pdf',
      expectedSha256: fixture.sha256,
      expectedSizeBytes: fixture.archivedBytes.length,
      openPath,
      randomUUID: () => operationId,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' })

    await expect(readFile(path.join(displacedOperation, 'briefing.pdf')))
      .resolves.toEqual(Buffer.alloc(0))
  })

  it('denies staging before copying when it would consume the live-store reserve', async () => {
    const fixture = await createFixture()
    const openPath = vi.fn(async () => '')

    await expect(openVerifiedRestoredAttachment({
      restoredPath: fixture.restoredPath,
      sessionDirectory: fixture.sessionDirectory,
      displayName: 'briefing.pdf',
      expectedSha256: fixture.sha256,
      expectedSizeBytes: fixture.archivedBytes.length,
      openPath,
      getAvailableDiskBytes: () => fixture.archivedBytes.length,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' })

    expect(openPath).not.toHaveBeenCalled()
  })

  it('honours cancellation before copying or handing a path to the desktop shell', async () => {
    const fixture = await createFixture()
    const controller = new AbortController()
    const openPath = vi.fn(async () => '')

    await expect(openVerifiedRestoredAttachment({
      restoredPath: fixture.restoredPath,
      sessionDirectory: fixture.sessionDirectory,
      displayName: 'briefing.pdf',
      expectedSha256: fixture.sha256,
      expectedSizeBytes: fixture.archivedBytes.length,
      openPath,
      signal: controller.signal,
      beforeCopy: async () => controller.abort(),
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' })

    expect(openPath).not.toHaveBeenCalled()
  })
})

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sartracker-archive-review-open-'))
  roots.push(root)
  const sessionDirectory = path.join(root, randomUUID())
  const attachmentsDirectory = path.join(sessionDirectory, 'attachments')
  const restoredPath = path.join(attachmentsDirectory, '00000001-briefing.pdf')
  const outsidePath = path.join(root, 'outside-private.pdf')
  const archivedBytes = Buffer.from('ARCHIVED-BRIEFING-CONTENT')
  const outsideBytes = Buffer.from('OUTSIDE-PRIVATE-CONTENT!')
  await mkdir(attachmentsDirectory, { recursive: true, mode: 0o700 })
  await writeFile(restoredPath, archivedBytes, { mode: 0o600 })
  await writeFile(outsidePath, outsideBytes, { mode: 0o600 })
  return {
    root,
    sessionDirectory,
    restoredPath,
    outsidePath,
    archivedBytes,
    outsideBytes,
    sha256: createHash('sha256').update(archivedBytes).digest('hex'),
  }
}
