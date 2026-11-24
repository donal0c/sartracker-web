import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { openMissionPanel, openMissionReview, openWorkspacePanel } from './helpers/workspace-panels'

test.describe('M19 devices workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Devices Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    await seedTrackingWorkspace(page)
    // Start leaves the map clear (DON-368); Open Devices is in People.
    await openWorkspacePanel(page, 'people')
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

  test('unmounts the workspace immediately when the operator closes it [DON-260]', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    const dialog = page.getByRole('dialog', { name: 'Tracking Devices' })
    await expect(dialog).toBeVisible()

    await page.getByTestId('workspace-close-btn').click()

    await expect(page.getByTestId('devices-workspace')).toHaveCount(0, {
      timeout: 200,
    })
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Close workspace' })).toHaveCount(0)
  })

  test('stays closed while tracking status repeatedly changes layout [DON-262]', async ({
    page,
  }) => {
    const opener = page.getByTestId('open-devices-workspace')
    const dialog = page.getByRole('dialog', { name: 'Tracking Devices' })

    await opener.click()
    await expect(dialog).toBeVisible()
    await page.getByTestId('workspace-close-btn').click()
    await expect(dialog).toHaveCount(0)

    for (let index = 0; index < 20; index += 1) {
      await page.evaluate(async (warning) => {
        const harness = window.__SARTRACKER_BROWSER_HARNESS__
        if (harness === undefined) {
          throw new Error('Browser harness API unavailable.')
        }
        const state = harness.readState()
        await harness.hydrateTracking()
        await harness.injectTrackingSnapshot(
          {
            devices: [],
            positions: [],
            breadcrumbs: [],
          },
          {
            mode: 'online',
            consecutiveFailures: 0,
            recovered: false,
            lastSuccessAt: new Date().toISOString(),
            warning,
          },
        )
        if (state.currentMissionId === null) {
          throw new Error('Expected an active browser-harness mission.')
        }
      }, index % 2 === 0 ? 'Current fixes loaded; loading breadcrumb history.' : null)
    }

    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeVisible()
    await expect(opener).toBeFocused()
  })

  for (const width of [1280, 1024]) {
  test(`keeps the Open Devices pointer target fixed while tracking messages change, ${width} px wide [DON-261]`, async ({
    page,
  }) => {
    // A long message wrapped to two lines on Linux fonts in CI, growing the top
    // bar and moving the panel; 1024 px makes it long enough to wrap anywhere.
    await page.setViewportSize({ width, height: 720 })
    const opener = page.getByTestId('open-devices-workspace')
    // Measured on screen: the TRACKING LOST alarm runs across the map, so
    // nothing under the pointer may move when it appears (DON-341).
    const screenTop = async () => {
      const box = await opener.boundingBox()
      if (box === null) {
        throw new Error('Open Devices pointer target disappeared.')
      }
      return box.y
    }

    const observedTops = [await screenTop()]
    for (const warning of [
      null,
      'Current fixes loaded; loading breadcrumb history.',
      'OFFLINE MODE — showing last known positions.',
      null,
    ]) {
      await page.evaluate(async (nextWarning) => {
        const harness = window.__SARTRACKER_BROWSER_HARNESS__
        if (harness === undefined) {
          throw new Error('Browser harness API unavailable.')
        }
        await harness.injectTrackingSnapshot(
          {
            devices: [],
            positions: [],
            breadcrumbs: [],
          },
          {
            mode: nextWarning?.startsWith('OFFLINE') ? 'offline' : 'online',
            consecutiveFailures: nextWarning?.startsWith('OFFLINE') ? 1 : 0,
            recovered: false,
            lastSuccessAt: new Date().toISOString(),
            warning: nextWarning,
          },
        )
        await new Promise((resolve) => window.requestAnimationFrame(resolve))
      }, warning)
      observedTops.push(await screenTop())
    }

    expect(Math.max(...observedTops) - Math.min(...observedTops)).toBeLessThan(0.5)
  })
  }

  // Font widths differ by OS: the team's Linux laptops draw wider than macOS.
  // Verdana (macOS, Windows) and DejaVu Sans (Linux) are the wide case.
  for (const font of [null, 'Verdana, "DejaVu Sans", sans-serif'] as const) {
  test(`shows every tracking problem in full at 1024 px, with the pointer target fixed${font === null ? '' : ', in a wide font'} [DON-261]`, async ({ page }) => {
    // Runtime warnings can put a reassuring sentence first and add counts after
    // it. An ellipsis on one long line hid the problems behind "…"; these are
    // amber states with no separate red alarm, so they must stay readable.
    if (font !== null) await page.addStyleTag({ content: `:root, button { font-family: ${font} !important; }` })
    await page.setViewportSize({ width: 1024, height: 720 })
    const opener = page.getByTestId('open-devices-workspace')
    const topBefore = (await opener.boundingBox())?.y
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot, applyTrackingStatus }, { applyCurrentPositionRejections }] = await Promise.all([
        import('/src/features/tracking/tracking-store.ts'),
        import('/src/features/tracking/ingest-health-store.ts'),
      ])
      const position = (id: string) => ({
        id: `${id}-current`, device_id: id, lat: 51.9985, lon: -9.7426, altitude: 320, speed: 1, battery: 85,
        accuracy: 8, timestamp: new Date().toISOString(), timestamp_source: 'server' as const, source: 'osmand',
        data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: true,
      })
      applyTrackingSnapshot({ devices: [], positions: [position('alpha'), position('bravo')], breadcrumbs: [] })
      applyTrackingStatus({
        mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: new Date().toISOString(),
        warning: 'Current fixes loaded; refreshing device roster. BREADCRUMB HISTORY REFRESH FAILED — current fixes remain live; exact history will retry.',
        warningCodes: ['roster_refreshing', 'history_refresh_failed'],
      })
      applyCurrentPositionRejections([{ deviceId: 'alpha', reason: 'invalid_coordinates', rowIndex: 1 }])
    })

    const problems = page.getByTestId('ws-tracking-problems')
    await expect(problems).toHaveText('2 stale · 1 rejected · History failed')
    const clipped = await problems.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const bar = element.closest('[data-testid="ws-tracking-headline"]')?.getBoundingClientRect()
      return element.scrollWidth > element.clientWidth + 0.5 || bar === undefined || box.right > bar.right + 0.5
    })
    expect(clipped).toBe(false)
    expect((await opener.boundingBox())?.y).toBe(topBefore)
  })
  }

  test('makes workspace controls actionable immediately when opened [DON-260]', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    const closeButton = page.getByTestId('workspace-close-btn')

    const receivesPointerAtCentre = await closeButton.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return hit === element || (hit !== null && element.contains(hit))
    })
    expect(receivesPointerAtCentre).toBe(true)
  })

  test('preserves modal focus across a rapid close and reopen [DON-260]', async ({
    page,
  }) => {
    const opener = page.getByTestId('open-devices-workspace')
    const closeButton = page.getByTestId('workspace-close-btn')
    const dialog = page.getByRole('dialog', { name: 'Tracking Devices' })

    await opener.click()
    await expect(dialog).toBeVisible()
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)

    await closeButton.click()
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()

    await opener.click()
    await expect(dialog).toBeVisible()
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
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
    // Was the Tracking tab beside Devices; tracking health now stays in the top bar (DON-341).
    await expect(page.getByTestId('ws-tracking-headline')).toBeVisible()
    await expect(page.getByTestId('marker-at-grid-panel')).toBeHidden()

    await page.getByTestId('device-zoom-alpha').click()

    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByTestId('ws-tracking-headline')).toBeVisible()
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

  test('offers no control that narrows the mission participants [DON-295]', async ({ page }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()

    await expect(page.getByTestId('device-row-alpha')).toBeVisible()
    await expect(page.getByTestId('device-row-bravo')).toBeVisible()
    await expect(page.locator('[data-testid^="device-active-toggle-"]')).toHaveCount(0)
    await expect(page.getByTestId('device-filter-active')).toHaveCount(0)
  })

  test('keeps selection and search scoped to the current filter list [DON-190]', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()
    await expect(page.getByTestId('devices-inspector-title')).toContainText('Alpha Team')

    await page.getByTestId('device-visibility-bravo').click()
    await page.getByTestId('device-filter-hidden').click()

    await expect(page.getByTestId('device-row-bravo')).toBeVisible()
    await expect(page.getByTestId('device-row-alpha')).toBeHidden()
    await expect(page.getByTestId('devices-inspector-title')).toContainText('Bravo Team')

    await page.getByTestId('device-list-search').fill('Alpha')

    await expect(page.getByTestId('device-row-alpha')).toBeHidden()
    await expect(page.getByTestId('device-row-bravo')).toBeHidden()
    await expect(page.getByTestId('device-filter-empty-state')).toContainText(
      'No devices match Alpha in Hidden',
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

    // Tracking is offline here, so the TRACKING LOST alarm shows and the workspace
    // starts below it (DON-341): at 720 px high the inspector scrolls down to Zoom.
    // Scroll vertically only, after the width checks, so sideways overflow cannot hide.
    await page.getByTestId('devices-inspector').evaluate((inspector) => {
      const zoom = inspector.querySelector('[data-testid="devices-inspector-zoom"]')
      if (zoom === null) throw new Error('Expected the selected-device zoom button.')
      inspector.scrollTop += zoom.getBoundingClientRect().bottom - inspector.getBoundingClientRect().bottom + 16
    })
    await expect(zoomButton).toBeInViewport()
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

    await expect(page.getByTestId('breadcrumb-size-label')).toContainText(
      '12px dot diameter and trail width',
    )
    await expect(page.getByTestId('breadcrumb-mode-description')).toContainText(
      'The line still shows the whole trail.',
    )
    // DON-338: the whole-trail line stays drawn underneath the exact dots.
    await expect.poll(async () => formatTrackingLayerState(page)).toMatchObject({
      dotRadius: 6,
      lineWidth: 12,
      alphaBreadcrumbColor: '#FF7A00',
      breadcrumbFeatureKind: 'breadcrumb',
      lineFilter: expect.stringContaining('breadcrumbLine'),
      dotFilter: expect.stringContaining('breadcrumb'),
    })
    expect((await formatTrackingLayerState(page)).lineFilter).not.toContain('__hidden__')

    await page.getByTestId('breadcrumb-mode-line').click()
    await expect(page.getByTestId('breadcrumb-size-label')).toContainText('12px trail width')
    await expect(page.getByTestId('breadcrumb-mode-description')).toContainText(
      'The line shows the whole trail of each device.',
    )

    await expect.poll(async () => formatTrackingLayerState(page)).toMatchObject({
      lineWidth: 12,
      dotFilter: expect.stringContaining('__hidden__'),
      lineFilter: expect.stringContaining('breadcrumbLine'),
    })
  })

  test('renders every retained fix as a dot even when positions are tightly grouped [DON-259]', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await page.getByTestId('breadcrumb-mode-dots').click()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('devices-workspace')).toBeHidden()

    const expectedCoordinates = await page.evaluate(async () => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      if (harness === undefined) {
        throw new Error('Browser harness API unavailable.')
      }

      const fixBaseMs = Date.now() + 1_000
      const breadcrumbs = Array.from({ length: 4 }, (_entry, index) => ({
        id: `grouped-breadcrumb-${index + 1}`,
        device_id: 'alpha',
        lat: 51.997 + index * 0.00001,
        lon: -9.746 - index * 0.00001,
        altitude: null,
        speed: 2.5,
        battery: 84,
        accuracy: null,
        timestamp: new Date(fixBaseMs + index * 5_000).toISOString(),
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
            last_seen: '2026-07-19T12:14:15.000Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [],
        breadcrumbs,
      })

      return breadcrumbs.map(
        (position) => `${position.lon.toFixed(5)}:${position.lat.toFixed(5)}`,
      ).sort()
    })

    await expect.poll(async () =>
      readAlphaBreadcrumbCoordinateKeys(page, 'grouped-breadcrumb-'),
    ).toEqual(
      expectedCoordinates,
    )
  })

  test('renders sparse breadcrumb cadence as a connected trail [DON-189]', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await page.getByTestId('breadcrumb-mode-line').click()
    await page.getByTestId('workspace-close-btn').click()
    await expect(page.getByTestId('devices-workspace')).toBeHidden()

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

    await expect
      .poll(async () => readSparseBreadcrumbLine(page), { timeout: 15_000 })
      .toMatchObject({
        hasLine: true,
        coversSparseTrail: true,
      })
    await page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      map.fitBounds([[-9.776, 51.997], [-9.746, 52.017]], { padding: 60, duration: 0 })
    })
    // Check every fixture vertex and each segment midpoint in the rendered layer,
    // independently of source vertex counts and viewport-dependent tile clipping.
    await expect.poll(() => page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      return Array.from({ length: 11 }, (_, index) => {
        const point = map.project([-9.746 - index * 0.003, 51.997 + index * 0.002])
        return map.queryRenderedFeatures([[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]], { layers: ['tracking-breadcrumbs-line'] })
          .some((feature) => feature.properties.deviceId === 'alpha' && feature.properties.featureKind === 'breadcrumbLine')
      }).filter(Boolean).length
    }), { timeout: 15_000 }).toBe(11)
  })
})

