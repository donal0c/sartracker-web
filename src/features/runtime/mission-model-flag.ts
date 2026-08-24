export type MissionModelFlagContext = {
  readonly dev: boolean
  readonly browserHarness: boolean
  readonly buildFlag: string | undefined
}

export const DEFAULT_MISSION_MODEL_ENABLED = false

/**
 * Resolves the internal mission-model gate without exposing an operator toggle.
 * An explicit build value always wins so release builds fail closed by default.
 */
export function resolveMissionModelFlag(context: MissionModelFlagContext): boolean {
  if (context.buildFlag !== undefined) {
    return context.buildFlag === '1'
  }

  return context.dev || context.browserHarness || DEFAULT_MISSION_MODEL_ENABLED
}

/** Returns whether the additive PR-2 mission model is enabled in this renderer. */
export function isMissionModelEnabled(): boolean {
  const search = typeof window !== 'undefined' && typeof window.location?.search === 'string'
    ? new URLSearchParams(window.location.search)
    : null
  const browserHarnessMode = search?.get('missionHarness') === '1'
  const browserHarness = browserHarnessMode && search?.get('missionModel') === '1'

  return resolveMissionModelFlag({
    dev: import.meta.env.DEV && !browserHarnessMode,
    browserHarness,
    buildFlag: import.meta.env.VITE_SARTRACKER_MISSION_MODEL,
  })
}
