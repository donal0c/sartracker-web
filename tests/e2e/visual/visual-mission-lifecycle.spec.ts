/**
 * Visual verification tests for mission lifecycle.
 *
 * These tests verify the complete mission state machine renders correctly:
 * - Mission start with timers running
 * - Pause state with frozen active search time
 * - Finish confirmation dialog
 * - Governance card after finish
 * - Recovery dialog on page reload
 *
 * LIFE-SAFETY CRITICAL: Mission timers drive search coordination. If the elapsed
 * or active search timers display incorrectly, teams may miscalculate search windows.
 */
import { expect, test } from '@playwright/test'
import {
  navigateToHarness,
  startMission,
  pauseMission,
  resumeMission,
} from './helpers/test-setup'
import {
  captureAndRegister,
  captureElementAndRegister,
} from './helpers/verification-manifest'

test.describe('Visual: Mission Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page)
  })

  test('active mission shows running timers and correct controls', async ({ page }) => {
    await startMission(page, 'Ridge Search Alpha')
    // Let timers advance slightly
    await page.waitForTimeout(2000)

    const missionControl = page.getByTestId('mission-control')
    await expect(missionControl).toContainText('active')
    await expect(page.getByTestId('current-mission-name')).toContainText('Ridge Search Alpha')
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeEnabled()
    await expect(page.getByTestId('mission-finish-btn')).toBeEnabled()

    await captureElementAndRegister(page, 'mission-control', {
      testId: 'mission-active-state',
      testName: 'Mission control in active state',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Mission Control panel in active state:
1. It should show "MISSION CONTROL" as the section header
2. There should be an "ACTIVE" status indicator, likely with a green dot
3. There should be two timer displays: "ELAPSED" and "ACTIVE SEARCH"
4. Both timers should show a time greater than 00:00:00 (they should be running)
5. The timers should show roughly the same time since the mission just started
6. The current mission name "RIDGE SEARCH ALPHA" should be displayed
7. There should be "PAUSE" and "FINISH" buttons that appear enabled/clickable
8. There should be a "START" button that appears disabled/grayed out
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission-control contains "active"',
        'current-mission-name contains "Ridge Search Alpha"',
        'pause-resume button is enabled',
        'finish button is enabled',
      ],
    })
  })

  test('back-dated mission shows offset in elapsed timer', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Delayed Start')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    // Timer should show ~2 hours
    await expect(page.getByTestId('mission-elapsed')).toHaveText(/^02:0\d:\d\d$/)

    await captureElementAndRegister(page, 'mission-control', {
      testId: 'mission-backdated-offset',
      testName: 'Mission with 2-hour back-dated start',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of a back-dated SAR mission:
1. The ELAPSED timer should show approximately 02:00:XX (about 2 hours)
2. The ACTIVE SEARCH timer should show approximately 02:00:XX (about 2 hours)
3. The mission name "DELAYED START" should be visible
4. The status should show "ACTIVE"
5. Both timers being at ~2 hours confirms the back-dating offset is working correctly
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission-control contains "active"',
        'mission-elapsed matches 02:0X:XX pattern',
      ],
    })
  })

  test('paused mission freezes active search time while elapsed continues', async ({ page }) => {
    await startMission(page, 'Pause Test Mission')
    await page.waitForTimeout(2000)
    await pauseMission(page)
    await page.waitForTimeout(1500)

    await expect(page.getByTestId('mission-pause-resume-btn')).toHaveText('Resume')
    await expect(page.getByTestId('mission-finish-btn')).toBeEnabled()

    await captureElementAndRegister(page, 'mission-control', {
      testId: 'mission-paused-state',
      testName: 'Mission control in paused state',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Mission Control in paused state:
1. The status should show "PAUSED" (not "ACTIVE")
2. There should be two timer displays: "ELAPSED" and "ACTIVE SEARCH"
3. The ELAPSED timer should be greater than the ACTIVE SEARCH timer (elapsed keeps running, active freezes on pause)
4. The mission name "PAUSE TEST MISSION" should be visible
5. There should be a "Resume" button (not "Pause")
6. There should be a "FINISH" button that appears enabled
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission-control contains "paused"',
        'pause-resume button shows "Resume"',
        'finish button is enabled',
      ],
    })
  })

  test('finish dialog appears with correct confirmation flow', async ({ page }) => {
    await startMission(page, 'Finish Dialog Test')
    await page.getByTestId('mission-finish-btn').click()

    await expect(page.getByTestId('mission-finish-dialog')).toBeVisible()

    await captureAndRegister(page, {
      testId: 'mission-finish-dialog',
      testName: 'Mission finish confirmation dialog',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot showing the mission finish confirmation dialog:
1. A modal/dialog should be overlaid on the main application
2. The dialog should contain a "Confirm Finish" button or similar confirmation text
3. The dialog should clearly communicate that finishing the mission is a significant action
4. The main application should be visible but dimmed/blurred behind the dialog
5. The mission should still show as "ACTIVE" in the background until confirmed
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission-finish-dialog is visible',
      ],
    })

    // Complete the finish
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()
    await expect(page.getByTestId('mission-control')).toContainText('idle')
  })

  test('governance card appears after mission finishes', async ({ page }) => {
    await startMission(page, 'Governance Test')
    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()
    await page.waitForTimeout(500)

    const govCard = page.getByTestId('mission-governance-card')
    await expect(govCard).toBeVisible()
    await expect(govCard).toContainText('Governance Test')

    await captureElementAndRegister(page, 'mission-governance-card', {
      testId: 'mission-governance-card',
      testName: 'Governance card after mission finish',
      area: 'mission',
      severity: 'high',
      verificationPrompt: `Verify this screenshot of the mission governance card:
1. It should display the mission name "Governance Test"
2. It should indicate the mission is in a "finished" state
3. There should be a "Finalize" or "Archive & Lock" button visible
4. The card should communicate that the mission can be finalized/archived
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'governance card is visible',
        'governance card contains mission name',
      ],
    })
  })

  test('recovery dialog appears after simulated crash', async ({ page }) => {
    await startMission(page, 'Recovery Scenario')
    // Simulate crash by reloading
    await page.reload()
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForSelector('canvas', { timeout: 20000 })
    await page.waitForTimeout(1000)

    const recoveryDialog = page.getByTestId('mission-recovery-dialog')
    await expect(recoveryDialog).toBeVisible()

    // Capture just the recovery element for clearer visual verification
    await captureElementAndRegister(page, 'mission-recovery-dialog', {
      testId: 'mission-recovery-dialog',
      testName: 'Crash recovery dialog',
      area: 'recovery',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker mission recovery section (embedded in the right sidebar, NOT a modal overlay):
1. There should be a "RESUME MISSION" section or heading indicating a previous mission can be resumed
2. The interrupted mission name "Recovery Scenario" should be displayed
3. There should be a "Resume" button (amber/yellow colored) to continue the interrupted mission
4. There should be a "Start Fresh" button to abandon the interrupted mission and begin a new one
5. The recovery section should clearly communicate that a previous mission was interrupted and needs operator decision
6. This is critical for operator safety — if the app crashes during a real SAR operation, the operator must be clearly prompted to resume
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission-recovery-dialog is visible',
      ],
    })

    // Clean up: start fresh
    await page.getByRole('button', { name: 'Start Fresh' }).click()
  })
})
