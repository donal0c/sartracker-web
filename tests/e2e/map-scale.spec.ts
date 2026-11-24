import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)
const { NO_COVERAGE_TILE_BASE64 } = require('../../electron/official-map-no-coverage.cjs') as {
  NO_COVERAGE_TILE_BASE64: string
}

const syntheticDiscoveryPackage = {
  id: 'synthetic-official-map',
  sourceType: 'mbtiles',
  mapId: 'official_discovery_topo',
  packagePath: '/synthetic/test.mbtiles',
  status: 'ready',
  bounds: [-11, 50, -5, 56],
  minZoom: 0,
  maxZoom: 19,
  tileCount: 1,
  tileFormat: 'png',
  createdAt: '2026-09-13T10:00:00.000Z',
  verifiedAt: '2026-09-13T10:00:00.000Z',
  message: 'Synthetic package validation',
  attestation: {
    version: 1,
    schemaVersion: 1,
    decoderPolicy: 'native-raster-256-or-512-opaque-v1',
    sha256: 'a'.repeat(64),
    identity: 'synthetic',
  },
}

/** Irish camera positions (Kerry, Wicklow, Co. Down, Donegal) at search zooms. */
const CAMERAS = [
  { lng: -9.74, lat: 51.99, zoom: 13 },
  { lng: -6.3, lat: 53.0, zoom: 15 },
  { lng: -5.5, lat: 54.4, zoom: 11.5 },
  { lng: -7.4, lat: 55.3, zoom: 16.5 },
] as const

type ScaleMeasurement = {
  readonly label: string
  readonly labelledM: number
  readonly measuredM: number
}

