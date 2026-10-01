/**
 * Opens a folded Mission Control section (Participants or Outings) in the
 * packaged app, as an operator presses Show during a mission [DON-300].
 * Outside an active or paused mission the sections are never folded, so a
 * section that does not appear is treated as already open.
 */
export async function openMissionSection(page, name, { timeoutMs = 5_000 } = {}) {
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
