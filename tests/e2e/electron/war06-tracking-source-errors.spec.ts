import { _electron as electron, expect, test } from '@playwright/test'
import { readTrackingSourceInPage } from '../../../scripts/war06-surface-observation.mjs'

type ProbeWindow = Window & {
  __SARTRACKER_MAP__?: { getSource: (id: string) => { fire: (event: unknown) => void } | undefined }
  __SARTRACKER_TRACKING_SOURCE_ERRORS__?: unknown
}

/**
 * DON-353: Playwright cannot get an init script into a packaged app's first
 * window before it loads, so the WAR-06 probe relies on the renderer reporting
 * the tracking source's errors itself from the moment the map is created. This
 * opens the real renderer in a first Electron window, isolated and sandboxed
 * like the product's, with no init script, and checks that every map the probe
 * sees carries that report, that a reading becomes ready, and that a real
 * tracking-source error fails it. The packaged smoke checks the same on the
 * packaged app in CI.
 */
test('the first Electron window reports tracking-source errors from map creation, with no init script [DON-353]', async ({ baseURL }) => {
  test.setTimeout(120_000)
  if (baseURL === undefined) throw new Error('This test needs the dev server baseURL for the renderer.')
  const app = await electron.launch({
    args: ['tests/fixtures/war06-renderer-window.cjs'],
    env: { ...process.env, WAR06_RENDERER_URL: new URL('/?missionHarness=1&missionModel=1', baseURL).toString() },
  })
  try {
    const page = await app.firstWindow()
    // Sample from the first window on: a map without the report would read
    // as uncaptured, which the packaged probe counts as blind.
    const states = new Set<string>()
    let last: unknown = null
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      last = await page.evaluate(readTrackingSourceInPage).catch((error: unknown) => ({ state: 'navigating', reason: String(error) }))
      const state = (last as { state: string }).state
      states.add(state)
      if (state === 'ready') break
      await page.waitForTimeout(50).catch(() => undefined)
    }
    expect((last as { state?: string } | null)?.state, `last reading: ${JSON.stringify(last)}; page: ${(await page.locator('body').innerText().catch(() => '')).slice(0, 300)}`).toBe('ready')
    expect([...states]).not.toContain('uncaptured')
    expect(await page.evaluate(() => (window as ProbeWindow).__SARTRACKER_TRACKING_SOURCE_ERRORS__)).toEqual([])

    // As MapLibre does when its worker rejects an update.
    await page.evaluate(() => (window as ProbeWindow).__SARTRACKER_MAP__?.getSource('tracking')
      ?.fire({ type: 'error', error: new Error('worker rejected the update') }))
    expect(await page.evaluate(readTrackingSourceInPage)).toMatchObject({
      state: 'failed',
      reason: expect.stringContaining('worker rejected the update'),
    })
  } finally {
    await app.close()
  }
})