test.describe('map scale bar (DON-339 / M-01)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(NO_COVERAGE_TILE_BASE64, 'base64'),
      }),
    )
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('labels the ground distance the bar covers on OpenTopoMap', async ({ page }) => {
    await selectBasemap(page, 'opentopomap')
    await expectScaleMatchesMapLibre(page)
  })

  test('labels the ground distance the bar covers on Discovery Topo', async ({ page }) => {
    await page.evaluate(
      ({ defaults, mapPackage, png }) => {
        const settings = { ...defaults, officialMaps: { ...defaults.officialMaps, packages: [mapPackage] } }
        const bridge = {
          loadAppSettings: async () => structuredClone(settings),
          fetchOfficialMapTile: async () => ({ contentType: 'image/png', bytesBase64: png }),
          checkOfficialMapView: async (request: Record<string, unknown>) => ({
            ...request,
            status: 'complete',
            totalTiles: 4,
            usableTiles: 4,
            checkedAt: new Date().toISOString(),
            packageIdentities: [{ id: mapPackage.id, sha256: mapPackage.attestation.sha256 }],
            message: 'Synthetic native check: every required tile usable.',
          }),
          onOfficialMapPackagesChanged: () => () => undefined,
        }
        Object.defineProperty(window, 'sartrackerElectron', { configurable: true, value: bridge })
        window.dispatchEvent(new Event('sartracker:settings-updated'))
      },
      { defaults: DEFAULT_APP_SETTINGS, mapPackage: syntheticDiscoveryPackage, png: NO_COVERAGE_TILE_BASE64 },
    )
    await selectBasemap(page, 'official_discovery_topo')
    await expect(page.getByTestId('basemap-offline-readiness')).toContainText('Official package validated')
    await expectScaleMatchesMapLibre(page)
  })

  test('[DON-369] draws four alternating blocks and a half-way tick that MapLibre agrees with', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await selectBasemap(page, 'opentopomap')
    for (const camera of CAMERAS) {
      await page.evaluate((target) => {
        const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
        map?.jumpTo({ center: [target.lng, target.lat], zoom: target.zoom, bearing: 0, pitch: 0 })
      }, camera)
      await page.waitForTimeout(100)

      const result = await page.evaluate(() => {
        const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
        const bar = document.querySelector('[data-testid="map-scale-bar"]')
        const end = document.querySelector('[data-testid="map-scale-label"]')
        if (map === undefined || !(bar instanceof HTMLElement) || !(end instanceof HTMLElement)) {
          throw new Error('Scale bar or map is missing.')
        }
        const barRect = bar.getBoundingClientRect()
        const segments = [...bar.querySelectorAll('[data-testid="map-scale-segment"]')].map((segment) => ({
          width: segment.getBoundingClientRect().width,
          background: getComputedStyle(segment).backgroundColor,
        }))
        const ticks = [...document.querySelectorAll('[data-testid="map-scale-tick"]')].map((tick) => {
          const rect = tick.getBoundingClientRect()
          return { text: tick.textContent?.trim() ?? '', centreOffset: rect.left + rect.width / 2 - barRect.left }
        })
        const endNumber = end.firstChild?.textContent?.trim() ?? ''
        const unit = document.querySelector('[data-testid="map-scale-unit"]')?.textContent?.trim() ?? ''
        const canvas = map.getCanvas()
        const y = canvas.clientHeight / 2
        const x = canvas.clientWidth / 2
        const half = ticks.find((tick) => tick.text !== '0')
        const measuredHalfM = half === undefined ? null : map.unproject([x, y]).distanceTo(map.unproject([x + half.centreOffset, y]))
        return { barWidth: barRect.width, segments, ticks, endNumber, unit, measuredHalfM }
      })

      expect(result.segments).toHaveLength(4)
      const totalSegmentWidth = result.segments.reduce((sum, segment) => sum + segment.width, 0)
      expect(Math.abs(totalSegmentWidth - result.barWidth)).toBeLessThan(1)
      expect(result.segments[0].background).not.toBe(result.segments[1].background)
      expect(result.segments[0].background).toBe(result.segments[2].background)
      expect(result.ticks[0].text).toBe('0')
      const totalM = Number(result.endNumber) * (result.unit === 'km' ? 1000 : 1)
      // At this window the bar has a 200 px budget, so it is at least 80 px long and the half-way label always fits.
      expect(result.barWidth).toBeGreaterThanOrEqual(80)
      const halfTick = result.ticks.find((tick) => tick.text !== '0')
      expect(halfTick, `half-way tick at ${camera.lat},${camera.lng} z${camera.zoom}`).toBeDefined()
      expect(result.measuredHalfM).not.toBeNull()
      expect(Number(halfTick!.text) * (result.unit === 'km' ? 1000 : 1)).toBe(totalM / 2)
      expect(Math.abs(result.measuredHalfM! - totalM / 2) / (totalM / 2)).toBeLessThan(0.03)
    }
  })

  test('[DON-369] shrinks the bar on a narrow map', async ({ page }) => {
    // 52°N, zoom 13 is 5.88 m per pixel: a 200 px budget fits 1 km (170 px); under 170 px only 500 m (85 px) fits.
    await page.setViewportSize({ width: 1440, height: 900 })
    await jumpTo(page, { lng: -9, lat: 52, zoom: 13 })
    await expect(page.getByTestId('map-scale-label')).toHaveText('1 km')
    const wide = await scaleBarWidth(page)
    expect(wide).toBeGreaterThan(160)
    expect(wide).toBeLessThanOrEqual(200)

    // Only the window changes: the map's own resize must redraw the scale.
    await page.setViewportSize({ width: 520, height: 900 })
    await expect(page.getByTestId('map-scale-label')).toHaveText('500 m')
    const narrowMapWidth = await page.getByTestId('map-container').evaluate((element) => element.clientWidth)
    expect(narrowMapWidth * 0.3, 'the narrow map leaves under 170 px for the bar').toBeLessThan(169)
    const narrow = await scaleBarWidth(page)
    expect(narrow).toBeGreaterThan(80)
    expect(narrow).toBeLessThan(90)
  })

  test('[Codex r1] draws the bar frame inside the measured ends, so the painted bar is as long as its labels say', async ({ page }) => {
    await jumpTo(page, { lng: -9, lat: 52, zoom: 13 })
    const painted = await page.getByTestId('map-scale-bar').evaluate((bar) => {
      const width = bar.getBoundingClientRect().width
      const style = getComputedStyle(bar)
      // Anything drawn outside the box: outer box-shadow spread, outline, or a pseudo-element hanging past an end.
      const outerSpread = style.boxShadow === 'none'
        ? 0
        : Math.max(0, ...style.boxShadow.split(/,(?![^(]*\))/).filter((shadow) => !shadow.includes('inset')).map((shadow) => {
          const lengths = shadow.replace(/rgba?\([^)]*\)/g, '').trim().split(/\s+/).map((part) => Number.parseFloat(part))
          return Number.isFinite(lengths[3]) ? lengths[3] : 0
        }))
      const outline = style.outlineStyle === 'none' ? 0 : Number.parseFloat(style.outlineWidth) + Math.max(0, Number.parseFloat(style.outlineOffset))
      const after = getComputedStyle(bar, '::after')
      const overhang = after.content === 'none' ? 0 : Math.max(0, -Number.parseFloat(after.left) || 0, -Number.parseFloat(after.right) || 0)
      return { width, paintedWidth: width + 2 * (outerSpread + outline + overhang) }
    })
    expect(painted.paintedWidth - painted.width, 'paint beyond the measured ends').toBeLessThan(0.5)
  })

  test('[Codex r2] says "Map scale unavailable" past the live map\'s zoom and latitude limits', async ({ page }) => {
    await expect(page.getByTestId('map-scale-bar')).toBeVisible()
    const maxZoom = await page.evaluate(() => (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__?.getMaxZoom() ?? Number.NaN)
    expect(Number.isFinite(maxZoom)).toBe(true)
    for (const camera of [{ lat: 52, zoom: maxZoom + 3 }, { lat: 90, zoom: 13 }]) {
      await page.evaluate((target) => {
        const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
        if (map === undefined) throw new Error('Map instance is not exposed.')
        const forced = map as unknown as { getCenter: () => { lat: number; lng: number }; getZoom: () => number }
        forced.getCenter = () => ({ lat: target.lat, lng: -9 })
        forced.getZoom = () => target.zoom
        map.fire('zoom')
      }, camera)
      await expect(page.getByTestId('map-scale-readout'), JSON.stringify(camera)).toContainText('Map scale unavailable')
      await expect(page.getByTestId('map-scale-bar')).toHaveCount(0)
    }
    await page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      delete (map as unknown as { getCenter?: unknown }).getCenter
      delete (map as unknown as { getZoom?: unknown }).getZoom
      map?.fire('zoom')
    })
    await expect(page.getByTestId('map-scale-bar')).toBeVisible()
  })

  test('[Codex r1] says "Map scale unavailable" when the camera cannot be measured, then recovers', async ({ page }) => {
    await expect(page.getByTestId('map-scale-bar')).toBeVisible()
    await page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      if (map === undefined) throw new Error('Map instance is not exposed.')
      const broken = map as unknown as { getCenter: () => { lat: number; lng: number } }
      broken.getCenter = () => ({ lat: Number.NaN, lng: Number.NaN })
      map.fire('zoom')
    })
    await expect(page.getByTestId('map-scale-readout')).toContainText('Map scale unavailable')
    await expect(page.getByTestId('map-scale-bar')).toHaveCount(0)
    await page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      delete (map as unknown as { getCenter?: unknown }).getCenter
      map?.fire('zoom')
    })
    await expect(page.getByTestId('map-scale-bar')).toBeVisible()
    await expect(page.getByTestId('map-scale-readout')).not.toContainText('unavailable')
  })
})

