import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  MIN_AUTOSAVE_INTERVAL_MS,
  normalizeAutosaveIntervalMs,
} from '../../src/features/persistence/autosave-config'
import type { MissionAutosaveRuntime } from '../../src/features/persistence/mission-autosave-runtime'
import { startMissionAutosave } from '../../src/features/persistence/mission-autosave'

describe('mission autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
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

    const stop = startMissionAutosave(store, { intervalMs: 5_000 })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.getActiveMission).toHaveBeenCalledTimes(1)
    expect(store.syncBackup).toHaveBeenCalledTimes(1)

    stop()
  })

  it('does nothing when there is no active mission', async () => {
    const store = {
      getActiveMission: vi.fn().mockResolvedValue(null),
      syncBackup: vi.fn(),
    }

    const stop = startMissionAutosave(store, { intervalMs: 5_000 })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(store.getActiveMission).toHaveBeenCalledTimes(1)
    expect(store.syncBackup).not.toHaveBeenCalled()

    stop()
  })

  it('logs and survives autosave failures', async () => {
    const logger = { warn: vi.fn() }
    const store = {
      getActiveMission: vi.fn().mockResolvedValue({ id: 'm-1' }),
      syncBackup: vi.fn().mockRejectedValue(new Error('disk full')),
    }

    const stop = startMissionAutosave(store, { intervalMs: 5_000, logger })

    await vi.advanceTimersByTimeAsync(5_000)

    expect(logger.warn).toHaveBeenCalledWith('Mission autosave failed.', expect.any(Error))

    stop()
  })

  it('attempts a final sync when the page is hidden', async () => {
    const store = {
      getActiveMission: vi.fn().mockResolvedValue({ id: 'm-1' }),
      syncBackup: vi.fn().mockResolvedValue('/tmp/mission.sqlite'),
    }

    const stop = startMissionAutosave(store, { intervalMs: 5_000 })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    await Promise.resolve()

    expect(store.syncBackup).toHaveBeenCalledTimes(1)

    stop()
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

    const stop = startMissionAutosave(store, { intervalMs: 5_000 })

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
    stop()
  })

  it('returns a no-op stop function when browser lifecycle APIs are unavailable', () => {
    const stop = startMissionAutosave(
      {
        getActiveMission: vi.fn(),
        syncBackup: vi.fn(),
      },
      {
        runtime: null,
      },
    )

    expect(stop).toBeTypeOf('function')
    expect(() => stop()).not.toThrow()
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

    const stop = startMissionAutosave(
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

    stop()

    expect(runtime.clearInterval).toHaveBeenCalledWith(42)
    expect(runtime.removeDocumentEventListener).toHaveBeenCalledTimes(1)
    expect(runtime.removeWindowEventListener).toHaveBeenCalledTimes(1)
    expect(listeners.document).toHaveLength(0)
    expect(listeners.window).toHaveLength(0)
  })
})
