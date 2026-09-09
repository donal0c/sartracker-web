import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toBeVisible()
  await page.getByTestId('mission-name-input').fill('UI feedback mission')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control-collapse-btn')).toBeVisible()
})

test('Focus retains tracking health on every tab and minimized mission can be reviewed and restored', async ({ page }) => {
  await page.getByTestId('mission-control-collapse-btn').click()
  await page.getByTestId('focus-mode-toggle').click()
  await expect(page.getByTestId('mission-control')).toBeHidden()
  await expect(page.getByTestId('compact-mission-strip')).toContainText('UI feedback mission')
  await expect(page.getByTestId('compact-mission-strip')).toContainText('Active search')
  await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
    { devices: [], positions: [], breadcrumbs: [] },
    { mode: 'offline', consecutiveFailures: 2, recovered: false, lastSuccessAt: '2026-09-09T08:00:00Z', warning: 'Connection lost' },
  ))
  for (const tab of ['tracking', 'tools', 'layers']) {
    await page.getByTestId(`focus-sidebar-tab-${tab}`).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId(`focus-sidebar-tab-${tab}`)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('persistent-tracking-health')).toContainText('Disconnected')
    await expect(page.getByTestId('persistent-tracking-health')).toContainText('Last success')
  }
  await expect(page.getByTestId('persistent-tracking-health')).toHaveClass(/sar-status-chip-alert/)
  await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
    { devices: [], positions: [], breadcrumbs: [] },
    { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: 'OFFLINE MODE — showing last known positions from cache' },
  ))
  await expect(page.getByTestId('persistent-tracking-health')).toContainText('Tracking not live')
  await expect(page.getByTestId('persistent-tracking-health')).toHaveClass(/sar-status-chip-alert/)
  await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot(
    { devices: [], positions: [{ id: 'unverified', device_id: 'alpha', lat: 52, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: null, timestamp: new Date().toISOString(), source: 'gps', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false, fix_time_unverified: true }], breadcrumbs: [] },
    { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null },
  ))
  await expect(page.getByTestId('persistent-tracking-health')).toContainText('1 fix times unverified')
  await expect(page.getByTestId('persistent-tracking-health')).toHaveClass(/sar-status-chip-warning/)
  await page.getByTestId('compact-mission-review').click()
  await expect(page.getByRole('heading', { name: 'Audit Workspace', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByTestId('compact-mission-restore').click()
  await expect(page.getByTestId('mission-control')).toBeVisible()
})

test('Layer collapse returns map width and keyboard restore preserves the layer search', async ({ page }) => {
  await page.getByTestId('sidebar-tab-layers').click()
  await page.getByTestId('layer-tree-search').fill('test search')
  const before = await page.getByTestId('map-container').boundingBox()
  await page.getByTestId('layer-panel-toggle').click()
  await expect(page.getByTestId('operational-sidebar')).toBeHidden()
  await expect.poll(async () => (await page.getByTestId('map-container').boundingBox())!.width).toBeGreaterThan(before!.width + 200)
  await expect.poll(async () => page.locator('.maplibregl-canvas').evaluate((canvas) => canvas.getBoundingClientRect().width)).toBeGreaterThan(before!.width + 200)
  await page.getByTestId('restore-workspace').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('layer-tree-search')).toHaveValue('test search')
  await expect(page.getByTestId('layer-panel-toggle')).toBeFocused()
})

test('Map Tools chevron changes expansion without opening marker placement', async ({ page }) => {
  await page.getByTestId('drawing-toolbar-expand').locator('svg').click()
  await expect(page.getByTestId('drawing-toolbar-collapse')).toBeVisible()
  await expect(page.getByTestId('marker-dialog')).toBeHidden()
  await expect(page.getByTestId('drawing-toolbar-active-mode')).toHaveText('Select')
  await page.getByTestId('drawing-toolbar-collapse').click()
  await expect(page.getByTestId('drawing-toolbar-expand')).toBeVisible()
  await expect(page.getByTestId('marker-dialog')).toBeHidden()
})