/** Moves the camera and lets the scale update. */
async function jumpTo(page: Page, camera: { readonly lng: number; readonly lat: number; readonly zoom: number }): Promise<void> {
  await page.evaluate((target) => {
    const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
    if (map === undefined) throw new Error('Map instance is not exposed.')
    map.jumpTo({ center: [target.lng, target.lat], zoom: target.zoom, bearing: 0, pitch: 0 })
  }, camera)
  await page.waitForTimeout(100)
}

/** The drawn width of the scale bar in CSS pixels. */
async function scaleBarWidth(page: Page): Promise<number> {
  return page.getByTestId('map-scale-bar').evaluate((element) => element.getBoundingClientRect().width)
}

/** Switches the basemap through the operator menu. */
async function selectBasemap(page: Page, basemapId: string): Promise<void> {
  await page.getByTestId('basemap-menu-toggle').click()
  await page.getByTestId(`basemap-btn-${basemapId}`).click()
  await page.getByTestId('basemap-menu-toggle').click()
}

/**
 * Measures, at each camera, the ground distance between the two ends of the drawn bar
 * using MapLibre's own unproject at the map centre, and compares it with the label.
 */
async function expectScaleMatchesMapLibre(page: Page): Promise<void> {
  for (const camera of CAMERAS) {
    await page.evaluate((target) => {
      const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      if (map === undefined) {
        throw new Error('Map instance is not exposed.')
      }
      map.jumpTo({ center: [target.lng, target.lat], zoom: target.zoom, bearing: 0, pitch: 0 })
    }, camera)
    await page.waitForTimeout(100)

    const measurement = await page.evaluate((): ScaleMeasurement => {
      const map = (window as Window & { __SARTRACKER_MAP__?: import('maplibre-gl').Map }).__SARTRACKER_MAP__
      const bar = document.querySelector('[data-testid="map-scale-bar"]')
      const labelElement = document.querySelector('[data-testid="map-scale-label"]')
      if (map === undefined || !(bar instanceof HTMLElement) || !(labelElement instanceof HTMLElement)) {
        throw new Error('Scale bar or map is missing.')
      }
      const label = labelElement.textContent?.trim() ?? ''
      const match = /^([\d.]+)\s*(m|km)$/.exec(label)
      if (match === null) {
        throw new Error(`Unexpected scale label "${label}".`)
      }
      const labelledM = Number(match[1]) * (match[2] === 'km' ? 1000 : 1)
      const widthPx = bar.getBoundingClientRect().width
      const canvas = map.getCanvas()
      const y = canvas.clientHeight / 2
      const x = canvas.clientWidth / 2
      const west = map.unproject([x, y])
      const east = map.unproject([x + widthPx, y])
      return { label, labelledM, measuredM: west.distanceTo(east) }
    })

    const relativeError = Math.abs(measurement.measuredM - measurement.labelledM) / measurement.labelledM
    expect(
      relativeError,
      `${measurement.label} bar at ${camera.lat},${camera.lng} z${camera.zoom} covers ${measurement.measuredM.toFixed(1)} m`,
    ).toBeLessThan(0.03)
  }
}
