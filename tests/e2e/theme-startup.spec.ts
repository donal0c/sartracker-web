import { expect, test } from '@playwright/test'

for (const phase of ['booting', 'failed'] as const) {
  test(`saved high contrast applies before the ${phase} shell mounts`, async ({ page }) => {
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
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast')
  })
}
