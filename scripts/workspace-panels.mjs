/**
 * Opens the new layout's side panels from the top bar in the packaged app, as
 * an operator does (DON-341). Mirrors tests/e2e/helpers/workspace-panels.ts
 * for the packaged probes, which drive the app through Playwright's Electron
 * driver and so cannot import the TypeScript helper.
 *
 * Every helper takes an optional `click(locator, testId, position)`. Probes
 * that audit every trusted click (the tracking soak) pass their own, where
 * testId is the first data-testid on the clicked element's path; everyone
 * else gets an ordinary Playwright click. There is one implementation of each
 * behaviour, whoever clicks (DON-353).
 */

/**
 * @typedef {(locator: import('playwright').Locator, testId: string, position?: { x: number, y: number }) => Promise<unknown>} OperatorClick
 */

/** @type {OperatorClick} */
export const plainClick = (locator, _testId, position) => locator.click(position === undefined ? {} : { position })

const PANEL_TEST_IDS = {
  mission: 'ws-mission-host',
  people: 'ws-people-panel',
  layers: 'ws-layers-panel',
  tracking: 'ws-tracking-panel',
  tools: 'ws-tools-panel',
}

// The top-bar button for each panel, and where to press it so the first
// data-testid on the click's path is the button itself: the Mission button's
// centre lands on the mission name, so its phase label is pressed; the others
// are pressed in their padding, clear of badges and problem words.
const PANEL_BUTTONS = {
  mission: { testId: 'ws-mission-phase' },
  people: { testId: 'ws-toggle-people', position: { x: 4, y: 4 } },
  layers: { testId: 'ws-toggle-layers', position: { x: 4, y: 4 } },
  tracking: { testId: 'ws-tracking-headline', position: { x: 4, y: 4 } },
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
 * @param {{ click?: OperatorClick, timeoutMs?: number }} [options] who clicks, and how long to keep trying
 */
export async function openWorkspacePanel(page, panel, { click = plainClick, timeoutMs = 15_000 } = {}) {
  const target = page.getByTestId(PANEL_TEST_IDS[panel])
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await settle(page)
    if (await target.isVisible()) {
      await settle(page)
      if (await target.isVisible()) return
    }
    if (panel === 'tools') {
      await openWorkspacePanel(page, 'layers', { click, timeoutMs: Math.max(1_000, deadline - Date.now()) })
      await click(page.getByTestId('ws-open-tools'), 'ws-open-tools')
    } else {
      const { testId, position } = PANEL_BUTTONS[panel]
      await click(page.getByTestId(testId), testId, position)
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
 * @param {{ click?: OperatorClick, timeoutMs?: number }} [options] who clicks, and how long to wait for the item
 * @returns {Promise<import('playwright').Locator>} the visible item
 */
export async function moreMenuItem(page, testId, { click = plainClick, timeoutMs = 10_000 } = {}) {
  const menu = page.getByTestId('ws-more-menu')
  if (!await menu.isVisible()) {
    await click(page.getByTestId('ws-more-button'), 'ws-more-button')
    await menu.waitFor({ state: 'visible', timeout: timeoutMs })
  }
  const item = menu.getByTestId(testId)
  await item.waitFor({ state: 'visible', timeout: timeoutMs })
  return item
}

/**
 * Reads the app version shown at the foot of the More menu, then closes the
 * menu again. The top bar itself shows no version (DON-341).
 *
 * @param {import('playwright').Page} page the app window
 * @param {{ click?: OperatorClick, timeoutMs?: number }} [options] who clicks, and how long to wait
 * @returns {Promise<string>} the version text as shown
 */
export async function readMenuVersion(page, { click = plainClick, timeoutMs = 10_000 } = {}) {
  const menu = page.getByTestId('ws-more-menu')
  const wasOpen = await menu.isVisible()
  if (!wasOpen) {
    await click(page.getByTestId('ws-more-button'), 'ws-more-button')
    await menu.waitFor({ state: 'visible', timeout: timeoutMs })
  }
  const version = menu.locator('.ws-menu-version')
  await version.waitFor({ state: 'visible', timeout: timeoutMs })
  const text = (await version.innerText()).trim()
  if (!wasOpen) {
    await click(page.getByTestId('ws-more-button'), 'ws-more-button')
    await menu.waitFor({ state: 'hidden', timeout: timeoutMs })
  }
  if (text === '') throw new Error('The More menu shows no app version.')
  return text
}

/**
 * Opens Review and replay from the top bar's More menu and waits until it is
 * on screen (DON-341).
 *
 * @param {import('playwright').Page} page the app window
 * @param {{ click?: OperatorClick, timeoutMs?: number }} [options] who clicks, and how long to wait for Review
 */
export async function openMissionReview(page, { click = plainClick, timeoutMs = 15_000 } = {}) {
  await click(await moreMenuItem(page, 'ws-open-review', { click, timeoutMs }), 'ws-open-review')
  await page.getByTestId('mission-review-workspace').waitFor({ state: 'visible', timeout: timeoutMs })
}

/**
 * Presses Pause or Resume in the Mission panel and waits for the top bar to
 * show the new phase. Pausing asks for confirmation first (DON-341).
 *
 * @param {import('playwright').Page} page the app window
 * @param {{ click?: OperatorClick, timeoutMs?: number }} [options] who clicks, and how long to wait
 * @returns {Promise<'PAUSED' | 'Running'>} the phase now shown
 */
export async function pressPauseResume(page, { click = plainClick, timeoutMs = 10_000 } = {}) {
  await openWorkspacePanel(page, 'mission', { click, timeoutMs: Math.max(timeoutMs, 15_000) })
  const button = page.getByTestId('mission-pause-resume-btn')
  await button.waitFor({ state: 'visible', timeout: timeoutMs })
  const pausing = (await button.textContent())?.trim() === 'Pause'
  await click(button, 'mission-pause-resume-btn')
  if (pausing) {
    const yes = page.getByTestId('ws-pause-confirm-yes')
    await yes.waitFor({ state: 'visible', timeout: timeoutMs })
    await click(yes, 'ws-pause-confirm-yes')
  }
  const phase = pausing ? 'PAUSED' : 'Running'
  await page.waitForFunction((expected) =>
    document.querySelector('[data-testid="ws-mission-phase"]')?.textContent?.includes(expected) === true,
  phase, { timeout: timeoutMs })
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
 * @param {{ require?: 'device' | 'group', click?: OperatorClick, timeoutMs?: number }} [options]
 *   the picker that must be visible, who clicks, and how long to wait
 * @returns {Promise<import('playwright').Locator | null>} the required picker, or null
 */
export async function openParticipantPickers(page, { require, click = plainClick, timeoutMs = 30_000 } = {}) {
  await openWorkspacePanel(page, 'mission', { click, timeoutMs })
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
  await unfold(outer, 'ws-change-participants', click)
  if (require === 'device') await devices.waitFor({ state: 'visible', timeout: timeoutMs })
  await unfold(devices, 'ws-pick-devices', click)
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
 * @param {string} testId its data-testid, the first on the summary click's path
 * @param {OperatorClick} click who clicks
 */
async function unfold(fold, testId, click) {
  if (await fold.count() === 0) return
  if (await fold.evaluate((element) => element instanceof HTMLDetailsElement && element.open)) return
  await click(fold.locator('summary').first(), testId)
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
