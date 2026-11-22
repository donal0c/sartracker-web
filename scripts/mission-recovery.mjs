/**
 * Resumes an unfinished mission after a packaged restart through the Resume
 * card (DON-342), then confirms the same mission is running again. Packaged
 * builds always use the simplified layout, so the classic recovery dialog is
 * accepted only when a caller asks for it explicitly. A probe that expects
 * recovery must never skip it quietly: every way it can go wrong throws.
 */

const POLL_MS = 250
const RUNNING_PHASE_SELECTOR = '[data-testid="mission-control"][data-mission-phase="active"]'

/**
 * Waits for the recovery prompt, clicks its Resume button, and waits until no
 * recovery prompt is shown at all.
 *
 * @param {import('playwright').Page} page the app window
 * @param {{
 *   timeoutMs?: number,
 *   legacyDialog?: boolean,
 *   click?: (button: import('playwright').Locator, surface: 'card' | 'dialog') => Promise<void>,
 * }} [options] how long to wait for each step; legacyDialog also accepts the
 *   classic recovery dialog (older artifacts only); who clicks (a probe that
 *   records its own clicks passes its wrapper; the default is an ordinary click)
 * @returns {Promise<'card' | 'dialog'>} which prompt was used
 */
export async function resumeRecoveredMission(page, {
  timeoutMs = 60_000,
  legacyDialog = false,
  click = (button) => button.click(),
} = {}) {
  const dialog = page.getByTestId('mission-recovery-dialog')
  const card = page.getByTestId('start-screen-resume')
  const surface = await waitFor(page, timeoutMs, async () => {
    if (await card.isVisible()) return 'card'
    if (legacyDialog && await dialog.isVisible()) return 'dialog'
    return null
  })
  if (surface === null) {
    throw new Error(legacyDialog
      ? `Mission recovery expected, but neither the Resume card nor the recovery dialog appeared within ${timeoutMs} ms.`
      : `Mission recovery expected, but the Resume card did not appear within ${timeoutMs} ms.`)
  }
  const button = surface === 'card'
    ? page.getByTestId('start-screen-resume-btn')
    : dialog.getByRole('button', { name: 'Resume', exact: true })
  await click(button, surface)
  // Both prompts must be gone: a card replaced by the dialog is not recovery.
  const gone = await waitFor(page, timeoutMs, async () => (
    (await card.isVisible()) || (await dialog.isVisible()) ? null : true
  ))
  if (gone === null) {
    throw new Error(`A mission recovery prompt was still shown after Resume on the ${surface === 'card' ? 'Resume card' : 'recovery dialog'}, ${timeoutMs} ms later.`)
  }
  return surface
}

/**
 * Confirms that recovery brought back the interrupted mission and that it is
 * running: the store's bridge reports that mission as active, and the renderer
 * shows the running phase. A prompt that merely disappeared is not enough; a
 * recovery that leaves the mission paused or loads another one throws.
 *
 * @param {import('playwright').Page} page the app window
 * @param {string} expectedMissionId the mission that was running before the restart
 * @param {{ timeoutMs?: number }} [options] how long to wait for both to agree
 * @returns {Promise<{ id: string, status: string }>} the store's active mission
 */
export async function confirmResumedMission(page, expectedMissionId, { timeoutMs = 30_000 } = {}) {
  let mission = null
  let rendererRunning = false
  const confirmed = await waitFor(page, timeoutMs, async () => {
    mission = await page.evaluate(async () => {
      const active = await window.sartrackerElectron.missionStore.getActiveMission()
      return active === null ? null : { id: active.id, status: active.status }
    })
    if (mission !== null && mission.id !== expectedMissionId) {
      throw new Error(`Restart recovered mission ${mission.id}, expected ${expectedMissionId}.`)
    }
    rendererRunning = (await page.locator(RUNNING_PHASE_SELECTOR).count()) > 0
    return mission?.status === 'active' && rendererRunning ? mission : null
  })
  if (confirmed !== null) return confirmed
  if (mission?.status !== 'active') {
    const found = mission === null ? 'no active mission' : `store status ${mission.status}`
    throw new Error(`Mission ${expectedMissionId} was not running ${timeoutMs} ms after Resume: ${found}.`)
  }
  throw new Error(`The store reports mission ${expectedMissionId} running, but the renderer did not show the mission running within ${timeoutMs} ms.`)
}

/**
 * Polls until the check returns a value other than null, or time runs out.
 *
 * @template T
 * @param {import('playwright').Page} page the app window, for its timer
 * @param {number} timeoutMs how long to keep checking
 * @param {() => Promise<T | null>} check returns null while not yet true
 * @returns {Promise<T | null>} the first non-null result, or null on timeout
 */
async function waitFor(page, timeoutMs, check) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await check()
    if (result !== null) return result
    if (Date.now() >= deadline) return null
    await page.waitForTimeout(POLL_MS)
  }
}