test.describe('All devices docked after Zoom [DON-368]', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForSelector('canvas', { timeout: 15000 })
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Docked Devices Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    await seedTrackingWorkspace(page)
    await openWorkspacePanel(page, 'people')
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('devices-workspace')).toBeVisible()
  })

  test('puts the zoomed device in the map that is still visible beside the docked list, with People open', async ({ page }) => {
    await page.getByTestId('device-zoom-bravo').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()
    await expect(page.getByTestId('coordinate-target-indicator')).toContainText('Bravo Team')

    // Wait for the camera to settle, then check the device is right of the dock
    // and inside the map canvas, not underneath the list.
    await expect.poll(() => targetPlacement(page, [-9.50722, 52.05944]), { timeout: 15_000 }).toBe('visible')
  })

  test('keeps a device near the western map boundary visible beside the docked list', async ({ page }) => {
    await page.evaluate(async () => {
      const now = new Date().toISOString()
      await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(
        {
          devices: [{ device_id: 'edge', name: 'Edge Team', status: 'online', last_seen: now, unique_id: null, category: null }],
          positions: [{
            id: 'pos-edge', device_id: 'edge', lat: 52.05, lon: -10.84, altitude: null, speed: null, battery: null,
            accuracy: null, timestamp: now, source: null, data_origin: 'live', cache_age_seconds: null, device_cache_stale: false,
          }],
          breadcrumbs: [],
        },
        { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: now, warning: null },
      )
    })
    await page.getByTestId('device-zoom-edge').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()
    await expect.poll(() => targetPlacement(page, [-10.84, 52.05]), { timeout: 15_000 }).toBe('visible')
  })

  test('says No position beside a device without a position, never green Online alone', async ({ page }) => {
    await page.evaluate(async () => {
      const now = new Date().toISOString()
      await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(
        {
          devices: [
            { device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: now, unique_id: null, category: null },
            { device_id: 'nofix', name: 'Charlie Team', status: 'online', last_seen: now, unique_id: null, category: null },
          ],
          positions: [{
            id: 'pos-alpha', device_id: 'alpha', lat: 51.99917, lon: -9.74406, altitude: null, speed: null, battery: null,
            accuracy: null, timestamp: now, source: null, data_origin: 'live', cache_age_seconds: null, device_cache_stale: false,
          }],
          breadcrumbs: [],
        },
        { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: now, warning: null },
      )
    })
    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()

    await expect(page.getByTestId('device-trust-nofix')).toBeVisible()
    await expect(page.getByTestId('device-trust-nofix')).toHaveText('No position')
    await expect(page.getByTestId('device-status-nofix')).not.toHaveClass(/text-emerald/)
    // A live position needs no extra words.
    await expect(page.getByTestId('device-trust-alpha')).toHaveCount(0)
  })

  test('leaves the coordinate readouts and Map Tools uncovered beside the docked list', async ({ page }) => {
    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()
    for (const testId of ['coords-grid', 'coords-wgs84', 'coords-dms', 'drawing-toolbar']) {
      await expect.poll(() => page.evaluate((id) => {
        const element = document.querySelector(`[data-testid="${id}"]`)
        const dock = document.querySelector('[data-testid="devices-workspace"]')?.closest('[role="dialog"]')
        if (element === null || dock === null || dock === undefined) return 'missing'
        const box = element.getBoundingClientRect()
        if (box.width === 0) return 'not drawn'
        const x = box.left + Math.min(box.width, 40) / 2
        const y = box.top + box.height / 2
        const top = document.elementFromPoint(x, y)
        if (top === null || dock.contains(top)) return `covered by the dock at ${Math.round(x)},${Math.round(y)}`
        // Not clipped by an overflow-hidden parent either.
        let parent = element.parentElement
        while (parent !== null) {
          const style = getComputedStyle(parent)
          if (style.overflow !== 'visible' || style.overflowX !== 'visible') {
            const clip = parent.getBoundingClientRect()
            if (box.left < clip.left - 1 || box.right > clip.right + 1) return `clipped by ${parent.dataset.testid ?? parent.className}`
          }
          parent = parent.parentElement
        }
        return 'visible'
      }, testId), { timeout: 10_000, message: testId }).toBe('visible')
    }
    // The readouts wrap onto more rows here, so the map scale must sit above the taller bar.
    await expect.poll(() => page.evaluate(() => {
      const scale = document.querySelector('[data-testid="map-scale-readout"]')?.getBoundingClientRect()
      const bar = document.querySelector('[data-testid="coordinate-display"]')?.getBoundingClientRect()
      if (scale === undefined || bar === undefined) return 'missing'
      return scale.bottom <= bar.top ? 'clear' : `scale bottom ${Math.round(scale.bottom)} overlaps bar top ${Math.round(bar.top)}`
    }), { timeout: 10_000 }).toBe('clear')
  })

  test('fits the open Map Tools panels inside the map beside the docked list', async ({ page }) => {
    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()
    await expectMapToolsPanelsInsideMap(page)
    await expectMapScaleClear(page, 'All devices docked at 1366')
  })

  test('[Codex r2] keeps the GPX coverage notice clear of the scale and Map Tools when the coordinate bar wraps', async ({ page }) => {
    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()
    await page.evaluate(async () => {
      const { useGpxStore } = await import('/src/features/gpx/gpx-store.ts')
      useGpxStore.setState({ mapCoverageNotice: 'Layout fixture: 2 of 5 GPX tracks are not shown on the map.' })
    })
    await expect(page.getByTestId('gpx-map-coverage-notice')).toBeVisible()
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('[data-testid="coordinate-display"]')?.getBoundingClientRect().height ?? 0)))
      .toBeGreaterThan(80)
    await expectMapScaleClear(page, 'GPX notice, Map Tools closed')
    await expect.poll(() => uncovered(page, 'gpx-map-coverage-notice'), { timeout: 10_000 }).toBe('uncovered')
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-measure').click()
    await expectMapScaleClear(page, 'GPX notice, Measure open')
    await expect.poll(() => page.evaluate(() => {
      const tools = document.querySelector('[data-testid="drawing-toolbar"]')?.getBoundingClientRect()
      const notice = document.querySelector('[data-testid="gpx-map-coverage-notice"]')?.getBoundingClientRect()
      if (tools === undefined || notice === undefined) return 'missing'
      const meets = tools.left < notice.right && notice.left < tools.right && tools.top < notice.bottom && notice.top < tools.bottom
      return meets ? `Map Tools ends ${Math.round(tools.bottom)}, notice starts ${Math.round(notice.top)}` : 'apart'
    }), { timeout: 10_000 }).toBe('apart')
    await expect.poll(() => uncovered(page, 'gpx-map-coverage-notice'), { timeout: 10_000 }).toBe('uncovered')
  })

  test('[Codex r1] keeps a map warning readable over the scale and open Map Tools beside the docked list', async ({ page }) => {
    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()
    await raiseTrackingOverlayWarning(page)
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-measure').click()
    await expect(page.locator('.sar-map-tools-body')).toHaveAttribute('data-panel-open', 'true')
    await expectMapWarningsOnTop(page, 'All devices docked at 1366 with Measure open')
  })

  test('keeps the map warnings above the wrapped coordinate bar beside the docked list', async ({ page }) => {
    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()
    await page.evaluate(async () => {
      const [{ useMapOverlayWarningStore }, { createMapOverlaySyncWarning }] = await Promise.all([
        import('/src/features/map/map-overlay-warning-store.ts'),
        import('/src/lib/map-health.ts'),
      ])
      const warning = createMapOverlaySyncWarning('tracking', 'tracking')
      useMapOverlayWarningStore.getState().raiseWarning({ ...warning, registrationId: 'layout-fixture-tracking' as typeof warning.registrationId })
    })
    await expect(page.getByTestId('map-degraded-alert')).toBeVisible()
    // The bar must really have wrapped past the old fixed 80 px clearance.
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('[data-testid="coordinate-display"]')?.getBoundingClientRect().height ?? 0)))
      .toBeGreaterThan(80)
    await expect.poll(() => page.evaluate(() => {
      const alerts = document.querySelector('[data-testid="map-degraded-alert"]')?.getBoundingClientRect()
      const bar = document.querySelector('[data-testid="coordinate-display"]')?.getBoundingClientRect()
      if (alerts === undefined || bar === undefined) return 'missing'
      return alerts.bottom <= bar.top ? 'clear' : `warnings end ${Math.round(alerts.bottom)}, bar starts ${Math.round(bar.top)}`
    }), { timeout: 10_000 }).toBe('clear')
  })

  test('keeps the filter, search and keyboard focus when Zoom docks the list', async ({ page }) => {
    await page.getByTestId('device-filter-stale').click()
    await page.getByTestId('device-list-search').fill('Bravo')
    await expect(page.getByTestId('device-row-alpha')).toBeHidden()

    await page.getByTestId('device-zoom-bravo').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()

    await expect(page.getByTestId('device-filter-stale')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('device-list-search')).toHaveValue('Bravo')
    await expect(page.getByTestId('device-row-alpha')).toBeHidden()
    await expect(page.getByTestId('device-zoom-bravo')).toBeFocused()
  })

  test('keeps each device\'s position trust in words beside its name, and does not claim the map is live', async ({ page }) => {
    await page.getByTestId('device-zoom-alpha').click()
    await expect(page.getByTestId('devices-docked-note')).toBeVisible()

    // Bravo's position is stale: colour alone must not say so.
    await expect(page.getByTestId('device-trust-bravo')).toBeVisible()
    await expect(page.getByTestId('device-trust-bravo')).toHaveText('Stale')
    // Tracking is offline in this fixture, so Alpha's position is the last known one.
    await expect(page.getByTestId('device-trust-alpha')).toBeVisible()
    await expect(page.getByTestId('device-trust-alpha')).toHaveText('Last known')
    await expect(page.getByTestId('devices-docked-note')).not.toContainText('live')
  })
})

