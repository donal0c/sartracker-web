/**
 * Layout trial (?layout=a|b|c): the team's core tasks must work on every version,
 * and a stopped map must be loud. Set LAYOUT_SHOTS=<dir> to also save screenshots
 * for review. Synthetic names only; never put real team members here.
 *
 *   LAYOUT_SHOTS=tmp/layout-trial/shots npx playwright test tests/e2e/layout-trial --project=chromium --workers=1
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

const SHOTS = process.env.LAYOUT_SHOTS
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true })

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 })
test.setTimeout(120_000)

const NAMES = [
  'Aoife Brennan', 'Brian Casey', 'Ciara Doyle', 'Declan Egan', 'Eimear Flynn', 'Fergal Gorman', 'Grainne Hayes',
  'Hugh Kelly', 'Imelda Lynch', 'Jack Moran', 'Kate Nolan', 'Liam Power', 'Maeve Quinn', 'Niall Ryan',
] as const

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

async function open(page: Page, layout: string): Promise<void> {
  await page.goto(`/?missionHarness=1&missionModel=1&coverage=1&layout=${layout}`)
  await page.getByTestId('app-title').waitFor({ state: 'attached', timeout: 20_000 })
  await page.waitForSelector('canvas', { timeout: 20_000 })
  await page.waitForTimeout(2_000)
  await page.evaluate(async (names) => {
    const seen = new Date(Date.now() - 60_000).toISOString()
    await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
      groups: [
        { group_id: '101', name: 'Rescue Team', parent_group_id: null },
        { group_id: '102', name: 'Visiting Team', parent_group_id: null },
      ],
      devices: names.map((name, index) => ({
        device_id: String(index + 1), name, status: 'online' as const, last_seen: seen,
        unique_id: `d${index}`, category: null, group_id: index < 12 ? '101' : '102',
      })),
    })
  }, NAMES)
}

/** Feeds a snapshot: the first device has not moved, the third has gone quiet. */
async function feed(page: Page, options: { readonly lost?: boolean } = {}): Promise<void> {
  await page.evaluate(async ({ names, lost }) => {
    const now = Date.now()
    const iso = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
    const fix = (id: string, device: string, lat: number, lon: number, minutes: number, speed: number) => ({
      id, device_id: device, lat, lon, altitude: 300, speed, battery: 70, accuracy: 6, timestamp: iso(minutes),
      source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false,
    })
    const walkers = names.map((_, index) => index).filter((index) => index !== 0)
    const breadcrumbs = walkers.flatMap((index) => [40, 30, 20, 10, 1].map((minutes, step) =>
      fix(`bc-${index}-${step}`, String(index + 1), 51.96 + index * 0.0035 + step * 0.0045, -9.78 + index * 0.0065 - step * 0.002, index === 2 ? minutes + 16 : minutes, 1.2)))
    const still = [50, 40, 30, 20, 10, 1].map((minutes, step) => fix(`still-${step}`, '1', 51.9985 + step * 0.000002, -9.7426, minutes, 0))
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: names.map((name, index) => ({
        device_id: String(index + 1), name, status: index === 2 ? 'offline' as const : 'online' as const,
        last_seen: iso(index === 2 ? 17 : 1), unique_id: `d${index}`, category: 'person', group_id: index < 12 ? '101' : '102',
      })),
      positions: names.map((_, index) => index === 0
        ? fix('pos-0', '1', 51.9985 + 5 * 0.000002, -9.7426, 1, 0)
        : fix(`pos-${index}`, String(index + 1), 51.96 + index * 0.0035 + 4 * 0.0045, -9.78 + index * 0.0065 - 4 * 0.002, index === 2 ? 17 : 1, 1.2)),
      breadcrumbs: [...still, ...breadcrumbs],
    }, lost === true
      ? { mode: 'offline', consecutiveFailures: 4, recovered: false, lastSuccessAt: iso(7), warning: 'Traccar server is not answering. Showing last known positions.' }
      : { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: iso(0), warning: null })
  }, { names: NAMES, lost: options.lost })
  await page.waitForTimeout(900)
}

/** Chooses the team's default group in Settings, the way a coordinator does once. */
async function setDefaultGroup(page: Page): Promise<void> {
  await page.getByTestId('open-settings-workspace').click()
  await page.getByTestId('settings-default-participant-group').selectOption({ label: 'Rescue Team' })
  await page.getByTestId('settings-save').click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}

