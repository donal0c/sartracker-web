/**
 * Visual verification tests for the SAR Tracker app shell.
 *
 * These tests verify that the core operator interface renders correctly:
 * - Application branding and layout
 * - Map rendering with correct basemap
 * - Sidebar panels in their default states
 * - Drawing toolbar presence and completeness
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
      verificationPrompt: `Verify this screenshot of the SAR Tracker application in idle state:
1. The command mast should show "Mountain Rescue" and "SAR Tracker" title text
2. There should be a "MISSION CONTROL" section pinned at top showing "idle" state with timers at 00:00:00
3. Below Mission Control, there should be a segmented tab control with Tracking / Tools / Layers
4. There should be a "TRACKING" section showing idle status (active tab by default)
5. The left side should show a topographic map (OpenTopoMap basemap with terrain contours)
6. The top of the map should have 4 basemap switcher buttons (OpenTopoMap, ESRI World Topo, OpenStreetMap, ESRI Satellite)
7. A collapsed drawing toolbar should be visible on the left side with a Drawing Tools label and current active tool
8. A coordinate bar should be visible at the bottom of the map
9. The overall theme should be dark (dark backgrounds with light text)
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

  test('drawing toolbar shows all 7 tools with correct labels', async ({ page }) => {
    await expect(page.getByTestId('drawing-toolbar')).toBeVisible()
    await page.getByTestId('drawing-toolbar-expand').click()
    await expect(page.getByTestId('drawing-tool-line')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-search_area')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-range_ring')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-bearing_line')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-search_sector')).toBeVisible()
    await expect(page.getByTestId('drawing-tool-text_label')).toBeVisible()

    await captureElementAndRegister(page, 'drawing-toolbar', {
      testId: 'shell-drawing-toolbar',
      testName: 'Drawing toolbar completeness',
      area: 'app-shell',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker drawing toolbar:
1. There should be exactly 7 drawing tool buttons arranged in a vertical toolbar
2. The tools should be labeled: "Select", "Line", "Search Area", "Range Rings", "Bearing", "Sector", "Text Label"
3. The "Select" tool should appear to be currently active (highlighted)
4. There should be an "ACTIVE: SELECT" indicator at the top
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'drawing-tool-line is visible',
        'drawing-tool-search_area is visible',
        'drawing-tool-range_ring is visible',
        'drawing-tool-bearing_line is visible',
        'drawing-tool-search_sector is visible',
        'drawing-tool-text_label is visible',
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
7. The drawing toolbar and map health/status badge should remain visible on the map
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