test.describe('Operational tracking overlay readiness [DON-263]', () => {
  test('renders current positions and breadcrumbs while basemap tiles remain pending', async ({
    context,
    page,
  }) => {
    let releaseTiles = () => undefined
    const tileGate = new Promise<void>((resolve) => {
      releaseTiles = resolve
    })
    let heldTileCount = 0

    await context.route('https://tile.opentopomap.org/**', async (route) => {
      heldTileCount += 1
      await tileGate
      await route.abort().catch(() => undefined)
    })

    try {
      await page.goto('/?missionHarness=1')
      await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForSelector('canvas', { timeout: 15_000 })
      await openMissionPanel(page)
      await page.getByTestId('mission-name-input').fill('Pending Basemap Mission')
      await page.getByTestId('mission-start-btn').click()
      await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
      await seedTrackingWorkspace(page)

      await expect.poll(() => heldTileCount).toBeGreaterThan(0)
      await expect.poll(async () => readOperationalTrackingState(page)).toMatchObject({
        styleLoaded: false,
        currentPositionCount: 2,
        breadcrumbFeatureCount: 1,
        renderedOperationalFeatureCount: expect.any(Number),
      })
      await expect
        .poll(async () => (await readOperationalTrackingState(page)).renderedOperationalFeatureCount)
        .toBeGreaterThan(0)
    } finally {
      releaseTiles()
      await context.unrouteAll({ behavior: 'ignoreErrors' })
    }
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

async function readOperationalTrackingState(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('Map instance is unavailable.')
    }

    const source = map.getSource('tracking') as
      | { getData: () => Promise<GeoJSON.FeatureCollection> }
      | undefined
    const features = source === undefined ? [] : (await source.getData()).features
    const countKind = (featureKind: string) =>
      features.filter((feature) => feature.properties?.featureKind === featureKind).length

    return {
      styleLoaded: map.isStyleLoaded(),
      currentPositionCount: countKind('device'),
      breadcrumbFeatureCount:
        countKind('breadcrumb') + countKind('breadcrumbLine') + countKind('breadcrumbLoneFix'),
      renderedOperationalFeatureCount: map.queryRenderedFeatures(undefined, {
        layers: [
          'tracking-devices-circle',
          'tracking-breadcrumbs-line',
          'tracking-breadcrumbs-lone-fix',
          'tracking-breadcrumbs-dots',
        ],
      }).length,
    }
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
          isStyleLoaded: () => boolean
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
      sourceFound: map.getSource('tracking') !== undefined,
      styleLoaded: map.isStyleLoaded(),
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
  return page.evaluate(async () => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          getSource: (sourceId: string) => { getData: () => Promise<{ features?: Array<{ properties?: { featureKind?: string; deviceId?: string }; geometry?: { coordinates?: unknown[] } }> }> } | undefined
          querySourceFeatures: (sourceId: string) => Array<{
            geometry?: { type?: string; coordinates?: unknown[] }
            properties?: { featureKind?: string; deviceId?: string }
          }>
        }
      }
    ).__SARTRACKER_MAP__

    const source = map?.getSource('tracking')
    const sourceData = await source?.getData()
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
      // querySourceFeatures reports loaded, clipped vector tiles: their vertex
      // counts change with viewport height. Check complete source geometry while
      // retaining the independent rendered vertex/segment checks in the test.
      coversSparseTrail:
        (sourceData?.features ?? []).filter((feature) => feature.properties?.featureKind === 'breadcrumbLine' && feature.properties.deviceId === 'alpha').reduce(
          (total, feature) => total + (feature.geometry?.coordinates?.length ?? 0),
          0,
        ) >= 6,
    }
  })
}

