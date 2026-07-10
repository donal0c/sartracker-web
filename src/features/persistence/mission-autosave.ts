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

  if (runtime === null) {
    useAutosaveStatusStore.getState().markDisabled()
    return {
      stop: () => undefined,
      requestSync: async () => undefined,
    }
  }

  useAutosaveStatusStore.getState().configure({
    enabled: true,
    intervalMs,
    now: now(),
  })

  const handleVisibilityChange = () => {
    if (runtime.getVisibilityState() === 'hidden') {
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

  const timer = runtime.setInterval(() => {
    void enqueueAutosave({
      reason: 'interval',
      requireActiveMission: true,
    })
  }, intervalMs)

  runtime.addDocumentEventListener('visibilitychange', handleVisibilityChange)
  runtime.addWindowEventListener('pagehide', handlePageHide)

  return {
    stop: () => {
      if (stopped) {
        return
      }

      stopped = true
      runtime.clearInterval(timer)
      runtime.removeDocumentEventListener('visibilitychange', handleVisibilityChange)
      runtime.removeWindowEventListener('pagehide', handlePageHide)
    },
    requestSync: (reason) =>
      enqueueAutosave({
        reason,
        requireActiveMission: false,
      }),
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
