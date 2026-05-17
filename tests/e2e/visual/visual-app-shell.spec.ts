/**
 * Visual verification tests for the SAR Tracker app shell.
 *
 * These tests verify that the core operator interface renders correctly:
 * - Application branding and layout
 * - Map rendering with correct basemap
 * - Sidebar panels in their default states
 * - Map Tools toolbar presence and completeness
 * - Coordinate bar functionality
 *
 * Each test captures a screenshot with a verification manifest entry.
 * After tests run, an Opus subagent independently verifies each screenshot.
 *
 * LIFE-SAFETY CRITICAL: Incorrect UI layout or missing panels during a SAR
 * operation could cause operators to miss critical information.
 */
import { expect, test } from '@playwright/test'
import { navigateToHarness } from './helpers/test-setup'
import {
  captureAndRegister,
  captureElementAndRegister,
} from './helpers/verification-manifest'

test.describe('Visual: App Shell', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page)
  })

  test('idle state shows correct layout with all panels', async ({ page }) => {
    // Playwright assertions
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await expect(page.locator('canvas').first()).toBeVisible()
    await expect(page.getByTestId('basemap-switcher')).toBeVisible()
    await expect(page.getByTestId('mission-control')).toBeVisible()
    await expect(page.getByTestId('tracking-status')).toBeVisible()
    await expect(page.getByTestId('drawing-toolbar')).toBeVisible()

    await captureAndRegister(page, {
      testId: 'shell-idle-state',
      testName: 'App shell in idle state',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker application in idle state.

Important context for the reviewer:
- This capture is taken in a headless browser shortly after first paint. Map tiles are still loading, so the map area may show a partially-rendered topographic surface or an overlaid "Loading OpenTopoMap basemap" status badge — both are acceptable idle-state appearances. Do NOT fail the screenshot just because the basemap raster is incomplete or because a "Loading" / "Some tiles failed to load" health badge is visible.
- The compact Maps menu is closed by default in this idle-state capture and renders as a single "MAPS" / "OpenTopoMap" dropdown control near the top-left of the map. Do NOT expect four visible basemap buttons here — the four-button switcher is a separate test that opens the menu.

Check:
1. The command mast (top header strip) shows "Mountain Rescue" and "SAR Tracker" title text near the top-left.
2. A "MISSION CONTROL" section is pinned in the right-hand sidebar showing "idle" status with both timers at "00:00:00".
3. Below Mission Control there is a segmented tab control with three tabs labelled "Tracking", "Tools", and "Layers".
4. A "TRACKING" section is visible (the Tracking tab is active by default), showing an idle / no-active-mission state. Empty / placeholder content is correct here.
5. A compact Maps control is visible near the top-left of the map area — a single dropdown-style chip labelled "MAPS" with the currently selected basemap name (e.g. "OpenTopoMap"). It does NOT need to be expanded.
6. A collapsed Map Tools toolbar is visible on the left side of the map, showing a "MAP TOOLS" header with the current active mode label (for example "SELECT" or "Mission required").
7. A coordinate bar is visible along the bottom edge of the map area.
8. The overall theme is dark (dark stone/black backgrounds with light text and amber accents).
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'app-title contains "SAR Tracker"',
        'canvas is visible',
        'basemap-switcher is visible',
        'mission-control is visible',
        'tracking-status is visible',
        'drawing-toolbar is visible',
      ],
    })
  })

  test('map toolbar shows all tools with correct labels', async ({ page }) => {
    await expect(page.getByTestId('drawing-toolbar')).toBeVisible()
    await page.getByTestId('drawing-toolbar-expand').click()
    await expect(page.getByTestId('drawing-tool-line')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-search_area')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-range_ring')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-bearing_line')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-search_sector')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-text_label')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-measure')).toBeVisible()

    await captureElementAndRegister(page, 'drawing-toolbar', {
      testId: 'shell-drawing-toolbar',
      testName: 'Map toolbar completeness',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Map Tools toolbar in its expanded state. NOTE: no mission is active in this idle-state shell capture, so tool buttons are intentionally disabled and the active-mode chip shows "Mission required" — this is the correct disabled-state appearance and should NOT be flagged. Check:
1. There should be a "MAP TOOLS" header label at the top of the toolbar
2. Directly under the header, the active-mode chip should read "Mission required" (the tools are disabled because no mission is active)
3. There should be a vertical column of map tool buttons including "Line", "Search Area", "Range Rings", "Bearing", "Sector", "Text Label", and "Measure". Confirm at least 7 distinct tool buttons are visible and clearly labelled.
4. All tool buttons should appear visually disabled/dimmed (reduced opacity), reflecting the "Mission required" state
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'drawing-tool-line is visible',
        'drawing-tool-search_area is visible',
        'drawing-tool-range_ring is visible',
        'drawing-tool-bearing_line is visible',
        'drawing-tool-search_sector is visible',
        'drawing-tool-text_label is visible',
        'drawing-tool-measure is visible',
      ],
    })
  })

  test('basemap switcher shows all 4 options and selection persists', async ({ page }) => {
    await page.getByTestId('basemap-menu-toggle').click()
    await expect(page.getByTestId('basemap-btn-opentopomap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_topo')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-openstreetmap')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-esri_satellite')).toBeVisible()

    // OpenTopoMap should be the default selected basemap
    await expect(page.getByTestId('basemap-btn-opentopomap')).toHaveClass(/bg-amber/)

    await captureAndRegister(page, {
      testId: 'shell-basemap-switcher',
      testName: 'Basemap switcher with default selection',
      area: 'app-shell',
      severity: 'high',
      verificationPrompt: `Verify this screenshot of the SAR Tracker with the compact Maps menu open:
1. There should be exactly 4 basemap buttons in the Maps menu near the top-left of the map
2. The buttons should be labeled: "OpenTopoMap", "ESRI World Topo", "OpenStreetMap", "ESRI Satellite"
3. The "OpenTopoMap" button should appear selected/highlighted (different color from others)
4. The map itself should show a topographic map style with elevation contours and terrain features
5. The map should be centered roughly on the Kerry mountains area in Ireland
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'basemap-btn-opentopomap is visible',
        'basemap-btn-esri_topo is visible',
        'basemap-btn-openstreetmap is visible',
        'basemap-btn-esri_satellite is visible',
        'opentopomap button has amber highlight class',
      ],
    })
  })

  test('coordinate bar updates on mouse hover over map', async ({ page }) => {
    const mapContainer = page.getByTestId('map-container')
    const bounds = await mapContainer.boundingBox()
    expect(bounds).toBeTruthy()

    if (bounds) {
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.waitForTimeout(500)
    }

    await expect(page.getByTestId('coords-combined')).not.toHaveText('—')
    await expect(page.getByTestId('coords-combined')).toContainText('°')

    await captureAndRegister(page, {
      testId: 'shell-coordinate-bar',
      testName: 'Coordinate bar shows live coordinates',
      area: 'app-shell',
      severity: 'high',
      verificationPrompt: `Verify this screenshot showing the SAR Tracker coordinate bar:
1. At the bottom of the map area, there should be a coordinate bar
2. The coordinate bar should display coordinates with degree symbols (°)
3. The coordinates should show both WGS84 (lat/lon) and Irish Grid reference formats in clearly separated fields
4. The coordinates should be reasonable for Ireland (latitude ~51-53°N, longitude ~9-10°W)
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'coords-combined does not show placeholder dash',
        'coords-combined contains degree symbol',
      ],
    })
  })

  test('focus mode keeps mission, layer, and coordinate awareness visible', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Visual Focus Mode')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.getByTestId('focus-mode-toggle').click()
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-focus-mode', 'true')
    await expect(page.getByTestId('focus-mode-sidebar')).toBeVisible()
    await expect(page.getByTestId('mission-control')).toContainText('Visual Focus Mode')
    await expect(page.getByTestId('layer-panel')).toBeVisible()

    const mapContainer = page.getByTestId('map-container')
    const bounds = await mapContainer.boundingBox()
    expect(bounds).toBeTruthy()
    if (bounds) {
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    }
    await expect(page.getByTestId('focus-mode-coordinate-display')).toContainText('°')

    await captureAndRegister(page, {
      testId: 'shell-focus-mode',
      testName: 'Focus mode map-first operational shell',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker in Focus Mode Plus:
1. The map should remain the dominant surface and be wider than the normal shell
2. The normal full sidebar header/tabs should be replaced by a reduced Focus Mode Plus sidebar
3. The reduced sidebar should keep Mission Control visible with the active mission name and timers
4. Tracking status should still be visible in the reduced sidebar
5. Layer Workspace presence should remain visible in the reduced sidebar so operators know layer controls are still available
6. A mirrored focus coordinate display should be visible on top of the map
7. The Map Tools toolbar and map health/status badge should remain visible on the map
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'app-shell data-focus-mode is true',
        'focus-mode-sidebar is visible',
        'mission-control contains active mission',
        'layer-panel is visible',
        'focus-mode-coordinate-display contains coordinates',
      ],
    })
  })
})
