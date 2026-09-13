import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

describe('Electron exact breadcrumb-dot IPC ownership', () => {
  it('scopes list and cancellation to the renderer without colliding with line requests', async () => {
    const { registerExactBreadcrumbDotQueryIpcHandlers } = require(
      '../../electron/breadcrumb-query-ipc.cjs',
    ) as {
      readonly registerExactBreadcrumbDotQueryIpcHandlers: (input: {
        readonly ipcMain: {
          readonly handle: (
            channel: string,
            handler: (event: unknown, ...args: readonly unknown[]) => unknown,
          ) => void
        }
        readonly listChannel: string
        readonly cancelChannel: string
        readonly missionStore: {
          readonly listExactBreadcrumbDotPage: (
            query: unknown,
            requestId: string,
          ) => Promise<unknown>
          readonly cancelExactBreadcrumbDotQuery: (requestId: string) => Promise<boolean>
        }
        readonly validateIpcSender: (event: unknown) => void
      }) => void
    }
    const handlers = new Map<
      string,
      (event: unknown, ...args: readonly unknown[]) => unknown
    >()
    const missionStore = {
      listExactBreadcrumbDotPage: vi.fn().mockResolvedValue({ positions: [] }),
      cancelExactBreadcrumbDotQuery: vi.fn().mockResolvedValue(true),
    }
    registerExactBreadcrumbDotQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      listChannel: 'list-exact',
      cancelChannel: 'cancel-exact',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 41 })
    const event = { sender }
    const query = {
      missionId: 'mission-a',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    }

    await expect(
      handlers.get('list-exact')?.(event, query, 'request-1'),
    ).resolves.toEqual({ positions: [] })
    expect(missionStore.listExactBreadcrumbDotPage).toHaveBeenCalledWith(
      query,
      '41:exact-dot:request-1',
    )
    await expect(
      handlers.get('cancel-exact')?.(event, 'request-1'),
    ).resolves.toBe(true)
    expect(missionStore.cancelExactBreadcrumbDotQuery).toHaveBeenCalledWith(
      '41:exact-dot:request-1',
    )
  })

  it('cancels a pending dot query on main-frame navigation and ignores subframe navigation', async () => {
    let resolveList!: (value: { readonly positions: readonly unknown[] }) => void
    const list = new Promise<{ readonly positions: readonly unknown[] }>((resolve) => {
      resolveList = resolve
    })
    const cancelExactBreadcrumbDotQuery = vi.fn().mockResolvedValue(true)
    const { registerExactBreadcrumbDotQueryIpcHandlers } = require(
      '../../electron/breadcrumb-query-ipc.cjs',
    ) as {
      readonly registerExactBreadcrumbDotQueryIpcHandlers: (input: {
        readonly ipcMain: {
          readonly handle: (
            channel: string,
            handler: (event: unknown, ...args: readonly unknown[]) => unknown,
          ) => void
        }
        readonly listChannel: string
        readonly cancelChannel: string
        readonly missionStore: {
          readonly listExactBreadcrumbDotPage: (
            query: unknown,
            requestId: string,
          ) => Promise<unknown>
          readonly cancelExactBreadcrumbDotQuery: (requestId: string) => Promise<boolean>
        }
        readonly validateIpcSender: (event: unknown) => void
      }) => void
    }
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const missionStore = {
      listExactBreadcrumbDotPage: vi.fn(() => list),
      cancelExactBreadcrumbDotQuery,
    }
    registerExactBreadcrumbDotQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      listChannel: 'list-exact',
      cancelChannel: 'cancel-exact',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 42 })
    const event = { sender }
    const request = handlers.get('list-exact')!(event, {
      missionId: 'mission-a',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    }, 'navigation')

    sender.emit('did-start-navigation', {}, 'https://example.test/frame', false, false)
    await Promise.resolve()
    expect(cancelExactBreadcrumbDotQuery).not.toHaveBeenCalled()
    sender.emit('did-start-navigation', {}, 'https://example.test/hash', true, true)
    await Promise.resolve()
    expect(cancelExactBreadcrumbDotQuery).not.toHaveBeenCalled()
    sender.emit('did-start-navigation', {}, 'https://example.test/reload', false, true)
    await vi.waitFor(() => expect(cancelExactBreadcrumbDotQuery)
      .toHaveBeenCalledWith('42:exact-dot:navigation'))
    expect(sender.listenerCount('did-start-navigation')).toBe(0)
    resolveList({ positions: [] })
    await expect(request).resolves.toEqual({ positions: [] })
    expect(sender.listenerCount('did-start-navigation')).toBe(0)
  })
})
