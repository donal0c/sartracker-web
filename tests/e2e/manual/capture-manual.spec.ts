/**
 * Regenerates every screenshot used by the operator manual (public/manual/index.html).
 *
 * Run it with ONE command (the dev server starts by itself):
 *
 *   MANUAL_CAPTURE=1 npx playwright test tests/e2e/manual/capture-manual.spec.ts --project=chromium --workers=1
 *
 * Images are written to public/manual/assets/ at a 1440x900 window and cropped to the
 * surface being described. Only synthetic data is used: made-up team names, made-up
 * archive credentials and the Reeks/Carrauntoohil area of Kerry as a backdrop. Look at
 * every image after a run (`git diff --stat public/manual/assets`) before committing.
 *
 * Without MANUAL_CAPTURE=1 the whole file is skipped, so normal CI runs never rewrite
 * the manual's images.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

const OUT_DIR = join(process.cwd(), 'public', 'manual', 'assets')

test.skip(process.env.MANUAL_CAPTURE !== '1', 'set MANUAL_CAPTURE=1 to regenerate manual screenshots')
test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 })
test.setTimeout(180_000)

mkdirSync(OUT_DIR, { recursive: true })

/**
 * Map-dominated shots are saved as JPEG: about a fifth of the PNG size with no
 * visible change to map imagery. Interface close-ups stay PNG for crisp text.
 */
const JPEG_SHOTS = new Set([
  'app-shell',
  'focus-mode',
  'map-with-markup',
  'measurement',
  'mission-paused',
  'review-docked',
  'review-replay',
  'review-search-passes',
  'stationary-attention-map',
  'tracking-offline',
])
const JPEG_QUALITY = 85

/** Saves a screenshot of the page, an element, or a clip rectangle into the manual assets. */
async function shot(
  page: Page,
  name: string,
  target?: Locator | { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): Promise<void> {
  await page.waitForTimeout(600)
  const jpeg = JPEG_SHOTS.has(name)
  const path = join(OUT_DIR, `${name}.${jpeg ? 'jpg' : 'png'}`)
  const format = jpeg ? { type: 'jpeg' as const, quality: JPEG_QUALITY } : { type: 'png' as const }
  if (target === undefined) {
    await page.screenshot({ path, ...format })
  } else if ('screenshot' in target) {
    await target.screenshot({ path, ...format })
  } else {
    await page.screenshot({ path, clip: target, ...format })
  }
}

/** The visible panel of a modal dialog (without the blurred full-screen backdrop). */
async function dialogPanel(page: Page, testId: string): Promise<Locator> {
  const root = page.getByTestId(testId)
  const inner = root.locator('[role="dialog"]')
  return (await inner.count()) > 0 ? inner.first() : root
}

/** Opens the browser harness with the mission model on and waits for the map to draw. */
async function openHarness(page: Page): Promise<void> {
  // coverage=1 turns on the Mission History coverage view, which packaged builds have by default.
  await page.goto('/?missionHarness=1&missionModel=1&coverage=1')
  await page.getByTestId('app-title').waitFor({ timeout: 20_000 })
  await page.waitForSelector('canvas', { timeout: 20_000 })
  await page.waitForTimeout(2_500)
}

/** Seeds a synthetic Traccar roster: two groups and three devices. */
async function seedRoster(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const seen = new Date(Date.now() - 60_000).toISOString()
    await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
      groups: [
        { group_id: '101', name: 'Hill Team', parent_group_id: null },
        { group_id: '102', name: 'Valley Team', parent_group_id: null },
      ],
      devices: [
        { device_id: '1', name: 'Alpha Team', status: 'online', last_seen: seen, unique_id: 'a1', category: null, group_id: '101' },
        { device_id: '2', name: 'Bravo Team', status: 'online', last_seen: seen, unique_id: 'b2', category: null, group_id: '101' },
        { device_id: '3', name: 'Charlie Team', status: 'online', last_seen: seen, unique_id: 'c3', category: null, group_id: '102' },
      ],
    })
  })
}

