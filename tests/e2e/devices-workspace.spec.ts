import { expect, test } from '@playwright/test'

test.describe('M19 devices workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('Devices Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await seedTrackingWorkspace(page)
  })

  test('opens the dedicated workspace, renders the roster, and supports selection plus zoom', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByTestId('device-row-alpha')).toBeVisible()
    await expect(page.getByTestId('device-row-bravo')).toBeVisible()

    await page.getByTestId('device-row-bravo').click()
    await expect(page.getByTestId('devices-inspector-title')).toContainText('Bravo Team')
    await expect(page.getByTestId('devices-tracking-mode')).toContainText('offline')
    await expect(page.getByTestId('devices-tracking-warning')).toContainText('OFFLINE MODE')

    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('coordinate-target-indicator')).toContainText('Alpha Team')
  })

  test('keeps passive row clicks inside Devices instead of opening marker tools', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByTestId('devices-inspector-title')).toContainText('Alpha Team')

    await page.getByTestId('device-status-bravo').click()
    await page.getByTestId('device-last-seen-bravo').click()
    await page.getByTestId('device-source-bravo').click()

    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByTestId('devices-inspector-title')).toContainText('Bravo Team')
    await expect(page.getByTestId('tracking-status')).toBeVisible()
    await expect(page.getByTestId('marker-at-grid-panel')).toBeHidden()

    await page.getByTestId('device-zoom-alpha').click()

    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByTestId('tracking-status')).toBeVisible()
    await expect(page.getByTestId('marker-at-grid-panel')).toBeHidden()
    await expect(page.getByTestId('coordinate-target-indicator')).toContainText('Alpha Team')
  })

  test('keeps empty workspace clicks from opening Marker Details [DON-184]', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()

    const inspector = page.getByTestId('devices-inspector')
    await inspector.click({ position: { x: 24, y: 260 } })
    await clickInsideLowerListArea(page)

    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Marker Details' })).toBeHidden()
    await expect(page.getByTestId('marker-dialog')).toBeHidden()
  })

  test('toggles per-device visibility from the workspace', async ({ page }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('device-visibility-bravo')).toBeChecked()
    await page.getByTestId('device-visibility-bravo').click()
    await expect(page.getByTestId('device-visibility-bravo')).not.toBeChecked()
  })

  test('keeps selection and search scoped to the active device list [DON-190]', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByTestId('devices-inspector-title')).toContainText('Alpha Team')

    await page.getByTestId('device-active-toggle-bravo').click()
    await page.getByTestId('device-filter-active').click()

    await expect(page.getByTestId('device-row-bravo')).toBeVisible()
    await expect(page.getByTestId('device-row-alpha')).toBeHidden()
    await expect(page.getByTestId('devices-inspector-title')).toContainText('Bravo Team')

    await page.getByTestId('device-list-search').fill('Alpha')

    await expect(page.getByTestId('device-row-alpha')).toBeHidden()
    await expect(page.getByTestId('device-row-bravo')).toBeHidden()
    await expect(page.getByTestId('device-filter-empty-state')).toContainText(
      'No devices match Alpha in Active',
    )
    await expect(page.getByTestId('devices-inspector-title')).toBeHidden()
  })

  test('keeps selected device actions visible at constrained desktop width [DON-190]', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 720 })
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()

    const zoomButton = page.getByTestId('devices-inspector-zoom')
    await expect(zoomButton).toBeVisible()
    await expect(zoomButton).toBeInViewport()

    const boxes = await page.evaluate(() => {
      const inspector = document.querySelector('[data-testid="devices-inspector"]')
      const zoom = document.querySelector('[data-testid="devices-inspector-zoom"]')
      if (!(inspector instanceof HTMLElement) || !(zoom instanceof HTMLElement)) {
        throw new Error('Expected inspector and selected-device zoom button.')
      }
      const inspectorBox = inspector.getBoundingClientRect()
      const zoomBox = zoom.getBoundingClientRect()
      return {
        inspectorRight: inspectorBox.right,
        zoomRight: zoomBox.right,
        zoomLeft: zoomBox.left,
        inspectorLeft: inspectorBox.left,
      }
    })

    expect(boxes.zoomLeft).toBeGreaterThanOrEqual(boxes.inspectorLeft)
    expect(boxes.zoomRight).toBeLessThanOrEqual(boxes.inspectorRight + 1)
  })

  test('updates rendered breadcrumb colour, size, and global trail mode', async ({ page }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()

    await expect.poll(async () => readTrackingLayerState(page)).toMatchObject({
      lineWidth: 8,
      dotRadius: 4,
    })

    await page.getByTestId('device-breadcrumb-color-alpha').click()
    await page.getByTestId('device-color-option-FF7A00').click()
    await page.getByTestId('breadcrumb-size-control').fill('12')
    await page.getByTestId('breadcrumb-mode-dots').click()

    await expect(page.getByTestId('breadcrumb-size-label')).toContainText('12px dot diameter')
    await expect.poll(async () => formatTrackingLayerState(page)).toMatchObject({
      dotRadius: 6,
      alphaBreadcrumbColor: '#FF7A00',
      breadcrumbFeatureKind: 'breadcrumb',
      lineFilter: expect.stringContaining('__hidden__'),
      dotFilter: expect.stringContaining('breadcrumb'),
    })

    await page.getByTestId('breadcrumb-mode-line').click()
    await expect(page.getByTestId('breadcrumb-size-label')).toContainText('12px trail width')

    await expect.poll(async () => formatTrackingLayerState(page)).toMatchObject({
      lineWidth: 12,
      dotFilter: expect.stringContaining('__hidden__'),
      lineFilter: expect.stringContaining('breadcrumbLine'),
    })
  })

  test('renders sparse breadcrumb cadence as a connected trail [DON-189]', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      if (harness === undefined) {
        throw new Error('Browser harness API unavailable.')
      }

      const breadcrumbs = Array.from({ length: 6 }, (_entry, index) => ({
        id: `sparse-breadcrumb-${index + 1}`,
        device_id: 'alpha',
        lat: 51.997 + index * 0.004,
        lon: -9.746 - index * 0.006,
        altitude: null,
        speed: 2.5,
        battery: 84,
        accuracy: null,
        timestamp: new Date(Date.UTC(2026, 3, 10, 16, index * 6, 0)).toISOString(),
        source: null,
        data_origin: 'live' as const,
        cache_age_seconds: null,
        device_cache_stale: false,
      }))

      await harness.injectTrackingSnapshot({
        devices: [
          {
            device_id: 'alpha',
            name: 'Alpha Team',
            status: 'online',
            last_seen: '2026-04-10T17:00:00.000Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [
          {
            id: 'pos-alpha',
            device_id: 'alpha',
            lat: 52.017,
            lon: -9.776,
            altitude: null,
            speed: 3.5,
            battery: 82,
            accuracy: null,
            timestamp: '2026-04-10T17:00:00.000Z',
            source: null,
            data_origin: 'live',
            cache_age_seconds: null,
            device_cache_stale: false,
          },
        ],
        breadcrumbs,
      })
    })

    await expect.poll(async () => readSparseBreadcrumbLine(page)).toMatchObject({
      hasLine: true,
      coversSparseTrail: true,
    })
  })
})

