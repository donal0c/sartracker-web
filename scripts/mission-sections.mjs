import { openWorkspacePanel } from './workspace-panels.mjs'

/** The content each Mission Control section shows once it is open. */
const SECTION_CONTENT = {
  participants: '[data-testid="participant-management"], [data-testid="participant-selection-step"]',
  outings: '[data-testid="outing-controls-section"]',
}

/**
 * Opens a Mission Control section (Participants or Outings) in the packaged
 * app, as an operator presses Show during a mission [DON-300]. In the new
 * layout it first opens the Mission panel and, for Outings, "More mission
 * options" (DON-341).
 *
 * A section folds only during an active or paused mission; otherwise its
 * content is shown directly, with no fold around it. Either way this ends with
 * the section's content visible, or throws: a section that is genuinely
 * missing is a failure, never treated as already open.
 *
 * @param {import('playwright').Page} page the app window
 * @param {'participants' | 'outings'} name the section to open
 * @param {{ timeoutMs?: number }} [options] how long to wait for the section
 */
export async function openMissionSection(page, name, { timeoutMs = 5_000 } = {}) {
  const contentSelector = SECTION_CONTENT[name]
  if (contentSelector === undefined) throw new Error(`Unknown Mission Control section "${name}".`)
  if (await page.getByTestId('simplified-workspace').count() > 0) await openWorkspacePanel(page, 'mission')
  const more = page.getByTestId('ws-more-mission-options')
  if (name === 'outings' && await more.count() > 0
    && await more.evaluate((element) => element instanceof HTMLDetailsElement && !element.open)) {
    await more.locator('summary').first().click()
  }

  const fold = page.getByTestId(`mission-${name}-section`)
  const content = page.locator(contentSelector)
  // Right after Start the section may not be mounted yet: wait for the fold or its content.
  try {
    await fold.or(content).first().waitFor({ state: 'attached', timeout: timeoutMs })
  } catch {
    throw new Error(`The Mission ${name} section is missing: neither its fold nor its content appeared within ${timeoutMs} ms.`)
  }

  if (await fold.count() > 0) {
    if (await fold.getAttribute('data-open') === 'false') await page.getByTestId(`mission-${name}-section-toggle`).click()
    await page.waitForFunction(
      (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('data-open') === 'true',
      `mission-${name}-section`,
      { timeout: timeoutMs },
    )
    await fold.getByTestId(`mission-${name}-section-body`).locator(contentSelector).first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
    return
  }
  try {
    await content.first().waitFor({ state: 'visible', timeout: timeoutMs })
  } catch {
    throw new Error(`The Mission ${name} section is present but its content is not visible.`)
  }
}
