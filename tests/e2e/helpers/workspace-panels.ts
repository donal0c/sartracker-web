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

  if (NEEDS_RUNNING_MISSION.has(panel) && await page.getByTestId(`ws-toggle-${panel}`).isDisabled()) {
    throw new Error(`The ${panel} panel needs a running mission; start or resume one first.`)
  }

  // The buttons toggle, and a panel can open on its own (a warning, a phase
  // change) just as the click lands. Re-check after each click until it is open.
  const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(async () => {
    // A phase change closes the open panel one frame later; let it land first.
    await settle()
    if (await target.isVisible()) return
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
    await expect(target).toBeVisible({ timeout: 1_500 })
    await settle()
    await expect(target).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
}

/**
 * Presses Pause or Resume in Mission. Pausing asks to confirm (the team asked
 * for Pause not to be easy to hit by accident), so this confirms it.
 */
export async function pressPauseResume(page: Page): Promise<void> {
  await openMissionPanel(page)
  const button = page.getByTestId('mission-pause-resume-btn')
  const pausing = (await button.textContent())?.trim() === 'Pause'
  await button.click()
  if (pausing) await page.getByTestId('ws-pause-confirm-yes').click()
  // A phase change closes the open panel; wait for it so a following
  // openMissionPanel is not undone by that close.
  await expect(page.getByTestId('ws-mission-phase')).toContainText(pausing ? 'PAUSED' : 'Running')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** Opens Review and replay from the top bar's More menu (the old Mission Control Review button). */
export async function openMissionReview(page: Page): Promise<void> {
  await page.getByTestId('ws-more-button').click()
  await page.getByTestId('ws-open-review').click()
}

/**
 * Unfolds the start card's "Change who's taking part" and "Add one person at a
 * time" sections, so the group and device pickers can be used. Safe to repeat.
 */
export async function openParticipantPickers(page: Page): Promise<void> {
  await openMissionPanel(page)
  for (const id of ['ws-change-participants', 'ws-pick-devices']) {
    const fold = page.getByTestId(id)
    if (await fold.count() === 0) continue
    if (await fold.evaluate((element) => !(element as HTMLDetailsElement).open)) {
      await fold.locator('summary').first().click()
    }
  }
}

/**
 * Closes the Mission panel if it is open, as the old Minimise did; the mission
 * stays named in the top bar.
 */
export async function closeMissionPanel(page: Page): Promise<void> {
  const close = page.getByTestId('ws-mission-close')
  if (await close.isVisible()) await close.click()
  await expect(page.getByTestId('mission-control')).toBeHidden()
}
