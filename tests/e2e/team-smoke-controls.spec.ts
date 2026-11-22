import { expect, test } from '@playwright/test'

import { midMissionControls } from '../../scripts/team-smoke/checks/tracking.mjs'
import { openWorkspacePanel } from './helpers/workspace-panels'

/**
 * DON-315: the team-smoke `controls` check presses each mid-mission control,
 * leaves it set while walkers record, then undoes it. On the box (2 Oct 2026)
 * Focus Mode's undo timed out, so the later controls were never tested. Run
 * the tool's own press/undo sequence against the browser harness so a
 * selector that only works on the packaged shell fails here first. The
 * packaged app uses the new layout (DON-353), so this does too.
 */
test.describe('team-smoke mid-mission controls [DON-315]', () => {
  test('every control presses and undoes during an active mission', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?missionHarness=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId('mission-name-input').fill('Controls Harness')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')

    for (const control of midMissionControls(page)) {
      await test.step(`press: ${control.label}`, () => control.press())
      await test.step(`undo: ${control.label}`, () => control.undo())
    }
    // Every control is back as it was: positions and trails shown, side panel open.
    await expect(page.getByTestId('ws-full-map')).toHaveText('Full map')
    await openWorkspacePanel(page, 'people')
    await expect(page.getByTestId('ws-all-positions')).toBeChecked()
    await expect(page.getByTestId('ws-all-trails')).toBeChecked()
  })
})
