import { DEFAULT_AUTOSAVE_INTERVAL_MS, normalizeAutosaveIntervalMs } from './autosave-config'
import {
  createBrowserMissionAutosaveRuntime,
  type MissionAutosaveRuntime,
} from './mission-autosave-runtime'
import {
  type AutosaveSyncReason,
  useAutosaveStatusStore,
} from './autosave-status-store'

type MissionLike = {
  readonly id: string
}

export type AutosaveStore = {
  readonly getActiveMission: () => Promise<MissionLike | null>
  readonly syncBackup: (reason?: AutosaveSyncReason) => Promise<string>
}

type AutosaveLogger = {
  readonly warn: (message: string, error: unknown) => void
}

type StartMissionAutosaveOptions = {
  readonly intervalMs?: number
  readonly logger?: AutosaveLogger
  readonly runtime?: MissionAutosaveRuntime | null
  readonly now?: () => Date
}

export type MissionAutosaveController = {
  readonly stop: () => void
  readonly requestSync: (reason: AutosaveSyncReason) => Promise<void>
}

const DEFAULT_LOGGER: AutosaveLogger = {
  warn: (message, error) => {
    console.warn(message, error)
  },
}

/**
 * Starts periodic and lifecycle-triggered mission backup sync for the active mission.
 */
export function startMissionAutosave(
  store: AutosaveStore,
  options: StartMissionAutosaveOptions = {},
): MissionAutosaveController {
  const intervalMs = normalizeAutosaveIntervalMs(
    options.intervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS,
  )
  const logger = options.logger ?? DEFAULT_LOGGER
  const runtime = options.runtime ?? createBrowserMissionAutosaveRuntime()
  const now = options.now ?? (() => new Date())
  let syncQueue = Promise.resolve()
  let stopped = false
  let intervalTimer: number | null = null

  if (runtime === null) {
    useAutosaveStatusStore.getState().markDisabled()
    return {
      stop: () => undefined,
      requestSync: async () => undefined,
    }
  }
  const activeRuntime = runtime

  useAutosaveStatusStore.getState().configure({
    enabled: true,
    intervalMs,
    now: now(),
  })

  const handleVisibilityChange = () => {
    if (activeRuntime.getVisibilityState() === 'hidden') {
      void enqueueAutosave({
        reason: 'visibilitychange',
        requireActiveMission: true,
      })
    }
  }

  const handlePageHide = () => {
    void enqueueAutosave({
      reason: 'pagehide',
      requireActiveMission: true,
    })
  }

  scheduleNextInterval()

  activeRuntime.addDocumentEventListener('visibilitychange', handleVisibilityChange)
  activeRuntime.addWindowEventListener('pagehide', handlePageHide)

  return {
    stop: () => {
      if (stopped) {
        return
      }

      stopped = true
      if (intervalTimer !== null) {
        activeRuntime.clearTimeout(intervalTimer)
        intervalTimer = null
      }
      activeRuntime.removeDocumentEventListener('visibilitychange', handleVisibilityChange)
      activeRuntime.removeWindowEventListener('pagehide', handlePageHide)
    },
    requestSync: (reason) =>
      enqueueAutosave({
        reason,
        requireActiveMission: false,
      }),
  }

  /** Schedules one interval only after the preceding interval attempt settles. */
  function scheduleNextInterval(): void {
    if (stopped || intervalTimer !== null) {
      return
    }
    intervalTimer = activeRuntime.setTimeout(() => {
      intervalTimer = null
      void enqueueAutosave({
        reason: 'interval',
        requireActiveMission: true,
      }).finally(scheduleNextInterval)
    }, intervalMs)
  }

  /** Queues backup sync attempts so lifecycle-triggered writes cannot overlap timer writes. */
  function enqueueAutosave(input: {
    readonly reason: AutosaveSyncReason
    readonly requireActiveMission: boolean
  }): Promise<void> {
    if (stopped) {
      return Promise.resolve()
    }

    const nextSync = syncQueue.then(
      () => runAutosave(input),
      () => runAutosave(input),
    )
    syncQueue = nextSync.catch(() => undefined)
    return nextSync
  }

  /** Performs one backup sync attempt and records operator-visible status. */
  async function runAutosave(input: {
    readonly reason: AutosaveSyncReason
    readonly requireActiveMission: boolean
  }): Promise<void> {
    try {
      if (stopped && input.requireActiveMission) {
        return
      }
      if (input.requireActiveMission) {
        const activeMission = await store.getActiveMission()
        if (activeMission === null) {
          return
        }
      }

      useAutosaveStatusStore.getState().markSyncStarted({
        reason: input.reason,
        now: now(),
      })
      const backupPath = await store.syncBackup(input.reason)
      useAutosaveStatusStore.getState().markSyncSucceeded({
        reason: input.reason,
        backupPath,
        now: now(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useAutosaveStatusStore.getState().markSyncFailed({
        reason: input.reason,
        message,
        now: now(),
      })
      logger.warn('Mission autosave failed.', error)
    }
  }
}
