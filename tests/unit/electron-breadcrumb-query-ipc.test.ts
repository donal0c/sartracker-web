import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { registerBreadcrumbQueryIpcHandlers } = require(
  '../../electron/breadcrumb-query-ipc.cjs',
) as {
  readonly registerBreadcrumbQueryIpcHandlers: (input: {
    readonly ipcMain: {
      readonly handle: (
        channel: string,
        handler: (event: unknown, ...args: readonly unknown[]) => unknown,
      ) => void
    }
    readonly startChannel: string
    readonly readChannel: string
    readonly finishChannel: string
    readonly cancelChannel: string
    readonly missionStore: {
      readonly startBreadcrumbQuery: (
        missionId: string,
        perDeviceLimit: number,
        requestId: string,
      ) => Promise<unknown>
      readonly readBreadcrumbQueryFrame: (
        requestId: string,
        sequence?: number,
      ) => Promise<unknown>
      readonly finishBreadcrumbQuery: (requestId: string) => Promise<void>
      readonly cancelBreadcrumbQuery: (requestId: string) => Promise<boolean>
      readonly breadcrumbQueryCompletion: (requestId: string) => Promise<void>
    }
    readonly validateIpcSender: (event: unknown) => void
  }) => void
}

type IpcHandler = (event: unknown, ...args: readonly unknown[]) => unknown

const manifest = {
  version: 1,
  positionCount: 0,
  deviceTotalCount: 0,
  deviceSelectionCount: 0,
  droppedPositionCount: 0,
}

/** Creates a promise whose settlement can be controlled by a test. */
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/** Registers the production four-channel handlers with a test-owned store. */
function createHarness(missionStore: {
  readonly startBreadcrumbQuery: (
    missionId: string,
    perDeviceLimit: number,
    requestId: string,
  ) => Promise<unknown>
  readonly readBreadcrumbQueryFrame: (
    requestId: string,
    sequence?: number,
  ) => Promise<unknown>
  readonly finishBreadcrumbQuery: (requestId: string) => Promise<void>
  readonly cancelBreadcrumbQuery: (requestId: string) => Promise<boolean>
  readonly breadcrumbQueryCompletion: (requestId: string) => Promise<void>
}) {
  const handlers = new Map<string, IpcHandler>()
  const validateIpcSender = vi.fn()
  registerBreadcrumbQueryIpcHandlers({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    startChannel: 'start',
    readChannel: 'read',
    finishChannel: 'finish',
    cancelChannel: 'cancel',
    missionStore,
    validateIpcSender,
  })
  const handler = (channel: string): IpcHandler => {
    const registered = handlers.get(channel)
    if (registered === undefined) throw new Error(`Missing IPC handler: ${channel}`)
    return registered
  }
  const invoke = (
    channel: string,
    event: unknown,
    ...args: readonly unknown[]
  ): Promise<unknown> => Promise.resolve().then(() => handler(channel)(event, ...args))
  return { handler, invoke, validateIpcSender }
}

/** Creates a sender event with the identity used for request scoping. */
function eventFor(senderId: number) {
  return { sender: Object.assign(new EventEmitter(), { id: senderId }) }
}