async function clickInsideLowerListArea(page: import('@playwright/test').Page) {
  const list = page.getByTestId('device-list-scroll')
  const box = await list.boundingBox()
  if (box === null) {
    throw new Error('Device list scroll area is unavailable.')
  }

  await list.click({
    position: {
      x: Math.min(320, Math.max(8, box.width - 8)),
      y: Math.max(8, box.height - 8),
    },
  })
}

async function formatTrackingLayerState(page: import('@playwright/test').Page) {
  const state = await readTrackingLayerState(page)

  return {
    ...state,
    lineFilter: JSON.stringify(state.lineFilter),
    dotFilter: JSON.stringify(state.dotFilter),
  }
}

async function readTrackingLayerState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          getFilter: (layerId: string) => unknown
          getLayer: (layerId: string) => unknown
          getPaintProperty: (layerId: string, property: string) => unknown
          getSource: (sourceId: string) => unknown
        }
      }
    ).__SARTRACKER_MAP__

    if (map === undefined) {
      throw new Error('Map instance is unavailable.')
    }

    const alphaBreadcrumb = map.queryRenderedFeatures(undefined, {
      layers: ['tracking-breadcrumbs-dots'],
    }).find(
      (feature) =>
        feature.properties?.deviceId === 'alpha' &&
        feature.properties.featureKind === 'breadcrumb',
    )

    return {
      lineFilter: map.getLayer('tracking-breadcrumbs-line') === undefined
        ? null
        : map.getFilter('tracking-breadcrumbs-line'),
      dotFilter: map.getLayer('tracking-breadcrumbs-dots') === undefined
        ? null
        : map.getFilter('tracking-breadcrumbs-dots'),
      lineWidth: map.getLayer('tracking-breadcrumbs-line') === undefined
        ? null
        : map.getPaintProperty('tracking-breadcrumbs-line', 'line-width'),
      dotRadius: map.getLayer('tracking-breadcrumbs-dots') === undefined
        ? null
        : map.getPaintProperty('tracking-breadcrumbs-dots', 'circle-radius'),
      alphaBreadcrumbColor: alphaBreadcrumb?.properties?.color,
      breadcrumbFeatureKind: alphaBreadcrumb?.properties?.featureKind,
    }
  })
}

