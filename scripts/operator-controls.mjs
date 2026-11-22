/**
 * Operator controls in the packaged app's new layout (DON-341, DON-353), shared
 * by the packaged smokes. In the new layout the participant pickers can sit
 * inside folds, the Mission controls live in the Mission panel, and Devices
 * opens from the People panel. Every helper fails loudly when a control it
 * needs is missing; none of them skips a step quietly.
 *
 * Probes that audit every trusted click (the tracking soak) pass their own
 * `click(locator, testId, position)`, where testId is the first data-testid
 * on the clicked element's path. Panels then open with one audited click each.
 */

import { openWorkspacePanel } from './workspace-panels.mjs'

// The audited target is the element whose data-testid comes first on the
// click's path. The Mission button's centre lands on its mission name, so its
// phase label is clicked; People is clicked in its padding, clear of the badge.
const PANEL_BUTTONS = {
  mission: { panel: 'ws-mission-host', button: 'ws-mission-phase' },
  people: { panel: 'ws-people-panel', button: 'ws-toggle-people', position: { x: 4, y: 4 } },
}

/**
 * @typedef {(locator: import('playwright').Locator, testId: string, position?: { x: number, y: number }) => Promise<unknown>} OperatorClick
 * @typedef {{ click?: OperatorClick, timeoutMs?: number }} OperatorOptions
 */

/** @type {OperatorClick} */
const plainClick = (locator, _testId, position) => locator.click(position === undefined ? {} : { position })

/**
 * Panel options for a helper's click: an audited click is passed on, the
 * plain click lets the panel opener use its retrying top-bar open.
 *
 * @param {OperatorClick} click who clicks
 * @param {number} timeoutMs how long to wait
 * @returns {OperatorOptions} the options for openPanel
 */
function panelOptions(click, timeoutMs) {
  return click === plainClick ? { timeoutMs } : { click, timeoutMs }
}

/**
 * Opens the Mission or People panel. With the default click it uses the
 * top-bar helper's retrying open; with an audited click it clicks once and
 * requires the panel to appear.
 *
 * @param {import('playwright').Page} page the app window
 * @param {'mission' | 'people'} name the panel
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 */
export async function openPanel(page, name, { click, timeoutMs = 15_000 } = {}) {
  if (click === undefined) {
    await openWorkspacePanel(page, name, { timeoutMs })
    return
  }
  const { panel, button, position } = PANEL_BUTTONS[name]
  const target = page.getByTestId(panel)
  if (await target.isVisible()) return
  await click(page.getByTestId(button), button, position)
  await target.waitFor({ state: 'visible', timeout: timeoutMs })
}

/**
 * Opens a closed `<details>` fold by its summary. Does nothing if it is
 * already open.
 *
 * @param {import('playwright').Locator} fold the details element
 * @param {string} testId its data-testid
 * @param {OperatorClick} click who clicks
 */
async function unfold(fold, testId, click) {
  const closed = await fold.evaluate((element) => element instanceof HTMLDetailsElement && !element.open)
  if (closed) await click(fold.locator('summary').first(), testId)
}

/**
 * Puts the participant pickers on screen, reusing the C05 fix: the pickers
 * sit inside "Change who's taking part" only when the team has a default
 * group, and the device list inside "Pick people", so each fold is opened
 * only if it exists, and the picker itself is then required.
 *
 * @param {import('playwright').Page} page the app window
 * @param {OperatorOptions & { kind?: 'device' | 'group' }} [options] which picker must be visible
 * @returns {Promise<import('playwright').Locator>} the visible picker
 */
export async function unfoldParticipantPickers(page, { click = plainClick, timeoutMs = 30_000, kind = 'device' } = {}) {
  await openPanel(page, 'mission', panelOptions(click, timeoutMs))
  const outer = page.getByTestId('ws-change-participants')
  const devices = page.getByTestId('ws-pick-devices')
  const picker = page.getByTestId(`participant-${kind}-picker`)
  try {
    await outer.or(devices).or(picker).first().waitFor({ state: 'attached', timeout: timeoutMs })
  } catch {
    throw new Error(`The participant pickers did not appear within ${timeoutMs} ms.`)
  }
  if (await outer.count() > 0) await unfold(outer, 'ws-change-participants', click)
  if (kind === 'device') {
    await devices.waitFor({ state: 'visible', timeout: timeoutMs })
    await unfold(devices, 'ws-pick-devices', click)
  }
  try {
    await picker.waitFor({ state: 'visible', timeout: timeoutMs })
  } catch {
    throw new Error(`The ${kind} picker was not visible after opening its folds, within ${timeoutMs} ms.`)
  }
  return picker
}

/**
 * Selects participants before Start, as an operator does: opens the folds,
 * requires the picker and its checkboxes, then ticks them.
 *
 * @param {import('playwright').Page} page the app window
 * @param {OperatorOptions & {
 *   kind?: 'device' | 'group',
 *   which?: 'first' | 'all',
 *   expectedCount?: number,
 * }} [options] which picker, the first entry or all of them, and how many
 *   entries it must offer (checked before anything is ticked)
 * @returns {Promise<number>} how many entries were ticked
 */
