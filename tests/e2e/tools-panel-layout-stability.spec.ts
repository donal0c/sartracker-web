import { expect, test } from '@playwright/test'
import { openMissionPanel, openWorkspacePanel } from './helpers/workspace-panels'

/*
 * DON-355: the GPX import section loaded lazily about 300 ms after Tools
 * opened and pushed everything below it (the helicopter controls) down about
 * 476 px, moving buttons under the pointer. A control that has appeared must
 * not move while the rest of the panel loads.
 */

test.beforeEach(async ({ page }) => {
  // Hold the GPX section's code back 1.5 s. Loaded on demand this opened a wide
  // window in which the helicopter controls showed and then jumped; loaded with
  // the app, the delay only delays the app.
  await page.route('**/src/components/gpx-import-panel.tsx*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    await route.continue()
  })
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toBeVisible()
  await openMissionPanel(page)
  await page.getByTestId('mission-name-input').fill('Tools layout mission')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
})

test('opening Tools does not move its controls after they appear [DON-355]', async ({ page }) => {
  // Sample every frame where the first helicopter control sits from the moment it appears.
  await page.evaluate(() => {
    const samples: number[] = []
    Object.assign(window, { __toolsLayoutSamples: samples })
    const sample = () => {
      const control = document.querySelector('[data-testid="helicopter-add-slot"]')
      if (control !== null) samples.push(control.getBoundingClientRect().top)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })

  await openWorkspacePanel(page, 'tools')
  await expect(page.getByTestId('gpx-import-panel')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('helicopter-add-slot')).toBeVisible()
  // Let layout settle for a few frames after the section arrives.
  await page.waitForTimeout(300)

  const samples = await page.evaluate(() => (window as Window & { __toolsLayoutSamples: number[] }).__toolsLayoutSamples)
  expect(samples.length).toBeGreaterThan(0)
  const movement = Math.max(...samples) - Math.min(...samples)
  // The GPX section's code was held back 1.5 s, yet it is in place with the first frame.
  expect(await page.getByTestId('ws-tools-panel').innerText()).not.toMatch(/Loading GPX/u)
  expect(movement, `helicopter control moved ${movement.toFixed(1)} px while Tools loaded`).toBeLessThanOrEqual(0.5)
})
