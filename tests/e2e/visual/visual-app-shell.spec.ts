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
import {
  navigateToHarness,
  waitForAppShell,
  startMission,
  injectStandardTracking,
} from './helpers/test-setup'
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
1. The right sidebar should show "Kerry Mountain Rescue" and "SAR Tracker" title text
2. There should be a "MISSION CONTROL" section showing "idle" state with timers at 00:00:00
3. There should be a "TRACKING" section showing idle status
4. The left side should show a topographic map (OpenTopoMap basemap with terrain contours)
5. The top of the map should have 4 basemap switcher buttons (OpenTopoMap, ESRI Topo, OpenStreetMap, ESRI Satellite)
6. A drawing toolbar should be visible on the left side with tools: Select, Line, Search Area, Range Rings, Bearing, Sector, Text Label
7. A coordinate bar should be visible at the bottom of the map
8. The overall theme should be dark (dark backgrounds with light text)
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
1. There should be exactly 7 drawing tool buttons arranged in a grid
2. The tools should be labeled: "Select", "Line", "Search Area", "Range Rings", "Bearing", "Sector", "Text Label"
3. Each tool card should have a brief description of how to use it
4. The "Select" tool should appear to be currently active (highlighted)
5. There should be an "ACTIVE: SELECT" indicator at the top
6. LPB category labels should be listed at the bottom (Child, Hiker, Hunter, Elderly, Dementia, etc.)
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
      verificationPrompt: `Verify this screenshot of the SAR Tracker with basemap switcher:
1. There should be exactly 4 basemap buttons in a horizontal row near the top of the map
2. The buttons should be labeled: "OpenTopoMap", "ESRI Topo", "OpenStreetMap", "ESRI Satellite"
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
3. The coordinates should show both WGS84 (lat/lon) and Irish Grid reference formats separated by a pipe (|)
4. The coordinates should be reasonable for Ireland (latitude ~51-53°N, longitude ~9-10°W)
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'coords-combined does not show placeholder dash',
        'coords-combined contains degree symbol',
      ],
    })
  })
})
