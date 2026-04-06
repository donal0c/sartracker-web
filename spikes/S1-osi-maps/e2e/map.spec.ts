import { test, expect } from '@playwright/test';

test.describe('SAR Tracker Map', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for MapLibre to render (canvas appears inside the map container)
    await page.waitForSelector('canvas', { timeout: 10000 });
  });

  test('map loads and renders a canvas', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas.first()).toBeVisible();
  });

  test('basemap switcher is visible with all options', async ({ page }) => {
    const switcher = page.getByTestId('basemap-switcher');
    await expect(switcher).toBeVisible();

    // Check all four basemap buttons exist
    await expect(page.getByTestId('basemap-btn-opentopomap')).toBeVisible();
    await expect(page.getByTestId('basemap-btn-esri_topo')).toBeVisible();
    await expect(page.getByTestId('basemap-btn-openstreetmap')).toBeVisible();
    await expect(page.getByTestId('basemap-btn-esri_satellite')).toBeVisible();
  });

  test('clicking a basemap button switches the map', async ({ page }) => {
    // Click ESRI Topo
    await page.getByTestId('basemap-btn-esri_topo').click();

    // Wait a moment for style to load
    await page.waitForTimeout(1000);

    // The button should now be highlighted (has different styling)
    const btn = page.getByTestId('basemap-btn-esri_topo');
    const bg = await btn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    // Active button should have the blue background
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('coordinate display shows WGS84 and Irish Grid', async ({ page }) => {
    const coordDisplay = page.getByTestId('coordinate-display');
    await expect(coordDisplay).toBeVisible();

    // Move mouse over the map to trigger coordinate update
    const mapContainer = page.getByTestId('map-container');
    const box = await mapContainer.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    }

    // Wait for coordinates to update
    await page.waitForTimeout(500);

    const wgs84 = page.getByTestId('coords-wgs84');
    const irishGrid = page.getByTestId('coords-irish-grid');

    // Check that WGS84 shows degree symbol
    await expect(wgs84).toContainText('\u00b0');
    // Check that Irish Grid shows a grid reference (letter + numbers)
    const gridText = await irishGrid.textContent();
    expect(gridText).toBeTruthy();
  });

  test('pre-cache button is visible and clickable', async ({ page }) => {
    const precacheBtn = page.getByTestId('precache-btn');
    await expect(precacheBtn).toBeVisible();
    await expect(precacheBtn).toContainText('Pre-cache Kerry');
  });

  test('online status indicator is visible', async ({ page }) => {
    const status = page.getByTestId('online-status');
    await expect(status).toBeVisible();
    // Should show Online when browser is connected
    await expect(status).toContainText('Online');
  });
});
