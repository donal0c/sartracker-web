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
    readonly listChannel: string
    readonly cancelChannel: string
    readonly missionStore: {
      readonly listBreadcrumbPositions: (
        missionId: string,
        perDeviceLimit: number,
        requestId: string,
      ) => Promise<unknown>
      readonly cancelBreadcrumbQuery: (requestId: string) => Promise<boolean>
    }
    readonly validateIpcSender: (event: unknown) => void
  }) => void
}

describe('Electron breadcrumb query IPC ownership', () => {
  it('cancels a destroyed sender without allowing another renderer to cancel its query', async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: readonly unknown[]) => unknown
    >()
    let rejectQuery: (error: Error) => void = () => undefined
    const query = new Promise((_resolve, reject) => {
      rejectQuery = reject
    })
    const listBreadcrumbPositions = vi.fn().mockReturnValue(query)
    const cancelBreadcrumbQuery = vi.fn().mockImplementation(
      async (requestId: string) => {
        if (requestId === '41:request-1') {
          rejectQuery(new Error('destroyed renderer worker terminated'))
          return true
        }
        return false
      },
    )
    registerBreadcrumbQueryIpcHandlers({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
      },
      listChannel: 'list',
      cancelChannel: 'cancel',
      missionStore: { listBreadcrumbPositions, cancelBreadcrumbQuery },
      validateIpcSender: vi.fn(),
    })
    const senderA = Object.assign(new EventEmitter(), { id: 41 })
    const senderB = Object.assign(new EventEmitter(), { id: 42 })
    const eventA = { sender: senderA }
    const eventB = { sender: senderB }

    const listResult = Promise.resolve(
      handlers.get('list')?.(eventA, 'mission-a', 5_000, 'request-1'),
    )
    const listRejection = expect(listResult).rejects.toThrow(/terminated/u)
    expect(listBreadcrumbPositions).toHaveBeenCalledWith(
      'mission-a',
      5_000,
      '41:request-1',
    )
    expect(senderA.listenerCount('destroyed')).toBe(1)
    expect(senderA.listenerCount('render-process-gone')).toBe(1)

    await expect(
      handlers.get('cancel')?.(eventB, 'request-1'),
    ).resolves.toBe(false)
    expect(cancelBreadcrumbQuery).toHaveBeenLastCalledWith('42:request-1')

    senderA.emit('destroyed')
    await listRejection
    expect(cancelBreadcrumbQuery).toHaveBeenCalledWith('41:request-1')
    expect(senderA.listenerCount('destroyed')).toBe(0)
    expect(senderA.listenerCount('render-process-gone')).toBe(0)
  })

  it('removes crash listeners after normal query completion', async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: readonly unknown[]) => unknown
    >()
    const missionStore = {
      listBreadcrumbPositions: vi.fn().mockResolvedValue({ positions: [] }),
      cancelBreadcrumbQuery: vi.fn().mockResolvedValue(false),
    }
    registerBreadcrumbQueryIpcHandlers({
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
      },
      listChannel: 'list',
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 77 })

    await expect(
      handlers.get('list')?.(
        { sender },
        'mission-a',
        5_000,
        'session-b-request-1',
      ),
    ).resolves.toEqual({ positions: [] })

    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
    sender.emit('destroyed')
    expect(missionStore.cancelBreadcrumbQuery).not.toHaveBeenCalled()
  })
})