async function readAlphaBreadcrumbCoordinateKeys(
  page: import('@playwright/test').Page,
  sourcePositionIdPrefix?: string,
): Promise<readonly string[]> {
  return page.evaluate((expectedSourcePositionIdPrefix) => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          querySourceFeatures: (sourceId: string) => Array<{
            geometry?: { type?: string; coordinates?: unknown[] }
            properties?: {
              featureKind?: string
              deviceId?: string
              sourcePositionId?: string
            }
          }>
        }
      }
    ).__SARTRACKER_MAP__

    const coordinateKeys = (map?.querySourceFeatures('tracking-breadcrumb-dots-exact') ?? [])
      .filter(
        (feature) =>
          feature.properties?.featureKind === 'breadcrumb' &&
          feature.properties.deviceId === 'alpha' &&
          (expectedSourcePositionIdPrefix === undefined ||
            feature.properties.sourcePositionId?.startsWith(
              expectedSourcePositionIdPrefix,
            ) === true) &&
          feature.geometry?.type === 'Point',
      )
      .flatMap((feature) => {
        const coordinates = feature.geometry?.coordinates
        const lon = coordinates?.[0]
        const lat = coordinates?.[1]
        return typeof lon === 'number' && typeof lat === 'number'
          ? [`${lon.toFixed(5)}:${lat.toFixed(5)}`]
          : []
      })

    return [...new Set(coordinateKeys)].sort()
  }, sourcePositionIdPrefix)
}