/** Publishes a live tracking snapshot with current timestamps: three teams with trails. */
async function injectTracking(
  page: Page,
  options: { readonly charlieOffline?: boolean; readonly connectionLost?: boolean } = {},
): Promise<void> {
  await page.evaluate(async ({ charlieOffline, connectionLost }) => {
    const now = Date.now()
    const iso = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString()
    const device = (id: string, name: string, status: 'online' | 'offline', seen: string) => ({
      device_id: id, name, status, last_seen: seen, unique_id: name.toLowerCase(), category: 'person',
      group_id: id === '3' ? '102' : '101',
    })
    const fix = (id: string, deviceId: string, lat: number, lon: number, minutesAgo: number, speed: number) => ({
      id, device_id: deviceId, lat, lon, altitude: 300, speed, battery: 80, accuracy: 8,
      timestamp: iso(minutesAgo), source: 'osmand', data_origin: 'live' as const,
      cache_age_seconds: null, device_cache_stale: false,
    })
    const trail = (deviceId: string, points: readonly (readonly [number, number, number])[]) =>
      points.map((point, index) => fix(`bc-${deviceId}-${index}`, deviceId, point[0], point[1], point[2], 1.2))
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(
      {
        devices: [
          device('1', 'Alpha Team', 'online', iso(1)),
          device('2', 'Bravo Team', 'online', iso(2)),
          device('3', 'Charlie Team', charlieOffline === true ? 'offline' : 'online', charlieOffline === true ? iso(12) : iso(1)),
        ],
        positions: [
          fix('pos-1', '1', 51.9985, -9.7426, 1, 1.2),
          fix('pos-2', '2', 51.9905, -9.718, 2, 0.6),
          fix('pos-3', '3', 51.98, -9.7, charlieOffline === true ? 12 : 1, 0),
        ],
        breadcrumbs: [
          ...trail('1', [[51.97, -9.69, 60], [51.978, -9.705, 48], [51.985, -9.72, 36], [51.992, -9.734, 20], [51.9985, -9.7426, 1]]),
          ...trail('2', [[51.97, -9.73, 50], [51.976, -9.725, 38], [51.983, -9.721, 22], [51.9905, -9.718, 2]]),
          ...trail('3', [[51.975, -9.68, 55], [51.978, -9.69, 30], [51.98, -9.7, charlieOffline === true ? 12 : 1]]),
        ],
      },
      connectionLost === true
        ? { mode: 'offline', consecutiveFailures: 4, recovered: false, lastSuccessAt: iso(7), warning: 'Traccar server is not answering. Showing last known positions.' }
        : { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: iso(0), warning: null },
    )
  }, options)
  await page.waitForTimeout(1_000)
}

/** Publishes a snapshot where Alpha Team has not moved for 40 minutes (stationary attention). */
async function injectStationaryAlpha(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const now = Date.now()
    const iso = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString()
    const fix = (id: string, deviceId: string, lat: number, lon: number, minutesAgo: number) => ({
      id, device_id: deviceId, lat, lon, altitude: 300, speed: 0, battery: 70, accuracy: 6,
      timestamp: iso(minutesAgo), source: 'osmand', data_origin: 'live' as const,
      cache_age_seconds: null, device_cache_stale: false,
    })
    const alpha = [50, 40, 30, 20, 10, 1].map((minutes, index) =>
      fix(`still-${index}`, '1', 51.9985 + index * 0.000002, -9.7426, minutes))
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(
      {
        devices: [
          { device_id: '1', name: 'Alpha Team', status: 'online', last_seen: iso(1), unique_id: 'alpha team', category: 'person', group_id: '101' },
          { device_id: '2', name: 'Bravo Team', status: 'online', last_seen: iso(2), unique_id: 'bravo team', category: 'person', group_id: '101' },
        ],
        positions: [fix('pos-1', '1', 51.9985 + 5 * 0.000002, -9.7426, 1), fix('pos-2', '2', 51.9905, -9.718, 2)],
        breadcrumbs: [...alpha, fix('bc-2', '2', 51.9905, -9.718, 2)],
      },
      { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: iso(0), warning: null },
    )
  })
  await page.waitForTimeout(1_000)
}