test('upgrade from a collapsed legacy layer panel retains reachable tree controls', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('sartracker:layer-tree-ui', JSON.stringify({ state: { panelExpanded: false, expandedNodeIds: [], showHidden: true }, version: 0 })))
  await page.reload()
  await page.getByTestId('sidebar-tab-layers').click()
  await expect(page.getByTestId('layer-tree-search')).toBeVisible()
  await expect(page.getByTestId('layer-panel-toggle')).toHaveText('Collapse')
})

test('an open End Mission decision cannot be minimized or hidden by rail collapse', async ({ page }) => {
  await page.getByTestId('mission-finish-btn').click()
  await expect(page.getByTestId('mission-finish-dialog')).toBeVisible()
  await expect(page.getByTestId('mission-control-collapse-btn')).toBeHidden()
  await page.getByTestId('sidebar-tab-layers').click()
  await expect(page.getByTestId('layer-panel-toggle')).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mission-finish-dialog')).toBeHidden()
  await expect(page.getByTestId('layer-panel-toggle')).toBeEnabled()
})

test('pause protection clears the collapse latch instead of hiding controls again on Resume', async ({ page }) => {
  await page.getByTestId('sidebar-tab-layers').click()
  await page.getByTestId('layer-panel-toggle').click()
  await page.evaluate(async () => {
    const path = '/src/features/mission/mission-store.ts'
    const { useMissionStore } = await import(path)
    await useMissionStore.getState().controller.pauseMission()
  })
  await expect(page.getByTestId('mission-paused-banner')).toBeVisible()
  await page.getByTestId('mission-paused-banner-resume-btn').click()
  await expect(page.getByTestId('mission-control')).toBeVisible()
  await expect(page.getByTestId('restore-workspace')).toBeHidden()
})

for (const transition of ['recovery', 'idle'] as const) {
  test(`minimization is not inherited after ${transition} returns to the same mission`, async ({ page }) => {
    await page.getByTestId('mission-control-collapse-btn').click()
    await page.evaluate(async (phase) => {
      const path = '/src/features/mission/mission-store.ts'
      const { useMissionStore } = await import(path)
      const mission = useMissionStore.getState().currentMission
      Object.assign(window, { testOriginalMission: mission })
      useMissionStore.setState({ phase, currentMission: null, recoverableMission: phase === 'recovery' ? mission : null })
    }, transition)
    await expect(page.getByTestId('mission-control')).toBeVisible()
    await page.evaluate(async () => {
      const path = '/src/features/mission/mission-store.ts'
      const { useMissionStore } = await import(path)
      useMissionStore.setState({ phase: 'active', currentMission: (window as Window & { testOriginalMission: unknown }).testOriginalMission, recoverableMission: null })
    })
    await expect(page.getByTestId('mission-control')).toBeVisible()
    await expect(page.getByTestId('compact-mission-strip')).toBeHidden()
  })
}

test('high contrast is operator accessible and survives reload', async ({ page }) => {
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast')
})

test('brightened secondary controls retain their hover affordance', async ({ page }) => {
  await page.getByTestId('sidebar-tab-tools').click()
  await page.getByTestId('helicopter-add-slot').click()
  const button = page.getByTestId('helicopter-hide-empty-slots')
  await expect(button).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(button).not.toHaveCSS('color', 'rgb(231, 229, 228)')
  await button.hover()
  await expect(button).toHaveCSS('color', 'rgb(231, 229, 228)')
})

test('pending pause failure survives minimization and cannot be hidden by rail collapse', async ({ page }) => {
  await page.getByTestId('focus-mode-toggle').click()
  await page.evaluate(async () => {
    const path = '/src/features/mission/mission-store.ts'
    const { useMissionStore } = await import(path)
    const controller = useMissionStore.getState().controller
    useMissionStore.setState({ controller: { ...controller, pauseMission: () => new Promise((_resolve, reject) => {
      Object.assign(window, { rejectTestPause: () => reject(new Error('Test pause failed')) })
    }) } })
  })
  await page.getByTestId('mission-pause-resume-btn').click()
  await page.getByTestId('mission-control-collapse-btn').click()
  await expect(page.getByTestId('mission-control')).toBeHidden()
  await page.evaluate(() => (window as Window & { rejectTestPause: () => void }).rejectTestPause())
  await expect(page.getByTestId('mission-action-error')).toContainText('Test pause failed')
  await page.getByTestId('focus-sidebar-tab-layers').click()
  await expect(page.getByTestId('layer-panel-toggle')).toBeDisabled()
  await expect(page.getByTestId('mission-action-error')).toBeVisible()
})

