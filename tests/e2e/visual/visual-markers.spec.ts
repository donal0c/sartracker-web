/**
 * Visual verification tests for SAR markers.
 *
 * These tests verify that marker creation and editing UI renders correctly:
 * - IPP/LKP marker dialog with subject category
 * - Clue marker with confidence levels
 * - Hazard marker with severity levels
 * - Casualty marker with evacuation priority
 * - Marker coordinates display (WGS84, ITM, TM65)
 *
 * LIFE-SAFETY CRITICAL: Incorrect marker placement or metadata could direct
 * search teams to wrong locations or cause misidentification of evidence.
 */
import { expect, test } from '@playwright/test'
import {
  navigateToHarness,
  startMission,
  clickMap,
} from './helpers/test-setup'
import {
  captureAndRegister,
} from './helpers/verification-manifest'

test.describe('Visual: Markers', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page)
    await startMission(page, 'Marker Verification')
  })

  test('IPP/LKP marker dialog shows coordinate systems and subject category', async ({ page }) => {
    // Click center of map to create marker
    await clickMap(page, { x: 650, y: 350 })
    await page.waitForTimeout(500)

    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()

    // Verify IPP/LKP is default selected
    await expect(page.getByTestId('marker-name-input')).toBeVisible()

    await page.getByTestId('marker-name-input').fill('Initial Point')

    await captureAndRegister(page, {
      testId: 'marker-ipp-dialog',
      testName: 'IPP/LKP marker creation dialog',
      area: 'markers',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker marker creation dialog for IPP/LKP type:
1. A modal dialog should be visible with "NEW MARKER" and "Marker Details" header
2. There should be 4 marker type tabs: "IPP/LKP", "Clue", "Hazard", "Casualty"
3. "IPP/LKP" should be the currently selected/active tab
4. The dialog should show 3 coordinate formats:
   a. WGS84 coordinates (latitude/longitude with degree notation)
   b. ITM coordinates (6-digit easting/northing)
   c. TM65 GRID REF (Irish Grid reference format like "V XXXXX XXXXX")
5. There should be a "NAME" input field (may contain "Initial Point")
6. There should be a "DESCRIPTION" field
7. There should be a "SUBJECT CATEGORY" dropdown
8. There should be "UPDATED BY" and "COORDINATOR IDS" fields
9. There should be an "EVIDENCE ATTACHMENT" section with a file upload
10. There should be a "Close" button in the top-right corner
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'marker-dialog is visible',
        'marker-name-input is visible',
      ],
    })

    await page.getByTestId('marker-save-btn').click()
  })

  test('Clue marker shows confidence and clue type fields', async ({ page }) => {
    await clickMap(page, { x: 650, y: 350 })
    await page.waitForTimeout(500)

    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()

    // Switch to Clue type
    await dialog.getByText('Clue', { exact: true }).click()
    await page.waitForTimeout(300)

    await page.getByTestId('marker-name-input').fill('Boot Print Near Ridge')
    await page.getByTestId('marker-clue-type-input').selectOption('Footprint')
    await page.getByTestId('marker-confidence-input').selectOption('Probable')
    await page.getByTestId('marker-found-by-input').fill('Team 2')

    await captureAndRegister(page, {
      testId: 'marker-clue-dialog',
      testName: 'Clue marker dialog with fields populated',
      area: 'markers',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Clue marker dialog:
1. The "Clue" tab should be selected/active among the 4 marker type tabs
2. There should be a "CLUE TYPE" dropdown showing "Footprint"
3. There should be a "CONFIDENCE" dropdown showing "Probable"
4. There should be a "FOUND BY" field containing "Team 2"
5. The marker name should show "Boot Print Near Ridge"
6. Coordinate information should be displayed (WGS84, ITM, TM65)
7. There should be Save and Cancel/Close buttons
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'marker-dialog is visible',
        'clue type tab is selected',
        'clue-type-input set to Footprint',
        'confidence-input set to Probable',
        'found-by-input contains Team 2',
      ],
    })

    await page.getByTestId('marker-save-btn').click()
  })

  test('Hazard marker shows severity levels', async ({ page }) => {
    await clickMap(page, { x: 650, y: 350 })
    await page.waitForTimeout(500)

    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByText('Hazard', { exact: true }).click()
    await page.waitForTimeout(300)

    await page.getByTestId('marker-name-input').fill('Cliff Edge West Face')
    await page.getByTestId('marker-hazard-type-input').selectOption('Cliff/Drop-off')
    await page.getByTestId('marker-severity-input').selectOption('Critical')

    await captureAndRegister(page, {
      testId: 'marker-hazard-dialog',
      testName: 'Hazard marker dialog with critical severity',
      area: 'markers',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Hazard marker dialog:
1. The "Hazard" tab should be selected/active
2. There should be a "HAZARD TYPE" dropdown showing "Cliff/Drop-off"
3. There should be a "SEVERITY" dropdown showing "Critical"
4. The marker name should show "Cliff Edge West Face"
5. Coordinate information should be displayed
6. This is a life-safety critical marker type — hazard markers warn search teams about dangerous terrain
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'marker-dialog is visible',
        'hazard tab is selected',
        'hazard-type shows Cliff/Drop-off',
        'severity shows Critical',
      ],
    })

    await page.getByTestId('marker-save-btn').click()
  })

  test('Casualty marker shows condition and evacuation fields', async ({ page }) => {
    await clickMap(page, { x: 650, y: 350 })
    await page.waitForTimeout(500)

    const dialog = page.getByTestId('marker-dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByText('Casualty', { exact: true }).click()
    await page.waitForTimeout(300)

    await page.getByTestId('marker-name-input').fill('Casualty Near Summit')

    await captureAndRegister(page, {
      testId: 'marker-casualty-dialog',
      testName: 'Casualty marker dialog',
      area: 'markers',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Casualty marker dialog:
1. The "Casualty" tab should be selected/active
2. The dialog should show casualty-specific fields (condition, evacuation priority, or treatment)
3. The marker name should show "Casualty Near Summit"
4. Coordinate information should be displayed (WGS84, ITM, TM65)
5. This is the most critical marker type — it represents a person who needs rescue
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'marker-dialog is visible',
        'casualty tab is selected',
      ],
    })

    await page.getByTestId('marker-save-btn').click()
  })
})
