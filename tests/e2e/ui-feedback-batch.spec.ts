import { expect, test, type Page } from '@playwright/test'
import { closeMissionPanel, openDevicesWorkspace, openMissionPanel, openMissionReview, openWorkspacePanel } from './helpers/workspace-panels'

/*
 * The old screen's minimise, rail collapse and Focus Mode were retired with it
 * (DON-341). Each safety check below now asks the same question of the new
 * layout: can the warning or control be hidden, and is it still in reach?
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toBeVisible()
  await openMissionPanel(page)
  await page.getByTestId('mission-name-input').fill('UI feedback mission')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
})

/** Shows the map with no side panel, as the operator's Full map button does. */
async function showFullMap(page: Page): Promise<void> {
  if (await page.getByTestId('ws-side').getAttribute('data-empty') === 'true') return
  await page.getByTestId('ws-full-map').click()
  await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
}

test('tracking health stays in the top bar whichever panel is open, and Review opens from More, then Mission reopens', async ({ page }) => {
  // Was: Focus Mode kept the tracking chip on every sidebar tab.
  const headline = page.getByTestId('ws-tracking-headline')
  await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
    { devices: [], positions: [], breadcrumbs: [] },
    { mode: 'offline', consecutiveFailures: 2, recovered: false, lastSuccessAt: '2026-09-09T08:00:00Z', warning: 'Connection lost' },
  ))
  for (const panel of ['people', 'layers', 'tools', 'tracking', 'mission'] as const) {
    await openWorkspacePanel(page, panel)
    await expect(headline).toContainText('TRACKING LOST')
    await expect(headline).toContainText('Last update')
    await expect(headline).toHaveClass(/ws-health-alert/)
  }
  await showFullMap(page)
  await expect(headline).toContainText('TRACKING LOST')
  await expect(page.getByTestId('ws-alarm')).toBeVisible()

  // Cached positions shown as if live must read as lost, not OK (was "Tracking not live").
  await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
    { devices: [], positions: [], breadcrumbs: [] },
    { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: 'OFFLINE MODE — showing last known positions from cache' },
  ))
  await expect(headline).toHaveAttribute('data-condition', 'lost')
  await expect(headline).toHaveClass(/ws-health-alert/)

  await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
    { devices: [], positions: [{ id: 'unverified', device_id: 'alpha', lat: 52, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: null, timestamp: new Date().toISOString(), source: 'gps', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false, fix_time_unverified: true }], breadcrumbs: [] },
    { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null },
  ))
  await expect(headline).toContainText('1 position time not verified')
  await expect(headline).toHaveClass(/ws-health-warning/)

  // Was: the minimised mission strip's Review and Restore buttons.
  await openMissionReview(page)
  await expect(page.getByRole('heading', { name: 'Review and replay', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await openMissionPanel(page)
  await expect(page.getByTestId('mission-control')).toBeVisible()
})

test('Full map returns the map width and Show panel keeps the layer search', async ({ page }) => {
  // Was: collapsing the layer rail and restoring it from the keyboard.
  await openWorkspacePanel(page, 'layers')
  await page.getByTestId('layer-tree-search').fill('test search')
  const before = await page.getByTestId('map-container').boundingBox()
  const toggle = page.getByTestId('ws-full-map')
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
  await expect.poll(async () => (await page.getByTestId('map-container').boundingBox())!.width).toBeGreaterThan(before!.width + 200)
  await expect.poll(async () => page.locator('.maplibregl-canvas').evaluate((canvas) => canvas.getBoundingClientRect().width)).toBeGreaterThan(before!.width + 200)
  await expect(toggle).toHaveText('Show panel')
  await page.keyboard.press('Enter')
  // Show panel brings back People, the default panel; focus stays on the toggle.
  await expect(page.getByTestId('ws-people-panel')).toBeVisible()
  await expect(toggle).toBeFocused()
  await openWorkspacePanel(page, 'layers')
  await expect(page.getByTestId('layer-tree-search')).toHaveValue('test search')
})

test('Map Tools chevron changes expansion without opening marker placement', async ({ page }) => {
  await page.getByTestId('drawing-toolbar-expand').locator('svg').click()
  await expect(page.getByTestId('drawing-toolbar-collapse')).toBeVisible()
  await expect(page.getByTestId('marker-dialog')).toBeHidden()
  await expect(page.getByTestId('drawing-toolbar-active-mode')).toHaveText('Open')
  await page.getByTestId('drawing-toolbar-collapse').click()
  await expect(page.getByTestId('drawing-toolbar-expand')).toBeVisible()
  await expect(page.getByTestId('marker-dialog')).toBeHidden()
})

test('upgrade from a collapsed legacy layer panel retains reachable tree controls', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('sartracker:layer-tree-ui', JSON.stringify({ state: { panelExpanded: false, expandedNodeIds: [], showHidden: true }, version: 0 })))
  await page.reload()
  await page.getByTestId('start-screen-resume-btn').click()
  await openWorkspacePanel(page, 'layers')
  await expect(page.getByTestId('layer-tree-search')).toBeVisible()
  await expect(page.getByTestId('layer-tree')).toBeVisible()
})

