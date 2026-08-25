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
    readonly activationChannels?: {
      readonly activate: string
      readonly finalize: string
      readonly discard: string
    }
    readonly tileChannels?: {
      readonly read: string
      readonly cancel: string
    }
    readonly cancelChannel: string
    readonly missionStore: {
      readonly readCoverageManifest: (missionId: string, requestId: string) => Promise<unknown>
      readonly readCoverageChunk: (query: unknown, requestId: string) => Promise<unknown>
      readonly readCoverageClaim: (query: unknown, requestId: string) => Promise<unknown>
      readonly syncCoverageTileCatalog: (query: unknown, requestId: string) => Promise<unknown>
      readonly activateCoverageTileCatalog?: (input: unknown) => Promise<unknown>
      readonly finalizeCoverageTileCatalog?: (input: unknown) => Promise<unknown>
      readonly discardCoverageTileCatalog?: (input: unknown) => Promise<unknown>
      readonly cancelCoverageQuery: (requestId: string) => Promise<boolean>
      readonly readCoverageTile?: (query: unknown, requestId: string) => Promise<unknown>
      readonly cancelCoverageTileRead?: (requestId: string) => Promise<boolean>
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

  it('scopes tile reads to their renderer and cancels only the destroyed owner', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    let rejectOwnedRead: (error: Error) => void = () => undefined
    const ownedRead = new Promise((_resolve, reject) => { rejectOwnedRead = reject })
    const readCoverageTile = vi.fn()
      .mockReturnValueOnce(ownedRead)
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
    const cancelCoverageTileRead = vi.fn().mockImplementation(async (requestId: string) => {
      if (requestId === '52:coverage:tile-1') {
        rejectOwnedRead(new Error('destroyed renderer tile read cancelled'))
        return true
      }
      return false
    })
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
      tileChannels: { read: 'tile-read', cancel: 'tile-cancel' },
      cancelChannel: 'cancel',
      missionStore: {
        readCoverageManifest: vi.fn(), readCoverageChunk: vi.fn(),
        readCoverageClaim: vi.fn(), syncCoverageTileCatalog: vi.fn(),
        cancelCoverageQuery: vi.fn(), readCoverageTile, cancelCoverageTileRead,
      },
      validateIpcSender: vi.fn(),
    })
    const senderA = Object.assign(new EventEmitter(), { id: 52 })
    const senderB = Object.assign(new EventEmitter(), { id: 53 })
    const ownerRead = Promise.resolve(handlers.get('tile-read')?.(
      { sender: senderA }, { z: 8 }, 'tile-1',
    ))
    const rejection = expect(ownerRead).rejects.toThrow(/cancelled/u)
    expect(readCoverageTile).toHaveBeenCalledWith({ z: 8 }, '52:coverage:tile-1')

    await expect(handlers.get('tile-cancel')?.(
      { sender: senderB }, 'tile-1',
    )).resolves.toBe(false)
    expect(cancelCoverageTileRead).toHaveBeenLastCalledWith('53:coverage:tile-1')

    senderA.emit('render-process-gone')
    await rejection
    expect(cancelCoverageTileRead).toHaveBeenCalledWith('52:coverage:tile-1')
    expect(senderA.listenerCount('destroyed')).toBe(0)
    expect(senderA.listenerCount('render-process-gone')).toBe(0)

    await expect(handlers.get('tile-read')?.(
      { sender: senderB }, { z: 8 }, 'tile-1',
    )).resolves.toEqual(new Uint8Array([1, 2, 3]))
  })

  it('owns staged catalogs until activation and discards them when the renderer dies', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const discardCoverageTileCatalog = vi.fn().mockResolvedValue(true)
    const activateCoverageTileCatalog = vi.fn().mockResolvedValue(true)
    const missionStore = {
      readCoverageManifest: vi.fn(),
      readCoverageChunk: vi.fn(),
      readCoverageClaim: vi.fn(),
      syncCoverageTileCatalog: vi.fn().mockResolvedValue({
        activationId: 'coverage-stage-owned',
        periods: [],
        delivered: [],
      }),
      activateCoverageTileCatalog,
      discardCoverageTileCatalog,
      cancelCoverageQuery: vi.fn().mockResolvedValue(false),
    }
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
      activationChannels: { activate: 'activate', finalize: 'finalize', discard: 'discard' },
      cancelChannel: 'cancel', missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 73 })

    await expect(handlers.get('catalog')?.(
      { sender }, { missionId: 'mission-1', chunks: [] }, 'catalog-owned',
    )).resolves.toMatchObject({ activationId: 'coverage-stage-owned' })
    expect(sender.listenerCount('destroyed')).toBe(1)
    expect(sender.listenerCount('render-process-gone')).toBe(1)

    sender.emit('render-process-gone')
    await vi.waitFor(() => expect(discardCoverageTileCatalog).toHaveBeenCalledWith({
      activationId: 'coverage-stage-owned',
    }))
    expect(activateCoverageTileCatalog).not.toHaveBeenCalled()
  })

  it('retains ownership after activation and releases it only after finalization', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const activateCoverageTileCatalog = vi.fn().mockResolvedValue(true)
    const finalizeCoverageTileCatalog = vi.fn().mockResolvedValue(true)
    const missionStore = {
      readCoverageManifest: vi.fn(),
      readCoverageChunk: vi.fn(),
      readCoverageClaim: vi.fn(),
      syncCoverageTileCatalog: vi.fn().mockResolvedValue({
        activationId: 'coverage-stage-private', periods: [], delivered: [],
      }),
      activateCoverageTileCatalog,
      finalizeCoverageTileCatalog,
      discardCoverageTileCatalog: vi.fn().mockResolvedValue(true),
      cancelCoverageQuery: vi.fn().mockResolvedValue(false),
    }
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
      activationChannels: { activate: 'activate', finalize: 'finalize', discard: 'discard' },
      cancelChannel: 'cancel', missionStore,
      validateIpcSender: vi.fn(),
    })
    const owner = Object.assign(new EventEmitter(), { id: 80 })
    const stranger = Object.assign(new EventEmitter(), { id: 81 })
    const payload = { activationId: 'coverage-stage-private' }
    await handlers.get('catalog')?.(
      { sender: owner }, { missionId: 'mission-1', chunks: [] }, 'catalog-private',
    )

    await expect(handlers.get('activate')?.({ sender: stranger }, payload))
      .rejects.toThrow(/not owned/iu)
    await expect(handlers.get('activate')?.({ sender: owner }, payload)).resolves.toBe(true)

    expect(activateCoverageTileCatalog).toHaveBeenCalledOnce()
    expect(owner.listenerCount('destroyed')).toBe(1)
    expect(owner.listenerCount('render-process-gone')).toBe(1)
    await expect(handlers.get('finalize')?.({ sender: stranger }, payload))
      .rejects.toThrow(/not owned/iu)
    await expect(handlers.get('finalize')?.({ sender: owner }, payload)).resolves.toBe(true)

    expect(finalizeCoverageTileCatalog).toHaveBeenCalledOnce()
    expect(owner.listenerCount('destroyed')).toBe(0)
    expect(owner.listenerCount('render-process-gone')).toBe(0)
  })

  it('retains stage ownership when non-terminal activation fails and is retried', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const activateCoverageTileCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('activation response interrupted'))
      .mockResolvedValueOnce(true)
    const finalizeCoverageTileCatalog = vi.fn().mockResolvedValue(true)
    const missionStore = {
      readCoverageManifest: vi.fn(),
      readCoverageChunk: vi.fn(),
      readCoverageClaim: vi.fn(),
      syncCoverageTileCatalog: vi.fn().mockResolvedValue({
        activationId: 'coverage-stage-retry', periods: [], delivered: [],
      }),
      activateCoverageTileCatalog,
      finalizeCoverageTileCatalog,
      discardCoverageTileCatalog: vi.fn().mockResolvedValue(true),
      cancelCoverageQuery: vi.fn().mockResolvedValue(false),
    }
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
      activationChannels: { activate: 'activate', finalize: 'finalize', discard: 'discard' },
      cancelChannel: 'cancel', missionStore,
      validateIpcSender: vi.fn(),
    })
    const owner = Object.assign(new EventEmitter(), { id: 82 })
    const payload = { activationId: 'coverage-stage-retry' }
    await handlers.get('catalog')?.(
      { sender: owner }, { missionId: 'mission-1', chunks: [] }, 'catalog-retry',
    )

    await expect(handlers.get('activate')?.({ sender: owner }, payload))
      .rejects.toThrow(/interrupted/iu)
    expect(owner.listenerCount('destroyed')).toBe(1)
    await expect(handlers.get('activate')?.({ sender: owner }, payload)).resolves.toBe(true)
    await expect(handlers.get('finalize')?.({ sender: owner }, payload)).resolves.toBe(true)
  })

  it('retains stage ownership when a terminal transition fails before retry', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const finalizeCoverageTileCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('activation is no longer current'))
    const discardCoverageTileCatalog = vi.fn().mockResolvedValue(true)
    const missionStore = {
      readCoverageManifest: vi.fn(),
      readCoverageChunk: vi.fn(),
      readCoverageClaim: vi.fn(),
      syncCoverageTileCatalog: vi.fn().mockResolvedValue({
        activationId: 'coverage-stage-terminal-retry', periods: [], delivered: [],
      }),
      activateCoverageTileCatalog: vi.fn().mockResolvedValue(true),
      finalizeCoverageTileCatalog,
      discardCoverageTileCatalog,
      cancelCoverageQuery: vi.fn().mockResolvedValue(false),
    }
    registerCoverageIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as never) },
      readChannels: { manifest: 'manifest', chunk: 'chunk', claim: 'claim', catalog: 'catalog' },
      activationChannels: { activate: 'activate', finalize: 'finalize', discard: 'discard' },
      cancelChannel: 'cancel', missionStore,
      validateIpcSender: vi.fn(),
    })
    const owner = Object.assign(new EventEmitter(), { id: 83 })
    const payload = { activationId: 'coverage-stage-terminal-retry' }
    await handlers.get('catalog')?.(
      { sender: owner }, { missionId: 'mission-1', chunks: [] }, 'catalog-terminal-retry',
    )

    await expect(handlers.get('finalize')?.({ sender: owner }, payload))
      .rejects.toThrow(/no longer current/iu)
    expect(owner.listenerCount('destroyed')).toBe(1)
    await expect(handlers.get('discard')?.({ sender: owner }, payload)).resolves.toBe(true)
    expect(discardCoverageTileCatalog).toHaveBeenCalledOnce()
    expect(owner.listenerCount('destroyed')).toBe(0)
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
