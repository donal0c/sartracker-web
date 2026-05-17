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
