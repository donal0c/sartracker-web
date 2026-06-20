/**
 * V1 Regression E2E Coverage (sartracker-web-8gw)
 *
 * Pins user-visible regressions that have already been fixed once in this
 * codebase. Each test should fail red if its specific fix is reverted.
 *
 * Scope:
 *  - tracking layer per-device visibility actually flips MapLibre filter state
 *  - cold-start-offline shows a clear "showing last known positions" warning
 *    before the first live poll succeeds
 */
import { expect, test, type Page } from '@playwright/test'

async function waitForShell(page: Page) {
  const title = page.getByTestId('app-title')
  await title.waitFor({ state: 'visible', timeout: 10_000 })
  await expect(title).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 15_000 })
}

async function readMapFilterState(page: Page) {
  return page.evaluate(() => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          getLayer: (layerId: string) => unknown
          getFilter: (layerId: string) => unknown
        }
      }
    ).__SARTRACKER_MAP__

    if (map === undefined) {
      throw new Error('Map instance is unavailable.')
    }

    const readFilter = (layerId: string) =>
      map.getLayer(layerId) === undefined ? null : (map.getFilter(layerId) ?? null)

    return {
      trackingDevicesCircle: readFilter('tracking-devices-circle'),
      trackingDevicesLabel: readFilter('tracking-devices-label'),
      trackingDevicesHalo: readFilter('tracking-devices-halo'),
    }
  })
}

async function seedTrackingDevices(page: Page) {
  await page.evaluate(async () => {
    const { applyTrackingSnapshot } = await import('/src/features/tracking/tracking-store.ts')
    applyTrackingSnapshot({
      devices: [
        {
          device_id: 'alpha',
          name: 'Alpha Team',
          status: 'online',
          last_seen: '2026-04-09T16:00:00.000Z',
          unique_id: null,
          category: null,
        },
        {
          device_id: 'bravo',
          name: 'Bravo Team',
          status: 'online',
          last_seen: '2026-04-09T15:50:00.000Z',
          unique_id: null,
          category: null,
        },
      ],
      positions: [
        {
          id: 'pos-alpha',
          device_id: 'alpha',
          lat: 51.95,
          lon: -9.85,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-04-09T16:00:00.000Z',
          source: null,
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'pos-bravo',
          device_id: 'bravo',
          lat: 51.96,
          lon: -9.84,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-04-09T15:50:00.000Z',
          source: null,
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
      breadcrumbs: [],
    })
  })
}

test.describe('V1 regression: cold-start-offline operator-visible warning', () => {
  test.setTimeout(45_000)

  test('operator sees an explicit "showing last known positions" warning when only cached tracking is available', async ({
    page,
  }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await page.getByTestId('mission-name-input').fill('Cold Start Offline Test')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    // Simulate cold-start-from-cache: snapshot + status the runtime would publish
    // when start-tracking-runtime hydrates from a usable cache and no live poll
    // has succeeded yet.
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot, applyTrackingStatus }] = await Promise.all([
        import('/src/features/tracking/tracking-store.ts'),
      ])
      applyTrackingSnapshot({
        devices: [
          {
            device_id: 'cached-1',
            name: 'Cached Team',
            status: 'online',
            last_seen: '2026-04-09T15:50:00.000Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [
          {
            id: 'cached-pos-1',
            device_id: 'cached-1',
            lat: 51.95,
            lon: -9.85,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            timestamp: '2026-04-09T15:50:00.000Z',
            source: null,
            data_origin: 'cache' as const,
            cache_age_seconds: 120,
            device_cache_stale: false,
          },
        ],
        breadcrumbs: [],
      })
      applyTrackingStatus({
        mode: 'offline',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: '2026-04-09T15:50:00.000Z',
        warning: 'OFFLINE MODE — showing last known positions from cache.',
      })
    })

    // Tracking status panel sits in the default sidebar tab; click it to reveal.
    await page.getByTestId('sidebar-tab-tracking').click().catch(() => {
      // Tab may already be active or named differently in some layouts; the
      // panel should still be findable below.
    })

    const trackingStatus = page.getByTestId('tracking-status')
    await expect(trackingStatus).toBeVisible({ timeout: 5_000 })
    // The warning copy should clearly tell the operator they are looking at
    // last known positions, not a live feed. Match on a stable phrase rather
    // than the full sentence so future copy tweaks don't break the regression.
    await expect(trackingStatus).toContainText(/last known positions/i)
    await expect(trackingStatus).toContainText(/offline/i)
    await expect(page.getByTestId('tracking-mode-chip')).toHaveClass(/sar-status-chip-alert/)
    await expect(page.getByTestId('tracking-warning')).toHaveClass(/sar-status-alert-panel/)
  })
})

