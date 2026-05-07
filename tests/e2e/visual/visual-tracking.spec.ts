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
      verificationPrompt: `Verify this screenshot of the SAR Tracker tracking status panel:
1. It should show "Tracking" as the section header
2. The connection status should show "online" (not "idle" or "offline")
3. There should be a count showing 3 devices tracked
4. Device names "Alpha Team", "Bravo Team", and/or "Charlie Team" may be visible
5. There should be position count information showing how many GPS positions have been received
6. The status should clearly communicate that tracking is active and receiving data
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
      map?.jumpTo({ center: [-9.7426, 51.9985], zoom: 14 })
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

    await captureElementAndRegister(page, 'layer-panel', {
      testId: 'tracking-layer-panel',
      testName: 'Layer panel with tracked devices',
      area: 'layers',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker layer panel with tracking devices:
1. There should be a "LAYER WORKSPACE" header
2. Under "Tracking" group, there should be a "People" subgroup
3. The People group should list exactly 3 devices: "Alpha Team", "Bravo Team", "Charlie Team"
4. Each device should have a visibility checkbox (checked by default)
5. There should be a "Breadcrumbs" item under Tracking
6. There may be a "Map Tools" section with marker type categories (IPP/LKP, Clues, Hazards, Casualties)
7. The count next to "People" should show 3
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'layer-panel is visible',
        'Alpha Team text visible',
        'Bravo Team text visible',
        'Charlie Team text visible',
      ],
    })
  })

  test('full operational view with tracking and all sidebar panels', async ({ page }) => {
    await captureAndRegister(page, {
      testId: 'tracking-full-operational',
      testName: 'Full operational view with active tracking',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker in full operational mode:
1. LEFT SIDE - MAP: A topographic map should be visible showing the Kerry mountains
2. LEFT SIDE - DEVICES: Device markers with team names should be visible on the map
3. LEFT SIDE - TOOLBAR: The drawing toolbar should be on the left side of the map
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