describe('Electron breadcrumb query IPC ownership', () => {
  it('scopes cancellation to the sender and retains ownership until worker completion', async () => {
    const completion = deferred<void>()
    const startBreadcrumbQuery = vi.fn().mockResolvedValue(manifest)
    const cancelBreadcrumbQuery = vi.fn().mockResolvedValue(true)
    const breadcrumbQueryCompletion = vi.fn().mockReturnValue(completion.promise)
    const { handler, invoke } = createHarness({
      startBreadcrumbQuery,
      readBreadcrumbQueryFrame: vi.fn(),
      finishBreadcrumbQuery: vi.fn().mockResolvedValue(undefined),
      cancelBreadcrumbQuery,
      breadcrumbQueryCompletion,
    })
    const eventA = eventFor(41)
    const eventB = eventFor(42)

    const first = await handler('start')(eventA, {
      missionId: 'mission-a',
      perDeviceLimit: 5_000,
      requestId: 'request-1',
    }) as { readonly snapshotId: string; readonly missionId: string }
    expect(first).toEqual(expect.objectContaining({
      ...manifest,
      snapshotId: expect.any(String),
      missionId: 'mission-a',
    }))
    expect(startBreadcrumbQuery).toHaveBeenCalledWith(
      'mission-a',
      5_000,
      '41:request-1',
    )
    expect(breadcrumbQueryCompletion).toHaveBeenCalledWith('41:request-1')

    await expect(handler('start')(eventA, {
      missionId: 'mission-a',
      perDeviceLimit: 5_000,
      requestId: 'request-1',
    })).rejects.toThrow(/already active/u)
    await expect(invoke('cancel', eventB, { requestId: 'request-1' })).resolves.toBe(false)
    expect(cancelBreadcrumbQuery).not.toHaveBeenCalledWith('42:request-1')

    const senderA = eventA.sender as EventEmitter
    senderA.emit('destroyed')
    await vi.waitFor(() => expect(cancelBreadcrumbQuery).toHaveBeenCalledWith('41:request-1'))
    expect(senderA.listenerCount('destroyed')).toBe(0)
    expect(senderA.listenerCount('render-process-gone')).toBe(1)

    completion.resolve()
    await vi.waitFor(() => expect(senderA.listenerCount('destroyed')).toBe(0))
    expect(senderA.listenerCount('render-process-gone')).toBe(0)

    const next = await handler('start')(eventA, {
      missionId: 'mission-a',
      perDeviceLimit: 5_000,
      requestId: 'request-1',
    }) as { readonly snapshotId: string }
    expect(next.snapshotId).not.toBe(first.snapshotId)
  })

  it('fences stale read, finish, and optional cancel snapshots while stamping valid frames', async () => {
    const completion = deferred<void>()
    const readBreadcrumbQueryFrame = vi.fn().mockResolvedValue({
      sequence: 0,
      payload: 'terminal',
      done: true,
    })
    const finishBreadcrumbQuery = vi.fn().mockResolvedValue(undefined)
    const cancelBreadcrumbQuery = vi.fn().mockResolvedValue(true)
    const { handler, invoke } = createHarness({
      startBreadcrumbQuery: vi.fn().mockResolvedValue(manifest),
      readBreadcrumbQueryFrame,
      finishBreadcrumbQuery,
      cancelBreadcrumbQuery,
      breadcrumbQueryCompletion: vi.fn().mockReturnValue(completion.promise),
    })
    const event = eventFor(77)
    const started = await handler('start')(event, {
      missionId: 'mission-a',
      perDeviceLimit: 5_000,
      requestId: 'request-1',
    }) as { readonly snapshotId: string }

    await expect(invoke('read', event, {
      requestId: 'request-1',
      snapshotId: 'stale-snapshot',
      sequence: 0,
    })).rejects.toThrow(/snapshot is not active/u)
    await expect(invoke('finish', event, {
      requestId: 'request-1',
      snapshotId: 'stale-snapshot',
    })).rejects.toThrow(/snapshot is not active/u)
    await expect(invoke('cancel', event, {
      requestId: 'request-1',
      snapshotId: 'stale-snapshot',
    })).rejects.toThrow(/snapshot is not active/u)
    expect(readBreadcrumbQueryFrame).not.toHaveBeenCalled()
    expect(finishBreadcrumbQuery).not.toHaveBeenCalled()
    expect(cancelBreadcrumbQuery).not.toHaveBeenCalled()

    await expect(invoke('read', event, {
      requestId: 'request-1',
      snapshotId: started.snapshotId,
      sequence: 0,
    })).resolves.toEqual({
      sequence: 0,
      payload: 'terminal',
      done: true,
      snapshotId: started.snapshotId,
    })
    expect(readBreadcrumbQueryFrame).toHaveBeenCalledWith('77:request-1', 0)
    await expect(invoke('finish', event, {
      requestId: 'request-1',
      snapshotId: started.snapshotId,
    })).resolves.toBeUndefined()
    expect(finishBreadcrumbQuery).toHaveBeenCalledWith('77:request-1')

    completion.resolve()
  })

  it('releases a failed start so the sender can retry the same request ID', async () => {
    const startBreadcrumbQuery = vi.fn()
      .mockRejectedValueOnce(new Error('worker failed during startup'))
      .mockResolvedValueOnce(manifest)
    const breadcrumbQueryCompletion = vi.fn().mockResolvedValue(undefined)
    const { handler } = createHarness({
      startBreadcrumbQuery,
      readBreadcrumbQueryFrame: vi.fn(),
      finishBreadcrumbQuery: vi.fn().mockResolvedValue(undefined),
      cancelBreadcrumbQuery: vi.fn().mockResolvedValue(true),
      breadcrumbQueryCompletion,
    })
    const event = eventFor(91)
    const query = {
      missionId: 'mission-a',
      perDeviceLimit: 5_000,
      requestId: 'retryable-request',
    }

    await expect(handler('start')(event, query)).rejects.toThrow('worker failed during startup')
    expect(breadcrumbQueryCompletion).toHaveBeenCalledWith('91:retryable-request')
    await expect(handler('start')(event, query)).resolves.toEqual(expect.objectContaining({
      ...manifest,
      snapshotId: expect.any(String),
      missionId: 'mission-a',
    }))
    expect(startBreadcrumbQuery).toHaveBeenNthCalledWith(
      2,
      'mission-a',
      5_000,
      '91:retryable-request',
    )
  })
})
