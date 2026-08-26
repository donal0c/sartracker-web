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
      readonly listRendererEvidenceScopesAwaitingClosure?: () => Promise<readonly {
        readonly mission_id: string
        readonly scope_reason: string
      }[]>
      readonly recordIngestEvidenceLoss: (input: {
        readonly mission_id: string
        readonly reason: string
      }) => Promise<unknown>
      readonly stageRendererEvidenceIncident?: (input: {
        readonly incident_id: string
        readonly scopes: readonly {
          readonly mission_id: string
          readonly scope_reason: string
        }[]
      }) => Promise<unknown>
      readonly resolveRendererEvidenceIncidents?: (input: {
        readonly incident_id?: string
        readonly outcome: 'drained' | 'lost'
      }) => Promise<unknown>
    }
    readonly createRequestId: () => string
    readonly setTimeout: (listener: () => void, delayMs: number) => unknown
    readonly clearTimeout: (timer: unknown) => void
    readonly timeoutMs: number
  }) => {
    readonly prepare: (window: unknown, reason: string) => Promise<unknown>
    readonly markRendererUnavailable: () => Promise<unknown>
    readonly markRendererAvailable: () => Promise<void>
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
    expect(missionStore.listRendererEvidenceScopesAwaitingClosure).not.toHaveBeenCalled()
  })

  it('seals provisional uncertainty when the renderer explicitly rejects after the soft deadline', async () => {
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
    await vi.waitFor(() => {
      expect(missionStore.stageRendererEvidenceIncident).toHaveBeenCalledOnce()
    })
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-2', ok: false },
    )

    await expect(preparation).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-1',
    })
    expect(missionStore.resolveRendererEvidenceIncidents).toHaveBeenCalledWith({
      outcome: 'lost',
    })
    expect(missionStore.recordIngestEvidenceLoss).not.toHaveBeenCalled()
  })

  it('keeps the renderer alive after the soft deadline and retracts provisional uncertainty on a late clean drain [DON-276]', async () => {
    let softDeadline: (() => void) | undefined
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-slow-clean-drain',
      setTimeout: vi.fn((listener: () => void) => {
        softDeadline = listener
        return 12
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents }, 'app_quit')
    let settled = false
    void preparation.finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledOnce())

    softDeadline?.()
    await vi.waitFor(() => {
      expect(missionStore.stageRendererEvidenceIncident).toHaveBeenCalledWith({
        incident_id: 'request-slow-clean-drain',
        scopes: [{ mission_id: 'mission-1', scope_reason: 'active_mission' }],
      })
    })
    expect(settled).toBe(false)
    expect(missionStore.recordIngestEvidenceLoss).not.toHaveBeenCalled()

    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-slow-clean-drain', ok: true },
    )

    await expect(preparation).resolves.toEqual({ mode: 'renderer_drained' })
    expect(missionStore.resolveRendererEvidenceIncidents).toHaveBeenCalledWith({
      outcome: 'drained',
    })
    expect(missionStore.recordIngestEvidenceLoss).not.toHaveBeenCalled()
  })

  it('promotes the exact provisional incident when the renderer is actually lost [DON-276]', async () => {
    let softDeadline: (() => void) | undefined
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-soft-then-crash',
      setTimeout: vi.fn((listener: () => void) => {
        softDeadline = listener
        return 13
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents }, 'renderer_reload')
    softDeadline?.()
    await vi.waitFor(() => {
      expect(missionStore.stageRendererEvidenceIncident).toHaveBeenCalledOnce()
    })

    const crashFence = coordinator.markRendererUnavailable()

    await expect(Promise.all([preparation, crashFence])).resolves.toEqual([
      { mode: 'durable_loss_marker', missionId: 'mission-1' },
      { mode: 'durable_loss_marker', missionId: 'mission-1' },
    ])
    expect(missionStore.resolveRendererEvidenceIncidents).toHaveBeenCalledOnce()
    expect(missionStore.resolveRendererEvidenceIncidents).toHaveBeenCalledWith({
      outcome: 'lost',
    })
    expect(missionStore.recordIngestEvidenceLoss).not.toHaveBeenCalled()
  })

  it('seals a mission that appears after the soft-deadline scope snapshot [DON-276]', async () => {
    let softDeadline: (() => void) | undefined
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.listRendererEvidenceScopesAwaitingClosure
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        mission_id: 'mission-started-during-drain',
        scope_reason: 'active_mission',
      }])
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-late-mission',
      setTimeout: vi.fn((listener: () => void) => {
        softDeadline = listener
        return 14
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents }, 'app_quit')
    softDeadline?.()
    await vi.waitFor(() => {
      expect(missionStore.listRendererEvidenceScopesAwaitingClosure).toHaveBeenCalledOnce()
    })
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-late-mission', ok: false },
    )

    await expect(preparation).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-started-during-drain',
    })
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledWith({
      mission_id: 'mission-started-during-drain',
      reason: 'renderer_pending_evidence_lost',
      scope_reason: 'active_mission',
    })
  })

  it('seals a late mission when the renderer process is lost after the soft deadline [DON-276]', async () => {
    let softDeadline: (() => void) | undefined
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.listRendererEvidenceScopesAwaitingClosure
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        mission_id: 'mission-started-before-crash',
        scope_reason: 'active_mission',
      }])
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-late-mission-crash',
      setTimeout: vi.fn((listener: () => void) => {
        softDeadline = listener
        return 16
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents }, 'app_quit')
    softDeadline?.()
    await vi.waitFor(() => {
      expect(missionStore.listRendererEvidenceScopesAwaitingClosure).toHaveBeenCalledOnce()
    })
    const crashFence = coordinator.markRendererUnavailable()

    await expect(Promise.all([preparation, crashFence])).resolves.toEqual([
      { mode: 'durable_loss_marker', missionId: 'mission-started-before-crash' },
      { mode: 'durable_loss_marker', missionId: 'mission-started-before-crash' },
    ])
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledWith({
      mission_id: 'mission-started-before-crash',
      reason: 'renderer_pending_evidence_lost',
      scope_reason: 'active_mission',
    })
  })

  it('retains one durable incident when multi-scope health projection fails [DON-276]', async () => {
    let softDeadline: (() => void) | undefined
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.listRendererEvidenceScopesAwaitingClosure.mockResolvedValue([
      { mission_id: 'mission-a', scope_reason: 'active_mission' },
      { mission_id: 'mission-b', scope_reason: 'paused_recoverable_mission' },
    ])
    missionStore.stageRendererEvidenceIncident.mockRejectedValue(
      new Error('mission-b marker projection failed after incident commit'),
    )
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-partial-stage',
      setTimeout: vi.fn((listener: () => void) => {
        softDeadline = listener
        return 15
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents: createWebContents() }, 'app_quit')
    softDeadline?.()

    await expect(preparation).rejects.toThrow(/mission-b marker projection/iu)
    expect(missionStore.stageRendererEvidenceIncident).toHaveBeenCalledWith({
      incident_id: 'request-partial-stage',
      scopes: [
        { mission_id: 'mission-a', scope_reason: 'active_mission' },
        { mission_id: 'mission-b', scope_reason: 'paused_recoverable_mission' },
      ],
    })
    expect(missionStore.resolveRendererEvidenceIncidents).not.toHaveBeenCalled()
  })

  it('sweeps a durable partial incident when a later renderer drain is clean [DON-276]', async () => {
    const deadlines: Array<() => void> = []
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.stageRendererEvidenceIncident.mockRejectedValueOnce(
      new Error('partial marker projection failed after incident commit'),
    )
    const webContents = createWebContents()
    let nextRequest = 0
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => `request-partial-${++nextRequest}`,
      setTimeout: vi.fn((listener: () => void) => {
        deadlines.push(listener)
        return deadlines.length
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const first = coordinator.prepare({ webContents }, 'app_quit')
    deadlines[0]?.()
    await expect(first).rejects.toThrow(/partial marker projection/iu)

    const second = coordinator.prepare({ webContents }, 'app_quit')
    await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledTimes(2))
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-partial-2', ok: true },
    )

    await expect(second).resolves.toEqual({ mode: 'renderer_drained' })
    expect(missionStore.resolveRendererEvidenceIncidents).toHaveBeenCalledWith({
      outcome: 'drained',
    })
  })

  it('does not invent an empty incident when no mission can own renderer evidence [DON-276]', async () => {
    let softDeadline: (() => void) | undefined
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.listRendererEvidenceScopesAwaitingClosure.mockResolvedValue([])
    const webContents = createWebContents()
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-no-scopes',
      setTimeout: vi.fn((listener: () => void) => {
        softDeadline = listener
        return 19
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents }, 'app_quit')
    softDeadline?.()
    await vi.waitFor(() => expect(missionStore.listRendererEvidenceScopesAwaitingClosure)
      .toHaveBeenCalled())
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-no-scopes', ok: true },
    )

    await expect(preparation).resolves.toEqual({ mode: 'renderer_drained' })
    expect(missionStore.stageRendererEvidenceIncident).not.toHaveBeenCalled()
  })

  it('promotes a durable partial incident once when the renderer is later lost [DON-276]', async () => {
    const deadlines: Array<() => void> = []
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.stageRendererEvidenceIncident.mockRejectedValueOnce(
      new Error('partial marker projection failed after incident commit'),
    )
    missionStore.resolveRendererEvidenceIncidents.mockResolvedValueOnce({
      resolved_scopes: [{
        mission_id: 'mission-1',
        scope_reason: 'active_mission',
      }],
    })
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-partial-lost',
      setTimeout: vi.fn((listener: () => void) => {
        deadlines.push(listener)
        return deadlines.length
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    const preparation = coordinator.prepare({ webContents: createWebContents() }, 'app_quit')
    deadlines[0]?.()
    await expect(preparation).rejects.toThrow(/partial marker projection/iu)

    await expect(coordinator.markRendererUnavailable()).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-1',
    })
    expect(missionStore.resolveRendererEvidenceIncidents).toHaveBeenCalledWith({
      outcome: 'lost',
    })
    expect(missionStore.recordIngestEvidenceLoss).not.toHaveBeenCalled()
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
    missionStore.listRendererEvidenceScopesAwaitingClosure.mockResolvedValue([
      { mission_id: 'mission-finished', scope_reason: 'finished_unfinalized_mission' },
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
      scope_reason: 'finished_unfinalized_mission',
    })
  })

  it('marks every unfinalized mission when renderer-owned evidence scope is uncertain', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.listRendererEvidenceScopesAwaitingClosure.mockResolvedValue([
      { mission_id: 'mission-active', scope_reason: 'active_mission' },
      { mission_id: 'mission-finished', scope_reason: 'finished_unfinalized_mission' },
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
      [{
        mission_id: 'mission-active',
        reason: 'renderer_pending_evidence_lost',
        scope_reason: 'active_mission',
      }],
      [{
        mission_id: 'mission-finished',
        reason: 'renderer_pending_evidence_lost',
        scope_reason: 'finished_unfinalized_mission',
      }],
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

    await vi.waitFor(() => {
      expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledOnce()
    })
    expect(cleanExitFenceSettled).toBe(false)

    releaseMarker?.()
    await expect(Promise.all([crashFence, cleanExitFence])).resolves.toEqual([
      { mode: 'durable_loss_marker', missionId: 'mission-1' },
      { mode: 'durable_loss_marker', missionId: 'mission-1' },
    ])
  })

  it('starts a new durable loss occurrence after a replacement renderer becomes available [DON-276]', async () => {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const missionStore = createMissionStore()
    missionStore.listRendererEvidenceScopesAwaitingClosure
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        mission_id: 'mission-after-replacement',
        scope_reason: 'active_mission',
      }])
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: createIpcMain(listeners),
      missionStore,
      createRequestId: () => 'request-replacement-generation',
      setTimeout: vi.fn(() => 11),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })

    await expect(coordinator.markRendererUnavailable()).resolves.toEqual({
      mode: 'no_unfinalized_mission',
    })
    await coordinator.markRendererAvailable()
    await expect(coordinator.markRendererUnavailable()).resolves.toEqual({
      mode: 'durable_loss_marker',
      missionId: 'mission-after-replacement',
    })

    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledOnce()
    expect(missionStore.recordIngestEvidenceLoss).toHaveBeenCalledWith({
      mission_id: 'mission-after-replacement',
      reason: 'renderer_pending_evidence_lost',
      scope_reason: 'active_mission',
    })
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
    await vi.waitFor(() => {
      expect(missionStore.stageRendererEvidenceIncident).toHaveBeenCalledOnce()
    })
    expect(missionStore.resolveRendererEvidenceIncidents).not.toHaveBeenCalled()
    listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
      { sender: webContents },
      { requestId: 'request-5', ok: false },
    )

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
    listRendererEvidenceScopesAwaitingClosure: vi.fn(async () => [{
      mission_id: 'mission-1',
      scope_reason: 'active_mission',
    }]),
    recordIngestEvidenceLoss: vi.fn(async () => ({ state: 'critical' })),
    stageRendererEvidenceIncident: vi.fn(async () => ({ state: 'degraded' })),
    resolveRendererEvidenceIncidents: vi.fn(async () => ({ state: 'healthy' })),
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