async function seedTrackingWorkspace(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const harness = window.__SARTRACKER_BROWSER_HARNESS__
    if (harness === undefined) {
      throw new Error('Browser harness API unavailable.')
    }

    const fixBaseMs = Date.now() + 1_000
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
            timestamp: new Date(fixBaseMs + 20_000).toISOString(),
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
            timestamp: new Date(fixBaseMs + 15_000).toISOString(),
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
            timestamp: new Date(fixBaseMs).toISOString(),
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
            timestamp: new Date(fixBaseMs + 10_000).toISOString(),
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

/**
 * Once the camera settles, says whether a [longitude, latitude] is drawn inside
 * the map canvas and right of the docked All devices list (DON-368).
 */
async function targetPlacement(page: import('@playwright/test').Page, target: [number, number]): Promise<string> {
  return page.evaluate((lngLat) => {
    const map = (window as Window & { __SARTRACKER_MAP__: import('maplibre-gl').Map }).__SARTRACKER_MAP__
    if (map.isMoving()) return 'moving'
    const canvas = map.getCanvas().getBoundingClientRect()
    const dock = document.querySelector('[data-testid="devices-workspace"]')?.closest('[role="dialog"]')?.getBoundingClientRect()
    if (dock === undefined) return 'no dock'
    const point = map.project(lngLat)
    const x = canvas.left + point.x
    const y = canvas.top + point.y
    return x > dock.right + 16 && x > canvas.left + 16 && x < canvas.right - 16 && y > canvas.top + 16 && y < canvas.bottom - 16
      ? 'visible'
      : `hidden at ${Math.round(x)},${Math.round(y)}; dock ends ${Math.round(dock.right)}, map ${Math.round(canvas.left)}-${Math.round(canvas.right)}`
  }, target)
}

test.describe('Review docked at the narrowest supported width [DON-368]', () => {
  test.use({ viewport: { width: 1180, height: 768 } })

  test.beforeEach(async ({ page }) => {
    await serveBlankTiles(page)
    await page.goto('/?missionHarness=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForSelector('canvas', { timeout: 15000 })
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Narrow Review Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    await seedTrackingWorkspace(page)
    await openWorkspacePanel(page, 'people')
    await openMissionReview(page)
    await expect(page.getByTestId('mission-review-docked-readonly-note')).toBeVisible()
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'false')
  })

  test('keeps a usable map, Map Tools and the alarm action beside Review and People', async ({ page }) => {
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('.ws-map-area')?.getBoundingClientRect().width ?? 0)))
      .toBeGreaterThanOrEqual(MIN_DOCKED_MAP_WIDTH_PX)
    await expect.poll(() => uncoveredInsideMap(page, '[data-testid="ws-alarm-details"]'), { timeout: 10_000 }).toBe('inside')
    await expectMapToolsPanelsInsideMap(page)
    await expectMapScaleClear(page, 'Review docked at 1180')
  })

  test('[Codex r2] measures, reads, clears and closes Map Tools beside Review while map warnings stay showing', async ({ page }) => {
    await raiseTrackingOverlayWarning(page, ['tracking', 'measurements'])
    await expect(page.getByTestId('map-degraded-alert').locator('[data-testid^="map-overlay-warning-layout-fixture"]')).toHaveCount(2)
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-measure').click()
    await expect(page.locator('.sar-map-tools-body')).toHaveAttribute('data-panel-open', 'true')
    await expectMapToolsApartFromAlerts(page, 'Measure open')
    await expectMapWarningsOnTop(page, 'Measure open')

    // Two map clicks in the strip of map right of Map Tools and above the warnings.
    const area = await page.locator('.ws-map-area').boundingBox()
    const tools = await page.getByTestId('drawing-toolbar').boundingBox()
    expect(area).not.toBeNull()
    expect(tools).not.toBeNull()
    const x = (tools!.x + tools!.width + area!.x + area!.width) / 2 - 10
    const y = area!.y + area!.height * 0.42
    await page.mouse.click(x, y)
    await page.mouse.click(x, y + 50)
    await expect(page.getByTestId('measurement-count')).toHaveText('1')

    // The result can be read: it is on screen and nothing is drawn over it.
    await page.getByTestId('measurement-list').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('measurement-list')).toContainText(/\d+(\.\d+)?\s*(m|km)/)
    await expect.poll(() => uncovered(page, 'measurement-list'), { timeout: 10_000 }).toBe('uncovered')
    await expectMapToolsApartFromAlerts(page, 'measurement made')

    // Clear Measurements takes the real click (Playwright refuses a click another element would receive).
    await page.getByTestId('measurement-clear-btn').scrollIntoViewIfNeeded()
    await page.getByTestId('measurement-clear-btn').click()
    await page.getByTestId('measurement-clear-confirm-btn').click()
    await expect(page.getByTestId('measurement-count')).toHaveText('0')

    await page.getByTestId('drawing-toolbar-collapse').click()
    await expect(page.getByTestId('drawing-toolbar-expand')).toBeVisible()
    await expect(page.getByTestId('map-degraded-alert').locator('[data-testid^="map-overlay-warning-layout-fixture"]')).toHaveCount(2)
    await expectMapWarningsOnTop(page, 'Map Tools closed')
  })
})

