import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { registerMissionReviewReadQueryIpcHandlers } = require(
  '../../electron/mission-review-read-query-ipc.cjs',
) as {
  readonly registerMissionReviewReadQueryIpcHandlers: (input: {
    readonly ipcMain: {
      readonly handle: (
        channel: string,
        handler: (event: unknown, ...args: readonly unknown[]) => unknown,
      ) => void
    }
    readonly readChannel: string
    readonly cancelChannel: string
    readonly missionStore: {
      readonly readMissionReview: (query: unknown, requestId: string) => Promise<unknown>
      readonly cancelMissionReviewRead: (requestId: string) => Promise<boolean>
    }
    readonly validateIpcSender: (event: unknown) => void
  }) => void
}

describe('Mission Review read IPC ownership [DON-251]', () => {
  it('cancels a destroyed renderer without exposing another renderer query', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    let rejectQuery: (error: Error) => void = () => undefined
    const query = new Promise((_resolve, reject) => {
      rejectQuery = reject
    })
    const readMissionReview = vi.fn().mockReturnValue(query)
    const cancelMissionReviewRead = vi.fn().mockImplementation(async (requestId: string) => {
      if (requestId === '41:mission-review:request-1') {
        rejectQuery(new Error('destroyed Review worker terminated'))
        return true
      }
      return false
    })
    registerMissionReviewReadQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannel: 'read',
      cancelChannel: 'cancel',
      missionStore: { readMissionReview, cancelMissionReviewRead },
      validateIpcSender: vi.fn(),
    })
    const senderA = Object.assign(new EventEmitter(), { id: 41 })
    const senderB = Object.assign(new EventEmitter(), { id: 42 })
    const input = { missionId: 'mission-1', includeTelemetry: false, auditLimit: 501 }

    const readResult = Promise.resolve(
      handlers.get('read')?.({ sender: senderA }, input, 'request-1'),
    )
    const readRejection = expect(readResult).rejects.toThrow(/terminated/u)
    expect(readMissionReview).toHaveBeenCalledWith(
      input,
      '41:mission-review:request-1',
    )

    await expect(
      handlers.get('cancel')?.({ sender: senderB }, 'request-1'),
    ).resolves.toBe(false)
    expect(cancelMissionReviewRead).toHaveBeenLastCalledWith(
      '42:mission-review:request-1',
    )

    senderA.emit('destroyed')
    await readRejection
    expect(cancelMissionReviewRead).toHaveBeenCalledWith(
      '41:mission-review:request-1',
    )
  })

  it('removes renderer lifecycle listeners after normal completion', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const missionStore = {
      readMissionReview: vi.fn().mockResolvedValue({ auditEvents: [], breadcrumbCount: 0 }),
      cancelMissionReviewRead: vi.fn().mockResolvedValue(false),
    }
    registerMissionReviewReadQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannel: 'read',
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 77 })

    await expect(
      handlers.get('read')?.(
        { sender },
        { missionId: 'mission-1', includeTelemetry: false, auditLimit: 501 },
        'request-2',
      ),
    ).resolves.toEqual({ auditEvents: [], breadcrumbCount: 0 })

    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
  })
})