async function readSparseBreadcrumbLine(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          getSource: (sourceId: string) => unknown
          querySourceFeatures: (sourceId: string) => Array<{
            geometry?: { type?: string; coordinates?: unknown[] }
            properties?: { featureKind?: string; deviceId?: string }
          }>
        }
      }
    ).__SARTRACKER_MAP__

    const source = map?.getSource('tracking')
    const features = source === undefined ? [] : (map?.querySourceFeatures('tracking') ?? [])
    const lineFeatures =
      features.filter(
        (feature) =>
          feature.properties?.featureKind === 'breadcrumbLine' &&
          feature.properties.deviceId === 'alpha' &&
          feature.geometry?.type === 'LineString',
      ) ?? []

    return {
      lineCount: lineFeatures.length,
      coordinateCount: lineFeatures.reduce(
        (total, feature) => total + (feature.geometry?.coordinates?.length ?? 0),
        0,
      ),
      hasLine: lineFeatures.length > 0,
      coversSparseTrail:
        lineFeatures.reduce(
          (total, feature) => total + (feature.geometry?.coordinates?.length ?? 0),
          0,
        ) >= 6,
    }
  })
}

async function seedTrackingWorkspace(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const harness = window.__SARTRACKER_BROWSER_HARNESS__
    if (harness === undefined) {
      throw new Error('Browser harness API unavailable.')
    }

    await harness.injectTrackingSnapshot(
      {
        devices: [
          {
            device_id: 'alpha',
            name: 'Alpha Team',
            status: 'online',
            last_seen: '2026-04-10T17:00:00.000Z',
            unique_id: null,
            category: null,
          },
          {
            device_id: 'bravo',
            name: 'Bravo Team',
            status: 'offline',
            last_seen: '2026-04-10T16:40:00.000Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [
          {
            id: 'pos-alpha',
            device_id: 'alpha',
            lat: 51.99917,
            lon: -9.74406,
            altitude: null,
            speed: 3.5,
            battery: 82,
            accuracy: null,
            timestamp: '2026-04-10T17:00:00.000Z',
            source: null,
            data_origin: 'live',
            cache_age_seconds: null,
            device_cache_stale: false,
          },
          {
            id: 'pos-bravo',
            device_id: 'bravo',
            lat: 52.05944,
            lon: -9.50722,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            timestamp: '2026-04-10T16:40:00.000Z',
            source: null,
            data_origin: 'cache',
            cache_age_seconds: 1200,
            device_cache_stale: true,
          },
        ],
        breadcrumbs: [
          {
            id: 'breadcrumb-alpha-1',
            device_id: 'alpha',
            lat: 51.9975,
            lon: -9.7462,
            altitude: null,
            speed: 2.5,
            battery: 84,
            accuracy: null,
            timestamp: '2026-04-10T16:50:00.000Z',
            source: null,
            data_origin: 'live',
            cache_age_seconds: null,
            device_cache_stale: false,
          },
          {
            id: 'breadcrumb-alpha-2',
            device_id: 'alpha',
            lat: 51.9982,
            lon: -9.7451,
            altitude: null,
            speed: 2.9,
            battery: 83,
            accuracy: null,
            timestamp: '2026-04-10T16:55:00.000Z',
            source: null,
            data_origin: 'live',
            cache_age_seconds: null,
            device_cache_stale: false,
          },
        ],
      },
      {
        mode: 'offline',
        consecutiveFailures: 1,
        recovered: false,
        lastSuccessAt: '2026-04-10T17:00:00.000Z',
        warning: 'OFFLINE MODE — showing last known positions.',
      },
    )
  })
}
