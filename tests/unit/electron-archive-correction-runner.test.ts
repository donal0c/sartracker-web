import { EventEmitter } from 'node:events'
import { lstatSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { serialize } from 'node:v8'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startArchiveCorrectionWorker } from '../../electron/archive-correction-runner.cjs'

type FakeUtility = EventEmitter & {
  readonly postMessage: ReturnType<typeof vi.fn>
  readonly kill: ReturnType<typeof vi.fn>
}

const ARCHIVE_ID = '11111111-1111-4111-8111-111111111111'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('archive correction utility runner', () => {
  it('sends no authority until an exact cwd identity READY handshake', () => {
    const utility = fakeUtility()
    const input = correctionInput(utility)
    const operation = startArchiveCorrectionWorker(input)

    expect(utility.postMessage).not.toHaveBeenCalled()
    emitReady(utility, input.databasePath)

    expect(utility.postMessage).toHaveBeenCalledOnce()
    const start = utility.postMessage.mock.calls[0][0]
    expect(start).toMatchObject({
      type: 'start',
      request: { databaseName: 'mission-store.sqlite' },
    })
    expect(start.request).not.toHaveProperty('databasePath')
    expect(start).not.toHaveProperty('cancellationBuffer')
    expect(() => serialize(start)).not.toThrow()
    utility.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: ARCHIVE_ID,
      operationId: start.request.operationId,
    })
    utility.emit('exit', 0)
    void operation
  })

  it('rejects a terminal envelope not bound to the exact correction operation', async () => {
    const utility = fakeUtility()
    const input = correctionInput(utility, { operationId: 'operation-a' })
    const operation = startArchiveCorrectionWorker(input)
    emitReady(utility, input.databasePath)

    utility.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: ARCHIVE_ID,
    })
    utility.emit('exit', 0)

    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_FAILED' })
  })

  it('kills and rejects a utility whose READY identity does not match the pinned directory', async () => {
    const utility = fakeUtility()
    const input = correctionInput(utility)
    const operation = startArchiveCorrectionWorker(input)
    const workerExited = operation.workerExited

    utility.emit('message', { type: 'ready', directoryIdentity: { dev: '0', ino: '1' } })
    expect(utility.kill).toHaveBeenCalledOnce()
    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_FAILED' })
    utility.emit('exit', 1)
    await expect(workerExited).resolves.toBeUndefined()
  })

  it('does not turn cancellation after durable completion into a false failure', async () => {
    const utility = fakeUtility()
    const controller = new AbortController()
    const input = correctionInput(utility, { signal: controller.signal })
    const operation = startArchiveCorrectionWorker(input)
    emitReady(utility, input.databasePath)
    utility.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: ARCHIVE_ID,
      operationId: 'operation-1',
    })

    controller.abort()
    expect(utility.kill).toHaveBeenCalledOnce()
    utility.emit('exit', 1)

    await expect(operation).resolves.toEqual({ missionId: 'mission-1', archiveId: ARCHIVE_ID })
  })

  it('rejects a completion followed by a nonzero utility exit', async () => {
    const utility = fakeUtility()
    const input = correctionInput(utility)
    const operation = startArchiveCorrectionWorker(input)
    emitReady(utility, input.databasePath)
    utility.emit('message', {
      type: 'complete',
      missionId: 'mission-1',
      archiveId: ARCHIVE_ID,
      operationId: 'operation-1',
    })
    utility.emit('error', 'FatalError', 'fixture', 'fixture')
    utility.emit('exit', 1)

    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_FAILED' })
  })

  it('gives a cooperative utility time to settle custody before forced termination', async () => {
    vi.useFakeTimers()
    try {
      const utility = fakeUtility()
      const controller = new AbortController()
      const input = correctionInput(utility, { signal: controller.signal })
      const operation = startArchiveCorrectionWorker(input)
      emitReady(utility, input.databasePath)
      const rejection = expect(operation).rejects.toMatchObject({
        code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      })

      controller.abort()
      expect(utility.kill).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(utility.kill).toHaveBeenCalledOnce()
      utility.emit('exit', 1)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not mask a late custody failure behind cancellation', async () => {
    const utility = fakeUtility()
    const controller = new AbortController()
    const input = correctionInput(utility, { signal: controller.signal })
    const operation = startArchiveCorrectionWorker(input)
    emitReady(utility, input.databasePath)
    controller.abort()
    utility.emit('message', { type: 'error', code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED' })
    utility.emit('exit', 1)

    await expect(operation).rejects.toMatchObject({
      code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
    })
  })

  it('fails closed when Electron did not inject a utility-process factory', async () => {
    const input = correctionInput(fakeUtility())
    const operation = startArchiveCorrectionWorker({
      ...input,
      createUtilityProcess: undefined,
    })

    await expect(operation).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_FAILED' })
    await expect(operation.workerExited).resolves.toBeUndefined()
  })
})

function fakeUtility(): FakeUtility {
  const utility = new EventEmitter() as FakeUtility
  Object.defineProperties(utility, {
    postMessage: { value: vi.fn() },
    kill: { value: vi.fn(() => true) },
  })
  return utility
}

function correctionInput(utility: FakeUtility, overrides: Readonly<Record<string, unknown>> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'sartracker-correction-runner-'))
  roots.push(root)
  return {
    databasePath: path.join(root, 'mission-store.sqlite'),
    snapshotPath: path.join(root, 'correction.sqlite'),
    missionId: 'mission-1',
    archiveId: ARCHIVE_ID,
    expectedSha256: 'a'.repeat(64),
    expectedIdentity: { dev: 1, ino: 1, sizeBytes: 1 },
    finalizedEpoch: 1,
    adminName: 'Duty Admin',
    reason: 'Correction',
    attachmentDirectory: path.join(root, 'attachments'),
    attachmentMappings: [],
    operationId: 'operation-1',
    createUtilityProcess: () => utility,
    ...overrides,
  }
}

function emitReady(utility: FakeUtility, databasePath: string): void {
  const stat = lstatSync(path.dirname(databasePath), { bigint: true })
  utility.emit('message', {
    type: 'ready',
    directoryIdentity: { dev: stat.dev.toString(), ino: stat.ino.toString() },
  })
}
