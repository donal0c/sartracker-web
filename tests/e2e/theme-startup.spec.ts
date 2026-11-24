import { expect, test } from '@playwright/test'

for (const phase of ['booting', 'failed'] as const) {
  test(`a saved light theme (old High contrast key) applies before the ${phase} shell mounts`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('sartracker:high-contrast', 'true'))
    await page.route('**/src/features/runtime/bootstrap-app-runtime.ts', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `import { useRuntimeBootStore } from '/src/features/runtime/runtime-boot-store.ts';
        export async function bootstrapAppRuntime() {
          useRuntimeBootStore.setState({ phase: '${phase}', error: ${phase === 'failed' ? "'Injected startup fault'" : 'null'} });
        }`,
    }))
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId(`runtime-${phase}-shell`)).toBeVisible()
    await expect(page.getByTestId('theme-toggle')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })
}

test('the light theme is on <html> before any app script runs', async ({ page }) => {
  // The index.html <head> script sets it before the first paint (DON-344); hold
  // the app bundle back to prove the theme does not wait for it.
  await page.addInitScript(() => localStorage.setItem('sartracker:high-contrast', 'true'))
  await page.route('**/src/main.tsx', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.goto('/?missionHarness=1')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('app-shell')).toHaveCount(0)
})

test('a fresh profile with nothing saved opens light before any app script runs', async ({ page }) => {
  // Light is the default (DON-344, team rule 13: higher contrast by default).
  await page.route('**/src/main.tsx', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.goto('/?missionHarness=1')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-read-failed', 'true')
})

test('a saved dark choice stays dark from the first paint', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sartracker:high-contrast', 'false'))
  await page.route('**/src/main.tsx', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.goto('/?missionHarness=1')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'standard')
})
