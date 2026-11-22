/**
 * Opens the new layout's side panels from the top bar in the packaged app, as
 * an operator does (DON-341). Mirrors tests/e2e/helpers/workspace-panels.ts
 * for the packaged probes, which drive the app through Playwright's Electron
 * driver and so cannot import the TypeScript helper.
 */

const PANEL_TEST_IDS = {
  mission: 'ws-mission-host',
  people: 'ws-people-panel',
  layers: 'ws-layers-panel',
  tracking: 'ws-tracking-panel',
  tools: 'ws-tools-panel',
}

/**
 * Waits two animation frames, so a panel that a phase change is about to
 * close has closed before the next check.
 *
 * @param {import('playwright').Page} page the app window
 */
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/**
 * Opens one side panel and waits until it stays visible. Does nothing if it
 * is already open. The top bar buttons toggle and a panel can open or close on
 * its own as a click lands, so it re-checks after each click.
 *
 * @param {import('playwright').Page} page the app window
 * @param {'mission' | 'people' | 'layers' | 'tracking' | 'tools'} panel the panel to open
 * @param {{ timeoutMs?: number }} [options] how long to keep trying
 */
export async function openWorkspacePanel(page, panel, { timeoutMs = 15_000 } = {}) {
  const target = page.getByTestId(PANEL_TEST_IDS[panel])
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await settle(page)
    if (await target.isVisible()) {
      await settle(page)
      if (await target.isVisible()) return
    }
    if (panel === 'mission') await page.getByTestId('ws-mission-button').click()
    else if (panel === 'people') await page.getByTestId('ws-toggle-people').click()
    else if (panel === 'layers') await page.getByTestId('ws-toggle-layers').click()
    else if (panel === 'tracking') await page.getByTestId('ws-tracking-headline').click()
    else {
      await openWorkspacePanel(page, 'layers', { timeoutMs: Math.max(1_000, deadline - Date.now()) })
      await page.getByTestId('ws-open-tools').click()
    }
    await target.waitFor({ state: 'visible', timeout: 1_500 }).catch(() => undefined)
  }
  throw new Error(`The ${panel} panel did not open from the top bar within ${timeoutMs} ms.`)
}

/**
 * Opens the top bar's More menu and returns one of its items, once visible.
 * Review, Diagnostics, Help, Weather and the theme exist only while the menu is
 * open, so a probe that reached for them directly never got there (DON-341).
 *
 * @param {import('playwright').Page} page the app window
 * @param {string} testId the item's data-testid
 * @param {{ timeoutMs?: number }} [options] how long to wait for the item
 * @returns {Promise<import('playwright').Locator>} the visible item
 */
export async function moreMenuItem(page, testId, { timeoutMs = 10_000 } = {}) {
  const menu = page.getByTestId('ws-more-menu')
  if (!await menu.isVisible()) {
    await page.getByTestId('ws-more-button').click()
    await menu.waitFor({ state: 'visible', timeout: timeoutMs })
  }
  const item = menu.getByTestId(testId)
  await item.waitFor({ state: 'visible', timeout: timeoutMs })
  return item
}

/**
 * Opens Review and replay from the top bar's More menu and waits until it is
 * on screen (DON-341).
 *
 * @param {import('playwright').Page} page the app window
 * @param {{ timeoutMs?: number }} [options] how long to wait for Review
 */
export async function openMissionReview(page, { timeoutMs = 15_000 } = {}) {
  await (await moreMenuItem(page, 'ws-open-review', { timeoutMs })).click()
  await page.getByTestId('mission-review-workspace').waitFor({ state: 'visible', timeout: timeoutMs })
}

/**
 * Presses Pause or Resume in the Mission panel and waits for the top bar to
 * show the new phase. Pausing asks for confirmation first (DON-341).
 *
 * @param {import('playwright').Page} page the app window
 * @returns {Promise<'PAUSED' | 'Running'>} the phase now shown
 */
export async function pressPauseResume(page) {
  await openWorkspacePanel(page, 'mission')
  const button = page.getByTestId('mission-pause-resume-btn')
  const pausing = (await button.textContent())?.trim() === 'Pause'
  await button.click()
  if (pausing) await page.getByTestId('ws-pause-confirm-yes').click()
  const phase = pausing ? 'PAUSED' : 'Running'
  await page.waitForFunction((expected) =>
    document.querySelector('[data-testid="ws-mission-phase"]')?.textContent?.includes(expected) === true,
  phase, { timeout: 10_000 })
  await settle(page)
  return phase
}

/**
 * Opens the Mission panel and unfolds its participant pickers (DON-341).
 * "Change who's taking part" exists only when the team has a default group
 * and "Pick people" holds the device list; both start closed. Before Start,
 * pass `require` to wait until that picker is mounted, unfolded and visible;
 * during a mission the pickers are replaced by the add-device form, so without
 * `require` this only opens whichever folds are there.
 *
 * @param {import('playwright').Page} page the app window
 * @param {{ require?: 'device' | 'group', timeoutMs?: number }} [options] the picker that must be visible
 * @returns {Promise<import('playwright').Locator | null>} the required picker, or null
 */
export async function openParticipantPickers(page, { require, timeoutMs = 30_000 } = {}) {
  await openWorkspacePanel(page, 'mission')
  const outer = page.getByTestId('ws-change-participants')
  const devices = page.getByTestId('ws-pick-devices')
  const picker = require === undefined ? null : page.getByTestId(`participant-${require}-picker`)
  if (picker !== null) {
    try {
      await outer.or(devices).or(picker).first().waitFor({ state: 'attached', timeout: timeoutMs })
    } catch {
      throw new Error(`The participant pickers did not appear in the Mission panel within ${timeoutMs} ms.`)
    }
  }
  await unfold(outer)
  if (require === 'device') await devices.waitFor({ state: 'visible', timeout: timeoutMs })
  await unfold(devices)
  if (picker === null) return null
  try {
    await picker.waitFor({ state: 'visible', timeout: timeoutMs })
  } catch {
    throw new Error(`The ${require} picker was not visible after opening its folds, within ${timeoutMs} ms.`)
  }
  return picker
}

/**
 * Opens a closed `<details>` fold by its summary and waits until it is open.
 * Does nothing if the fold is absent or already open.
 *
 * @param {import('playwright').Locator} fold the details element
 */
async function unfold(fold) {
  if (await fold.count() === 0) return
  if (await fold.evaluate((element) => element instanceof HTMLDetailsElement && element.open)) return
  await fold.locator('summary').first().click()
  await fold.evaluate((element) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000
    const check = () => {
      if (element instanceof HTMLDetailsElement && element.open) resolve(undefined)
      else if (Date.now() > deadline) reject(new Error(`The ${element.getAttribute('data-testid')} fold did not open.`))
      else requestAnimationFrame(check)
    }
    check()
  }))
}
