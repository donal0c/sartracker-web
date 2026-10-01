import { expect, type Page } from '@playwright/test'

type MissionSectionName = 'participants' | 'outings'

/**
 * Opens the folded Participants and/or Outings sections of Mission Control,
 * as an operator presses Show during a mission [DON-300]. A section that a
 * warning already holds open, or that is not folded, is left alone.
 */
export async function openMissionSections(
  page: Page,
  names: readonly MissionSectionName[] = ['participants', 'outings'],
): Promise<void> {
  for (const name of names) {
    const section = page.getByTestId(`mission-${name}-section`)
    // Right after Start the section may not be mounted yet. Outside an active
    // or paused mission it is never folded, so absence means already open.
    await section.waitFor({ state: 'attached', timeout: 5_000 }).catch(() => undefined)
    if (await section.count() === 0) continue
    if (await section.getAttribute('data-open') === 'false') {
      await page.getByTestId(`mission-${name}-section-toggle`).click()
    }
    await expect(section).toHaveAttribute('data-open', 'true')
  }
}