test.describe('Review docked with People closed at the narrowest supported width [DON-368]', () => {
  test.use({ viewport: { width: 1180, height: 768 } })

  test('shows the tracking warnings on the map clear of the open Map Tools panels', async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForSelector('canvas', { timeout: 15000 })
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Narrow Review Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    // Tracking is up and one device has gone quiet, so that person is named on the map.
    await page.evaluate(async () => {
      const now = Date.now()
      const at = (ms: number) => new Date(ms).toISOString()
      await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(
        {
          devices: [
            { device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: at(now), unique_id: null, category: null },
            { device_id: 'bravo', name: 'Bravo Team', status: 'offline', last_seen: at(now - 40 * 60_000), unique_id: null, category: null },
          ],
          positions: [
            { id: 'pos-alpha', device_id: 'alpha', lat: 51.99917, lon: -9.74406, altitude: null, speed: null, battery: null, accuracy: null, timestamp: at(now), source: null, data_origin: 'live', cache_age_seconds: null, device_cache_stale: false },
            { id: 'pos-bravo', device_id: 'bravo', lat: 52.05944, lon: -9.50722, altitude: null, speed: null, battery: null, accuracy: null, timestamp: at(now - 40 * 60_000), source: null, data_origin: 'live', cache_age_seconds: null, device_cache_stale: false },
          ],
          breadcrumbs: [],
        },
        { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: at(now), warning: null },
      )
    })
    await openMissionReview(page)
    await expect(page.getByTestId('mission-review-docked-readonly-note')).toBeVisible()
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
    await expect(page.getByTestId('ws-exceptions')).toBeVisible()

    await page.getByTestId('drawing-toolbar-expand').click()
    for (const tool of ['measure', 'marker_at_grid']) {
      await page.getByTestId(`drawing-tool-${tool}`).click()
      await expect(page.locator('.sar-map-tools-body')).toHaveAttribute('data-panel-open', 'true')
      await expectMapToolsApartFromWarnings(page, tool)
    }

    // The red alarm appears while Map Tools is open: it pushes the warnings down
    // without resizing them, and Map Tools must follow (Codex round 5).
    await page.evaluate(async () => {
      const { useTrackingMapUpdateStore } = await import('/src/features/tracking/tracking-map-update-store.ts')
      useTrackingMapUpdateStore.getState().reportFailure('Layout fixture: the map could not draw the latest positions.')
    })
    await expect(page.getByTestId('ws-alarm')).toContainText('MAP NOT UPDATING')
    // Wait until the warnings have actually moved down under the alarm.
    await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ws-exceptions') as HTMLElement).getPropertyValue('--ws-alarm-height')) || 0))
      .toBeGreaterThan(0)
    await expect(page.getByTestId('ws-exceptions')).toBeVisible()
    await expect(page.locator('.sar-map-tools-body')).toHaveAttribute('data-panel-open', 'true')
    await expectMapToolsApartFromWarnings(page, 'marker_at_grid with the alarm')
  })
})

