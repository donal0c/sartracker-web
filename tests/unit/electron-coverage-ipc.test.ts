import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { registerCoverageIpcHandlers } = require('../../electron/coverage-ipc.cjs') as {
  readonly registerCoverageIpcHandlers: (input: {
    readonly ipcMain: { readonly handle: (channel: string, handler: (...args: never[]) => unknown) => void }
    readonly readChannel: string
    readonly cancelChannel: string
    readonly missionStore: {
      readonly readCoverage: (query: unknown, requestId: string) => Promise<unknown>
      readonly cancelCoverageQuery: (requestId: string) => Promise<boolean>
    }
    readonly validateIpcSender: (event: unknown) => void
  }) => void
}

describe('coverage IPC ownership [DON-276]', () => {
  it('scopes request and cancellation IDs to the owning renderer', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    let rejectQuery: (error: Error) => void = () => undefined
    const query = new Promise((_resolve, reject) => { rejectQuery = reject })
    const readCoverage = vi.fn().mockReturnValue(query)
    const cancelCoverageQuery = vi.fn().mockImplementation(async (requestId: string) => {
      if (requestId === '41:coverage:request-1') {
        rejectQuery(new Error('destroyed coverage worker terminated'))
        return true
      }
      return false
    })
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannel: 'read', cancelChannel: 'cancel',
      missionStore: { readCoverage, cancelCoverageQuery },
      validateIpcSender: vi.fn(),
    })
    const senderA = Object.assign(new EventEmitter(), { id: 41 })
    const senderB = Object.assign(new EventEmitter(), { id: 42 })
    const input = { kind: 'manifest', missionId: 'mission-1' }

    const readResult = Promise.resolve(handlers.get('read')?.({ sender: senderA }, input, 'request-1'))
    const rejection = expect(readResult).rejects.toThrow(/terminated/u)
    expect(readCoverage).toHaveBeenCalledWith(input, '41:coverage:request-1')
    await expect(handlers.get('cancel')?.({ sender: senderB }, 'request-1')).resolves.toBe(false)
    expect(cancelCoverageQuery).toHaveBeenLastCalledWith('42:coverage:request-1')

    senderA.emit('render-process-gone')
    await rejection
    expect(cancelCoverageQuery).toHaveBeenCalledWith('41:coverage:request-1')
  })

  it('removes lifecycle listeners after normal completion', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const missionStore = {
      readCoverage: vi.fn().mockResolvedValue({ chunks: [] }),
      cancelCoverageQuery: vi.fn().mockResolvedValue(false),
    }
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannel: 'read', cancelChannel: 'cancel', missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 77 })

    await expect(handlers.get('read')?.(
      { sender }, { kind: 'manifest', missionId: 'mission-1' }, 'request-2',
    )).resolves.toEqual({ chunks: [] })
    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
  })
})
