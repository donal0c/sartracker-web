import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs')

let userDataPath: string | undefined
let store: { readonly close: () => void } | undefined

afterEach(async () => {
  store?.close()
  store = undefined
  if (userDataPath !== undefined) {
    await rm(userDataPath, { recursive: true, force: true })
    userDataPath = undefined
  }
})

describe('Electron mission-store exact breadcrumb dots', () => {
  it('serializes exact and line workers and drains exact cancellation before replacement', async () => {
    let rejectExact: (error: Error) => void = () => undefined
    const runBreadcrumbDotQueryInWorker = vi.fn().mockImplementation(
      (input: { readonly signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => {
            rejectExact = reject
          }, { once: true })
        }),
    )
    let releaseLineCompletion = () => undefined
    const lineCompletion = new Promise<void>((resolve) => { releaseLineCompletion = resolve })
    const lineSession = {
      manifest: {
        version: 1,
        positionCount: 0,
        deviceTotalCount: 0,
        deviceSelectionCount: 0,
        droppedPositionCount: 0,
      },
      read: vi.fn(async (sequence: number) => ({ sequence, payload: '', done: true })),
      finish: vi.fn(() => {
        releaseLineCompletion()
        return lineCompletion
      }),
      cancel: vi.fn(async () => undefined),
      completion: lineCompletion,
    }
    const startBreadcrumbQuerySession = vi.fn(async () => lineSession)
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-dot-store-'))
    const missionStore = createElectronMissionStore({
      userDataPath,
      runBreadcrumbDotQueryInWorker,
      startBreadcrumbQuerySession,
    })
    store = missionStore
    const dotQuery = missionStore.listExactBreadcrumbDotPage({
      missionId: 'mission-a',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    }, '41:exact-dot:request-1')
    await vi.waitFor(() => expect(runBreadcrumbDotQueryInWorker).toHaveBeenCalledOnce())
    const lineQuery = missionStore.startBreadcrumbQuery(
      'mission-b',
      5_000,
      '42:request-1',
    )
    expect(startBreadcrumbQuerySession).not.toHaveBeenCalled()

    const cancellation = missionStore.cancelExactBreadcrumbDotQuery(
      '41:exact-dot:request-1',
    )
    const abortError = new Error('exact worker terminated')
    abortError.name = 'AbortError'
    rejectExact(abortError)

    await expect(cancellation).resolves.toBe(true)
    await expect(dotQuery).rejects.toMatchObject({ name: 'AbortError' })
    await expect(lineQuery).resolves.toEqual(lineSession.manifest)
    await expect(missionStore.finishBreadcrumbQuery('42:request-1')).resolves.toBeUndefined()
    expect(startBreadcrumbQuerySession).toHaveBeenCalledOnce()
  })

  it('keeps active dot custody when a queued canonical session is cancelled before dot exit', async () => {
    let dotSignal: AbortSignal | undefined
    let rejectDot: (error: Error) => void = () => undefined
    const runBreadcrumbDotQueryInWorker = vi.fn().mockImplementation(
      (input: { readonly signal: AbortSignal }) => {
        dotSignal = input.signal
        return new Promise((_resolve, reject) => {
          rejectDot = reject
          input.signal.addEventListener('abort', () => undefined, { once: true })
        })
      },
    )
    let releaseReplacementCompletion = () => undefined
    const replacementCompletion = new Promise<void>((resolve) => {
      releaseReplacementCompletion = resolve
    })
    const replacementSession = {
      manifest: {
        version: 1,
        positionCount: 0,
        deviceTotalCount: 0,
        deviceSelectionCount: 0,
        droppedPositionCount: 0,
      },
      read: vi.fn(async (sequence: number) => ({ sequence, payload: '', done: true })),
      finish: vi.fn(() => {
        releaseReplacementCompletion()
        return replacementCompletion
      }),
      cancel: vi.fn(async () => undefined),
      completion: replacementCompletion,
    }
    const startBreadcrumbQuerySession = vi.fn(async () => replacementSession)
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-dot-store-'))
    const missionStore = createElectronMissionStore({
      userDataPath,
      runBreadcrumbDotQueryInWorker,
      startBreadcrumbQuerySession,
    })
    store = missionStore

    const dotQuery = missionStore.listExactBreadcrumbDotPage({
      missionId: 'mission-a',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    }, '41:exact-dot:active')
    await vi.waitFor(() => expect(runBreadcrumbDotQueryInWorker).toHaveBeenCalledOnce())

    const queuedStart = missionStore.startBreadcrumbQuery('mission-b', 5_000, '42:queued')
    expect(startBreadcrumbQuerySession).not.toHaveBeenCalled()
    const queuedRejection = expect(queuedStart).rejects.toMatchObject({ name: 'AbortError' })
    await expect(missionStore.cancelBreadcrumbQuery('42:queued')).resolves.toBe(true)
    await queuedRejection
    expect(startBreadcrumbQuerySession).not.toHaveBeenCalled()

    let dotCancellationSettled = false
    const dotCancellation = missionStore.cancelExactBreadcrumbDotQuery('41:exact-dot:active').then(
      (result) => {
        dotCancellationSettled = true
        return result
      },
    )
    expect(dotSignal?.aborted).toBe(true)
    expect(dotCancellationSettled).toBe(false)

    const replacementStart = missionStore.startBreadcrumbQuery('mission-c', 5_000, '43:replacement')
    expect(startBreadcrumbQuerySession).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(startBreadcrumbQuerySession).not.toHaveBeenCalled()

    const dotError = new Error('dot worker exited')
    dotError.name = 'AbortError'
    const dotRejection = expect(dotQuery).rejects.toMatchObject({ name: 'AbortError' })
    rejectDot(dotError)
    await expect(dotCancellation).resolves.toBe(true)
    await dotRejection

    await expect(replacementStart).resolves.toEqual(replacementSession.manifest)
    expect(startBreadcrumbQuerySession).toHaveBeenCalledOnce()
    await expect(missionStore.finishBreadcrumbQuery('43:replacement')).resolves.toBeUndefined()
  })

  it('aborts and joins active dot custody during prepareClose and fences later admissions', async () => {
    let dotSignal: AbortSignal | undefined
    let rejectDot: (error: Error) => void = () => undefined
    const runBreadcrumbDotQueryInWorker = vi.fn().mockImplementation(
      (input: { readonly signal: AbortSignal }) => {
        dotSignal = input.signal
        return new Promise((_resolve, reject) => {
          rejectDot = reject
          input.signal.addEventListener('abort', () => undefined, { once: true })
        })
      },
    )
    const startBreadcrumbQuerySession = vi.fn(async () => {
      throw new Error('canonical session must not start after shutdown')
    })
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-dot-store-'))
    const missionStore = createElectronMissionStore({
      userDataPath,
      runBreadcrumbDotQueryInWorker,
      startBreadcrumbQuerySession,
    })
    store = missionStore

    const dotQuery = missionStore.listExactBreadcrumbDotPage({
      missionId: 'mission-a',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    }, '41:exact-dot:shutdown')
    await vi.waitFor(() => expect(runBreadcrumbDotQueryInWorker).toHaveBeenCalledOnce())

    const prepareClose = missionStore.prepareClose()
    expect(dotSignal?.aborted).toBe(true)
    await expect(missionStore.listExactBreadcrumbDotPage({
      missionId: 'mission-b',
      activeDeviceIds: [],
      limit: 1,
      direction: 'latest',
    }, '41:exact-dot:late')).rejects.toThrow(/closing|closed/iu)
    await expect(missionStore.startBreadcrumbQuery('mission-c', 5_000, '43:late'))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(startBreadcrumbQuerySession).not.toHaveBeenCalled()

    const dotError = new Error('dot worker exited during shutdown')
    dotError.name = 'AbortError'
    const dotRejection = expect(dotQuery).rejects.toMatchObject({ name: 'AbortError' })
    rejectDot(dotError)
    await dotRejection
    await expect(prepareClose).resolves.toBeUndefined()

    const closingStore = store
    store = undefined
    expect(() => closingStore.close()).not.toThrow()
  })
})
