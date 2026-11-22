import { expect, type Page } from '@playwright/test'

/** The side panels an operator can open in the new layout (DON-341). */
export type WorkspacePanel = 'mission' | 'people' | 'layers' | 'tracking' | 'tools'

/** The element that is visible while each panel is open. */
export const WORKSPACE_PANEL_TEST_IDS: Readonly<Record<WorkspacePanel, string>> = {
  mission: 'ws-mission-host',
  people: 'ws-people-panel',
  layers: 'ws-layers-panel',
  tracking: 'ws-tracking-panel',
  tools: 'ws-tools-panel',
}

/**
 * People is the running mission's roster: its button is greyed out before Start,
 * in recovery and after Finish. Layers, the tools and Tracking open in every phase.
 */
const NEEDS_RUNNING_MISSION: ReadonlySet<WorkspacePanel> = new Set(['people'])

/**
 * Opens Mission Control the way an operator does: the Mission button in the top
 * bar. Before a mission this is the start card; during one it is the side panel.
 * Does nothing if Mission is already open, so it is safe to call repeatedly.
 */
export async function openMissionPanel(page: Page): Promise<void> {
  await openWorkspacePanel(page, 'mission')
}

/**
 * Opens one side panel through the top bar and waits until it is visible.
 * Does nothing if that panel is already open. Fails with a clear message if the
 * panel needs a running mission and none is running.
 */
export async function openWorkspacePanel(page: Page, panel: WorkspacePanel): Promise<void> {
  const target = page.getByTestId(WORKSPACE_PANEL_TEST_IDS[panel])
  if (await target.isVisible()) return

  if (NEEDS_RUNNING_MISSION.has(panel) && await page.getByTestId(`ws-toggle-${panel}`).isDisabled()) {
    throw new Error(`The ${panel} panel needs a running mission; start or resume one first.`)
  }

  switch (panel) {
    case 'mission':
      await page.getByTestId('ws-mission-button').click()
      break
    case 'people':
      await page.getByTestId('ws-toggle-people').click()
      break
    case 'layers':
      await page.getByTestId('ws-toggle-layers').click()
      break
    case 'tracking':
      await page.getByTestId('ws-tracking-headline').click()
      break
    case 'tools':
      await openWorkspacePanel(page, 'layers')
      await page.getByTestId('ws-open-tools').click()
      break
  }
  await expect(target).toBeVisible()
}
