import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { registerCoverageIpcHandlers } = require('../../electron/coverage-ipc.cjs') as {
  readonly registerCoverageIpcHandlers: (input: {
    readonly ipcMain: { readonly handle: (channel: string, handler: (...args: never[]) => unknown) => void }
    readonly readChannels: {
      readonly manifest: string
      readonly chunk: string
      readonly claim: string
      readonly catalog: string
    }
    readonly cancelChannel: string
    readonly missionStore: {
      readonly readCoverageManifest: (missionId: string, requestId: string) => Promise<unknown>
      readonly readCoverageChunk: (query: unknown, requestId: string) => Promise<unknown>
      readonly readCoverageClaim: (query: unknown, requestId: string) => Promise<unknown>
      readonly syncCoverageTileCatalog: (query: unknown, requestId: string) => Promise<unknown>
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
    const readCoverageManifest = vi.fn().mockReturnValue(query)
    const cancelCoverageQuery = vi.fn().mockImplementation(async (requestId: string) => {
      if (requestId === '41:coverage:request-1') {
        rejectQuery(new Error('destroyed coverage worker terminated'))
        return true
      }
      return false
    })
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
      cancelChannel: 'cancel',
      missionStore: {
        readCoverageManifest,
        readCoverageChunk: vi.fn(),
        readCoverageClaim: vi.fn(),
        syncCoverageTileCatalog: vi.fn(),
        cancelCoverageQuery,
      },
      validateIpcSender: vi.fn(),
    })
    const senderA = Object.assign(new EventEmitter(), { id: 41 })
    const senderB = Object.assign(new EventEmitter(), { id: 42 })
    const readResult = Promise.resolve(handlers.get('manifest')?.(
      { sender: senderA }, 'mission-1', 'request-1',
    ))
    const rejection = expect(readResult).rejects.toThrow(/terminated/u)
    expect(readCoverageManifest).toHaveBeenCalledWith('mission-1', '41:coverage:request-1')
    await expect(handlers.get('cancel')?.({ sender: senderB }, 'request-1')).resolves.toBe(false)
    expect(cancelCoverageQuery).toHaveBeenLastCalledWith('42:coverage:request-1')

    senderA.emit('render-process-gone')
    await rejection
    expect(cancelCoverageQuery).toHaveBeenCalledWith('41:coverage:request-1')
  })

  it('removes lifecycle listeners after normal completion', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const missionStore = {
      readCoverageManifest: vi.fn().mockResolvedValue({ chunks: [] }),
      readCoverageChunk: vi.fn().mockResolvedValue({ positions: [] }),
      readCoverageClaim: vi.fn().mockResolvedValue({ databaseReady: true }),
      syncCoverageTileCatalog: vi.fn().mockResolvedValue({ periods: [] }),
      cancelCoverageQuery: vi.fn().mockResolvedValue(false),
    }
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
      cancelChannel: 'cancel', missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 77 })

    await expect(handlers.get('manifest')?.(
      { sender }, 'mission-1', 'request-2',
    )).resolves.toEqual({ chunks: [] })
    expect(sender.listenerCount('destroyed')).toBe(0)
    expect(sender.listenerCount('render-process-gone')).toBe(0)
  })

  it('routes chunk and claim reads through their named mission-store methods', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const missionStore = {
      readCoverageManifest: vi.fn(),
      readCoverageChunk: vi.fn().mockResolvedValue({ positions: [] }),
      readCoverageClaim: vi.fn().mockResolvedValue({ databaseReady: true }),
      syncCoverageTileCatalog: vi.fn().mockResolvedValue({ periods: [] }),
      cancelCoverageQuery: vi.fn().mockResolvedValue(false),
    }
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
      cancelChannel: 'cancel', missionStore,
      validateIpcSender: vi.fn(),
    })
    const event = { sender: Object.assign(new EventEmitter(), { id: 91 }) }
    const chunkInput = { missionId: 'mission-1', expectedContentRev: 4 }
    const claimInput = { missionId: 'mission-1', selectedKeys: [] }

    await handlers.get('chunk')?.(event, chunkInput, 'chunk-1')
    await handlers.get('claim')?.(event, claimInput, 'claim-1')
    await handlers.get('catalog')?.(event, claimInput, 'catalog-1')

    expect(missionStore.readCoverageChunk).toHaveBeenCalledWith(
      chunkInput, '91:coverage:chunk-1',
    )
    expect(missionStore.readCoverageClaim).toHaveBeenCalledWith(
      claimInput, '91:coverage:claim-1',
    )
    expect(missionStore.syncCoverageTileCatalog).toHaveBeenCalledWith(
      claimInput, '91:coverage:catalog-1',
    )
  })
})
