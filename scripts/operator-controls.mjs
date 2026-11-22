/**
 * Operator controls in the packaged app's new layout (DON-341, DON-353) that
 * the shared panel and section helpers do not already cover: ticking
 * participants, Devices, closing a workspace, Finish, and Review from the
 * Mission panel. Panels, participant folds, sections and Pause come from
 * workspace-panels.mjs and mission-sections.mjs, so there is one
 * implementation of each. Every helper fails loudly when a control it needs is
 * missing; none of them skips a step quietly.
 *
 * Probes that audit every trusted click (the tracking soak) pass their own
 * `click(locator, testId, position)`, where testId is the first data-testid
 * on the clicked element's path.
 */

import { openParticipantPickers, openWorkspacePanel, plainClick, pressPauseResume } from './workspace-panels.mjs'

/**
 * @typedef {import('./workspace-panels.mjs').OperatorClick} OperatorClick
 * @typedef {{ click?: OperatorClick, timeoutMs?: number }} OperatorOptions
 */

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
  const picker = await openParticipantPickers(page, { require: kind, click, timeoutMs })
  if (picker === null) throw new Error(`The ${kind} picker was not returned.`)
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
  await openWorkspacePanel(page, 'people', { click, timeoutMs })
  const open = page.getByTestId('open-devices-workspace')
  await open.waitFor({ state: 'visible', timeout: timeoutMs })
  await click(open, 'open-devices-workspace')
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
  await openWorkspacePanel(page, 'mission', { click, timeoutMs })
  const finish = page.getByTestId('mission-finish-btn')
  await finish.waitFor({ state: 'visible', timeout: timeoutMs })
  await click(finish, 'mission-finish-btn')
  const dialog = page.getByTestId('mission-finish-dialog')
  await dialog.waitFor({ state: 'visible', timeout: timeoutMs })
  await click(dialog.getByRole('button', { name: 'Confirm Finish', exact: true }), 'mission-finish-dialog')
}

/**
 * Pauses or resumes through the shared Pause control and waits until the top
 * bar shows the new state. Does nothing if the mission is already in that
 * state.
 *
 * @param {import('playwright').Page} page the app window
 * @param {boolean} paused true to pause, false to resume
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 */
export async function setMissionPaused(page, paused, { click = plainClick, timeoutMs = 30_000 } = {}) {
  const expected = paused ? 'PAUSED' : 'Running'
  const phase = page.getByTestId('ws-mission-phase')
  await phase.waitFor({ state: 'visible', timeout: timeoutMs })
  if ((await phase.textContent())?.includes(expected) === true) return
  await closeWorkspace(page, { click, timeoutMs })
  const shown = await pressPauseResume(page, { click, timeoutMs })
  if (shown !== expected) throw new Error(`Pressing Pause/Resume showed ${shown}, not ${expected}.`)
}

/**
 * Opens Review and replay from the Mission panel's button, where the probes
 * expect it after a mission has run, and waits until it is on screen.
 *
 * @param {import('playwright').Page} page the app window
 * @param {OperatorOptions} [options] who clicks, and how long to wait
 */
export async function openReviewFromMission(page, { click = plainClick, timeoutMs = 15_000 } = {}) {
  await openWorkspacePanel(page, 'mission', { click, timeoutMs })
  const open = page.getByTestId('open-mission-review-workspace')
  await open.waitFor({ state: 'visible', timeout: timeoutMs })
  await click(open, 'open-mission-review-workspace')
  await page.getByTestId('mission-review-workspace').waitFor({ state: 'visible', timeout: timeoutMs })
}
