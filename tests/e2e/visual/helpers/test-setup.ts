/**
 * Shared setup utilities for visual E2E tests.
 * Provides consistent app initialization, mission management, and tracking injection.
 */
import { expect, type Page } from '@playwright/test'

/** Wait for the app shell to be fully loaded and interactive. */
export async function waitForAppShell(page: Page): Promise<void> {
  const title = page.getByTestId('app-title')
  await title.waitFor({ state: 'visible', timeout: 15000 })
  await expect(title).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 20000 })
  // Allow map tiles to begin loading
  await page.waitForTimeout(1500)
}

/** Navigate to the browser validation harness. */
export async function navigateToHarness(page: Page): Promise<void> {
  await page.goto('/?missionHarness=1')
  await waitForAppShell(page)
}

/** Start a mission with the given name and optional offset hours. */
export async function startMission(
  page: Page,
  name: string,
  offsetHours?: number,
): Promise<void> {
  await page.getByTestId('mission-name-input').fill(name)
  if (offsetHours !== undefined) {
    await page.getByTestId('mission-offset-input').fill(String(offsetHours))
  }
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toContainText('active')
}

/** Pause the current active mission. */
export async function pauseMission(page: Page): Promise<void> {
  await page.getByTestId('mission-pause-resume-btn').click()
  await expect(page.getByTestId('mission-control')).toContainText('paused')
}

/** Resume a paused mission. */
export async function resumeMission(page: Page): Promise<void> {
  await page.getByTestId('mission-pause-resume-btn').click()
  await expect(page.getByTestId('mission-control')).toContainText('active')
}

/** Finish the current mission through the confirmation dialog. */
export async function finishMission(page: Page): Promise<void> {
  await page.getByTestId('mission-finish-btn').click()
  await expect(page.getByTestId('mission-finish-dialog')).toBeVisible()
  await page
    .getByTestId('mission-finish-dialog')
    .getByRole('button', { name: 'Confirm Finish' })
    .click()
  await expect(page.getByTestId('mission-control')).toContainText('idle')
}

/**
 * Standard 3-device tracking scenario for Mountain Rescue validation.
 * Alpha: online, near Carrauntoohil summit ridge
 * Bravo: online, near Hag's Tooth col
 * Charlie: offline/stale, lower slopes
 */
export async function injectStandardTracking(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const snapshot = {
      devices: [
        {
          device_id: 'alpha',
          name: 'Alpha Team',
          status: 'online' as const,
          last_seen: '2026-04-10T12:00:00.000Z',
          unique_id: null,
          category: 'person',
        },
        {
          device_id: 'bravo',
          name: 'Bravo Team',
          status: 'online' as const,
          last_seen: '2026-04-10T11:58:00.000Z',
          unique_id: null,
          category: 'person',
        },
        {
          device_id: 'charlie',
          name: 'Charlie Team',
          status: 'offline' as const,
          last_seen: '2026-04-10T10:30:00.000Z',
          unique_id: null,
          category: 'person',
        },
      ],
      positions: [
        {
          id: 'pos-alpha',
          device_id: 'alpha',
          lat: 51.9985,
          lon: -9.7426,
          altitude: 320.5,
          speed: 1.2,
          battery: 85,
          accuracy: 8,
          timestamp: '2026-04-10T12:00:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'pos-bravo',
          device_id: 'bravo',
          lat: 52.0012,
          lon: -9.7501,
          altitude: 280,
          speed: 0.5,
          battery: 42,
          accuracy: 15,
          timestamp: '2026-04-10T11:58:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'pos-charlie',
          device_id: 'charlie',
          lat: 51.995,
          lon: -9.738,
          altitude: 350,
          speed: 0,
          battery: 12,
          accuracy: 20,
          timestamp: '2026-04-10T10:30:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
      breadcrumbs: [
        {
          id: 'bc-alpha-0',
          device_id: 'alpha',
          lat: 51.9918,
          lon: -9.7354,
          altitude: 260,
          speed: 1.7,
          battery: 93,
          accuracy: 6,
          timestamp: '2026-04-10T11:54:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'bc-alpha-1',
          device_id: 'alpha',
          lat: 51.9948,
          lon: -9.7382,
          altitude: 310,
          speed: 1.5,
          battery: 90,
          accuracy: 5,
          timestamp: '2026-04-10T11:56:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'bc-alpha-2',
          device_id: 'alpha',
          lat: 51.997,
          lon: -9.741,
          altitude: 315,
          speed: 1.3,
          battery: 87,
          accuracy: 6,
          timestamp: '2026-04-10T11:58:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'bc-alpha-3',
          device_id: 'alpha',
          lat: 51.9985,
          lon: -9.7426,
          altitude: 320.5,
          speed: 1.2,
          battery: 85,
          accuracy: 8,
          timestamp: '2026-04-10T12:00:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'bc-bravo-1',
          device_id: 'bravo',
          lat: 52.002,
          lon: -9.752,
          altitude: 270,
          speed: 0.8,
          battery: 50,
          accuracy: 10,
          timestamp: '2026-04-10T11:40:00.000Z',
          source: 'osmand',
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
    }

    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(snapshot, {
      mode: 'online',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: '2026-04-10T12:00:01.000Z',
      warning: null,
    })
  })
  // Allow tracking state to propagate to UI and map
  await page.waitForTimeout(800)
}

/** Click a position on the map container, using force to bypass overlapping elements. */
export async function clickMap(
  page: Page,
  position: { x: number; y: number },
): Promise<void> {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, force: true })
}

/** Right-click a position on the map container. */
export async function rightClickMap(
  page: Page,
  position: { x: number; y: number },
): Promise<void> {
  const target = page.locator('.maplibregl-canvas').first()
  await target.waitFor({ state: 'visible', timeout: 15000 })
  await target.click({ position, button: 'right', force: true })
}

/** Read the persisted browser harness state. */
export async function readHarnessState(page: Page) {
  return page.evaluate(
    () => window.__SARTRACKER_BROWSER_HARNESS__?.readState() ?? null,
  )
}
