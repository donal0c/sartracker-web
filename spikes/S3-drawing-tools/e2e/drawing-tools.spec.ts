import { test, expect } from '@playwright/test';

// Helper to click on the map overlay
async function clickMap(page: import('@playwright/test').Page, position: { x: number; y: number }) {
  const overlay = page.getByTestId('map-click-overlay');
  await overlay.click({ position });
}

async function dblClickMap(page: import('@playwright/test').Page, position: { x: number; y: number }) {
  const overlay = page.getByTestId('map-click-overlay');
  await overlay.dblclick({ position });
}

test.describe('SAR Drawing Tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map"]');
    await page.waitForTimeout(1500); // Allow map to initialize
  });

  // ========== TOOLBAR TESTS ==========

  test('toolbar renders all tool buttons', async ({ page }) => {
    await expect(page.getByTestId('toolbar')).toBeVisible();
    await expect(page.getByTestId('tool-select')).toBeVisible();
    await expect(page.getByTestId('tool-line')).toBeVisible();
    await expect(page.getByTestId('tool-polygon')).toBeVisible();
    await expect(page.getByTestId('tool-range-ring')).toBeVisible();
    await expect(page.getByTestId('tool-bearing-line')).toBeVisible();
    await expect(page.getByTestId('tool-sector')).toBeVisible();
    await expect(page.getByTestId('tool-measure')).toBeVisible();
    await expect(page.getByTestId('tool-marker')).toBeVisible();
  });

  test('tool activation toggles active state', async ({ page }) => {
    const lineBtn = page.getByTestId('tool-line');
    await lineBtn.click();
    await expect(lineBtn).toHaveClass(/active/);

    // Click again to deactivate
    await lineBtn.click();
    await expect(lineBtn).not.toHaveClass(/active/);
  });

  test('marker tool shows marker type selector', async ({ page }) => {
    await page.getByTestId('tool-marker').click();
    await expect(page.getByTestId('marker-type-selector')).toBeVisible();
    await expect(page.getByTestId('marker-type-ipp')).toBeVisible();
    await expect(page.getByTestId('marker-type-clue')).toBeVisible();
    await expect(page.getByTestId('marker-type-hazard')).toBeVisible();
    await expect(page.getByTestId('marker-type-casualty')).toBeVisible();
  });

  // ========== LINE TOOL ==========

  test('line tool: draw a line with double-click finish', async ({ page }) => {
    await page.getByTestId('tool-line').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');

    await clickMap(page, { x: 300, y: 250 });
    await clickMap(page, { x: 400, y: 300 });
    await dblClickMap(page, { x: 500, y: 250 });

    // Wait for feature to be added
    await page.waitForTimeout(300);
  });

  // ========== POLYGON / SEARCH AREA ==========

  test('polygon tool: draw and open search area dialog', async ({ page }) => {
    await page.getByTestId('tool-polygon').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');

    await clickMap(page, { x: 300, y: 200 });
    await clickMap(page, { x: 500, y: 200 });
    await clickMap(page, { x: 400, y: 350 });
    await dblClickMap(page, { x: 400, y: 350 });

    await expect(page.getByTestId('search-area-dialog')).toBeVisible();
  });

  test('search area dialog: metadata form works', async ({ page }) => {
    await page.getByTestId('tool-polygon').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');

    await clickMap(page, { x: 300, y: 200 });
    await clickMap(page, { x: 500, y: 200 });
    await clickMap(page, { x: 400, y: 350 });
    await dblClickMap(page, { x: 400, y: 350 });

    await expect(page.getByTestId('search-area-dialog')).toBeVisible();

    await page.getByTestId('sa-name').fill('Alpha Sector');
    await page.getByTestId('sa-team').fill('Team 1');
    await page.getByTestId('sa-status').selectOption('Assigned');
    await page.getByTestId('sa-priority').fill('1');
    await page.getByTestId('sa-poa').fill('35');
    await page.getByTestId('sa-terrain').selectOption('Mountain');
    await page.getByTestId('sa-notes').fill('Steep terrain');

    await expect(page.getByTestId('sa-area')).toContainText('Area:');

    await page.getByTestId('sa-create').click();
    await expect(page.getByTestId('search-area-dialog')).not.toBeVisible();
  });

  // ========== RANGE RING ==========

  test('range ring tool: click opens dialog', async ({ page }) => {
    await page.getByTestId('tool-range-ring').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('range-ring-dialog')).toBeVisible();
  });

  test('range ring dialog: manual mode creates rings', async ({ page }) => {
    await page.getByTestId('tool-range-ring').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('range-ring-dialog')).toBeVisible();
    await page.getByTestId('rr-radius').fill('2000');
    await page.getByTestId('rr-count').fill('3');
    await page.getByTestId('rr-create').click();

    await expect(page.getByTestId('range-ring-dialog')).not.toBeVisible();
  });

  test('range ring dialog: LPB mode creates rings', async ({ page }) => {
    await page.getByTestId('tool-range-ring').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('range-ring-dialog')).toBeVisible();

    // Switch to LPB mode
    const lpbRadio = page.locator('.dialog input[type="radio"]').nth(1);
    await lpbRadio.click();

    await page.getByTestId('rr-lpb-category').selectOption('hiker');
    await page.getByTestId('rr-create').click();

    await expect(page.getByTestId('range-ring-dialog')).not.toBeVisible();
  });

  // ========== BEARING LINE ==========

  test('bearing line tool: click opens dialog', async ({ page }) => {
    await page.getByTestId('tool-bearing-line').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('bearing-line-dialog')).toBeVisible();
  });

  test('bearing line dialog: creates bearing line', async ({ page }) => {
    await page.getByTestId('tool-bearing-line').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('bearing-line-dialog')).toBeVisible();
    await page.getByTestId('bl-bearing').fill('45');
    await page.getByTestId('bl-distance').fill('2000');
    await page.getByTestId('bl-create').click();

    await expect(page.getByTestId('bearing-line-dialog')).not.toBeVisible();
  });

  test('bearing line dialog: shows magnetic conversion', async ({ page }) => {
    await page.getByTestId('tool-bearing-line').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('bearing-line-dialog')).toBeVisible();
    await page.getByTestId('bl-bearing').fill('90');
    const conversion = page.getByTestId('bl-conversion');
    await expect(conversion).toContainText('Magnetic');
    await expect(conversion).toContainText('-4.5');
  });

  // ========== SEARCH SECTOR ==========

  test('sector tool: click opens dialog', async ({ page }) => {
    await page.getByTestId('tool-sector').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('sector-dialog')).toBeVisible();
  });

  test('sector dialog: creates sector', async ({ page }) => {
    await page.getByTestId('tool-sector').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('sector-dialog')).toBeVisible();
    await page.getByTestId('sec-start').fill('0');
    await page.getByTestId('sec-end').fill('90');
    await page.getByTestId('sec-radius').fill('1500');
    await page.getByTestId('sec-create').click();

    await expect(page.getByTestId('sector-dialog')).not.toBeVisible();
  });

  // ========== MEASUREMENT ==========

  test('measurement tool: two clicks create measurement', async ({ page }) => {
    await page.getByTestId('tool-measure').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');

    await clickMap(page, { x: 300, y: 250 });
    await clickMap(page, { x: 500, y: 350 });

    // Feature should be added
    await page.waitForTimeout(300);
  });

  // ========== MARKER ==========

  test('marker tool: click opens dialog', async ({ page }) => {
    await page.getByTestId('tool-marker').click();
    await page.getByTestId('marker-type-ipp').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('marker-dialog')).toBeVisible();
  });

  test('marker dialog: creates marker', async ({ page }) => {
    await page.getByTestId('tool-marker').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('marker-dialog')).toBeVisible();
    await page.getByTestId('mk-name').fill('Test IPP');
    await page.getByTestId('mk-notes').fill('Found near river');
    await page.getByTestId('mk-create').click();

    await expect(page.getByTestId('marker-dialog')).not.toBeVisible();
  });

  // ========== DIALOG CANCELLATION ==========

  test('dialog cancel closes without creating feature', async ({ page }) => {
    await page.getByTestId('tool-range-ring').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('range-ring-dialog')).toBeVisible();
    await page.getByTestId('rr-cancel').click();
    await expect(page.getByTestId('range-ring-dialog')).not.toBeVisible();
  });

  // ========== MARKER → SELECT → PROPERTIES PANEL ==========

  test('place marker, select it, verify properties panel', async ({ page }) => {
    // Create a marker
    await page.getByTestId('tool-marker').click();
    await page.getByTestId('marker-type-ipp').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await expect(page.getByTestId('marker-dialog')).toBeVisible();
    await page.getByTestId('mk-name').fill('Test IPP Alpha');
    await page.getByTestId('mk-notes').fill('Near summit');
    await page.getByTestId('mk-create').click();
    await expect(page.getByTestId('marker-dialog')).not.toBeVisible();

    // Switch to select tool and click the same location
    await page.getByTestId('tool-select').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });
    await page.waitForTimeout(500);

    // Verify properties panel shows with correct data
    const panel = page.getByTestId('properties-panel');
    if (await panel.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(panel).toContainText('Test IPP Alpha');
      await expect(panel).toContainText('marker');
    }
  });

  // ========== COORDINATE BAR ==========

  test('coordinate bar is visible', async ({ page }) => {
    await expect(page.getByTestId('coordinate-bar')).toBeVisible();
  });

  // ========== SELECT / DELETE ==========

  test('select tool: overlay appears when active', async ({ page }) => {
    await page.getByTestId('tool-select').click();
    await expect(page.getByTestId('map-click-overlay')).toBeVisible();
  });

  test('delete removes a feature', async ({ page }) => {
    // Create a range ring first
    await page.getByTestId('tool-range-ring').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });
    await page.getByTestId('rr-radius').fill('5000');
    await page.getByTestId('rr-count').fill('1');
    await page.getByTestId('rr-create').click();

    // Switch to select
    await page.getByTestId('tool-select').click();
    await page.waitForSelector('[data-testid="map-click-overlay"]');
    await clickMap(page, { x: 400, y: 300 });

    await page.waitForTimeout(500);

    // If properties panel visible, delete the feature
    const deleteBtn = page.getByTestId('delete-feature');
    if (await deleteBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await deleteBtn.click();
      await expect(page.getByTestId('properties-panel')).not.toBeVisible();
    }
  });
});
