import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  RENDERER_TEARDOWN_READY_CHANNEL,
  RENDERER_TEARDOWN_REQUEST_CHANNEL,
  createRendererTeardownCoordinator,
} = require('../../electron/renderer-teardown-coordinator.cjs') as {
  readonly RENDERER_TEARDOWN_READY_CHANNEL: string
  readonly RENDERER_TEARDOWN_REQUEST_CHANNEL: string
  readonly createRendererTeardownCoordinator: (dependencies: {
    readonly ipcMain: {
      readonly on: (channel: string, listener: (event: unknown, input: unknown) => void) => void
      readonly removeListener: (channel: string, listener: (event: unknown, input: unknown) => void) => void
    }
    readonly missionStore: {
      readonly getActiveMission: () => Promise<{ readonly id: string } | null>
      readonly recordIngestEvidenceLoss: (input: {
        readonly mission_id: string
        readonly reason: string
      }) => Promise<unknown>
    }
    readonly createRequestId: () => string
    readonly setTimeout: (listener: () => void, delayMs: number) => unknown
    readonly clearTimeout: (timer: unknown) => void
    readonly timeoutMs: number
  }) => {
    readonly prepare: (window: unknown, reason: string) => Promise<unknown>
    readonly markRendererUnavailable: () => Promise<unknown>
    readonly dispose: () => void
  }
}

describe('renderer teardown coordinator', () => {
  it('waits for the matching renderer drain acknowledgement before allowing teardown', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const ipcMain = createIpcMain(listeners)
    const missionStore = createMissionStore()
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain,
      missionStore,
      createRequestId: () => 'request-1',
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents }, 'app_quit')
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledOnce())
    expect(webContents.send).toHaveBeenCalledWith(RENDERER_TEARDOWN_REQUEST_CHANNEL, {
      requestId: 'request-1',
      reason: 'app_quit',
    })
    expect(missionStore.recordIngestEvidenceLoss).not.toHaveBeenCalled()

    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-1', ok: true },
    )

    await expect(preparation).resolves.toEqual({ mode: 'renderer_drained' })
    expect(missionStore.getActiveMission).not.toHaveBeenCalled()
  })

  it('durably blocks the active mission when the renderer misses the bounded timeout', async () => {
    let timeoutListener: (() => void) | undefined
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-2',
      setTimeout: vi.fn((listener: () => void) => {
        timeoutListener = listener
        return 2
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents }, 'renderer_reload')
    await vi.waitFor(() => expect(timeoutListener).toBeTypeOf('function'))
    timeoutListener?.()

    await expect(preparation).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-1',
    })
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      reason: 'renderer_pending_evidence_lost',
    })
  })

  it('uses the same durable fallback when the renderer rejects cleanup or is gone', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-3',
      setTimeout: vi.fn(() => 3),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })
    const rejectingContents = createWebContents()
    const rejected = coordinator.prepare({ webContents: rejectingContents }, 'window_close')
    await vi.waitFor(() => expect(rejectingContents.send).toHaveBeenCalledOnce())
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: rejectingContents },
      { requestId: 'request-3', ok: false },
    )
    await expect(rejected).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-1',
    })

    const goneContents = createWebContents(true)
    await expect(
      coordinator.prepare({ webContents: goneContents }, 'app_quit'),
    ).resolves.toEqual({ mode: 'durable_loss_marker', missionId: 'mission-1' })
    expect(goneContents.send).not.toHaveBeenCalled()
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledTimes(2)
  })

  it('refuses teardown when the durable fallback cannot be written', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.recordIngestEvidenceLoss.mockRejectedValue(new Error('database unavailable'))
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-4',
      setTimeout: vi.fn(() => 4),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })
    const webContents = createWebContents()
    const preparation = coordinator.prepare({ webContents }, 'window_close')
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledOnce())
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-4', ok: false },
    )

    await expect(preparation).rejects.toThrow('database unavailable')
  })

  it('immediately marks a mission when the renderer process crashes', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-crash',
      setTimeout: vi.fn(() => 6),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    await expect(coordinator.markRendererUnavailable()).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-1',
    })
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledOnce()
  })

  it('ignores forged acknowledgements from another renderer', async () => {
    let timeoutListener: (() => void) | undefined
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-5',
      setTimeout: vi.fn((listener: () => void) => {
        timeoutListener = listener
        return 5
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })
    const preparation = coordinator.prepare({ webContents }, 'app_quit')
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledOnce())
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: createWebContents() },
      { requestId: 'request-5', ok: true },
    )
    timeoutListener?.()

    await expect(preparation).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-1',
    })
  })
})

function createIpcMain(
  listeners: Map<string, (event: unknown, input: unknown) => void>,
) {
  return {
    on: vi.fn((channel: string, listener: (event: unknown, input: unknown) => void) => {
      listeners.set(channel, listener)
    }),
    removeListener: vi.fn((channel: string) => {
      listeners.delete(channel)
    }),
  }
}

function createMissionStore() {
  return {
    getActiveMission: vi.fn(async () => ({ id: 'mission-1' })),
    recordIngestEvidenceLoss: vi.fn(async () => ({ state: 'critical' })),
  }
}

let nextWebContentsId = 0
function createWebContents(destroyed = false) {
  nextWebContentsId += 1
  return {
    id: nextWebContentsId,
    isDestroyed: vi.fn(() => destroyed),
    send: vi.fn(),
  }
}
