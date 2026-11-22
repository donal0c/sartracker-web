import { shouldEnableMissionBrowserHarness } from '../mission/mission-browser-harness'

/**
 * Temporary, test-only: the old command-mast and sidebar screen, kept so the
 * existing e2e specs keep running while they move to the new layout on the
 * `don-341-integration` branch. It is reachable only inside the browser test
 * harness (which a packaged desktop app can never be forced into) and only with
 * `classicLayout=1` in the address. Delete it, with its spec flags, before that
 * branch merges to master (DON-341).
 */
export function shouldUseClassicLayoutFixtureForContext(context: {
  readonly search: string
  readonly harnessEnabled: boolean
}): boolean {
  return context.harnessEnabled && new URLSearchParams(context.search).get('classicLayout') === '1'
}

/** Whether this window shows the temporary classic layout fixture. */
export function shouldUseClassicLayoutFixture(): boolean {
  if (typeof window === 'undefined') return false
  return shouldUseClassicLayoutFixtureForContext({
    search: window.location.search,
    harnessEnabled: shouldEnableMissionBrowserHarness(),
  })
}
