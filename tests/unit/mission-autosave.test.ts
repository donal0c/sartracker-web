import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_AUTOSAVE_INTERVAL_MS,
  MIN_AUTOSAVE_INTERVAL_MS,
  normalizeAutosaveIntervalMs,
} from '../../src/features/persistence/autosave-config'
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
})
