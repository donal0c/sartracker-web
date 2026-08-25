export type CoverageFlagContext = {
  readonly buildFlag: string | undefined
  readonly browserHarness: boolean
  readonly browserHarnessMode?: boolean
}

export const DEFAULT_COVERAGE_ENABLED = true

/** Resolves the internal flag; explicit build posture always wins. */
export function resolveCoverageFlag(context: CoverageFlagContext): boolean {
  if (context.buildFlag !== undefined) return context.buildFlag === '1'
  if (context.browserHarnessMode === true) return context.browserHarness
  return context.browserHarness || DEFAULT_COVERAGE_ENABLED
}

/** Returns whether complete mission coverage is enabled in this renderer. */
export function isCoverageEnabled(): boolean {
  const search = typeof window !== 'undefined' && typeof window.location?.search === 'string'
    ? new URLSearchParams(window.location.search)
    : null
  const browserHarnessMode = search?.get('missionHarness') === '1'
  return resolveCoverageFlag({
    buildFlag: import.meta.env.VITE_SARTRACKER_COVERAGE,
    browserHarnessMode,
    browserHarness: browserHarnessMode && search.get('coverage') === '1',
  })
}