test('an open Finish decision holds Mission in view and cannot be closed away', async ({ page }) => {
  // Was: the decision could not be minimised or hidden by collapsing the rail.
  await openMissionPanel(page)
  await page.getByTestId('mission-finish-btn').click()
  await expect(page.getByTestId('mission-finish-dialog')).toBeVisible()
  await expect(page.getByTestId('ws-mission-close')).toBeDisabled()
  await page.getByTestId('ws-toggle-layers').click()
  await page.getByTestId('ws-full-map').click()
  await expect(page.getByTestId('mission-finish-dialog')).toBeVisible()
  await expect(page.getByTestId('ws-layers-panel')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mission-finish-dialog')).toBeHidden()
  await expect(page.getByTestId('ws-mission-close')).toBeEnabled()
})

test('a pause from Full map shows the alarm, and its Resume brings tracking back', async ({ page }) => {
  // Was: pause protection cleared the rail-collapse latch so Resume did not hide controls again.
  await showFullMap(page)
  await page.evaluate(async () => {
    const path = '/src/features/mission/mission-store.ts'
    const { useMissionStore } = await import(path)
    await useMissionStore.getState().controller.pauseMission()
  })
  await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
  await page.getByTestId('ws-alarm-resume').click()
  await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
  await expect(page.getByTestId('ws-alarm')).not.toContainText('MISSION PAUSED')
  // The harness has no tracking server, so the running mission is told so, in red [DON-375].
  await expect(page.getByTestId('ws-alarm')).toContainText('TRACKING NOT CONNECTED')
  await expect(page.getByTestId('ws-alarm-details')).toBeVisible()
  await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
})

test('the light theme is the default, and dark is operator accessible and survives reload', async ({ page }) => {
  // The theme toggle moved under More (DON-341); light became the default (DON-344).
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('ws-top-bar')).toHaveCSS('background-color', 'rgb(238, 240, 243)')
  await page.getByTestId('ws-more-button').click()
  await expect(page.getByTestId('theme-toggle')).toHaveText('Theme: Light')
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'standard')
  await expect(page.getByTestId('theme-toggle')).toHaveText('Theme: Dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'standard')
  await expect(page.getByTestId('ws-top-bar')).toHaveCSS('background-color', 'rgb(0, 0, 0)')
})

test('brightened secondary controls retain their hover affordance', async ({ page }) => {
  await openWorkspacePanel(page, 'tools')
  // The GPX import section used to load lazily and push the helicopter section
  // about 476 px down when it arrived (CI flake, DON-353); it now loads with
  // the app (DON-355, tools-panel-layout-stability.spec.ts).
  await expect(page.getByTestId('gpx-import-panel')).toBeVisible()
  await page.getByTestId('helicopter-add-slot').click()
  const button = page.getByTestId('helicopter-hide-empty-slots')
  await expect(button).toBeVisible()
  await page.mouse.move(0, 0)
  // In the light default (DON-344) the label rests at the dim text colour
  // (#454c55) and settles on the darker stone-200 (#22262b) on hover.
  await expect(button).toHaveCSS('color', 'rgb(69, 76, 85)')
  await button.hover()
  await expect(button).toHaveCSS('color', 'rgb(34, 38, 43)')
})

