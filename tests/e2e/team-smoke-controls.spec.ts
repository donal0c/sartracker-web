import { expect, test } from '@playwright/test'

import { midMissionControls } from '../../scripts/team-smoke/checks/tracking.mjs'

/**
 * DON-315: the team-smoke `controls` check presses each mid-mission control,
 * leaves it set while walkers record, then undoes it. On the box (2 Oct 2026)
 * Focus Mode's undo timed out, so the later controls were never tested. Run
 * the tool's own press/undo sequence against the browser harness so a
 * selector that only works on the packaged shell fails here first.
 */
test.describe('team-smoke mid-mission controls [DON-315]', () => {
  test('every control presses and undoes during an active mission', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?missionHarness=1')
    await page.evaluate(() => window.localStorage.removeItem('sartracker:focus-mode-active'))
    await page.reload()
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId('mission-name-input').fill('Controls Harness')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    for (const control of midMissionControls(page)) {
      await test.step(`press: ${control.label}`, () => control.press())
      await test.step(`undo: ${control.label}`, () => control.undo())
    }
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-focus-mode', 'false')
  })
})