test.describe('Review docked with People closed at 1180x760 [DON-369]', () => {
  test.use({ viewport: { width: 1180, height: 760 } })

  test('[Codex r3] keeps the Map Tools header, collapse control and a scrolling body usable when the alarm and a full warning stack arrive', async ({ page }) => {
    await serveBlankTiles(page)
    await page.goto('/?missionHarness=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForSelector('canvas', { timeout: 15000 })
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Narrow Review Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    // Five teams have gone quiet: three are named on the map, then "+2 more".
    await page.evaluate(async () => {
      const now = Date.now()
      const at = (ms: number) => new Date(ms).toISOString()
      const quiet = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
      await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(
        {
          devices: quiet.map((id) => ({ device_id: id, name: `${id} Team`, status: 'offline', last_seen: at(now - 40 * 60_000), unique_id: null, category: null })),
          positions: quiet.map((id, index) => ({ id: `pos-${id}`, device_id: id, lat: 52 + index * 0.01, lon: -9.6, altitude: null, speed: null, battery: null, accuracy: null, timestamp: at(now - 40 * 60_000), source: null, data_origin: 'live', cache_age_seconds: null, device_cache_stale: false })),
          breadcrumbs: [],
        },
        { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: at(now), warning: null },
      )
    })
    await openMissionReview(page)
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
    await expect(page.getByTestId('ws-exceptions-more')).toBeVisible()
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-measure').click()
    const body = page.locator('.sar-map-tools-body')
    await expect(body).toHaveAttribute('data-panel-open', 'true')
    const toolsHeight = () => page.evaluate(() => Math.round(document.querySelector('[data-testid="drawing-toolbar"]')?.getBoundingClientRect().height ?? 0))
    const roomyHeight = await toolsHeight()

    // The alarm, the tracking rows with "more", and every overlay warning family arrive after Map Tools opened.
    await page.evaluate(async () => {
      const { useTrackingMapUpdateStore } = await import('/src/features/tracking/tracking-map-update-store.ts')
      useTrackingMapUpdateStore.getState().reportFailure('Layout fixture: the map could not draw the latest positions.')
    })
    await expect(page.getByTestId('ws-alarm')).toContainText('MAP NOT UPDATING')
    await raiseTrackingOverlayWarning(page, ['tracking', 'measurements', 'drawings'])
    await expect(page.getByTestId('map-degraded-alert').locator('[data-testid^="map-overlay-warning-layout-fixture"]')).toHaveCount(3)

    // Map Tools keeps a usable minimum: the header and collapse control can be reached and the body scrolls.
    await expect.poll(toolsHeight, { timeout: 10_000 }).toBeGreaterThanOrEqual(MAP_TOOLS_MIN_USABLE_HEIGHT_PX)
    await expect.poll(() => body.evaluate((element) => element.clientHeight), { timeout: 10_000 }).toBeGreaterThanOrEqual(96)
    await expect.poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(true)
    await page.getByTestId('drawing-toolbar-collapse').scrollIntoViewIfNeeded()
    // Its "Map Tools" label at the left stays clear even where the warnings, drawn on top, cover its right.
    await expect.poll(() => page.evaluate(() => {
      const collapse = document.querySelector('[data-testid="drawing-toolbar-collapse"]')
      if (collapse === null) return 'missing'
      const box = collapse.getBoundingClientRect()
      const top = document.elementFromPoint(box.left + 40, box.top + 12)
      return top !== null && collapse.contains(top) ? 'reachable' : `covered by ${top?.getAttribute('data-testid') ?? top?.className ?? 'nothing'}`
    }), { timeout: 10_000 }).toBe('reachable')
    await expectMapWarningsOnTop(page, 'full warning stack')
    // The warning stack stops below the tracking shortcuts and scrolls, so neither covers the other.
    await expect.poll(() => page.evaluate(() => {
      const shortcuts = document.querySelector('[data-testid="ws-exceptions"]')?.getBoundingClientRect()
      const alerts = document.querySelector('[data-testid="map-degraded-alert"]')?.getBoundingClientRect()
      if (shortcuts === undefined || alerts === undefined) return 'missing'
      return alerts.top >= shortcuts.bottom ? 'apart' : `warnings start ${Math.round(alerts.top)}, shortcuts end ${Math.round(shortcuts.bottom)}`
    }), { timeout: 10_000 }).toBe('apart')
    await expect.poll(() => uncovered(page, 'ws-exceptions-more'), { timeout: 10_000 }).toBe('uncovered')
    // A GPX notice keeps the order it had before DON-369: drawn over the warnings, never under them.
    await page.evaluate(async () => {
      const { useGpxStore } = await import('/src/features/gpx/gpx-store.ts')
      useGpxStore.setState({ mapCoverageNotice: 'Layout fixture: 2 of 5 GPX tracks are not shown on the map.' })
    })
    await expect.poll(() => uncovered(page, 'gpx-map-coverage-notice'), { timeout: 10_000 }).toBe('uncovered')
    await expect.poll(toolsHeight, { timeout: 10_000 }).toBeGreaterThanOrEqual(MAP_TOOLS_MIN_USABLE_HEIGHT_PX)
    // Measure is still reachable by scrolling the body.
    await page.getByTestId('drawing-tool-measure').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('drawing-tool-measure')).toBeVisible()

    // The warnings clear and Map Tools grows back to its full height.
    await page.evaluate(async () => {
      const [{ useTrackingMapUpdateStore }, { useMapOverlayWarningStore }] = await Promise.all([
        import('/src/features/tracking/tracking-map-update-store.ts'),
        import('/src/features/map/map-overlay-warning-store.ts'),
      ])
      useTrackingMapUpdateStore.getState().clearFailure()
      const { useGpxStore } = await import('/src/features/gpx/gpx-store.ts')
      useGpxStore.setState({ mapCoverageNotice: null })
      for (const family of ['tracking', 'measurements', 'drawings']) {
        useMapOverlayWarningStore.getState().clearWarning(`layout-fixture-${family}` as never)
      }
    })
    await expect(page.getByTestId('map-degraded-alert')).toHaveCount(0)
    await expect.poll(toolsHeight, { timeout: 10_000 }).toBeGreaterThanOrEqual(roomyHeight - 1)
    await page.getByTestId('drawing-toolbar-collapse').scrollIntoViewIfNeeded()
    await page.getByTestId('drawing-toolbar-collapse').click()
    await expect(page.getByTestId('drawing-toolbar-expand')).toBeVisible()
  })
})

/** Checks Map Tools and the warnings named on the map are each inside the map, uncovered, and apart. */
async function expectMapToolsApartFromWarnings(page: import('@playwright/test').Page, label: string): Promise<void> {
  await expect.poll(() => uncoveredInsideMap(page, '[data-testid="drawing-toolbar"]'), { timeout: 10_000, message: label }).toBe('inside')
  await expect.poll(() => uncoveredInsideMap(page, '[data-testid="ws-exceptions"]'), { timeout: 10_000, message: `${label} warnings` }).toBe('inside')
  await expect.poll(() => page.evaluate(() => {
    const tools = document.querySelector('[data-testid="drawing-toolbar"]')?.getBoundingClientRect()
    const warnings = document.querySelector('[data-testid="ws-exceptions"]')?.getBoundingClientRect()
    if (tools === undefined || warnings === undefined) return 'missing'
    const overlap = tools.left < warnings.right && warnings.left < tools.right && tools.top < warnings.bottom && warnings.top < tools.bottom
    return overlap ? `Map Tools ${Math.round(tools.top)}-${Math.round(tools.bottom)} meets warnings ${Math.round(warnings.top)}-${Math.round(warnings.bottom)}` : 'apart'
  }), { timeout: 10_000, message: label }).toBe('apart')
}

/** The narrowest map a docked panel may leave beside itself (DON-368). */
const MIN_DOCKED_MAP_WIDTH_PX = 480
/** A real tile PNG, served for every outside request so a live tile outage cannot add map warnings. */
const BLANK_TILE_PNG = Buffer.from(
  (createRequire(import.meta.url)('../../electron/official-map-no-coverage.cjs') as { NO_COVERAGE_TILE_BASE64: string }).NO_COVERAGE_TILE_BASE64,
  'base64',
)

/** Serves blank tiles, so the map warnings these layout checks count are only the ones they raise. */
async function serveBlankTiles(page: import('@playwright/test').Page): Promise<void> {
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE_PNG }))
}
/** Codex r3 (DON-369): Map Tools never shrinks below this, so its header and collapse control stay reachable. */
const MAP_TOOLS_MIN_USABLE_HEIGHT_PX = 144

/** Opens Map Tools, then Measure and Marker at GR, and checks each stays inside the map, uncovered. */
async function expectMapToolsPanelsInsideMap(page: import('@playwright/test').Page): Promise<void> {
  await expect.poll(() => uncoveredInsideMap(page, '[data-testid="drawing-toolbar"]'), { timeout: 10_000, message: 'collapsed Map Tools' }).toBe('inside')
  await page.getByTestId('drawing-toolbar-expand').click()
  for (const tool of ['measure', 'marker_at_grid']) {
    await page.getByTestId(`drawing-tool-${tool}`).click()
    await expect(page.locator('.sar-map-tools-body')).toHaveAttribute('data-panel-open', 'true')
    await expect.poll(() => uncoveredInsideMap(page, '[data-testid="drawing-toolbar"]'), { timeout: 10_000, message: tool }).toBe('inside')
  }
}

/**
 * DON-369: the segmented scale bar lies inside the visible map, wholly above the
 * coordinate bar, and apart from Map Tools and any docked panel. The bar ignores
 * the pointer, so this compares boxes rather than hit-testing.
 */
