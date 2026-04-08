import { DEFAULT_AUTOSAVE_INTERVAL_MS, normalizeAutosaveIntervalMs } from './autosave-config'

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
}

const DEFAULT_LOGGER: AutosaveLogger = {
  warn: (message, error) => {
    console.warn(message, error)
  },
}

export function startMissionAutosave(
  store: AutosaveStore,
  options: StartMissionAutosaveOptions = {},
): () => void {
  const intervalMs = normalizeAutosaveIntervalMs(
    options.intervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS,
  )
  const logger = options.logger ?? DEFAULT_LOGGER
  let syncInFlight = false

  const timer = window.setInterval(async () => {
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
  }, intervalMs)

  return () => {
    window.clearInterval(timer)
  }
}
