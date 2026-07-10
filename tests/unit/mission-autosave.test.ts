import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  MIN_AUTOSAVE_INTERVAL_MS,
  normalizeAutosaveIntervalMs,
} from '../../src/features/persistence/autosave-config'
import type { MissionAutosaveRuntime } from '../../src/features/persistence/mission-autosave-runtime'
import { startMissionAutosave } from '../../src/features/persistence/mission-autosave'
import {
  selectAutosaveWarning,
  useAutosaveStatusStore,
} from '../../src/features/persistence/autosave-status-store'

describe('mission autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    useAutosaveStatusStore.getState().reset()
    vi.useRealTimers()
  })

  it('uses the default autosave interval when none is provided', () => {
    expect(normalizeAutosaveIntervalMs()).toBe(DEFAULT_AUTOSAVE_INTERVAL_MS)
  })

  it('clamps autosave interval to a safe minimum', () => {
    expect(normalizeAutosaveIntervalMs(500)).toBe(MIN_AUTOSAVE_INTERVAL_MS)
  })

  it('syncs the backup when there is an active mission', async () => {
    const store = {
      getActiveMission: vi.fn().mockResolvedValue({ id: 'm-1' }),
      syncBackup: vi.fn().mockResolvedValue('/tmp/mission.sqlite'),
    }

    const autosave = startMissionAutosave(store, { intervalMs: 5_000 })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.getActiveMission).toHaveBeenCalledTimes(1)
    expect(store.syncBackup).toHaveBeenCalledTimes(1)
    expect(store.syncBackup).toHaveBeenCalledWith('interval')
    expect(useAutosaveStatusStore.getState().lastSuccessAt).not.toBeNull()

    autosave.stop()
  })

  it('does nothing when there is no active mission', async () => {
    const store = {
      getActiveMission: vi.fn().mockResolvedValue(null),
      syncBackup: vi.fn(),
    }

    const autosave = startMissionAutosave(store, { intervalMs: 5_000 })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.getActiveMission).toHaveBeenCalledTimes(1)
    expect(store.syncBackup).not.toHaveBeenCalled()

    autosave.stop()
  })

  it('logs and survives autosave failures', async () => {
    const logger = { warn: vi.fn() }
    const store = {
      getActiveMission: vi.fn().mockResolvedValue({ id: 'm-1' }),
      syncBackup: vi.fn().mockRejectedValue(new Error('disk full')),
    }

    const autosave = startMissionAutosave(store, { intervalMs: 5_000, logger })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(logger.warn).toHaveBeenCalledWith('Mission autosave failed.', expect.any(Error))
    expect(useAutosaveStatusStore.getState().lastFailure?.message).toBe('disk full')
    expect(selectAutosaveWarning(useAutosaveStatusStore.getState())).toContain(
      'Autosave failing',
    )

    autosave.stop()
  })

  it('exposes a forced requestSync path that writes a backup even without an active mission', async () => {
    const store = {
      getActiveMission: vi.fn().mockResolvedValue(null),
      syncBackup: vi.fn().mockResolvedValue('/tmp/mission.sqlite'),
    }

    const autosave = startMissionAutosave(store, { intervalMs: 5_000 })

    await autosave.requestSync('mission-finish')

    expect(store.getActiveMission).not.toHaveBeenCalled()
    expect(store.syncBackup).toHaveBeenCalledTimes(1)
    expect(store.syncBackup).toHaveBeenCalledWith('mission-finish')
    expect(useAutosaveStatusStore.getState().lastSuccessReason).toBe('mission-finish')

    autosave.stop()
  })

  it('queues a forced lifecycle sync behind an in-flight interval sync', async () => {
    let resolveSync: ((value: string) => void) | null = null
    let syncCalls = 0
    const store = {
      getActiveMission: vi.fn().mockResolvedValue({ id: 'm-1' }),
      syncBackup: vi.fn().mockImplementation(() => {
        syncCalls += 1
        if (syncCalls === 1) {
          return new Promise<string>((resolve) => {
            resolveSync = resolve
          })
        }

        return Promise.resolve('/tmp/mission.sqlite')
      }),
    }

    const autosave = startMissionAutosave(store, { intervalMs: 5_000 })

    await vi.advanceTimersByTimeAsync(5_000)
    const forcedSync = autosave.requestSync('mission-pause')

    expect(store.syncBackup).toHaveBeenCalledTimes(1)

    resolveSync?.('/tmp/mission.sqlite')
    await forcedSync

    expect(store.syncBackup).toHaveBeenCalledTimes(2)
    expect(useAutosaveStatusStore.getState().lastSuccessReason).toBe('mission-pause')

    autosave.stop()
  })

  it('does not report stale autosave status from wall-clock jumps alone', () => {
    vi.setSystemTime(new Date('2026-05-16T09:00:00.000Z'))
    useAutosaveStatusStore.getState().configure({
      enabled: true,
      intervalMs: 10_000,
    })
    useAutosaveStatusStore.getState().markSyncSucceeded({
      reason: 'interval',
      backupPath: '/tmp/mission.sqlite',
    })

    vi.setSystemTime(new Date('2026-05-16T10:00:00.000Z'))

    expect(selectAutosaveWarning(useAutosaveStatusStore.getState())).toBeNull()
  })

  it('reports stale autosave status after observed tick time exceeds the configured grace', () => {
    useAutosaveStatusStore.getState().configure({
      enabled: true,
      intervalMs: 10_000,
      now: new Date('2026-05-16T09:00:00.000Z'),
    })
    useAutosaveStatusStore.getState().markSyncSucceeded({
      reason: 'interval',
      backupPath: '/tmp/mission.sqlite',
      now: new Date('2026-05-16T09:00:00.000Z'),
    })

    useAutosaveStatusStore.getState().markObservedElapsed({ elapsedMs: 19_000 })

    expect(selectAutosaveWarning(useAutosaveStatusStore.getState())).toBeNull()

    useAutosaveStatusStore.getState().markObservedElapsed({ elapsedMs: 2_000 })

    expect(
      selectAutosaveWarning(useAutosaveStatusStore.getState()),
    ).toContain('Autosave stale')
  })

  it('keeps lifecycle sync failures visible after unrelated sync successes', () => {
    useAutosaveStatusStore.getState().configure({
      enabled: true,
      intervalMs: 10_000,
      now: new Date('2026-05-16T09:00:00.000Z'),
    })
    useAutosaveStatusStore.getState().markSyncFailed({
      reason: 'mission-finish',
      message: 'backup target unavailable',
      now: new Date('2026-05-16T09:00:01.000Z'),
    })

    useAutosaveStatusStore.getState().markSyncSucceeded({
      reason: 'interval',
      backupPath: '/tmp/mission.sqlite',
      now: new Date('2026-05-16T09:00:10.000Z'),
    })

    expect(useAutosaveStatusStore.getState().lastFailure?.reason).toBe('mission-finish')
    expect(selectAutosaveWarning(useAutosaveStatusStore.getState())).toContain(
      'backup target unavailable',
    )
  })

  it('clears a lifecycle sync failure after the matching lifecycle sync succeeds', () => {
    useAutosaveStatusStore.getState().configure({
      enabled: true,
      intervalMs: 10_000,
      now: new Date('2026-05-16T09:00:00.000Z'),
    })
    useAutosaveStatusStore.getState().markSyncFailed({
      reason: 'mission-finish',
      message: 'backup target unavailable',
      now: new Date('2026-05-16T09:00:01.000Z'),
    })

    useAutosaveStatusStore.getState().markSyncSucceeded({
      reason: 'mission-finish',
      backupPath: '/tmp/mission.sqlite',
      now: new Date('2026-05-16T09:00:10.000Z'),
    })

    expect(useAutosaveStatusStore.getState().lastFailure).toBeNull()
    expect(selectAutosaveWarning(useAutosaveStatusStore.getState())).toBeNull()
  })

  it('attempts a final sync when the page is hidden', async () => {
    const store = {
      getActiveMission: vi.fn().mockResolvedValue({ id: 'm-1' }),
      syncBackup: vi.fn().mockResolvedValue('/tmp/mission.sqlite'),
    }

    const autosave = startMissionAutosave(store, { intervalMs: 5_000 })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    await Promise.resolve()

    expect(store.syncBackup).toHaveBeenCalledTimes(1)

    autosave.stop()
  })

  it('does not start overlapping syncs from timer and lifecycle triggers', async () => {
    let resolveSync: ((value: string) => void) | null = null
    const store = {
      getActiveMission: vi.fn().mockResolvedValue({ id: 'm-1' }),
      syncBackup: vi.fn().mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveSync = resolve
          }),
      ),
    }

    const autosave = startMissionAutosave(store, { intervalMs: 5_000 })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.syncBackup).toHaveBeenCalledTimes(1)

    resolveSync?.('/tmp/mission.sqlite')
    await Promise.resolve()
    await Promise.resolve()
    autosave.stop()
  })

  it('returns a no-op stop function when browser lifecycle APIs are unavailable', () => {
    const autosave = startMissionAutosave(
      {
        getActiveMission: vi.fn(),
        syncBackup: vi.fn(),
      },
      {
        runtime: null,
      },
    )

    expect(autosave.stop).toBeTypeOf('function')
    expect(autosave.requestSync).toBeTypeOf('function')
    expect(() => autosave.stop()).not.toThrow()
  })

  it('removes timer and lifecycle listeners on stop', () => {
    const listeners: {
      document: EventListener[]
      window: EventListener[]
    } = {
      document: [],
      window: [],
    }
    const runtime: MissionAutosaveRuntime = {
      getVisibilityState: () => 'visible',
      setInterval: vi.fn().mockReturnValue(42),
      clearInterval: vi.fn(),
      addDocumentEventListener: vi.fn((_, listener) => {
        listeners.document.push(listener)
      }),
      removeDocumentEventListener: vi.fn((_, listener) => {
        listeners.document = listeners.document.filter((candidate) => candidate !== listener)
      }),
      addWindowEventListener: vi.fn((_, listener) => {
        listeners.window.push(listener)
      }),
      removeWindowEventListener: vi.fn((_, listener) => {
        listeners.window = listeners.window.filter((candidate) => candidate !== listener)
      }),
    }

    const autosave = startMissionAutosave(
      {
        getActiveMission: vi.fn().mockResolvedValue(null),
        syncBackup: vi.fn(),
      },
      {
        runtime,
      },
    )

    expect(listeners.document).toHaveLength(1)
    expect(listeners.window).toHaveLength(1)

    autosave.stop()

    expect(runtime.clearInterval).toHaveBeenCalledWith(42)
    expect(runtime.removeDocumentEventListener).toHaveBeenCalledTimes(1)
    expect(runtime.removeWindowEventListener).toHaveBeenCalledTimes(1)
    expect(listeners.document).toHaveLength(0)
    expect(listeners.window).toHaveLength(0)
  })
})