/**
 * The browser harness has no Traccar server to answer history requests, so participant
 * history would sit on "pending / retrying" forever. This marks the requested history as
 * fetched (the way a healthy server would) so screenshots show the normal, healthy state.
 */
async function completeParticipantBackfill(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const [{ getBrowserHarnessStore }, { useCoverageStore }, { useParticipantStore }] = await Promise.all([
      import('/src/features/browser-validation/browser-harness-store.ts'),
      import('/src/features/tracking/coverage-store.ts'),
      import('/src/features/participants/participant-store.ts'),
    ])
    const store = getBrowserHarnessStore()
    const missionId = window.__SARTRACKER_BROWSER_HARNESS__?.readState().currentMissionId ?? null
    if (missionId === null) throw new Error('No current mission to complete history for.')
    const checkpoints = await store.listParticipantBackfillCheckpoints(missionId)
    await Promise.all(checkpoints.map((checkpoint) =>
      store.upsertParticipantBackfillCheckpoint({
        mission_id: checkpoint.mission_id,
        traccar_device_id: checkpoint.traccar_device_id,
        window_from: checkpoint.window_from,
        window_to: checkpoint.window_to,
        reconciled_until: checkpoint.window_to,
        completed: true,
      })))
    await useParticipantStore.getState().controller?.refreshBackfillCheckpoints(missionId)
    await useCoverageStore.getState().controller?.refresh()
  })
  // A fresh snapshot after the history is marked fetched lets the coverage claim settle.
  await injectTracking(page)
  await page.evaluate(async () => {
    const { useCoverageStore } = await import('/src/features/tracking/coverage-store.ts')
    await useCoverageStore.getState().controller?.refresh()
  })
  // Fail loudly rather than photograph a half-loaded panel.
  await expect(page.getByTestId('coverage-status-panel')).toContainText('All mission history shown', {
    timeout: 20_000,
  })
}

/** Starts a mission with the Hill Team group and Charlie Team selected, then feeds tracking. */
async function startDemoMission(page: Page, name = 'Coomloughra Search'): Promise<void> {
  await seedRoster(page)
  await page.getByTestId('mission-name-input').fill(name)
  await page.getByTestId('mission-offset-input').fill('2')
  await page.getByTestId('participant-group-picker').getByText('Hill Team', { exact: true }).click()
  await page.getByTestId('participant-device-picker').getByText('Charlie Team', { exact: true }).click()
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toContainText('active')
  await injectTracking(page)
  await completeParticipantBackfill(page)
}

/**
 * Runs a capture in a taller window (same 1440 width). The right-hand rail is split into a
 * Mission Control card and a tab body that both scroll; at 900px tall the tab body is only a
 * couple of hundred pixels, so close-ups of rail panels are taken at 1440x1500 instead.
 */
async function withTallWindow(page: Page, capture: () => Promise<void>): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1500 })
  await page.waitForTimeout(800)
  try {
    await capture()
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(500)
  }
}

