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
import { openWorkspacePanel } from '../helpers/workspace-panels'
import { navigateToHarness, startMission } from './helpers/test-setup'
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
    await expect(page.getByTestId('map-scale-readout')).toBeVisible()
    await expect(page.getByTestId('ws-mission-button')).toBeVisible()
    await expect(page.getByTestId('ws-tracking-headline')).toBeVisible()
    await expect(page.getByTestId('drawing-toolbar')).toBeVisible()

    await captureAndRegister(page, {
      testId: 'shell-idle-state',
      testName: 'App shell in idle state',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker application in idle state, before any mission.

Important context for the reviewer:
- This capture is taken in a headless browser shortly after first paint. Map tiles are still loading, so the map area may show a partially-rendered topographic surface or an overlaid "Loading OpenTopoMap basemap" status badge — both are acceptable idle-state appearances. Do NOT fail the screenshot just because the basemap raster is incomplete or because a "Loading" / "Some tiles failed to load" health badge is visible.
- The compact Maps menu is closed by default in this idle-state capture and renders as a single "MAPS" / "OpenTopoMap" dropdown control near the top-left of the map. Do NOT expect four visible basemap buttons here — the four-button switcher is a separate test that opens the menu.
- The "New mission" start card may be open over the map; that is acceptable.

Check:
1. A single top bar runs across the window, with the team logo or "SAR Tracker" branding at its left.
2. The top bar has a Mission button saying no mission is running yet (for example "Start a mission" and "No mission running").
3. The top bar has a tracking line saying in whole words whether tracking is connected; before a mission it is not a red alarm.
4. The top bar has readable buttons such as Layers, Settings and More.
5. A compact Maps control is visible near the top-left of the map area — a single dropdown-style chip labelled "MAPS" with the currently selected basemap name (e.g. "OpenTopoMap"). It does NOT need to be expanded.
6. A collapsed Map Tools toolbar is visible near the top-left of the map, labelled "MAP TOOLS".
7. A compact "MAP SCALE" readout is visible over the map above the bottom coordinate strip.
8. A coordinate bar is visible along the bottom edge of the map area.
9. The overall theme is the light default (DON-344): light grey top bar and panels with dark text, strong borders and amber accents. The map itself is not themed.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'app-title contains "SAR Tracker"',
        'canvas is visible',
        'basemap-switcher is visible',
        'map-scale-readout is visible',
        'Mission button is visible',
        'tracking headline is visible',
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

  test('basemap switcher groups official and public fallback maps', async ({ page }) => {
    await page.getByTestId('basemap-menu-toggle').click()
    await expect(page.getByTestId('map-catalogue-group-official')).toContainText('Official maps')
    await expect(page.getByTestId('basemap-btn-official_discovery_topo')).toBeVisible()
    await expect(page.getByTestId('basemap-btn-official_discovery_topo')).toBeDisabled()
    await expect(page.getByTestId('map-catalogue-group-public-fallback')).toContainText(
      'Public fallback maps',
    )
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
1. The menu should be grouped with an "Official maps" section and a "Public fallback maps" section
2. The Official maps section should include "Discovery Topo", "Premium Basemap", "Aerial Imagery", and "High-Resolution Imagery"; in hosted visual mode each official option should be marked not configured / unavailable
3. The Public fallback maps section should include "OpenTopoMap", "ESRI World Topo", "OpenStreetMap", and "ESRI Satellite"
4. The "OpenTopoMap" public fallback button should appear selected/highlighted (different color from others)
5. The map itself should show a topographic map style with elevation contours and terrain features
6. The map should be centered roughly on the Kerry mountains area in Ireland
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'map-catalogue-group-official is visible',
        'basemap-btn-official_discovery_topo is visible and disabled',
        'map-catalogue-group-public-fallback is visible',
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

  test('map scale and centred coordinates remain readable at smaller desktop size', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })

    const mapContainer = page.getByTestId('map-container')
    const bounds = await mapContainer.boundingBox()
    expect(bounds).toBeTruthy()
    if (bounds) {
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    }

    await expect(page.getByTestId('map-scale-readout')).toBeVisible()
    await expect(page.getByTestId('map-scale-label')).toContainText(/m|km/)
    await expect(page.getByTestId('coordinate-readout-group')).toBeVisible()
    await expect(page.getByTestId('coords-combined')).not.toHaveText('—')

    await captureAndRegister(page, {
      testId: 'shell-map-scale-small-display',
      testName: 'Map scale and centred coordinate group at smaller desktop size',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker map shell at a smaller 1280x720 desktop size:
1. A map scale readout should be visible over the lower-left map area, above the coordinate strip, with a metric label such as metres or kilometres.
2. The coordinate readouts should be grouped together near the lower centre of the map area, not spread across the whole bottom edge.
3. The coordinate group should show DD, Irish Grid, and DMS fields with readable values.
4. The Convert button may remain on the lower-right side of the coordinate strip, but it must not push the coordinate group off centre.
5. The top bar, Maps control and Map Tools control should remain visible without horizontal overflow or critical clipping.
6. The map scale and coordinate strip should not cover each other.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'map-scale-readout is visible',
        'map-scale-label contains a metric unit',
        'coordinate-readout-group is visible',
        'coords-combined contains live coordinate values',
      ],
    })
  })

  // Was Focus mode; Full map replaced it in the new layout (DON-341).
  test('full map keeps mission, tracking, and coordinate awareness visible', async ({ page }) => {
    await startMission(page, 'Visual Full Map')
    await openWorkspacePanel(page, 'layers')
    await page.getByTestId('ws-full-map').click()
    await expect(page.locator('[data-testid="ws-side"][data-empty="true"]')).toBeAttached()
    await expect(page.getByTestId('ws-layers-panel')).toBeHidden()
    await expect(page.getByTestId('ws-mission-button')).toContainText('Visual Full Map')
    await expect(page.getByTestId('ws-tracking-headline')).toBeVisible()
    await expect(page.getByTestId('map-scale-readout')).toBeVisible()

    const mapContainer = page.getByTestId('map-container')
    const bounds = await mapContainer.boundingBox()
    expect(bounds).toBeTruthy()
    if (bounds) {
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    }
    await expect(page.getByTestId('coordinate-display')).toContainText('°')

    await captureAndRegister(page, {
      testId: 'shell-full-map',
      testName: 'Full map, map-first operational shell',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker with Full map on during a running mission:
1. No side panel is open: the map takes the whole width below the top bar.
2. The top bar still names the running mission "Visual Full Map" with readable timers.
3. The top bar still shows the tracking line in whole words, so tracking awareness is kept.
4. The top bar offers a way back to the panels (for example "Show panel").
5. The Maps control, Map Tools toolbar and metric map scale remain visible on the map.
6. The coordinate strip along the bottom shows coordinates with degree symbols.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'side panel area is empty',
        'Mission button names the running mission',
        'tracking headline is visible',
        'map-scale-readout is visible',
        'coordinate-display contains coordinates',
      ],
    })
  })
})
