import { expect, test } from '@playwright/test'

test.describe('M2 map shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title'); await title.waitFor({ state: 'visible', timeout: 10000 }); await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
  })

  test('renders the map canvas and basemap controls', async ({ page }) => {
    await expect(page.locator('canvas').first()).toBeVisible()
    await expect(page.getByTestId('system-status-value')).toContainText('Browser test')
    await expect(page.getByTestId('system-status-detail')).toContainText('Session storage only')
    await expect(page.getByTestId('basemap-switcher')).toBeVisible()
    await expect(page.getByTestId('basemap-menu-toggle')).toBeVisible()
    await expect(page.getByTestId('map-scale-readout')).toBeVisible()
    await expect(page.getByTestId('map-scale-label')).toContainText(/m|km/)
    await page.getByTestId('basemap-menu-toggle').click()
    await expect(page.getByTestId('map-catalogue-group-official')).toContainText('Official maps')
    await expect(page.getByTestId('basemap-btn-official_discovery_topo')).toContainText(
      'Discovery Topo',
    )
    await expect(page.getByTestId('basemap-btn-official_discovery_topo')).toBeDisabled()
    await expect(page.getByTestId('map-catalogue-group-public-fallback')).toContainText(
      'Public fallback maps',
    )
    await expect(page.getByTestId('basemap-btn-opentopomap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_topo')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-openstreetmap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_satellite')).toBeVisible()
    await expect(page.getByTestId('basemap-map-health')).toContainText('basemap')
    await expect(page.getByTestId('basemap-offline-readiness')).toBeVisible()
    await expect(page.getByTestId('basemap-grid-note')).toContainText(
      'Grid lines: Discovery package/source dependent',
    )
    await expect(page.getByTestId('check-offline-map-coverage')).toBeVisible()
  })

  test('keeps the live map container at a non-zero height', async ({ page }) => {
    const dimensions = await page.evaluate(() => {
      const mapContainer = document.querySelector('[data-testid="map-container"]')
      const mapRoot = document.querySelector('.maplibregl-map')
      const target = mapContainer ?? mapRoot

      if (!(target instanceof HTMLElement)) {
        return null
      }

      const rect = target.getBoundingClientRect()
      return {
        width: rect.width,
        height: rect.height,
      }
    })

    expect(dimensions).not.toBeNull()
    expect(dimensions?.width ?? 0).toBeGreaterThan(100)
    expect(dimensions?.height ?? 0).toBeGreaterThan(100)
  })

  test('keeps compact map controls usable on a narrow operator viewport', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await expect(page.getByTestId('basemap-menu-toggle')).toBeVisible()
    await expect(page.getByTestId('drawing-toolbar-expand')).toBeVisible()

    await page.getByTestId('basemap-menu-toggle').click()
    await expect(page.getByTestId('basemap-btn-esri_satellite')).toBeVisible()
    await page.getByTestId('basemap-menu-toggle').click()

    await page.getByTestId('drawing-toolbar-expand').click()
    await expect(page.getByTestId('drawing-tool-line')).toBeVisible()
    await expect(page.getByTestId('drawing-toolbar-active-mode')).toContainText('Mission required')
  })

  test('DON-195: shows map scale and centred coordinate group on smaller desktop displays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })

    const mapContainer = page.getByTestId('map-container')
    const mapBounds = await mapContainer.boundingBox()
    expect(mapBounds).not.toBeNull()

    if (mapBounds !== null) {
      await page.mouse.move(mapBounds.x + mapBounds.width / 2, mapBounds.y + mapBounds.height / 2)
    }

    const scaleReadout = page.getByTestId('map-scale-readout')
    await expect(scaleReadout).toBeVisible()
    await expect(page.getByTestId('map-scale-label')).toContainText(/m|km/)

    const coordinateGroup = page.getByTestId('coordinate-readout-group')
    await expect(coordinateGroup).toBeVisible()
    await expect(page.getByTestId('coords-combined')).not.toHaveText('—')

    const layout = await page.evaluate(() => {
      const map = document.querySelector('[data-testid="map-container"]')
      const coordinateGroup = document.querySelector('[data-testid="coordinate-readout-group"]')
      const coordinateDisplay = document.querySelector('[data-testid="coordinate-display"]')
      const dmsValue = document.querySelector('[data-testid="coords-dms"]')
      const convertButton = document.querySelector('[data-testid="open-coordinate-converter"]')
      const scale = document.querySelector('[data-testid="map-scale-readout"]')
      if (
        !(map instanceof HTMLElement) ||
        !(coordinateGroup instanceof HTMLElement) ||
        !(coordinateDisplay instanceof HTMLElement) ||
        !(dmsValue instanceof HTMLElement) ||
        !(convertButton instanceof HTMLElement) ||
        !(scale instanceof HTMLElement)
      ) {
        return null
      }

      const mapRect = map.getBoundingClientRect()
      const groupRect = coordinateGroup.getBoundingClientRect()
      const displayRect = coordinateDisplay.getBoundingClientRect()
      const dmsRect = dmsValue.getBoundingClientRect()
      const convertRect = convertButton.getBoundingClientRect()
      const scaleRect = scale.getBoundingClientRect()

      return {
        mapCenterX: mapRect.left + mapRect.width / 2,
        groupCenterX: groupRect.left + groupRect.width / 2,
        dmsRight: dmsRect.right,
        convertLeft: convertRect.left,
        displayBottom: displayRect.bottom,
        viewportHeight: window.innerHeight,
        scaleBottom: scaleRect.bottom,
        coordinateTop: displayRect.top,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        appOverflow: document.body.scrollWidth - window.innerWidth,
      }
    })

    expect(layout).not.toBeNull()
    expect(Math.abs((layout?.groupCenterX ?? 0) - (layout?.mapCenterX ?? 0))).toBeLessThan(24)
    expect(layout?.dmsRight).toBeLessThanOrEqual((layout?.convertLeft ?? 0) - 8)
    expect(layout?.displayBottom).toBeLessThanOrEqual(layout?.viewportHeight ?? 0)
    expect(layout?.scaleBottom).toBeLessThanOrEqual((layout?.coordinateTop ?? 0) - 8)
    expect(layout?.horizontalOverflow).toBeLessThanOrEqual(1)
    expect(layout?.appOverflow).toBeLessThanOrEqual(1)
  })

  test('keeps command mast cells distinct at compact desktop widths [DON-258]', async ({
    page,
  }) => {
    for (const width of [1100, 1280]) {
      await page.setViewportSize({ width, height: 720 })

      const layout = await page.evaluate(() => {
        const mast = document.querySelector('[data-testid="command-mast"]')
        const grid = mast?.firstElementChild
        if (!(grid instanceof HTMLElement)) {
          return null
        }

        const cells = [...grid.children].flatMap((child) => {
          if (!(child instanceof HTMLElement)) {
            return []
          }
          const rect = child.getBoundingClientRect()
          return [{ left: rect.left, right: rect.right }]
        })

        return {
          firstLeft: cells[0]?.left ?? Number.NaN,
          lastRight: cells.at(-1)?.right ?? Number.NaN,
          overlaps: cells.some(
            (cell, index) => index > 0 && cell.left < (cells[index - 1]?.right ?? cell.left) - 1,
          ),
          viewportWidth: window.innerWidth,
        }
      })

      expect(layout).not.toBeNull()
      expect(layout?.firstLeft ?? -1).toBeGreaterThanOrEqual(0)
      expect(layout?.lastRight ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width + 1)
      expect(layout?.overlaps).toBe(false)
      expect(layout?.viewportWidth).toBe(width)
    }
  })

  test('persists the selected basemap', async ({ page }) => {
    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId('basemap-btn-esri_topo').click()
    await expect(page.getByTestId('basemap-menu-toggle')).toContainText('ESRI World Topo')
    await expect(page.getByTestId('basemap-btn-esri_topo')).toBeHidden()

    await page.reload()
    await page.waitForSelector('canvas', { timeout: 15000 })

    await expect(page.getByTestId('basemap-menu-toggle')).toContainText('ESRI World Topo')
    await page.getByTestId('basemap-menu-toggle').click()
    await expect(page.getByTestId('basemap-btn-esri_topo')).toHaveClass(/bg-amber-300/)
  })

  test('preserves the map viewport when switching basemaps', async ({ page }) => {
    await page.evaluate(() => {
      const harness = (window as Window & { __SARTRACKER_MAP__?: {
        jumpTo: (options: {
          center: [number, number]
          zoom: number
          bearing: number
          pitch: number
        }) => void
      } }).__SARTRACKER_MAP__
      if (harness === undefined) {
        return
      }

      harness.jumpTo({
        center: [-9.74406, 51.99917],
        zoom: 13.8,
        bearing: 18,
        pitch: 42,
      })
    })

    const before = await page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__?: {
        getCenter: () => { lat: number; lng: number }
        getZoom: () => number
      } }).__SARTRACKER_MAP__
      if (map === undefined) {
        return null
      }

      const center = map.getCenter()
      return {
        lat: center.lat,
        lon: center.lng,
        zoom: map.getZoom(),
      }
    })

    expect(before).not.toBeNull()

    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId('basemap-btn-esri_topo').click()
    await expect(page.getByTestId('basemap-btn-esri_topo')).toBeHidden()

    const after = await page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__?: {
        getCenter: () => { lat: number; lng: number }
        getZoom: () => number
      } }).__SARTRACKER_MAP__
      if (map === undefined) {
        return null
      }

      const center = map.getCenter()
      return {
        lat: center.lat,
        lon: center.lng,
        zoom: map.getZoom(),
      }
    })

    expect(after).not.toBeNull()
    expect(Math.abs((after?.lat ?? 0) - (before?.lat ?? 0))).toBeLessThan(0.0001)
    expect(Math.abs((after?.lon ?? 0) - (before?.lon ?? 0))).toBeLessThan(0.0001)
    expect(Math.abs((after?.zoom ?? 0) - (before?.zoom ?? 0))).toBeLessThan(0.01)
  })

  test('allows navigation across Ireland instead of locking to the default mission area', async ({ page }) => {
    const targets = [
      { label: 'south west', center: [-10.45, 51.55] },
      { label: 'north west', center: [-8.15, 55.25] },
      { label: 'east coast', center: [-6.25, 53.35] },
    ] satisfies readonly { readonly label: string; readonly center: [number, number] }[]

    for (const target of targets) {
      const reached = await page.evaluate((candidate) => {
        const map = (window as Window & { __SARTRACKER_MAP__?: {
          jumpTo: (options: { center: [number, number]; zoom: number }) => void
          getCenter: () => { lat: number; lng: number }
        } }).__SARTRACKER_MAP__
        if (map === undefined) {
          return null
        }

        map.jumpTo({ center: candidate.center, zoom: 10 })
        const center = map.getCenter()
        return {
          label: candidate.label,
          lat: center.lat,
          lon: center.lng,
        }
      }, target)

      expect(reached, target.label).not.toBeNull()
      expect(Math.abs((reached?.lon ?? 0) - target.center[0]), target.label).toBeLessThan(0.05)
      expect(Math.abs((reached?.lat ?? 0) - target.center[1]), target.label).toBeLessThan(0.05)
    }
  })

  test('preserves operator camera when the first tracking update arrives [DON-185]', async ({
    page,
  }) => {
    await page.getByTestId('mission-name-input').fill('Tracking Camera Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    const operatorView = {
      center: [-10.45, 51.55] as [number, number],
      zoom: 12.7,
    }
    await page.evaluate((view) => {
      const map = (
        window as Window & {
          __SARTRACKER_MAP__?: {
            jumpTo: (options: { center: [number, number]; zoom: number }) => void
          }
        }
      ).__SARTRACKER_MAP__
      if (map === undefined) {
        throw new Error('Map instance unavailable.')
      }
      map.jumpTo(view)
    }, operatorView)

    await page.evaluate(async () => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      if (harness === undefined) {
        throw new Error('Browser harness API unavailable.')
      }

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
            lat: 53.35,
            lon: -6.25,
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
        breadcrumbs: [],
      })
    })
    await page.evaluate(() => {
      const map = (
        window as Window & {
          __SARTRACKER_MAP__?: {
            fire: (type: string) => void
          }
        }
      ).__SARTRACKER_MAP__
      map?.fire('idle')
    })

    await expect.poll(async () => readTrackingOverlaySynchronized(page)).toBe(true)
    await expect.poll(async () => readMapCamera(page)).toMatchObject({
      lon: expect.closeTo(operatorView.center[0], 0.001),
      lat: expect.closeTo(operatorView.center[1], 0.001),
      zoom: expect.closeTo(operatorView.zoom, 0.05),
    })
  })

  test('updates the coordinate bar on mouse move', async ({ page }) => {
    const mapContainer = page.getByTestId('map-container')
    const bounds = await mapContainer.boundingBox()

    expect(bounds).toBeTruthy()

    if (!bounds) {
      return
    }

    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)

    await expect(page.getByTestId('coords-combined')).not.toHaveText('—')
    await expect(page.getByTestId('coords-combined')).toContainText('°')
    await expect(page.getByTestId('coords-combined')).toContainText('|')
  })

  test('shows the operator-facing tracking status panel', async ({ page }) => {
    await expect(page.getByTestId('tracking-status')).toBeVisible()
    await expect(page.getByTestId('tracking-status')).toContainText('Tracking')
    await expect(page.getByTestId('tracking-status')).toContainText('idle')
    await expect(page.getByTestId('tracking-status')).toContainText('Tracking is not configured.')
  })

  test('shows the mission control panel shell', async ({ page }) => {
    await expect(page.getByTestId('mission-control')).toBeVisible()
    await expect(page.getByTestId('mission-control')).toContainText('Mission Control')
    await expect(page.getByTestId('mission-control')).toContainText('idle')
    await expect(page.getByTestId('mission-start-btn')).toBeEnabled()
  })

  test('shows lifecycle backup failures as a persistent alert', async ({ page }) => {
    await page.evaluate(async () => {
      const { useAutosaveStatusStore } = await import(
        '/src/features/persistence/autosave-status-store.ts'
      )
      useAutosaveStatusStore.getState().markSyncFailed({
        reason: 'mission-finish',
        message: 'backup volume unavailable',
        now: new Date('2026-05-16T09:00:00.000Z'),
      })
    })

    const alert = page.getByTestId('lifecycle-backup-failure-banner')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('Lifecycle backup failed')
    await expect(alert).toContainText('mission finish')
    await expect(alert).toContainText('backup volume unavailable')
    await expect(alert.getByRole('button')).toHaveCount(0)
  })

  test('keeps command mast autosave warnings visible and accessible', async ({ page }) => {
    await page.evaluate(async () => {
      const { useAutosaveStatusStore } = await import(
        '/src/features/persistence/autosave-status-store.ts'
      )
      useAutosaveStatusStore.getState().markSyncFailed({
        reason: 'mission-finish',
        message: 'backup volume unavailable',
        now: new Date('2026-05-16T09:00:00.000Z'),
      })
    })

    const warning = page.getByTestId('autosave-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toContainText('Autosave warning')
    await expect(warning).toHaveAttribute('title', /Autosave failing: backup volume unavailable/)
    await expect(warning).toHaveAttribute(
      'aria-label',
      /Autosave failing: backup volume unavailable/,
    )
    await expect(warning).toHaveAttribute('role', 'status')
  })

  test('shows the runtime booting shell while startup is still preparing', async ({ page }) => {
    await page.evaluate(async () => {
      const { useRuntimeBootStore } = await import(
        '/src/features/runtime/runtime-boot-store.ts'
      )
      useRuntimeBootStore.setState({
        phase: 'booting',
        error: null,
        generation: 100,
      })
    })

    await expect(page.getByTestId('runtime-booting-shell')).toBeVisible()
    await expect(page.getByRole('status')).toContainText(
      'Loading mission, tracking, and map services...',
    )
    await expect(page.getByTestId('app-shell')).toHaveCount(0)
  })

  test('shows runtime faults with a clean reload action', async ({ page }) => {
    await page.evaluate(async () => {
      const { useRuntimeBootStore } = await import(
        '/src/features/runtime/runtime-boot-store.ts'
      )
      useRuntimeBootStore.setState({
        phase: 'failed',
        error: 'Injected startup fault.',
        generation: 99,
      })
    })

    await expect(page.getByTestId('runtime-failed-shell')).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Injected startup fault.')
    await expect(page.getByText('copy or screenshot this fault message')).toBeVisible()

    const reloadButton = page.getByRole('button', { name: 'Reload clean runtime' })
    await expect(reloadButton).toBeFocused()
    await page.getByTestId('runtime-fault-export-support-bundle').click()
    await expect(page.getByTestId('runtime-fault-export-path')).toContainText(
      'startup-fault-support-bundle',
    )
    await reloadButton.click()

    await expect(page).toHaveURL(/\/$/)
    expect(page.url()).not.toContain('missionHarness=1')
  })
})

async function readMapCamera(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          getCenter: () => { lat: number; lng: number }
          getZoom: () => number
        }
      }
    ).__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('Map instance unavailable.')
    }
    const center = map.getCenter()
    return {
      lat: center.lat,
      lon: center.lng,
      zoom: map.getZoom(),
    }
  })
}

async function readTrackingOverlaySynchronized(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          getLayer: (layerId: string) => unknown
          getSource: (sourceId: string) => unknown
        }
      }
    ).__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('Map instance unavailable.')
    }
    return map.getSource('tracking') !== undefined && map.getLayer('tracking-devices-circle') !== undefined
  })
}