test.describe('manual screenshots: running a mission', () => {
  test('start, tracking, devices, layers, tools, focus mode', async ({ page }) => {
    await openHarness(page)
    await seedRoster(page)

    // Ready to start: name, offset and participants filled in, nothing started yet.
    await page.getByTestId('mission-name-input').fill('Coomloughra Search')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('participant-group-picker').getByText('Hill Team', { exact: true }).click()
    await page.getByTestId('participant-device-picker').getByText('Charlie Team', { exact: true }).click()
    await withTallWindow(page, async () => {
      // Scroll the device list so a locked group member and the ticked single device both show.
      await page.getByTestId('participant-device-picker').evaluate((element) => {
        for (const scroller of [element, ...element.querySelectorAll('*')]) scroller.scrollTop = 60
      })
      await shot(page, 'start-mission-setup', page.getByTestId('mission-control-dock'))
    })

    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await injectTracking(page)
    await completeParticipantBackfill(page)
    await shot(page, 'app-shell')

    await withTallWindow(page, async () => {
      await shot(page, 'mission-control-active', page.getByTestId('mission-control-dock'))
      await shot(page, 'tracking-tab', page.getByTestId('sidebar-tab-content'))
      await page.getByTestId('sidebar-tab-layers').click()
      await shot(page, 'layers-tab', page.getByTestId('sidebar-tab-content'))
      await page.getByTestId('sidebar-tab-tracking').click()
    })

    await page.getByTestId('open-devices-workspace').click()
    await page.getByTestId('devices-workspace').waitFor()
    await shot(page, 'devices-workspace')
    await page.keyboard.press('Escape')

    await page.getByTestId('focus-mode-toggle').click()
    await shot(page, 'focus-mode')
  })
})

test.describe('manual screenshots: map, coordinates, markers and drawings', () => {
  test('maps menu, converter, toolbar, marker and search-area forms', async ({ page }) => {
    await openHarness(page)
    await startDemoMission(page)

    await page.getByTestId('basemap-menu-toggle').click()
    await shot(page, 'maps-menu', { x: 0, y: 170, width: 520, height: 560 })
    await page.getByTestId('basemap-menu-toggle').click()

    await page.getByTestId('open-coordinate-converter').click()
    await page.getByTestId('coordinate-mode-dd').click()
    await page.getByTestId('coordinate-input-latitude').fill('51.99850')
    await page.getByTestId('coordinate-input-longitude').fill('-9.74260')
    await page.getByTestId('coordinate-convert-btn').click()
    await shot(page, 'coordinate-converter', await dialogPanel(page, 'coordinate-converter-dialog'))
    await page.keyboard.press('Escape')

    await page.getByTestId('drawing-toolbar-expand').click()
    await shot(page, 'map-tools', { x: 0, y: 170, width: 520, height: 640 })

    // Search area: three clicks to draw, then the form.
    await page.getByTestId('drawing-tool-search_area').click({ force: true })
    const canvas = page.locator('.maplibregl-canvas').first()
    await canvas.click({ position: { x: 560, y: 260 }, force: true })
    await canvas.click({ position: { x: 760, y: 240 }, force: true })
    await canvas.click({ position: { x: 700, y: 420 }, force: true })
    await canvas.click({ position: { x: 700, y: 420 }, button: 'right', force: true })
    await page.getByTestId('drawing-dialog').waitFor()
    await page.setViewportSize({ width: 1440, height: 1500 })
    await page.getByTestId('drawing-name-input').fill('Area A - Coomloughra Corrie')
    await page.getByTestId('drawing-search-area-team-input').fill('Hill Team')
    await page.getByTestId('drawing-search-area-status-input').selectOption('Assigned')
    await shot(page, 'drawing-search-area-form', await dialogPanel(page, 'drawing-dialog'))
    await page.getByTestId('drawing-save-btn').click()
    await page.getByTestId('drawing-dialog').waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(500)

    // Casualty marker.
    await canvas.click({ position: { x: 330, y: 420 }, force: true })
    await page.getByTestId('marker-dialog').waitFor()
    await page.getByTestId('marker-dialog').getByText('Casualty', { exact: true }).click()
    await page.getByTestId('marker-name-input').fill('Walker with ankle injury')
    await page.getByTestId('marker-condition-input').selectOption('Medical Emergency')
    await page.getByTestId('marker-evacuation-priority-input').selectOption('Urgent')
    await page.setViewportSize({ width: 1440, height: 1500 })
    await shot(page, 'marker-casualty-form', await dialogPanel(page, 'marker-dialog'))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('marker-save-btn').click()
    await page.getByTestId('marker-dialog').waitFor({ state: 'hidden' })
    await page.getByTestId('drawing-toolbar-collapse').click()
    await shot(page, 'map-with-markup')
  })
})

