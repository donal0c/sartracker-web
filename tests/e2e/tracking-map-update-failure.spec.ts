import { expect, test, type Page } from '@playwright/test'

import { openMissionPanel } from './helpers/workspace-panels'

type WorkerMessage = { readonly type: string }
type HarnessWindow = Window & {
  __SARTRACKER_BROWSER_HARNESS__?: {
    injectTrackingSnapshot: (snapshot: unknown) => Promise<void>
  }
  __SARTRACKER_MAP__?: {
    getSource: (id: string) => ({ actor: { sendAsync: (message: WorkerMessage, ...rest: unknown[]) => Promise<unknown> } }) | undefined
    querySourceFeatures: (id: string) => Array<{ properties: Record<string, unknown> }>
    jumpTo: (options: { center: [number, number]; zoom: number }) => void
  }
  /** What the patched worker boundary rejects. */
  __DON357_WORKER__?: { rejectData: boolean; rejectTiles: boolean }
  /** The id of the newest fix sent to the app. */
  __DON357_LATEST__?: string
}

/** Sends one fresh fix for one person through the harness, as a poll would. */
async function injectFix(page: Page, minute: number) {
  await page.evaluate(async (fixMinute) => {
    const timestamp = new Date(Date.now() - 60_000 + fixMinute * 1_000).toISOString()
    const id = `alpha-${fixMinute}`
    ;(window as HarnessWindow).__DON357_LATEST__ = id
    await (window as HarnessWindow).__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: timestamp, unique_id: null, category: null }],
      positions: [{
        id, device_id: 'alpha', lat: 52.1 + fixMinute * 0.0005, lon: -9.7, altitude: null, speed: null,
        battery: null, accuracy: 4, timestamp, source: 'osmand', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false,
      }],
      breadcrumbs: [],
    })
  }, minute)
}

/** The position ids the map's loaded tracking tiles hold: what it can draw. */
async function drawnPositionIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const features = (window as HarnessWindow).__SARTRACKER_MAP__?.querySourceFeatures('tracking') ?? []
    return [...new Set(features
      .filter((feature) => feature.properties.featureKind === 'device')
      .map((feature) => String(feature.properties.sourcePositionId)))]
  })
}

/**
 * DON-357: when MapLibre's worker rejects a tracking update, the map keeps the
 * old positions and only the source fires an error. The rejection is injected
 * at the worker boundary (the source's actor), so MapLibre's own dispatch,
 * events and tile reloads run as in the field. The operator must see the
 * alarm; it must stay while the data or the tiles fail; and it must clear only
 * once the newest position is actually drawn, including after a tile errored,
 * which MapLibre's normal reload skips.
 */
test('a rejected tracking map update raises the alarm until the newest position is drawn [DON-357]', async ({ page }) => {
  await page.goto('/?missionHarness=1')
  await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForSelector('canvas', { timeout: 15_000 })
  await openMissionPanel(page)
  await page.getByTestId('mission-name-input').fill('Map Update Mission')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
  await page.evaluate(() => (window as HarnessWindow).__SARTRACKER_MAP__?.jumpTo({ center: [-9.7, 52.1], zoom: 12 }))
  await injectFix(page, 0)
  await expect.poll(() => drawnPositionIds(page), { timeout: 15_000 }).toEqual(['alpha-0'])
  const alarm = page.getByTestId('ws-alarm')
  await expect(alarm).toHaveCount(0)

  // Patch the worker boundary: the actor that carries data and tile requests.
  await page.evaluate(() => {
    const source = (window as HarnessWindow).__SARTRACKER_MAP__?.getSource('tracking')
    if (source === undefined) throw new Error('No tracking source')
    const control = { rejectData: true, rejectTiles: false }
    ;(window as HarnessWindow).__DON357_WORKER__ = control
    const actor = source.actor
    const send = actor.sendAsync.bind(actor)
    actor.sendAsync = (message, ...rest) => {
      if (control.rejectData && message.type === 'LD') return Promise.reject(new Error('worker rejected the update'))
      if (control.rejectTiles && (message.type === 'LT' || message.type === 'RT')) return Promise.reject(new Error('worker could not build the tile'))
      return send(message, ...rest)
    }
  })

  // 1. The worker rejects the update: the map still holds the old position.
  await injectFix(page, 1)
  await expect(alarm).toContainText('MAP NOT UPDATING')
  await expect(alarm).toContainText('out of date')
  await expect(page.getByTestId('ws-tracking-headline')).toHaveAttribute('data-condition', 'map')
  expect(await drawnPositionIds(page)).toEqual(['alpha-0'])

  // From here, record what the map holds at the moment the alarm clears.
  const atClear = page.evaluate(() => new Promise<{ latest: string | undefined; drawn: string[] }>((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="ws-alarm"]') !== null) return
      observer.disconnect()
      const features = (window as HarnessWindow).__SARTRACKER_MAP__?.querySourceFeatures('tracking') ?? []
      resolve({
        latest: (window as HarnessWindow).__DON357_LATEST__,
        drawn: [...new Set(features
          .filter((feature) => feature.properties.featureKind === 'device')
          .map((feature) => String(feature.properties.sourcePositionId)))],
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }))

  // 2. The worker accepts the full resend, but every tile fails to rebuild:
  //    nothing new is drawn, so the alarm stays.
  await page.evaluate(() => {
    const control = (window as HarnessWindow).__DON357_WORKER__!
    control.rejectData = false
    control.rejectTiles = true
  })
  await injectFix(page, 2)
  await page.waitForTimeout(1_000)
  await expect(alarm).toContainText('MAP NOT UPDATING')
  expect(await drawnPositionIds(page)).not.toContain('alpha-2')

  // 3. The worker recovers. The next poll is resent in full and every tile,
  //    errored ones included, is rebuilt; the alarm clears only once the
  //    newest position is in what the map draws.
  await page.evaluate(() => { (window as HarnessWindow).__DON357_WORKER__!.rejectTiles = false })
  await injectFix(page, 3)
  await expect(alarm).toHaveCount(0)
  const cleared = await atClear
  expect(cleared.latest).toBe('alpha-3')
  expect(cleared.drawn).toEqual(['alpha-3'])
})
