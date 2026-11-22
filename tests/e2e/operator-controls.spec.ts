import { expect, test, type Locator, type Page } from '@playwright/test'

import { openMissionSection } from '../../scripts/mission-sections.mjs'
import {
  closeWorkspace,
  openDevicesWorkspace,
  selectParticipants,
  setMissionPaused,
} from '../../scripts/operator-controls.mjs'
import { openParticipantPickers, openWorkspacePanel } from '../../scripts/workspace-panels.mjs'

/**
 * DON-353: the tracking soak audits every trusted click and requires the test
 * id each helper names to be the first data-testid on the click's path. Drive
 * the shared helpers with an auditing click, an ordinary (not forced) click
 * like the soak's, so a helper that names the wrong control, or needs a forced
 * click to reach it, fails here before the packaged lane.
 */
function auditedClick(page: Page, misses: string[]) {
  return async (locator: Locator, testId: string, position?: { x: number, y: number }) => {
    await page.evaluate(() => {
      const win = window as Window & { __auditedTarget?: string | null }
      win.__auditedTarget = null
      document.addEventListener('click', (event) => {
        const element = event.composedPath().find((node) => node instanceof HTMLElement && node.dataset.testid !== undefined)
        win.__auditedTarget = element instanceof HTMLElement ? element.dataset.testid ?? null : null
      }, { capture: true, once: true })
    })
    await locator.click(position === undefined ? {} : { position })
    const seen = await page.evaluate(() => (window as Window & { __auditedTarget?: string | null }).__auditedTarget)
    if (seen !== testId) misses.push(`expected ${testId}, the click landed on ${seen}`)
  }
}

test.describe('shared operator controls under the soak click audit [DON-353]', () => {
  test('panels, pickers, sections, Devices and Pause name the control they press', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
    await page.evaluate(async () => {
      const seen = new Date(Date.now() - 60_000).toISOString()
      await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
        groups: [{ group_id: '101', name: 'Hill Team', parent_group_id: null }],
        devices: [
          { device_id: '1', name: 'Alpha Team', status: 'online', last_seen: seen, unique_id: 'a1', category: null, group_id: '101' },
          { device_id: '3', name: 'Charlie Team', status: 'online', last_seen: seen, unique_id: 'c3', category: null, group_id: null },
        ],
      })
    })
    const misses: string[] = []
    const click = auditedClick(page, misses)

    await openWorkspacePanel(page, 'mission', { click })
    await page.getByTestId('mission-name-input').fill('Audited Harness')
    expect(await selectParticipants(page, { click, kind: 'device', which: 'first' })).toBe(1)
    await expect(await openParticipantPickers(page, { require: 'device', click })).toBeVisible()
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')

    // People is enabled once a mission runs.
    await openWorkspacePanel(page, 'people', { click })
    await openMissionSection(page, 'participants', { click, timeoutMs: 15_000 })
    await expect(page.getByTestId('participant-management')).toBeVisible()

    await setMissionPaused(page, true, { click })
    await expect(page.getByTestId('ws-mission-phase')).toContainText('PAUSED')
    await setMissionPaused(page, false, { click })
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')

    await openDevicesWorkspace(page, { click })
    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await closeWorkspace(page, { click })
    await expect(page.getByTestId('devices-workspace')).toBeHidden()

    expect(misses).toEqual([])
  })
})
