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
    await expect(page.getByTestId('map-health')).toContainText('basemap')
    await expect(page.getByTestId('basemap-menu-toggle')).toBeVisible()
    await page.getByTestId('basemap-menu-toggle').click()
    await expect(page.getByTestId('basemap-btn-opentopomap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_topo')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-openstreetmap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_satellite')).toBeVisible()
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

  test('persists the selected basemap', async ({ page }) => {
    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId('basemap-btn-esri_topo').click()
    await expect(page.getByTestId('basemap-menu-toggle')).toContainText('ESRI World Topo')

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
    await expect(page.getByTestId('basemap-btn-esri_topo')).toHaveClass(/bg-amber-300/)

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
    await reloadButton.click()

    await expect(page).toHaveURL(/\/$/)
    expect(page.url()).not.toContain('missionHarness=1')
  })
})
