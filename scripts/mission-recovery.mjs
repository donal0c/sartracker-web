/**
 * Resumes an unfinished mission after a packaged restart, through whichever
 * prompt the app shows: the new layout's Resume card (DON-342) or the older
 * recovery dialog. A probe that expects recovery must never skip it quietly:
 * if neither prompt appears, or the prompt stays after Resume, this throws.
 */

const POLL_MS = 250

/**
 * Waits for one recovery prompt, clicks its Resume button, and waits for the
 * prompt to go.
 *
 * @param {import('playwright').Page} page the app window
 * @param {{
 *   timeoutMs?: number,
 *   click?: (button: import('playwright').Locator, surface: 'card' | 'dialog') => Promise<void>,
 * }} [options] how long to wait for each step, and who clicks (a probe that
 *   records its own clicks passes its wrapper; the default is an ordinary click)
 * @returns {Promise<'card' | 'dialog'>} which prompt was used
 */
export async function resumeRecoveredMission(page, { timeoutMs = 60_000, click = (button) => button.click() } = {}) {
  const dialog = page.getByTestId('mission-recovery-dialog')
  const card = page.getByTestId('start-screen-resume')
  const surface = await waitFor(page, timeoutMs, async () => {
    if (await card.isVisible()) return 'card'
    if (await dialog.isVisible()) return 'dialog'
    return null
  })
  if (surface === null) {
    throw new Error(`Mission recovery expected, but neither the Resume card nor the recovery dialog appeared within ${timeoutMs} ms.`)
  }
  const prompt = surface === 'card' ? card : dialog
  const button = surface === 'card'
    ? page.getByTestId('start-screen-resume-btn')
    : dialog.getByRole('button', { name: 'Resume', exact: true })
  await click(button, surface)
  const gone = await waitFor(page, timeoutMs, async () => (await prompt.isVisible() ? null : true))
  if (gone === null) {
    throw new Error(`The mission recovery ${surface === 'card' ? 'Resume card' : 'dialog'} was still shown after Resume, ${timeoutMs} ms later.`)
  }
  return surface
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