test.describe('manual screenshots: warnings, outings, history, pause', () => {
  test('offline, stationary, outings, mission history, paused, recovery', async ({ page }) => {
    await openHarness(page)
    await startDemoMission(page)

    // Tracking went offline: last-known positions stay on the map, status turns red.
    await injectTracking(page, { connectionLost: true })
    await shot(page, 'tracking-offline')
    await injectTracking(page)

    // Stationary attention.
    await injectStationaryAlpha(page)
    await shot(page, 'stationary-attention-map')
    await page.getByTestId('open-devices-workspace').click()
    await page.getByTestId('devices-workspace').waitFor()
    await shot(page, 'stationary-attention-devices')
    await page.keyboard.press('Escape')
    await injectTracking(page)

    // Outings.
    await withTallWindow(page, async () => {
      await page.getByTestId('outing-label-input').fill('Morning search')
      await page.getByTestId('outing-start-btn').click()
      await page.getByTestId('outing-controls-section').scrollIntoViewIfNeeded()
      await shot(page, 'outings', page.getByTestId('outing-controls-section'))
    })

    // Mission history coverage in the Layers tab.
    await withTallWindow(page, async () => {
      await page.getByTestId('coverage-status-panel').scrollIntoViewIfNeeded()
      await shot(page, 'mission-history-coverage', page.getByTestId('coverage-status-panel'))
    })

    // Paused.
    await page.getByTestId('mission-pause-resume-btn').click()
    await expect(page.getByTestId('mission-paused-banner')).toBeVisible()
    await shot(page, 'mission-paused')
    await withTallWindow(page, async () => {
      await shot(page, 'mission-paused-controls', page.getByTestId('mission-control-dock'))
    })
    await page.getByTestId('mission-paused-banner-resume-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    // Restart recovery.
    await page.reload()
    await page.getByTestId('app-title').waitFor({ timeout: 20_000 })
    await page.waitForSelector('canvas', { timeout: 20_000 })
    await page.waitForTimeout(1_500)
    await page.getByTestId('mission-recovery-dialog').waitFor()
    await shot(page, 'recovery-choice', page.getByTestId('mission-recovery-dialog'))
  })
})

const ARCHIVE_PASSPHRASE = 'Synthetic!Archive123'

/** Finishes the active mission through the confirmation dialog. */
async function finishMission(page: Page): Promise<void> {
  await page.getByTestId('mission-finish-btn').click()
  await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).waitFor()
}

/** Confirms Finish. */
async function confirmFinish(page: Page): Promise<void> {
  await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
  await page.getByTestId('mission-governance-card').waitFor()
}

test.describe('manual screenshots: review, replay and search passes', () => {
  test('docked review, replay, search passes', async ({ page }) => {
    await openHarness(page)
    await startDemoMission(page)
    await page.getByTestId('outing-label-input').fill('Morning search')
    await page.getByTestId('outing-start-btn').click()
    await page.evaluate(async () => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.importGpxFiles([{
        sourcePath: '/tracks/team-alpha-descent.gpx',
        fileName: 'team-alpha-descent.gpx',
        contents: `<gpx version="1.1"><trk><name>Alpha descent</name><trkseg>
          <trkpt lat="51.9985" lon="-9.7426"><time>${new Date(Date.now() - 50 * 60_000).toISOString()}</time></trkpt>
          <trkpt lat="51.9930" lon="-9.7300"><time>${new Date(Date.now() - 40 * 60_000).toISOString()}</time></trkpt>
          <trkpt lat="51.9880" lon="-9.7100"><time>${new Date(Date.now() - 30 * 60_000).toISOString()}</time></trkpt>
        </trkseg></trk></gpx>`,
      }])
    })

    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByTestId('mission-review-workspace').waitFor()
    await shot(page, 'review-docked')
    await page.getByRole('button', { name: 'Replay', exact: true }).click()
    await page.getByTestId('mission-replay-seek').click()
    await page.getByTestId('mission-replay-workspace').waitFor()
    await page.waitForTimeout(2_500)
    await shot(page, 'review-replay')
    await page.getByRole('button', { name: 'Search Passes', exact: true }).click()
    await page.getByTestId('search-operations-workspace').waitFor()
    await shot(page, 'review-search-passes')
  })
})