async function startMission(page: Page, options: { readonly defaultGroupSet?: boolean } = {}): Promise<void> {
  await page.getByTestId('mission-name-input').fill('Coomloughra Search')
  await page.getByTestId('mission-offset-input').fill('2')
  if (options.defaultGroupSet === true) await page.getByTestId('trial-change-participants').locator('summary').first().click()
  else await page.getByTestId('participant-group-picker').getByLabel(/Rescue Team/).check()
  await page.getByTestId('participant-group-picker').getByLabel(/Visiting Team/).check()
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('trial-mission-phase')).toContainText('Running')
  await feed(page)
  await page.evaluate(async () => {
    const { getBrowserHarnessStore } = await import('/src/features/browser-validation/browser-harness-store.ts')
    const { useCoverageStore } = await import('/src/features/tracking/coverage-store.ts')
    const { useParticipantStore } = await import('/src/features/participants/participant-store.ts')
    const store = getBrowserHarnessStore()
    const missionId = window.__SARTRACKER_BROWSER_HARNESS__?.readState().currentMissionId ?? null
    if (missionId === null) throw new Error('No current mission.')
    const checkpoints = await store.listParticipantBackfillCheckpoints(missionId)
    await Promise.all(checkpoints.map((checkpoint) => store.upsertParticipantBackfillCheckpoint({
      mission_id: checkpoint.mission_id, traccar_device_id: checkpoint.traccar_device_id,
      window_from: checkpoint.window_from, window_to: checkpoint.window_to,
      reconciled_until: checkpoint.window_to, completed: true,
    })))
    await useParticipantStore.getState().controller?.refreshBackfillCheckpoints(missionId)
    await useCoverageStore.getState().controller?.refresh()
  })
  await feed(page)
}

async function showPeople(page: Page): Promise<void> {
  if (await page.getByTestId('trial-people-panel').count() === 0) await page.getByTestId('trial-toggle-people').click()
  await expect(page.getByTestId('trial-people-panel')).toBeVisible()
}

for (const version of ['a', 'b', 'c'] as const) {
  test.describe(`Version ${version.toUpperCase()}`, () => {
    test('start a mission from one simple card', async ({ page }) => {
      await open(page, version)
      await expect(page.getByTestId('mission-start-btn')).toBeVisible()
      await expect(page.getByText('Roll back time (hours)')).toBeVisible()
      await expect(page.getByTestId('mission-finish-btn')).toBeHidden()
      // Troubleshooting does not need a mission first.
      await page.getByTestId('trial-tracking-headline').click()
      await expect(page.getByTestId('trial-tracking-panel')).toBeVisible()
      await page.getByTestId('trial-panel-close').click()
      await setDefaultGroup(page)
      await expect(page.getByTestId('trial-default-group-summary')).toContainText('Rescue Team')
      await shot(page, `${version}-1-start`)
      await startMission(page, { defaultGroupSet: true })
      await expect(page.getByTestId('mission-pause-resume-btn')).toBeHidden()
      await shot(page, `${version}-2-running`)
    })

    test('find a person, spot who has not moved, switch one off', async ({ page }) => {
      await open(page, version)
      await startMission(page)
      await showPeople(page)
      await expect(page.getByTestId('trial-people-count')).toHaveText(String(NAMES.length))
      // Problems come first, in words.
      await expect(page.getByTestId('trial-people-list').locator('li').first()).toContainText(/Not moving|Offline/)
      await expect(page.getByTestId('trial-person-status-3')).toContainText(/Offline|Out of date/)
      await shot(page, `${version}-3-people`)
      await page.getByTestId('trial-people-search').fill('niall')
      await expect(page.getByTestId('trial-people-list').locator('li')).toHaveCount(1)
      await page.getByTestId('trial-people-search').fill('')

      await page.getByTestId('trial-trail-5').uncheck()
      await expect(page.getByTestId('trial-trail-5')).not.toBeChecked()
      await expect(page.getByTestId('trial-position-5')).toBeChecked()
      await page.getByTestId('trial-position-6').uncheck()
      await expect(page.getByTestId('trial-position-6')).not.toBeChecked()
      // A filtered map must say so, even with People closed.
      await expect(page.getByTestId('trial-tracking-headline')).toContainText("1 person's location hidden on the map")
      await expect(page.getByTestId('trial-trail-6')).toBeChecked()
    })

    test('lost tracking cannot be missed and pause is loud', async ({ page }) => {
      await open(page, version)
      await startMission(page)
      await feed(page, { lost: true })
      await expect(page.getByTestId('trial-alarm')).toContainText('TRACKING LOST')
      await expect(page.getByTestId('trial-tracking-headline')).not.toContainText('Traccar server')
      // The named call-outs add to the alarm rather than repeating it.
      await expect(page.getByTestId('trial-exceptions-more')).toHaveCount(0)
      await shot(page, `${version}-4-lost`)
      await page.getByTestId('trial-tracking-headline').click()
      await expect(page.getByTestId('trial-tracking-advice')).toContainText('internet connection')
      await expect(page.getByTestId('trial-reconnect')).toBeVisible()
      await shot(page, `${version}-10-tracking-lost`)
      await page.getByTestId('trial-panel-close').click()
      await feed(page)
      await expect(page.getByTestId('trial-alarm')).toBeHidden()

      await page.getByTestId('trial-mission-button').click()
      await expect(page.getByTestId('mission-pause-resume-btn')).toBeVisible()
      await shot(page, `${version}-5-mission`)
      // Pause is never one click away from an accident.
      await page.getByTestId('mission-pause-resume-btn').click()
      await expect(page.getByTestId('trial-alarm')).toBeHidden()
      await page.getByTestId('trial-pause-confirm-no').click()
      await expect(page.getByTestId('trial-mission-phase')).toContainText('Running')
      await page.getByTestId('mission-pause-resume-btn').click()
      await page.getByTestId('trial-pause-confirm-yes').click()
      await expect(page.getByTestId('trial-alarm')).toContainText('MISSION PAUSED')
      await page.getByTestId('trial-tracking-headline').click()
      await expect(page.getByTestId('trial-tracking-advice')).toContainText('Resume mission')
      await expect(page.getByTestId('trial-tracking-advice')).not.toContainText('internet')
      await expect(page.getByTestId('trial-reconnect')).toHaveCount(0)
      await shot(page, `${version}-11-tracking-paused`)
      await page.getByTestId('trial-panel-close').click()
      await showPeople(page)
      // Nothing under the alarm may read as current.
      await expect(page.getByTestId('trial-person-status-5')).toContainText('Last known position')
      await shot(page, `${version}-6-paused`)
      await page.getByTestId('trial-alarm-resume').click()
      await expect(page.getByTestId('trial-alarm')).toBeHidden()
      await expect(page.getByTestId('trial-mission-phase')).toContainText('Running')
    })

    test('map can fill the screen, and layers still open large', async ({ page }) => {
      await open(page, version)
      await startMission(page)
      if (version !== 'c') {
        await page.getByTestId('trial-full-map').click()
        await expect(page.getByTestId('trial-people-panel')).toHaveCount(0)
      }
      await expect(page.getByTestId('trial-tracking-headline')).toBeVisible()
      // People closed: the problems are still named on the map, most urgent first.
      await expect(page.getByTestId('trial-exceptions').locator('button').first()).toContainText('Aoife Brennan')
      await expect(page.getByTestId('trial-exception-3')).toContainText('Ciara Doyle')
      await expect.poll(async () => ((await page.locator('canvas').first().boundingBox())?.width ?? 0) / 1440, { timeout: 5_000 }).toBeGreaterThan(0.95)
      await shot(page, `${version}-7-full-map`)

      await page.getByTestId('trial-toggle-layers').click()
      await expect(page.getByTestId('trial-layers-panel')).toBeVisible()
      // One panel at a time.
      await expect(page.getByTestId('trial-people-panel')).toHaveCount(0)
      await expect(page.getByTestId('layer-show-hidden-toggle')).toHaveCount(0)
      await expect(page.getByTestId('layer-row-group-tracking')).toHaveCount(0)
      await shot(page, `${version}-8-layers`)
    })

    test('tools stay reachable and the small screen still works', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 })
      await open(page, version)
      await startMission(page)
      await showPeople(page)
      await shot(page, `${version}-9-small-screen`)
      await page.getByTestId('trial-more-button').click()
      await expect(page.getByTestId('open-diagnostics-workspace')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByTestId('drawing-toolbar').waitFor()
      await page.getByTestId('coordinate-display').waitFor()
    })
  })
}

