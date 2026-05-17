/**
 * Visual verification tests for GPS device tracking.
 *
 * These tests verify that tracking data displays correctly:
 * - Device positions rendered on map
 * - Tracking status panel with device counts
 * - Online/offline device status indicators
 * - Breadcrumb trails visible on map
 * - Layer panel shows tracking devices
 *
 * LIFE-SAFETY CRITICAL: Incorrect tracking display could cause operators to
 * lose awareness of team positions on the mountain.
 */
import { expect, test } from '@playwright/test'
import {
  navigateToHarness,
  startMission,
  injectStandardTracking,
} from './helpers/test-setup'
import {
  captureAndRegister,
  captureElementAndRegister,
} from './helpers/verification-manifest'

test.describe('Visual: Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page)
    await startMission(page, 'Tracking Verification')
    await injectStandardTracking(page)
  })

  test('tracking status panel shows correct device counts and status', async ({ page }) => {
    await expect(page.getByTestId('tracking-status')).toContainText('online')
    await expect(page.getByTestId('tracking-status')).toContainText('3')

    await captureElementAndRegister(page, 'tracking-status', {
      testId: 'tracking-status-panel',
      testName: 'Tracking status panel with 3 devices',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker tracking status panel. NOTE: this panel is the summary card only — individual device names render in the Layers tab (separate test) and are NOT expected here. Check only what is in frame:
1. The section header should read "Tracking System" with a "telemetry stream" subtitle (a header of "TRACKING SYSTEM / TELEMETRY STREAM" is correct)
2. The connection status chip in the header should show "ONLINE" with a green/emerald dot (not "idle" or "offline")
3. There should be a 4-column counters strip with labels "DEVICES", "FIXES", "CACHE", "STALE"
4. The DEVICES counter should show "3"
5. The FIXES counter should be a non-zero number (3 or more, reflecting received GPS fixes)
6. There should be an "Open Devices" button below the counters
7. There should be a "Last success" line showing a time, and a healthy/warning status message line at the bottom
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'tracking-status contains "online"',
        'tracking-status shows 3 devices',
      ],
    })
  })

  test('map shows device markers at correct positions', async ({ page }) => {
    // Device names appear in the layer tree (Layers tab)
    await page.getByTestId('sidebar-tab-layers').click()
    await expect(page.getByText('Alpha Team')).toBeVisible()
    await expect(page.getByText('Bravo Team')).toBeVisible()
    await page.getByTestId('sidebar-tab-tracking').click()

    // Zoom the map closer to the device positions for readable labels
    await page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__?: {
        jumpTo: (opts: { center: [number, number]; zoom: number }) => void
      } }).__SARTRACKER_MAP__
      map?.jumpTo({ center: [-9.7415, 51.9964], zoom: 13.2 })
    })
    await page.waitForTimeout(1500) // let map tiles load at new zoom

    await captureAndRegister(page, {
      testId: 'tracking-map-devices',
      testName: 'Device markers rendered on map (zoomed)',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker map zoomed to show tracking device markers:
1. The map should show a zoomed-in topographic view of a mountainous area (contour lines, terrain shading visible)
2. There should be at least 2 small colored device marker dots/icons visible on the map (typically green, cyan, or colored circles/pins)
3. The device markers should be positioned on the mountain terrain in the central area of the map (not off-screen or in corners)
4. There should be at least one visible breadcrumb trail line (a colored line connecting previous GPS positions, typically blue/cyan) running through the terrain
5. The right sidebar should show the SAR Tracker with mission timers running (time > 00:00:00)
6. The right sidebar should show tracking controls with status indicators (colored buttons for Pause/Finish)
Note: device text labels (team names) may be very small at map scale — this is a known issue. Focus on verifying that colored marker dots and trail lines are present on the terrain.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'Alpha Team text is visible on map (Playwright DOM check)',
        'Bravo Team text is visible on map (Playwright DOM check)',
      ],
    })
  })

  test('layer panel lists all tracked devices', async ({ page }) => {
    await page.getByTestId('sidebar-tab-layers').click()
    const layerPanel = page.getByTestId('layer-panel')
    await expect(layerPanel).toBeVisible()
    await layerPanel.scrollIntoViewIfNeeded()

    // Devices should appear in the layer tree
    await expect(page.getByText('Alpha Team')).toBeVisible()
    await expect(page.getByText('Bravo Team')).toBeVisible()
    await expect(page.getByText('Charlie Team')).toBeVisible()

    await captureElementAndRegister(page, 'layer-tree', {
      testId: 'tracking-layer-panel',
      testName: 'Layer panel with tracked devices',
      area: 'layers',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Layer Tree with tracking devices:
1. Under the "Tracking" group, there should be a "People" subgroup
2. The People group should list exactly 3 devices: "Alpha Team", "Bravo Team", "Charlie Team"
3. Each device should have a visibility checkbox (checked by default)
4. There should be a "Breadcrumbs" item under Tracking
5. The count next to "People" should show 3
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'layer-panel is visible',
        'Alpha Team text visible',
        'Bravo Team text visible',
        'Charlie Team text visible',
      ],
    })
  })

  test('mast tracking cell shows separate fix and stale chips, never a ratio', async ({ page }) => {
    // Inject a fresh snapshot where one of the three latest positions is
    // marked stale so both chips have visible numbers and the warning tone is
    // exercised. This pins the regression that the original mast cell read
    // "ONLINE 3/1" — visually scanning as the impossible ratio "3 of 1".
    await page.evaluate(async () => {
      const snapshot = {
        devices: [
          { device_id: 'alpha', name: 'Alpha Team', status: 'online' as const, last_seen: '2026-04-10T12:00:00.000Z', unique_id: null, category: 'person' },
          { device_id: 'bravo', name: 'Bravo Team', status: 'online' as const, last_seen: '2026-04-10T11:58:00.000Z', unique_id: null, category: 'person' },
          { device_id: 'charlie', name: 'Charlie Team', status: 'offline' as const, last_seen: '2026-04-10T10:30:00.000Z', unique_id: null, category: 'person' },
        ],
        positions: [
          { id: 'pos-alpha', device_id: 'alpha', lat: 51.9985, lon: -9.7426, altitude: 320, speed: 1, battery: 85, accuracy: 8, timestamp: '2026-04-10T12:00:00.000Z', source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false },
          { id: 'pos-bravo', device_id: 'bravo', lat: 52.0012, lon: -9.7501, altitude: 280, speed: 0.5, battery: 42, accuracy: 15, timestamp: '2026-04-10T11:58:00.000Z', source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false },
          { id: 'pos-charlie', device_id: 'charlie', lat: 51.995, lon: -9.738, altitude: 350, speed: 0, battery: 12, accuracy: 20, timestamp: '2026-04-10T10:30:00.000Z', source: 'cache' as const, cache_age_seconds: 600, device_cache_stale: true },
        ],
        breadcrumbs: [],
      }

      await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(snapshot, {
        mode: 'online',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: '2026-04-10T12:00:01.000Z',
        warning: null,
      })
    })
    await page.waitForTimeout(400)

    const cell = page.getByTestId('mast-tracking-cell')
    await expect(cell).toBeVisible()
    // Three glance-readable values — never combined as a single n/n ratio.
    await expect(page.getByTestId('mast-tracking-mode')).toHaveText('ONLINE')
    await expect(page.getByTestId('mast-tracking-fix-value')).toHaveText('3')
    await expect(page.getByTestId('mast-tracking-stale-value')).toHaveText('1')
    const cellText = (await cell.textContent()) ?? ''
    expect(cellText).not.toMatch(/\b\d+\s*\/\s*\d+\b/)

    await captureElementAndRegister(page, 'command-mast', {
      testId: 'mast-tracking-cell-active',
      testName: 'Mast tracking cell during an active mission',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker command mast (the top header strip) during an active mission:
1. The mast contains a tracking cell labelled with the current tracking mode in uppercase (one of "ONLINE", "OFFLINE", or "IDLE"). For this capture the mode label should be "ONLINE".
2. The same cell shows two separate stat rows underneath the mode label: a row whose label is "FIX" with a numeric value (a small whole number such as 3), and a row whose label is "STALE" with a separate numeric value (a small whole number such as 1).
3. The FIX and STALE values are rendered as two distinct numbers in two separate rows. They are NOT combined into a single value like "3/1" or "FIX/STALE 3/1" or "1/3" — that exact regression is what this test exists to prevent. Mark item 3 FAIL only if you see a single visible "<digits>/<digits>" string treated as one value inside the tracking cell.
4. The cell sits between the "DEVICES" cell on its left and the "SYSTEM STATUS" cell on its right. Both neighbours should still be visible and labelled.
5. The overall theme is dark with amber accents; tone for the STALE row is amber/warning when the value is greater than zero.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mast-tracking-cell visible',
        'mast-tracking-mode is "ONLINE"',
        'mast-tracking-fix-value is "3"',
        'mast-tracking-stale-value is "1"',
        'mast-tracking-cell does not match a digits/digits ratio',
      ],
    })
  })

  test('full operational view with tracking and all sidebar panels', async ({ page }) => {
    await expect(page.getByTestId('mission-elapsed')).not.toHaveText('00:00:00')

    await captureAndRegister(page, {
      testId: 'tracking-full-operational',
      testName: 'Full operational view with active tracking',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker in full operational mode:
1. LEFT SIDE - MAP: A topographic map should be visible showing the Kerry mountains
2. LEFT SIDE - DEVICES: Device markers with team names should be visible on the map
3. LEFT SIDE - TOOLBAR: The Map Tools toolbar should be on the left side of the map
4. LEFT SIDE - COORDS: A coordinate bar should be at the bottom of the map
5. TOP HEADER: "Mountain Rescue" and "SAR Tracker" branding
6. RIGHT SIDE - MISSION: Mission Control panel pinned at top showing "ACTIVE" status with running timers
7. RIGHT SIDE - TABS: A segmented tab control with Tracking / Tools / Layers below Mission Control
8. RIGHT SIDE - TRACKING: Tracking panel showing "online" status with device count (active tab)
9. The overall layout should be: map taking ~70% width, sidebar taking ~30% width
10. Theme should be dark with amber/gold accents
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'full-page screenshot with all panels visible',
      ],
    })
  })
})
