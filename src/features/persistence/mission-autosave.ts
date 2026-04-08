import { DEFAULT_AUTOSAVE_INTERVAL_MS, normalizeAutosaveIntervalMs } from './autosave-config'
import {
  createBrowserMissionAutosaveRuntime,
  type MissionAutosaveRuntime,
} from './mission-autosave-runtime'

type MissionLike = {
  readonly id: string
}

export type AutosaveStore = {
  readonly getActiveMission: () => Promise<MissionLike | null>
  readonly syncBackup: () => Promise<string>
}

type AutosaveLogger = {
  readonly warn: (message: string, error: unknown) => void
}

type StartMissionAutosaveOptions = {
  readonly intervalMs?: number
  readonly logger?: AutosaveLogger
  readonly runtime?: MissionAutosaveRuntime | null
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
): () => void {
  const intervalMs = normalizeAutosaveIntervalMs(
    options.intervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS,
  )
  const logger = options.logger ?? DEFAULT_LOGGER
  const runtime = options.runtime ?? createBrowserMissionAutosaveRuntime()
  let syncInFlight = false

  if (runtime === null) {
    return () => undefined
  }

  const runAutosave = async () => {
    if (syncInFlight) {
      return
    }

    syncInFlight = true

    try {
      const activeMission = await store.getActiveMission()
      if (activeMission === null) {
        return
      }

      await store.syncBackup()
    } catch (error) {
      logger.warn('Mission autosave failed.', error)
    } finally {
      syncInFlight = false
    }
  }

  const handleVisibilityChange = () => {
    if (runtime.getVisibilityState() === 'hidden') {
      void runAutosave()
    }
  }

  const handlePageHide = () => {
    void runAutosave()
  }

  const timer = runtime.setInterval(() => {
    void runAutosave()
  }, intervalMs)

  runtime.addDocumentEventListener('visibilitychange', handleVisibilityChange)
  runtime.addWindowEventListener('pagehide', handlePageHide)

  return () => {
    runtime.clearInterval(timer)
    runtime.removeDocumentEventListener('visibilitychange', handleVisibilityChange)
    runtime.removeWindowEventListener('pagehide', handlePageHide)
  }
}