test('a pause that fails after Mission was closed reopens Mission and stays flagged', async ({ page }) => {
  // Was: the pending pause failure survived minimisation and blocked rail collapse.
  await page.evaluate(async () => {
    const path = '/src/features/mission/mission-store.ts'
    const { useMissionStore } = await import(path)
    const controller = useMissionStore.getState().controller
    useMissionStore.setState({ controller: { ...controller, pauseMission: () => new Promise((_resolve, reject) => {
      Object.assign(window, { rejectTestPause: () => reject(new Error('Test pause failed')) })
    }) } })
  })
  await openMissionPanel(page)
  await page.getByTestId('mission-pause-resume-btn').click()
  await page.getByTestId('ws-pause-confirm-yes').click()
  await closeMissionPanel(page)
  await expect(page.getByTestId('mission-control')).toBeHidden()
  await page.evaluate(() => (window as Window & { rejectTestPause: () => void }).rejectTestPause())
  await expect(page.getByTestId('mission-action-error')).toContainText('Test pause failed')
  await expect(page.getByTestId('mission-action-error')).toBeVisible()
  await expect(page.getByTestId('ws-mission-attention')).toContainText('Needs attention')
  // Tracking stays reachable (Reconnect is never blocked); the flag stays on Mission.
  await openWorkspacePanel(page, 'tracking')
  await expect(page.getByTestId('ws-mission-attention')).toContainText('Needs attention')
  await openMissionPanel(page)
  await expect(page.getByTestId('mission-action-error')).toContainText('Test pause failed')
})

test('archive recovery keeps the Mission card open and cannot be closed', async ({ page }) => {
  // Was: archive recovery could not be hidden by collapsing an idle rail.
  await page.evaluate(async () => {
    const path = '/src/features/mission/mission-store.ts'
    const { useMissionStore } = await import(path)
    const mission = useMissionStore.getState().currentMission
    useMissionStore.setState({ phase: 'idle', currentMission: null, governanceMission: { ...mission, status: 'finalized', storage_state: 'recovery_required' } })
  })
  await expect(page.getByTestId('mission-storage-state')).toContainText('recovery_required')
  await expect(page.getByTestId('ws-mission-close')).toBeDisabled()
  await page.getByTestId('ws-toggle-layers').click()
  await expect(page.getByTestId('mission-storage-state')).toBeVisible()
  await expect(page.getByTestId('mission-storage-state')).toContainText('recovery_required')
})

test('a rejected admin roster can be retried without leaving hide controls locked', async ({ page }) => {
  await page.evaluate(async () => {
    const storePath = '/src/features/mission/mission-store.ts'
    const settingsPath = '/src/features/settings/settings-types.ts'
    const { useMissionStore } = await import(storePath)
    const { DEFAULT_APP_SETTINGS } = await import(settingsPath)
    const mission = useMissionStore.getState().currentMission
    Object.assign(window, { testOriginalMission: mission })
    const roster = { available: false, calls: 0 }
    Object.assign(window, { testRosterAvailability: roster })
    Object.assign(window, { sartrackerElectron: { archiveReview: { supported: false }, loadAppSettings: async () => {
      roster.calls += 1
      if (!roster.available) throw new Error('Test roster unavailable')
      return { ...DEFAULT_APP_SETTINGS, missionDefaults: { ...DEFAULT_APP_SETTINGS.missionDefaults, adminRoster: ['Ops Lead'] } }
    } } })
    useMissionStore.setState({ phase: 'idle', currentMission: null, governanceMission: { ...mission, status: 'finalized', storage_state: 'live' } })
    window.dispatchEvent(new Event('sartracker:settings-updated'))
  })
  // A background map refresh must not bypass the unavailable-settings state.
  await expect.poll(() => page.evaluate(() => (window as Window & {
    testRosterAvailability: { calls: number }
  }).testRosterAvailability.calls)).toBeGreaterThan(0)
  await openMissionPanel(page)
  await page.getByTestId('mission-unlock-btn').click()
  await expect(page.getByText('Test roster unavailable', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    (window as Window & { testRosterAvailability: { available: boolean } }).testRosterAvailability.available = true
  })
  await page.getByRole('button', { name: 'Retry admin roster' }).click()
  await expect(page.getByText('Test roster unavailable', { exact: true })).toBeHidden()
  await expect(page.getByTestId('mission-unlock-admin')).toHaveValue('Ops Lead')
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const path = '/src/features/mission/mission-store.ts'
    const { useMissionStore } = await import(path)
    useMissionStore.setState({ phase: 'active', currentMission: (window as Window & { testOriginalMission: unknown }).testOriginalMission, governanceMission: null })
  })
  // Was: the minimise button returned. Now Mission can be closed again.
  await openMissionPanel(page)
  await expect(page.getByTestId('ws-mission-close')).toBeEnabled()
  await closeMissionPanel(page)
  await openWorkspacePanel(page, 'layers')
  await expect(page.getByTestId('ws-layers-panel')).toBeVisible()
})

