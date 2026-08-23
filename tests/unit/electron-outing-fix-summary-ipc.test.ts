import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { registerOutingFixSummaryIpcHandlers } = require(
  '../../electron/outing-fix-summary-ipc.cjs',
) as {
  readonly registerOutingFixSummaryIpcHandlers: (input: {
    readonly ipcMain: {
      readonly handle: (
        channel: string,
        handler: (event: unknown, ...args: readonly unknown[]) => unknown,
      ) => void
    }
    readonly readChannel: string
    readonly cancelChannel: string
    readonly missionStore: {
      readonly readOutingFixSummary: (query: unknown, requestId: string) => Promise<unknown>
      readonly cancelOutingFixSummary: (requestId: string) => Promise<boolean>
    }
    readonly validateIpcSender: (event: unknown) => void
  }) => void
}

describe('outing fix-summary IPC ownership [DON-270]', () => {
  it('scopes cancellation to the renderer that owns the request', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    let rejectQuery: (error: Error) => void = () => undefined
    const query = new Promise((_resolve, reject) => {
      rejectQuery = reject
    })
    const readOutingFixSummary = vi.fn().mockReturnValue(query)
    const cancelOutingFixSummary = vi.fn().mockImplementation(async (requestId: string) => {
      if (requestId === '41:outing-fix-summary:request-1') {
        rejectQuery(new Error('destroyed outing summary worker terminated'))
        return true
      }
      return false
    })
    registerOutingFixSummaryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannel: 'read',
      cancelChannel: 'cancel',
      missionStore: { readOutingFixSummary, cancelOutingFixSummary },
      validateIpcSender: vi.fn(),
    })
    const senderA = Object.assign(new EventEmitter(), { id: 41 })
    const senderB = Object.assign(new EventEmitter(), { id: 42 })
    const input = { missionId: 'mission-1' }

    const readResult = Promise.resolve(
      handlers.get('read')?.({ sender: senderA }, input, 'request-1'),
    )
    const readRejection = expect(readResult).rejects.toThrow(/terminated/u)
    expect(readOutingFixSummary).toHaveBeenCalledWith(
      input,
      '41:outing-fix-summary:request-1',
    )

    await expect(
      handlers.get('cancel')?.({ sender: senderB }, 'request-1'),
    ).resolves.toBe(false)
    expect(cancelOutingFixSummary).toHaveBeenLastCalledWith(
      '42:outing-fix-summary:request-1',
    )

    senderA.emit('destroyed')
    await readRejection
    expect(cancelOutingFixSummary).toHaveBeenCalledWith(
      '41:outing-fix-summary:request-1',
    )
  })

  it('removes renderer lifecycle listeners after normal completion', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const missionStore = {
      readOutingFixSummary: vi.fn().mockResolvedValue({
        totalBreadcrumbCount: 2,
        unassignedBreadcrumbCount: 1,
        outings: [],
      }),
      cancelOutingFixSummary: vi.fn().mockResolvedValue(false),
    }
    registerOutingFixSummaryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannel: 'read',
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 77 })

    await expect(
      handlers.get('read')?.({ sender }, { missionId: 'mission-1' }, 'request-2'),
    ).resolves.toMatchObject({ unassignedBreadcrumbCount: 1 })

    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
  })
})
