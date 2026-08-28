import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { registerMissionReplayQueryIpcHandlers } = require(
  '../../electron/mission-replay-query-ipc.cjs',
) as {
  readonly registerMissionReplayQueryIpcHandlers: (input: {
    readonly ipcMain: {
      readonly handle: (
        channel: string,
        handler: (event: unknown, ...args: readonly unknown[]) => unknown,
      ) => void
    }
    readonly readChannels: {
      readonly state: string
      readonly trackChunk: string
      readonly objectChunk: string
    }
    readonly cancelChannel: string
    readonly missionStore: {
      readonly readMissionReplay: (query: unknown, requestId: string) => Promise<unknown>
      readonly readMissionReplayTrackChunk: (
        query: unknown,
        requestId: string,
      ) => Promise<unknown>
      readonly readMissionReplayObjectChunk: (
        query: unknown,
        requestId: string,
      ) => Promise<unknown>
      readonly cancelMissionReplay: (requestId: string) => Promise<boolean>
    }
    readonly validateIpcSender: (event: unknown) => void
  }) => void
}

describe('Mission Replay query IPC ownership [DON-278]', () => {
  it('loads in Electron sandboxed preload and projects Replay without local require access', async () => {
    const preload = readFileSync('electron/preload.cjs', 'utf8')
    const invoke = vi.fn().mockResolvedValue({ tracks: [] })
    let exposedBridge: Record<string, unknown> | undefined

    expect(() => runInNewContext(preload, {
      require: (specifier: string) => {
        if (specifier !== 'electron') {
          throw new Error(`Sandboxed preload cannot require ${specifier}.`)
        }
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, bridge: Record<string, unknown>) => {
              exposedBridge = bridge
            },
          },
          ipcRenderer: {
            invoke,
            on: vi.fn(),
            removeListener: vi.fn(),
            send: vi.fn(),
          },
        }
      },
      window: { addEventListener: vi.fn() },
    })).not.toThrow()

    const missionStore = exposedBridge?.missionStore as {
      readonly readMissionReplay: (query: unknown, requestId: string) => Promise<unknown>
    }
    await missionStore.readMissionReplay({
      missionId: 'mission-1',
      selectedTime: '2026-08-28T12:00:00Z',
      trackLimit: 100,
      rendererControlledBlob: 'x'.repeat(64 * 1024 * 1024),
    }, 'bounded-query')

    expect(invoke).toHaveBeenCalledWith(
      'sartracker:mission-store:read-mission-replay',
      {
        missionId: 'mission-1',
        selectedTime: '2026-08-28T12:00:00Z',
        trackLimit: 100,
      },
      'bounded-query',
    )
  })

  it('projects renderer queries before main dispatch and preload worker cloning', async () => {
    const handlers = new Map<string, (event: unknown, ...args: readonly unknown[]) => unknown>()
    const missionStore = {
      readMissionReplay: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayTrackChunk: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayObjectChunk: vi.fn().mockResolvedValue({ objects: [] }),
      cancelMissionReplay: vi.fn().mockResolvedValue(false),
    }
    registerMissionReplayQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannels: { state: 'state', trackChunk: 'trackChunk', objectChunk: 'objectChunk' },
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 12 })

    await handlers.get('state')?.({ sender }, {
      missionId: 'mission-1',
      selectedTime: '2026-08-28T12:00:00Z',
      trackLimit: 100,
      rendererControlledBlob: 'x'.repeat(1024 * 1024),
    }, 'bounded-query')

    expect(missionStore.readMissionReplay).toHaveBeenCalledWith({
      missionId: 'mission-1',
      selectedTime: '2026-08-28T12:00:00.000Z',
      trackLimit: 100,
      objectLimit: 100,
      deviceIds: null,
      outingIds: null,
      timezone: 'Europe/Dublin',
    }, '12:mission-replay:bounded-query')
    const preload = readFileSync('electron/preload.cjs', 'utf8')
    expect(preload).toContain("projectReplayQueryForIpc(query, 'state')")
    expect(preload).toContain("projectReplayQueryForIpc(query, 'chunk')")
    expect(preload).toContain("projectReplayQueryForIpc(query, 'objects')")
  })

  it.each([
    ['state', 'readMissionReplay', 'destroyed'],
    ['state', 'readMissionReplay', 'render-process-gone'],
    ['trackChunk', 'readMissionReplayTrackChunk', 'destroyed'],
    ['trackChunk', 'readMissionReplayTrackChunk', 'render-process-gone'],
    ['objectChunk', 'readMissionReplayObjectChunk', 'destroyed'],
    ['objectChunk', 'readMissionReplayObjectChunk', 'render-process-gone'],
  ] as const)(
    'cancels a renderer-owned %s worker through %s on %s without exposing its request ID',
    async (channel, methodName, teardownEvent) => {
      const handlers = new Map<
        string,
        (event: unknown, ...args: readonly unknown[]) => unknown
      >()
      let rejectQuery: (error: Error) => void = () => undefined
      const query = new Promise((_resolve, reject) => {
        rejectQuery = reject
      })
      const readMissionReplay = vi.fn().mockReturnValue(query)
      const readMissionReplayTrackChunk = vi.fn().mockReturnValue(query)
      const readMissionReplayObjectChunk = vi.fn().mockReturnValue(query)
      const cancelMissionReplay = vi.fn().mockImplementation(async (requestId: string) => {
        if (requestId === '41:mission-replay:request-1') {
          rejectQuery(new Error('destroyed Replay worker terminated'))
          return true
        }
        return false
      })
      const missionStore = {
        readMissionReplay,
        readMissionReplayTrackChunk,
        readMissionReplayObjectChunk,
        cancelMissionReplay,
      }
      registerMissionReplayQueryIpcHandlers({
        ipcMain: { handle: (registeredChannel, handler) => {
          handlers.set(registeredChannel, handler)
        } },
        readChannels: {
          state: 'state',
          trackChunk: 'trackChunk',
          objectChunk: 'objectChunk',
        },
        cancelChannel: 'cancel',
        missionStore,
        validateIpcSender: vi.fn(),
      })
      const senderA = Object.assign(new EventEmitter(), { id: 41 })
      const senderB = Object.assign(new EventEmitter(), { id: 42 })
      const input = {
        missionId: 'mission-1',
        selectedTime: '2026-08-28T12:00:00Z',
        trackLimit: 100,
        ...(channel === 'objectChunk' ? { replayGeneration: 0 } : {}),
      }
      const expectedInput = expect.objectContaining({
        missionId: 'mission-1',
        selectedTime: '2026-08-28T12:00:00.000Z',
        trackLimit: 100,
      })

      const readResult = Promise.resolve(
        handlers.get(channel)?.({ sender: senderA }, input, 'request-1'),
      )
      const readRejection = expect(readResult).rejects.toThrow(/terminated/u)
      expect(missionStore[methodName]).toHaveBeenCalledWith(
        expectedInput,
        '41:mission-replay:request-1',
      )
      expect(senderA.listenerCount('destroyed')).toBe(1)
      expect(senderA.listenerCount('render-process-gone')).toBe(1)

      await expect(
        handlers.get('cancel')?.({ sender: senderB }, 'request-1'),
      ).resolves.toBe(false)
      expect(cancelMissionReplay).toHaveBeenLastCalledWith(
        '42:mission-replay:request-1',
      )

      senderA.emit(teardownEvent)
      await readRejection
      expect(cancelMissionReplay).toHaveBeenCalledWith(
        '41:mission-replay:request-1',
      )
      expect(senderA.listenerCount('destroyed')).toBe(0)
      expect(senderA.listenerCount('render-process-gone')).toBe(0)
    },
  )

  it('removes renderer lifecycle listeners after every Replay read completes', async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: readonly unknown[]) => unknown
    >()
    const missionStore = {
      readMissionReplay: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayTrackChunk: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayObjectChunk: vi.fn().mockResolvedValue({ objects: [] }),
      cancelMissionReplay: vi.fn().mockResolvedValue(false),
    }
    registerMissionReplayQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannels: {
        state: 'state',
        trackChunk: 'trackChunk',
        objectChunk: 'objectChunk',
      },
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })
    const sender = Object.assign(new EventEmitter(), { id: 77 })

    for (const channel of ['state', 'trackChunk', 'objectChunk']) {
      await handlers.get(channel)?.(
        { sender },
        {
          missionId: 'mission-1',
          selectedTime: '2026-08-28T12:00:00Z',
          trackLimit: 100,
          ...(channel === 'objectChunk' ? { replayGeneration: 0 } : {}),
        },
        `request-${channel}`,
      )
      expect(sender.listenerCount('destroyed')).toBe(0)
      expect(sender.listenerCount('render-process-gone')).toBe(0)
    }

    sender.emit('destroyed')
    expect(missionStore.cancelMissionReplay).not.toHaveBeenCalled()
  })

  it('rejects invalid renderer and request identities before starting Replay work', async () => {
    const handlers = new Map<
      string,
      (event: unknown, ...args: readonly unknown[]) => unknown
    >()
    const missionStore = {
      readMissionReplay: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayTrackChunk: vi.fn().mockResolvedValue({ tracks: [] }),
      readMissionReplayObjectChunk: vi.fn().mockResolvedValue({ objects: [] }),
      cancelMissionReplay: vi.fn().mockResolvedValue(false),
    }
    registerMissionReplayQueryIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      readChannels: {
        state: 'state',
        trackChunk: 'trackChunk',
        objectChunk: 'objectChunk',
      },
      cancelChannel: 'cancel',
      missionStore,
      validateIpcSender: vi.fn(),
    })

    await expect(
      handlers.get('state')?.(
        { sender: Object.assign(new EventEmitter(), { id: -1 }) },
        { missionId: 'mission-1' },
        'request-1',
      ),
    ).rejects.toThrow(/sender ID is invalid/u)
    await expect(
      handlers.get('state')?.(
        { sender: Object.assign(new EventEmitter(), { id: 1 }) },
        { missionId: 'mission-1' },
        '../request',
      ),
    ).rejects.toThrow(/request ID is invalid/u)
    expect(missionStore.readMissionReplay).not.toHaveBeenCalled()
  })
})
