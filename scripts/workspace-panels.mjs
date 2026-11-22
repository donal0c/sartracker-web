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
 * @param {'mission' | 'people' | 'layers' | 'tools'} panel the panel to open
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
    else {
      await openWorkspacePanel(page, 'layers', { timeoutMs: Math.max(1_000, deadline - Date.now()) })
      await page.getByTestId('ws-open-tools').click()
    }
    await target.waitFor({ state: 'visible', timeout: 1_500 }).catch(() => undefined)
  }
  throw new Error(`The ${panel} panel did not open from the top bar within ${timeoutMs} ms.`)
}

/**
 * Opens Review and replay from the top bar's More menu (DON-341).
 *
 * @param {import('playwright').Page} page the app window
 */
export async function openMissionReview(page) {
  await page.getByTestId('ws-more-button').click()
  await page.getByTestId('ws-open-review').click()
}
