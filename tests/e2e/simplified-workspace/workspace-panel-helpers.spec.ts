/**
 * The shared panel helpers the migrated specs use to reach Mission, People,
 * Layers, Tracking and the GPX/helicopter tools in the new layout (DON-353).
 * Each helper must open its panel from any other panel and be safe to repeat.
 */
import { expect, test, type Page } from '@playwright/test'

import { openMissionPanel, openWorkspacePanel, WORKSPACE_PANEL_TEST_IDS } from '../helpers/workspace-panels'

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 })
test.setTimeout(90_000)

async function openApp(page: Page): Promise<void> {
  await page.goto('/?missionHarness=1')
  await page.getByTestId('app-title').waitFor({ state: 'attached', timeout: 20_000 })
  await expect(page.getByTestId('simplified-workspace')).toBeVisible()
}

async function startMission(page: Page): Promise<void> {
  await openMissionPanel(page)
  await page.getByTestId('mission-name-input').fill('Helper Check')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
}

test.describe('Workspace panel helpers', () => {
  test('before a mission, Mission and Tracking open, and People says it needs a running mission', async ({ page }) => {
    await openApp(page)

    await openMissionPanel(page)
    await openMissionPanel(page)
    await expect(page.getByTestId(WORKSPACE_PANEL_TEST_IDS.mission)).toBeVisible()

    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId(WORKSPACE_PANEL_TEST_IDS.tracking)).toBeVisible()

    await expect(openWorkspacePanel(page, 'people')).rejects.toThrow(/running mission/)
  })

  test('during a mission, every panel opens from any other and repeating is harmless', async ({ page }) => {
    await openApp(page)
    await startMission(page)

    for (const panel of ['people', 'layers', 'tools', 'tracking', 'mission', 'people', 'people', 'mission', 'mission'] as const) {
      await openWorkspacePanel(page, panel)
      await expect(page.getByTestId(WORKSPACE_PANEL_TEST_IDS[panel])).toBeVisible()
    }
  })
})
