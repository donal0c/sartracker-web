import { openWorkspacePanel } from './workspace-panels.mjs'

/**
 * Opens a folded Mission Control section (Participants or Outings) in the
 * packaged app, as an operator presses Show during a mission [DON-300].
 * Outside an active or paused mission the sections are never folded, so a
 * section that does not appear is treated as already open.
 */
export async function openMissionSection(page, name, { timeoutMs = 5_000 } = {}) {
  // The new layout keeps Mission Control in a side panel opened from the top
  // bar, with Outings inside "More mission options" (DON-341).
  if (await page.getByTestId('simplified-workspace').count() > 0) await openWorkspacePanel(page, 'mission')
  const more = page.getByTestId('ws-more-mission-options')
  if (name === 'outings' && await more.count() > 0
    && await more.evaluate((element) => element instanceof HTMLDetailsElement && !element.open)) {
    await more.locator('summary').first().click()
  }
  const section = page.getByTestId(`mission-${name}-section`)
  await section.waitFor({ state: 'attached', timeout: timeoutMs }).catch(() => undefined)
  if (await section.count() === 0) return
  if (await section.getAttribute('data-open') === 'false') {
    await page.getByTestId(`mission-${name}-section-toggle`).click({ force: true })
  }
  await page.waitForFunction(
    (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-open') === 'true',
    `mission-${name}-section`,
    { timeout: timeoutMs },
  )
}