test('paused alarm and Resume stay in view at 1280x720, with a panel open and on Full map', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openMissionPanel(page)
  await page.getByTestId('mission-pause-resume-btn').click()
  await page.getByTestId('ws-pause-confirm-yes').click()
  await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'paused')
  for (const fullMap of [false, true]) {
    if (fullMap) await showFullMap(page)
    else await openWorkspacePanel(page, 'layers')
    await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
    await expect(page.getByTestId('ws-alarm-resume')).toBeInViewport()
    await expect(page.getByTestId('ws-tracking-headline')).toContainText('MISSION PAUSED')
  }
})

for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
  test(`reachable Devices Zoom and separate Full map scale at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot({
      devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: new Date().toISOString(), unique_id: null, category: 'person' }],
      positions: [{ id: 'alpha-fix', device_id: 'alpha', lat: 53.34912, lon: -6.26031, altitude: null, speed: null, battery: null, accuracy: null, timestamp: new Date().toISOString(), source: 'gps', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false }], breadcrumbs: [],
    }))
    await openDevicesWorkspace(page)
    await expect(page.getByTestId('device-filter-tabs').locator('button')).toHaveCount(5)
    expect(await page.getByTestId('device-filter-tabs').locator('button').evaluateAll((buttons) => buttons.every((button) => {
      const label = button.querySelector('span:last-child')!
      const bounds = button.getBoundingClientRect()
      const text = label.getBoundingClientRect()
      return text.left >= bounds.left && text.right <= bounds.right
    }))).toBe(true)
    const zoom = page.getByTestId('device-zoom-alpha')
    const coordinates = page.getByTestId('devices-inspector').getByText('53.34912, -6.26031', { exact: true })
    await expect(coordinates).toBeVisible()
    expect(await coordinates.evaluate((element) => {
      const value = element.getBoundingClientRect()
      const panel = element.closest('aside')!.getBoundingClientRect()
      return value.left >= panel.left && value.right <= panel.right && element.scrollWidth <= element.clientWidth
    })).toBe(true)
    if (width === 1920) {
      expect(await page.getByTestId('device-list-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect(zoom).toBeInViewport()
    }
    await zoom.scrollIntoViewIfNeeded()
    const bounds = await zoom.boundingBox()
    expect(bounds).not.toBeNull()
    expect(await zoom.evaluate((element) => {
      const r = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    })).toBe(true)
    await zoom.click()
    await page.keyboard.press('Escape')
    // Was the Focus Mode coordinate mirror; Full map keeps the normal coordinate bar.
    await showFullMap(page)
    const coordinate = await page.getByTestId('coordinate-display').boundingBox()
    const scale = await page.getByTestId('map-scale-readout').boundingBox()
    expect(coordinate).not.toBeNull()
    expect(scale).not.toBeNull()
    expect(coordinate!.x >= scale!.x + scale!.width || scale!.x >= coordinate!.x + coordinate!.width || coordinate!.y >= scale!.y + scale!.height || scale!.y >= coordinate!.y + coordinate!.height).toBe(true)
  })
}