test('archive recovery cannot be hidden by collapsing an idle rail', async ({ page }) => {
  await page.evaluate(async () => {
    const path = '/src/features/mission/mission-store.ts'
    const { useMissionStore } = await import(path)
    const mission = useMissionStore.getState().currentMission
    useMissionStore.setState({ phase: 'idle', currentMission: null, governanceMission: { ...mission, status: 'finalized', storage_state: 'recovery_required' } })
  })
  await page.getByTestId('sidebar-tab-layers').click()
  await expect(page.getByTestId('layer-panel-toggle')).toBeDisabled()
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
    let attempts = 0
    Object.assign(window, { sartrackerElectron: { archiveReview: { supported: false }, loadAppSettings: async () => {
      if (attempts++ === 0) throw new Error('Test roster unavailable')
      return { ...DEFAULT_APP_SETTINGS, missionDefaults: { ...DEFAULT_APP_SETTINGS.missionDefaults, adminRoster: ['Ops Lead'] } }
    } } })
    useMissionStore.setState({ phase: 'idle', currentMission: null, governanceMission: { ...mission, status: 'finalized', storage_state: 'live' } })
  })
  await page.getByTestId('mission-unlock-btn').click()
  await expect(page.getByText('Test roster unavailable', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retry admin roster' }).click()
  await expect(page.getByText('Test roster unavailable', { exact: true })).toBeHidden()
  await expect(page.getByTestId('mission-unlock-admin')).toHaveValue('Ops Lead')
  await page.keyboard.press('Escape')
  await page.evaluate(async () => {
    const path = '/src/features/mission/mission-store.ts'
    const { useMissionStore } = await import(path)
    useMissionStore.setState({ phase: 'active', currentMission: (window as Window & { testOriginalMission: unknown }).testOriginalMission, governanceMission: null })
  })
  await expect(page.getByTestId('mission-control-collapse-btn')).toBeVisible()
  await page.getByTestId('sidebar-tab-layers').click()
  await expect(page.getByTestId('layer-panel-toggle')).toBeEnabled()
})

test('paused alarm and Resume retain the uncapped dock at 1280x720 in both modes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByTestId('mission-pause-resume-btn').click()
  for (const focus of [false, true]) {
    if (focus) await page.getByTestId('focus-mode-toggle').click()
    const dock = page.getByTestId(focus ? 'focus-mode-mission-dock' : 'mission-control-dock')
    await expect(dock).toHaveCSS('max-height', 'none')
    await expect(page.getByTestId('mission-paused-banner')).toBeVisible()
    await expect(page.getByTestId('mission-paused-banner-resume-btn')).toBeInViewport()
    await expect(page.getByTestId('persistent-tracking-health')).toContainText('Mission paused')
  }
})

for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
  test(`reachable Devices Zoom and separate Focus scale at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__.injectTrackingSnapshot({
      devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: new Date().toISOString(), unique_id: null, category: 'person' }],
      positions: [{ id: 'alpha-fix', device_id: 'alpha', lat: 53.34912, lon: -6.26031, altitude: null, speed: null, battery: null, accuracy: null, timestamp: new Date().toISOString(), source: 'gps', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false }], breadcrumbs: [],
    }))
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('device-filter-tabs').locator('button')).toHaveCount(6)
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
    await page.getByTestId('focus-mode-toggle').click()
    const coordinate = await page.getByTestId('focus-mode-coordinate-mirror').boundingBox()
    const scale = await page.getByTestId('map-scale-readout').boundingBox()
    expect(coordinate).not.toBeNull()
    expect(scale).not.toBeNull()
    expect(coordinate!.x >= scale!.x + scale!.width || scale!.x >= coordinate!.x + coordinate!.width || coordinate!.y >= scale!.y + scale!.height || scale!.y >= coordinate!.y + coordinate!.height).toBe(true)
  })
}