test.describe('manual screenshots: finish, archive and lock', () => {
  test('finish dialog, governance list, custody dialog, archive review, cleanup', async ({ page }) => {
    await openHarness(page)
    await startDemoMission(page, 'Coomloughra Search')
    await finishMission(page)
    await shot(page, 'finish-confirm', page.getByTestId('mission-finish-dialog'))
    await confirmFinish(page)

    // A second finished mission so the Mission Governance list has a choice to make.
    await seedRoster(page)
    await page.getByTestId('mission-name-input').fill('Gap of Dunloe Training')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await finishMission(page)
    await confirmFinish(page)
    await withTallWindow(page, async () => {
      await shot(page, 'governance-card', page.getByTestId('mission-governance-card'))
    })

    // Archive & Lock: passphrase, then the one-time recovery code.
    await page.getByTestId('mission-governance-select').selectOption({ label: 'Coomloughra Search' }).catch(() => undefined)
    await page.getByTestId('mission-finalize-btn').click()
    const custody = page.getByTestId('mission-archive-custody-dialog')
    await custody.waitFor()
    await page.getByTestId('archive-passphrase').fill(ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-passphrase-confirmation').fill(ARCHIVE_PASSPHRASE)
    await withTallWindow(page, async () => {
      await shot(page, 'archive-passphrase-step', await dialogPanel(page, 'mission-archive-custody-dialog'))
    })
    await page.getByTestId('archive-issue-recovery-code').click()
    const recoveryCode = (await page.getByTestId('archive-recovery-code').innerText()).trim()
    await page.getByTestId('archive-recovery-code-confirmation').fill(recoveryCode)
    await withTallWindow(page, async () => {
      await shot(page, 'archive-custody-dialog', await dialogPanel(page, 'mission-archive-custody-dialog'))
    })
    await page.getByTestId('archive-finalize').click()
    await custody.waitFor({ state: 'hidden' })

    // Saved archives in Review, then open one read-only.
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByTestId('mission-archive-review-control').waitFor()
    await withTallWindow(page, async () => {
      await shot(page, 'archive-saved-list', page.getByTestId('mission-archive-review-control'))
    })
    await page.locator('[data-testid^="archive-review-select-"]').first().click()
    await page.getByTestId('archive-review-secret').fill(ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-review-open').click()
    await page.getByTestId('mission-review-archive-banner').waitFor()
    await shot(page, 'archive-review-open')
    await page.getByTestId('mission-review-close-archive').click()

    // Optional clean-up of live rows once a verified archive exists.
    await page.locator('[data-testid^="archive-cleanup-open-"]').first().click()
    await page.getByTestId('mission-archive-cleanup-dialog').waitFor()
    await withTallWindow(page, async () => {
      await shot(page, 'archive-cleanup-dialog', await dialogPanel(page, 'mission-archive-cleanup-dialog'))
    })
  })
})

test.describe('manual screenshots: evidence gap, admin roster', () => {
  test('evidence-loss acknowledgement with and without an admin roster', async ({ page }) => {
    await openHarness(page)
    // With no Admin Roster members the dialog explains how to add one.
    await startDemoMission(page, 'Evidence Gap Drill')
    const missionId = await page.evaluate(
      () => window.__SARTRACKER_BROWSER_HARNESS__?.readState().currentMissionId ?? null,
    )
    expect(missionId).not.toBeNull()
    await finishMission(page)
    await confirmFinish(page)
    await page.evaluate(async (id) => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.injectEvidenceLoss(id)
    }, missionId!)
    await page.getByTestId('mission-finalize-btn').click()
    await page.getByTestId('archive-passphrase').fill(ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-passphrase-confirmation').fill(ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-issue-recovery-code').click()
    const code = (await page.getByTestId('archive-recovery-code').innerText()).trim()
    await page.getByTestId('archive-recovery-code-confirmation').fill(code)
    await page.getByTestId('archive-finalize').click()
    await page.getByTestId('mission-evidence-loss-dialog').waitFor()
    await withTallWindow(page, async () => {
      await shot(page, 'evidence-gap-no-admin', await dialogPanel(page, 'mission-evidence-loss-dialog'))
    })

    // Same dialog with a named admin available.
    await page.evaluate(() => {
      window.localStorage.setItem(
        'sartracker:browser-settings',
        JSON.stringify({ missionDefaults: { adminRoster: ['Ops Lead'] } }),
      )
    })
    await page.reload()
    await page.getByTestId('app-title').waitFor({ timeout: 20_000 })
    await page.waitForSelector('canvas', { timeout: 20_000 })
    await page.getByTestId('mission-governance-card').waitFor()
    await page.getByTestId('mission-finalize-btn').click()
    await page.getByTestId('archive-passphrase').fill(ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-passphrase-confirmation').fill(ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-issue-recovery-code').click()
    const code2 = (await page.getByTestId('archive-recovery-code').innerText()).trim()
    await page.getByTestId('archive-recovery-code-confirmation').fill(code2)
    await page.getByTestId('archive-finalize').click()
    await page.getByTestId('mission-evidence-loss-dialog').waitFor()
    await withTallWindow(page, async () => {
      await shot(page, 'evidence-gap-acknowledge', await dialogPanel(page, 'mission-evidence-loss-dialog'))
    })
  })
})

test.describe('manual screenshots: settings and diagnostics', () => {
  test('settings sections and diagnostics', async ({ page }) => {
    await openHarness(page)
    await startDemoMission(page)

    await page.getByTestId('open-settings-workspace').click()
    const settings = page.getByTestId('settings-workspace')
    await settings.waitFor()
    const sheet = { x: 672, y: 0, width: 768, height: 900 }
    for (const [heading, name] of [
      ['Coordinator Roster', 'settings-rosters'],
      ['Data Sources', 'settings-data-sources'],
      ['Weather Links', 'settings-weather-links'],
    ] as const) {
      await settings.getByText(new RegExp(`^${heading}$`, 'iu')).first().evaluate((element) => {
        element.scrollIntoView({ block: 'start' })
      })
      await shot(page, name, sheet)
    }
    await page.keyboard.press('Escape')

    await page.getByTestId('open-diagnostics-workspace').click()
    const diagnostics = page.getByTestId('diagnostics-workspace')
    await diagnostics.waitFor()
    const diagnosticsSheet = { x: 544, y: 0, width: 896, height: 900 }
    await shot(page, 'diagnostics-top', diagnosticsSheet)
    await page.getByTestId('diagnostics-export-support-bundle').evaluate((element) => {
      element.scrollIntoView({ block: 'center' })
    })
    await shot(page, 'diagnostics-export', diagnosticsSheet)
    await page.keyboard.press('Escape')

  })
})

test.describe('manual screenshots: GPX, helicopters, measuring, grid references, display', () => {
  test('gpx import, helicopter slot, measurement, marker at grid reference, high contrast', async ({ page }) => {
    await openHarness(page)
    await startDemoMission(page)

    await page.evaluate(async () => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.importGpxFiles([{
        sourcePath: '/tracks/team-alpha-descent.gpx',
        fileName: 'team-alpha-descent.gpx',
        contents: `<gpx version="1.1"><trk><name>Alpha descent</name><trkseg>
          <trkpt lat="51.9985" lon="-9.7426"><time>${new Date(Date.now() - 50 * 60_000).toISOString()}</time></trkpt>
          <trkpt lat="51.9930" lon="-9.7300"><time>${new Date(Date.now() - 40 * 60_000).toISOString()}</time></trkpt>
          <trkpt lat="51.9880" lon="-9.7100"><time>${new Date(Date.now() - 30 * 60_000).toISOString()}</time></trkpt>
        </trkseg></trk></gpx>`,
      }])
    })
    await withTallWindow(page, async () => {
      await page.getByTestId('sidebar-tab-tools').click()
      await shot(page, 'tools-tab', page.getByTestId('sidebar-tab-content'))
      await page.getByTestId('helicopter-add-slot').click()
      await page.getByTestId('helicopter-panel').scrollIntoViewIfNeeded()
      await shot(page, 'helicopter-panel', page.getByTestId('helicopter-panel'))
      await page.getByTestId('sidebar-tab-tracking').click()
    })

    // Measurement: Map Tools -> Measure -> two clicks.
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-measure').click({ force: true })
    const canvas = page.locator('.maplibregl-canvas').first()
    await canvas.click({ position: { x: 640, y: 600 }, force: true })
    await canvas.click({ position: { x: 900, y: 420 }, force: true })
    await page.getByTestId('measurement-panel').waitFor()
    await shot(page, 'measurement', { x: 0, y: 170, width: 1040, height: 660 })

    // Marker at a grid reference.
    await page.getByTestId('drawing-tool-marker-at-grid').click({ force: true }).catch(async () => {
      await page.getByRole('button', { name: 'Marker at GR' }).click({ force: true })
    })
    await page.getByTestId('marker-at-grid-panel').waitFor()
    await page.getByTestId('marker-at-grid-reference-input').fill('V 80962 80489')
    await shot(page, 'marker-at-grid', { x: 0, y: 170, width: 700, height: 660 })
    await page.getByTestId('drawing-toolbar-collapse').click()

    // Minimised Mission Control.
    await page.getByTestId('mission-control-collapse-btn').click()
    await page.getByTestId('compact-mission-strip').waitFor()
    await shot(page, 'mission-control-minimized', { x: 0, y: 0, width: 1440, height: 260 })
    await page.getByTestId('compact-mission-restore').click()
  })
})