test('a normal launch shows today\'s screen and no switcher', async ({ page }) => {
  await page.goto('/?missionHarness=1')
  await page.getByTestId('app-title').waitFor({ timeout: 20_000 })
  await expect(page.getByTestId('command-mast')).toBeVisible()
  await expect(page.getByTestId('layout-trial-switcher')).toHaveCount(0)
  await expect(page.getByTestId('layout-trial-root')).toHaveCount(0)
})

test('baseline: today\'s screen for comparison', async ({ page }) => {
  test.skip(SHOTS === undefined, 'only needed for review screenshots')
  await page.goto('/?missionHarness=1&missionModel=1&coverage=1')
  await page.getByTestId('app-title').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(2_000)
  await page.evaluate(async (names) => {
    const seen = new Date(Date.now() - 60_000).toISOString()
    await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
      groups: [{ group_id: '101', name: 'Rescue Team', parent_group_id: null }, { group_id: '102', name: 'Visiting Team', parent_group_id: null }],
      devices: names.map((name, index) => ({ device_id: String(index + 1), name, status: 'online' as const, last_seen: seen, unique_id: `d${index}`, category: null, group_id: index < 12 ? '101' : '102' })),
    })
  }, NAMES)
  await shot(page, 'today-1-start')
  await page.getByTestId('mission-name-input').fill('Coomloughra Search')
  await page.getByTestId('participant-group-picker').getByLabel(/Rescue Team/).check()
  await page.getByTestId('participant-group-picker').getByLabel(/Visiting Team/).check()
  await page.getByTestId('mission-start-btn').click()
  await feed(page)
  await shot(page, 'today-2-running')
  await page.getByTestId('sidebar-tab-layers').click()
  await shot(page, 'today-8-layers')
  await feed(page, { lost: true })
  await shot(page, 'today-4-lost')
})