test.describe('Mast tracking cell never reads as a positions/stale ratio (sartracker-web-zq9)', () => {
  test.setTimeout(45_000)

  test('the mast splits FIX and STALE into separate values', async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await page.getByTestId('mission-name-input').fill('Mast Tracking Ratio Regression')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    // Two healthy positions, one stale-cached. Pre-fix this rendered as the
    // visually impossible "ONLINE 3/1" ratio in the mast.
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot, applyTrackingStatus }] = await Promise.all([
        import('/src/features/tracking/tracking-store.ts'),
      ])
      applyTrackingSnapshot({
        devices: [
          { device_id: 'd1', name: 'Team 1', status: 'online', last_seen: '2026-04-09T16:00:00.000Z', unique_id: null, category: null },
          { device_id: 'd2', name: 'Team 2', status: 'online', last_seen: '2026-04-09T15:50:00.000Z', unique_id: null, category: null },
          { device_id: 'd3', name: 'Team 3', status: 'offline', last_seen: '2026-04-09T15:00:00.000Z', unique_id: null, category: null },
        ],
        positions: [
          { id: 'p1', device_id: 'd1', lat: 51.95, lon: -9.85, altitude: null, speed: null, battery: null, accuracy: null, timestamp: '2026-04-09T16:00:00.000Z', source: null, data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false },
          { id: 'p2', device_id: 'd2', lat: 51.96, lon: -9.84, altitude: null, speed: null, battery: null, accuracy: null, timestamp: '2026-04-09T15:50:00.000Z', source: null, data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false },
          { id: 'p3', device_id: 'd3', lat: 51.97, lon: -9.83, altitude: null, speed: null, battery: null, accuracy: null, timestamp: '2026-04-09T15:00:00.000Z', source: null, data_origin: 'cache' as const, cache_age_seconds: 600, device_cache_stale: true },
        ],
        breadcrumbs: [],
      })
      applyTrackingStatus({ mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: '2026-04-09T16:00:01.000Z', warning: null })
    })

    const cell = page.getByTestId('mast-tracking-cell')
    await expect(cell).toBeVisible()
    await expect(page.getByTestId('mast-tracking-mode')).toHaveText('ONLINE')
    await expect(page.getByTestId('mast-tracking-fix-value')).toHaveText('3')
    await expect(page.getByTestId('mast-tracking-stale-value')).toHaveText('1')
    // Defends against the pre-fix `${positions.length}/${staleCount}` regression
    // that produced impossible ratios such as "3/1" inside the cell.
    const cellText = (await cell.textContent()) ?? ''
    expect(cellText).not.toMatch(/\b\d+\s*\/\s*\d+\b/)
  })

  test('idle state shows zero fix and zero stale with no ratio chrome', async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)

    const cell = page.getByTestId('mast-tracking-cell')
    await expect(cell).toBeVisible()
    await expect(page.getByTestId('mast-tracking-mode')).toHaveText('IDLE')
    await expect(page.getByTestId('mast-tracking-fix-value')).toHaveText('0')
    await expect(page.getByTestId('mast-tracking-stale-value')).toHaveText('0')
    const cellText = (await cell.textContent()) ?? ''
    expect(cellText).not.toMatch(/\b\d+\s*\/\s*\d+\b/)
  })
})

test.describe('V1 regression: tracking visibility filter through to MapLibre', () => {
  test.setTimeout(45_000)

  test('hiding a single tracking device updates the MapLibre device-circle filter', async ({
    page,
  }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await page.getByTestId('mission-name-input').fill('Tracking Visibility Test')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await seedTrackingDevices(page)

    // Wait for the catalog to surface both devices.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const { useLayerCatalogStore } = await import(
              '/src/features/layers/layer-catalog-store.ts'
            )
            return useLayerCatalogStore
              .getState()
              .root.children.flatMap((group) => group.children)
              .flatMap((layer) => layer.children.map((feature) => feature.id))
          }),
        { timeout: 10_000 },
      )
      .toEqual(expect.arrayContaining(['feature:device:alpha', 'feature:device:bravo']))

    await page.getByTestId('sidebar-tab-layers').click()

    // Confirm baseline: the MapLibre filter does not exclude bravo.
    const baseline = await readMapFilterState(page)
    expect(JSON.stringify(baseline.trackingDevicesCircle)).not.toContain('bravo')

    // Click the per-device visibility toggle for bravo.
    const bravoToggle = page.getByTestId('layer-visibility-feature-device-bravo')
    await expect(bravoToggle).toBeVisible({ timeout: 10_000 })
    await bravoToggle.click()

    // The device-circle filter must now include bravo in the !in list.
    await expect
      .poll(
        async () => JSON.stringify((await readMapFilterState(page)).trackingDevicesCircle),
        { timeout: 5_000 },
      )
      .toContain('bravo')
    // Alpha must remain visible.
    expect(JSON.stringify((await readMapFilterState(page)).trackingDevicesCircle)).not.toContain(
      '"alpha"',
    )

    // Re-show: filter no longer mentions bravo.
    await bravoToggle.click()
    await expect
      .poll(
        async () => JSON.stringify((await readMapFilterState(page)).trackingDevicesCircle),
        { timeout: 5_000 },
      )
      .not.toContain('bravo')
  })
})