async function expectMapScaleClear(page: import('@playwright/test').Page, label: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const scale = rect('[data-testid="map-scale-readout"]')
    const map = rect('.ws-map-area')
    const coordinates = rect('[data-testid="coordinate-display"]')
    const tools = rect('[data-testid="drawing-toolbar"]')
    if (scale === undefined || map === undefined || coordinates === undefined || tools === undefined) return 'missing'
    const meets = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    if (scale.left < map.left - 1 || scale.right > map.right + 1 || scale.top < map.top - 1) {
      return `outside the map: ${Math.round(scale.left)}-${Math.round(scale.right)} vs ${Math.round(map.left)}-${Math.round(map.right)}`
    }
    if (scale.bottom > coordinates.top) return `scale bottom ${Math.round(scale.bottom)} below coordinate bar top ${Math.round(coordinates.top)}`
    if (meets(scale, tools)) return `meets Map Tools ${Math.round(tools.top)}-${Math.round(tools.bottom)}`
    const gpxNotice = rect('[data-testid="gpx-map-coverage-notice"]')
    if (gpxNotice !== undefined && meets(scale, gpxNotice)) return `meets the GPX notice ${Math.round(gpxNotice.top)}-${Math.round(gpxNotice.bottom)}`
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const box = dialog.getBoundingClientRect()
      if (box.width > 0 && meets(scale, box)) return `under the docked panel ${dialog.getAttribute('data-testid') ?? ''}`
    }
    return 'clear'
  }), { timeout: 10_000, message: label }).toBe('clear')
}

/** Raises persistent overlay warnings, which the map stacks at the bottom right, full width on a narrow map. */
async function raiseTrackingOverlayWarning(
  page: import('@playwright/test').Page,
  families: readonly ('tracking' | 'measurements' | 'drawings')[] = ['tracking'],
): Promise<void> {
  await page.evaluate(async (names) => {
    const [{ useMapOverlayWarningStore }, { createMapOverlaySyncWarning }] = await Promise.all([
      import('/src/features/map/map-overlay-warning-store.ts'),
      import('/src/lib/map-health.ts'),
    ])
    for (const family of names) {
      const warning = createMapOverlaySyncWarning(family, family)
      useMapOverlayWarningStore.getState().raiseWarning({ ...warning, registrationId: `layout-fixture-${family}` as typeof warning.registrationId })
    }
  }, families)
  await expect(page.getByTestId('map-degraded-alert')).toBeVisible()
}

/** Codex r2 (DON-369): Map Tools and the map warnings each get their own space; neither is drawn over the other. */
async function expectMapToolsApartFromAlerts(page: import('@playwright/test').Page, label: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const tools = document.querySelector('[data-testid="drawing-toolbar"]')?.getBoundingClientRect()
    const alerts = document.querySelector('[data-testid="map-degraded-alert"]')?.getBoundingClientRect()
    if (tools === undefined || alerts === undefined) return 'missing'
    const meets = tools.left < alerts.right && alerts.left < tools.right && tools.top < alerts.bottom && alerts.top < tools.bottom
    return meets ? `Map Tools ${Math.round(tools.top)}-${Math.round(tools.bottom)} meets warnings ${Math.round(alerts.top)}-${Math.round(alerts.bottom)}` : 'apart'
  }), { timeout: 10_000, message: label }).toBe('apart')
}

/** 'uncovered' when the element's centre is not drawn over by anything else. */
async function uncovered(page: import('@playwright/test').Page, testId: string): Promise<string> {
  return page.evaluate((id) => {
    const element = document.querySelector(`[data-testid="${id}"]`)
    if (element === null) return 'missing'
    const box = element.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height, 30) / 2)
    return top !== null && element.contains(top) ? 'uncovered' : `covered by ${top?.getAttribute('data-testid') ?? top?.className ?? 'nothing'}`
  }, testId)
}

/**
 * Codex r1 (DON-369): every map warning is drawn on top, readable across its
 * whole width, even where the scale chip or open Map Tools share the corner.
 * The scale ignores the pointer, so it is made hit-testable for the check only.
 */
async function expectMapWarningsOnTop(page: import('@playwright/test').Page, label: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const alerts = document.querySelector('[data-testid="map-degraded-alert"]')
    const scale = document.querySelector('[data-testid="map-scale-readout"]')
    if (!(alerts instanceof HTMLElement) || !(scale instanceof HTMLElement)) return 'missing'
    const items = [...alerts.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
    if (items.length === 0) return 'no warnings'
    const previous = scale.style.pointerEvents
    scale.style.pointerEvents = 'auto'
    try {
      // The stack scrolls when it is capped, so only the part of each warning inside it is checked.
      const stack = alerts.getBoundingClientRect()
      for (const item of items) {
        const itemBox = item.getBoundingClientRect()
        const visibleTop = Math.max(itemBox.top, stack.top)
        const visibleBottom = Math.min(itemBox.bottom, stack.bottom)
        if (visibleBottom - visibleTop < 4) continue
        const box = { left: itemBox.left, right: itemBox.right, width: itemBox.width }
        const y = (visibleTop + visibleBottom) / 2
        for (const x of [box.left + 6, box.left + box.width / 2, box.right - 6]) {
          const top = document.elementFromPoint(x, y)
          if (top === null || !item.contains(top)) {
            return `warning "${item.textContent?.slice(0, 30)}" covered at ${Math.round(x)},${Math.round(y)} by ${top?.getAttribute('data-testid') ?? top?.className ?? 'nothing'}`
          }
        }
      }
      return 'on top'
    } finally {
      scale.style.pointerEvents = previous
    }
  }), { timeout: 10_000, message: label }).toBe('on top')
}

/** 'inside' when the element lies within the map area and nothing else is drawn over its centre. */
async function uncoveredInsideMap(page: import('@playwright/test').Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel)
    const map = document.querySelector('.ws-map-area')
    if (element === null || map === null) return 'missing'
    const box = element.getBoundingClientRect()
    const area = map.getBoundingClientRect()
    if (box.width === 0) return 'not drawn'
    if (box.left < area.left - 1 || box.right > area.right + 1 || box.top < area.top - 1 || box.bottom > area.bottom + 1) {
      return `outside the map: ${Math.round(box.left)}-${Math.round(box.right)} vs ${Math.round(area.left)}-${Math.round(area.right)}`
    }
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height, 40) / 2)
    if (top === null || !element.contains(top)) return `covered by ${top?.getAttribute('data-testid') ?? top?.className ?? 'nothing'}`
    return 'inside'
  }, selector)
}
