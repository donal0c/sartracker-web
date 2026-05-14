import { expect, test } from '@playwright/test'

test.describe('browser-harness Tauri IPC isolation', () => {
  test('starts the harness, places a marker, and never invokes Tauri IPC', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    // Block any Tauri IPC channel (`ipc://` or `tauri://`) before the page loads.
    // In a real browser context these are never present anyway, but blocking them
    // explicitly turns any future regression into a hard test failure rather than
    // a silent network rejection.
    const tauriRequests: string[] = []
    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith('ipc://') || url.startsWith('tauri://')) {
        tauriRequests.push(url)
        return route.abort()
      }
      return route.continue()
    })

    await page.goto('/?missionHarness=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForSelector('canvas', { timeout: 15000 })

    // Sanity check: the renderer is in browser-harness mode, not Tauri.
    const isTauri = await page.evaluate(
      () => '__TAURI_INTERNALS__' in (window as Record<string, unknown>),
    )
    expect(isTauri).toBe(false)

    await page.getByTestId('mission-name-input').fill('Harness IPC isolation')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    // Place a marker — exercises the marker runtime end-to-end. Before T05 the
    // harness path silently routed the attachment ingest call through a
    // Tauri-aware helper instead of a noop adapter.
    const canvas = page.locator('canvas').first()
    await canvas.click({ position: { x: 200, y: 200 }, force: true })
    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()
    await page.getByTestId('marker-name-input').fill('Harness leak probe')
    await page.getByTestId('marker-save-btn').click()
    await expect(dialog).toBeHidden()

    expect(tauriRequests).toEqual([])
    expect(
      consoleErrors.filter(
        (text) =>
          text.toLowerCase().includes('tauri') ||
          text.toLowerCase().includes('ipc') ||
          text.toLowerCase().includes('invoke'),
      ),
    ).toEqual([])
  })
})