export async function selectParticipants(page, {
  click = plainClick,
  timeoutMs = 30_000,
  kind = 'device',
  which = 'first',
  expectedCount,
} = {}) {
  const picker = await unfoldParticipantPickers(page, { click, timeoutMs, kind })
  const boxes = picker.locator('input[type="checkbox"]')
  try {
    await boxes.first().waitFor({ state: 'visible', timeout: timeoutMs })
  } catch {
    const text = ((await picker.textContent()) ?? '').replace(/\s+/gu, ' ').trim().slice(0, 500)
    throw new Error(`The ${kind} picker offered nothing to select within ${timeoutMs} ms. Picker: ${text}`)
  }
  const available = await boxes.count()
  if (expectedCount !== undefined && available !== expectedCount) {
    throw new Error(`Expected ${expectedCount} selectable ${kind} entries; the picker offered ${available}.`)
  }
  const indexes = which === 'all' ? [...Array(available).keys()] : [0]
  for (const index of indexes) {
    const box = boxes.nth(index)
    if (await box.isChecked()) continue
    await click(box, `participant-${kind}-picker`)
    if (!await box.isChecked()) throw new Error(`The ${kind} picker entry ${index + 1} did not tick.`)
  }
  return indexes.length
}

/**
 * Opens Devices from the People panel. Does nothing if it is already open.
 *
 * @param {import('playwright').Page} page the app window
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 * @returns {Promise<import('playwright').Locator>} the Devices workspace
 */
export async function openDevicesWorkspace(page, { click = plainClick, timeoutMs = 15_000 } = {}) {
  const workspace = page.getByTestId('devices-workspace')
  if (await workspace.isVisible()) return workspace
  await openPanel(page, 'people', panelOptions(click, timeoutMs))
  await click(page.getByTestId('open-devices-workspace'), 'open-devices-workspace')
  await workspace.waitFor({ state: 'visible', timeout: timeoutMs })
  return workspace
}

/**
 * Closes an open workspace (Devices, Review) so the map and panels are
 * reachable again. Does nothing if none is open.
 *
 * @param {import('playwright').Page} page the app window
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 */
export async function closeWorkspace(page, { click = plainClick, timeoutMs = 15_000 } = {}) {
  const close = page.getByTestId('workspace-close-btn')
  if (!await close.isVisible()) return
  await click(close, 'workspace-close-btn')
  await close.waitFor({ state: 'hidden', timeout: timeoutMs })
}

/**
 * Opens the Finish dialog from the Mission panel and confirms it. The caller
 * checks the outcome, because some probes expect the finish to be refused.
 *
 * @param {import('playwright').Page} page the app window
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 */
export async function confirmFinishMission(page, { click = plainClick, timeoutMs = 30_000 } = {}) {
  await closeWorkspace(page, { click, timeoutMs })
  await openPanel(page, 'mission', panelOptions(click, timeoutMs))
  const finish = page.getByTestId('mission-finish-btn')
  await finish.waitFor({ state: 'visible', timeout: timeoutMs })
  await click(finish, 'mission-finish-btn')
  const dialog = page.getByTestId('mission-finish-dialog')
  await dialog.waitFor({ state: 'visible', timeout: timeoutMs })
  await click(dialog.getByRole('button', { name: 'Confirm Finish', exact: true }), 'mission-finish-dialog')
}

/**
 * Pauses or resumes from the Mission panel, answering the pause confirmation,
 * and waits until the top bar shows the new state. Does nothing if the
 * mission is already in that state.
 *
 * @param {import('playwright').Page} page the app window
 * @param {boolean} paused true to pause, false to resume
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 */
export async function setMissionPaused(page, paused, { click = plainClick, timeoutMs = 30_000 } = {}) {
  const phase = page.getByTestId('ws-mission-phase')
  const expected = paused ? 'PAUSED' : 'Running'
  if ((await phase.textContent())?.includes(expected) === true) return
  await closeWorkspace(page, { click, timeoutMs })
  await openPanel(page, 'mission', panelOptions(click, timeoutMs))
  await click(page.getByTestId('mission-pause-resume-btn'), 'mission-pause-resume-btn')
  if (paused) {
    const yes = page.getByTestId('ws-pause-confirm-yes')
    await yes.waitFor({ state: 'visible', timeout: timeoutMs })
    await click(yes, 'ws-pause-confirm-yes')
  }
  await page.waitForFunction(
    (text) => document.querySelector('[data-testid="ws-mission-phase"]')?.textContent?.includes(text) === true,
    expected,
    { timeout: timeoutMs },
  )
}

/**
 * Opens Review and replay from the Mission panel's button, where the probes
 * expect it after a mission has run.
 *
 * @param {import('playwright').Page} page the app window
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 */
export async function openReviewFromMission(page, { click = plainClick, timeoutMs = 15_000 } = {}) {
  await openPanel(page, 'mission', panelOptions(click, timeoutMs))
  await click(page.getByTestId('open-mission-review-workspace'), 'open-mission-review-workspace')
}

/**
 * Opens the Mission panel's participants section during a mission, for probes
 * whose every click is audited (mission-sections.mjs clicks for itself).
 *
 * @param {import('playwright').Page} page the app window
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 */
export async function openParticipantsSection(page, { click = plainClick, timeoutMs = 15_000 } = {}) {
  await openPanel(page, 'mission', panelOptions(click, timeoutMs))
  const fold = page.getByTestId('mission-participants-section')
  await fold.waitFor({ state: 'attached', timeout: timeoutMs })
  if (await fold.getAttribute('data-open') === 'false') {
    await click(page.getByTestId('mission-participants-section-toggle'), 'mission-participants-section-toggle')
  }
  await page.waitForFunction(
    () => document.querySelector('[data-testid="mission-participants-section"]')?.getAttribute('data-open') !== 'false',
    undefined,
    { timeout: timeoutMs },
  )
}