test.describe('manual screenshots: sealed archive that still needs verification', () => {
  test('verification retry asks for both original credentials', async ({ page }) => {
    await openHarness(page)
    await startDemoMission(page, 'Retry Drill')
    await finishMission(page)
    await confirmFinish(page)
    await page.getByTestId('mission-finalize-btn').click()
    await page.getByTestId('archive-passphrase').fill(ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-passphrase-confirmation').fill(ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-issue-recovery-code').click()
    const code = (await page.getByTestId('archive-recovery-code').innerText()).trim()
    await page.getByTestId('archive-recovery-code-confirmation').fill(code)
    await page.getByTestId('archive-finalize').click()
    await page.getByTestId('mission-archive-custody-dialog').waitFor({ state: 'hidden' })
    // Put the archive into the "sealed, not yet verified" state the harness can simulate.
    const archiveId = await page.evaluate(() => {
      const archive = window.__SARTRACKER_BROWSER_HARNESS__?.readState().missionArchives.at(-1)
      if (archive === undefined) throw new Error('Expected one synthetic archive.')
      return archive.id
    })
    await page.evaluate(async (id) => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.prepareArchiveVerificationRetryFixture(id)
    }, archiveId)
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByTestId(`archive-verify-retry-${archiveId}`).click()
    await page.getByTestId('mission-archive-verification-dialog').waitFor()
    await withTallWindow(page, async () => {
      await shot(page, 'archive-verify-retry', await dialogPanel(page, 'mission-archive-verification-dialog'))
    })
  })
})
