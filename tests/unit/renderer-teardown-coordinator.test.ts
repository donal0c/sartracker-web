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
      readonly listMissionIdsAwaitingEvidenceClosure: () => Promise<readonly string[]>
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
    readonly ensureUnexpectedRendererLossFenced: () => Promise<unknown>
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
    expect(missionStore.listMissionIdsAwaitingEvidenceClosure).not.toHaveBeenCalled()
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

  it('durably blocks a finished mission when renderer cleanup fails after Finish', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.listMissionIdsAwaitingEvidenceClosure.mockResolvedValue([
      'mission-finished',
    ])
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-finished',
      setTimeout: vi.fn(() => 7),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents }, 'window_close')
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledOnce())
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-finished', ok: false },
    )

    await expect(preparation).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-finished',
    })
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledWith({
      mission_id: 'mission-finished',
      reason: 'renderer_pending_evidence_lost',
    })
  })

  it('marks every unfinalized mission when renderer-owned evidence scope is uncertain', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.listMissionIdsAwaitingEvidenceClosure.mockResolvedValue([
      'mission-active',
      'mission-finished',
    ])
    const webContents = createWebContents(true)
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-all-open',
      setTimeout: vi.fn(() => 8),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    await expect(
      coordinator.prepare({ webContents }, 'app_quit'),
    ).resolves.toEqual({
      mode: 'durable_loss_markers',
      missionIds: ['mission-active', 'mission-finished'],
    })
    expect(missionStore.recordIngestEvidenceLoss.mock.calls).toEqual([
      [{ mission_id: 'mission-active', reason: 'renderer_pending_evidence_lost' }],
      [{ mission_id: 'mission-finished', reason: 'renderer_pending_evidence_lost' }],
    ])
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

  it('makes clean exit wait for an in-flight unexpected-renderer-loss fence [DON-276]', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    let releaseMarker: (() => void) | undefined
    missionStore.recordIngestEvidenceLoss.mockImplementation(
      () => new Promise<void>((resolve) => {
        releaseMarker = resolve
      }),
    )
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-crash-quit-race',
      setTimeout: vi.fn(() => 9),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const crashFence = coordinator.markRendererUnavailable()
    const cleanExitFence = coordinator.ensureUnexpectedRendererLossFenced()
    let cleanExitFenceSettled = false
    void cleanExitFence.finally(() => {
      cleanExitFenceSettled = true
    })

    await Promise.resolve()
    expect(cleanExitFenceSettled).toBe(false)
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledOnce()

    releaseMarker?.()
    await expect(Promise.all([crashFence, cleanExitFence])).resolves.toEqual([
      { mode: 'durable_loss_marker', missionId: 'mission-1' },
      { mode: 'durable_loss_marker', missionId: 'mission-1' },
    ])
  })

  it('retries a failed unexpected-renderer-loss fence before allowing later lifecycle work [DON-276]', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.recordIngestEvidenceLoss
      .mockRejectedValueOnce(new Error('marker storage unavailable'))
      .mockResolvedValueOnce(undefined)
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-crash-retry',
      setTimeout: vi.fn(() => 10),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    await expect(coordinator.markRendererUnavailable()).rejects.toThrow(
      'marker storage unavailable',
    )
    await expect(coordinator.ensureUnexpectedRendererLossFenced()).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-1',
    })
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledTimes(2)
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
    listMissionIdsAwaitingEvidenceClosure: vi.fn(async () => ['mission-1']),
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
