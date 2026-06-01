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
      verificationPrompt: `Verify this screenshot of the SAR Tracker Mission Control panel in active state. NOTE: this capture is the Mission Control panel only — the mission name is rendered on the command mast outside this element and is verified by separate shell tests. Check only what is in frame:
1. The section header should show "MISSION CONTROL" with a "lifecycle and timing" subtitle
2. There should be an "ACTIVE" status indicator at the top right of the panel header, accompanied by a green dot
3. There should be two timer displays labelled "ELAPSED" and "ACTIVE SEARCH"
4. Both timers should show a time greater than 00:00:00 (they should be running)
5. The timers should show roughly the same time since the mission just started
6. There should be "Pause" and "Finish" buttons that appear enabled/clickable
7. The mission name input and Start button should NOT be visible while the mission is active
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
      verificationPrompt: `Verify this screenshot of the Mission Control panel for a back-dated SAR mission. NOTE: this capture is the Mission Control panel only — the mission name renders on the command mast outside this element. Check only what is in frame:
1. The section header should show "MISSION CONTROL"
2. The status indicator should show "ACTIVE" with a green dot
3. The ELAPSED timer should show approximately 02:00:XX (about 2 hours), confirming the back-dating offset
4. The ACTIVE SEARCH timer should show approximately 02:00:XX (about 2 hours)
5. Pause and Finish buttons should be visible and appear enabled
6. The mission name input and Start button should NOT be visible
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
    await page.waitForTimeout(3500)

    await expect(page.getByTestId('mission-pause-resume-btn')).toHaveText('Resume')
    await expect(page.getByTestId('mission-finish-btn')).toBeEnabled()
    await expect(page.getByTestId('mission-elapsed')).not.toHaveText(
      await page.getByTestId('mission-active-search').innerText(),
    )
    // DON-64: the paused state must be unmistakable — a red alarm chip, an
    // explicit text banner, and a dedicated in-banner Resume control.
    await expect(page.getByTestId('mission-phase-chip')).toHaveText('PAUSED')
    await expect(page.getByTestId('mission-paused-banner')).toBeVisible()
    await expect(page.getByTestId('mission-paused-banner')).toContainText('Mission paused')
    await expect(page.getByTestId('mission-paused-banner-resume-btn')).toBeVisible()

    await captureElementAndRegister(page, 'mission-control', {
      testId: 'mission-paused-state',
      testName: 'Mission control in paused state',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the Mission Control panel in PAUSED state. NOTE: this capture is the Mission Control panel only — the mission name renders on the command mast outside this element. Check only what is in frame:
1. The section header should show "MISSION CONTROL"
2. The status indicator near the top-right should show "PAUSED" (not "ACTIVE") rendered as a bright RED alarm chip — paused is deliberately loud, not a soft amber state
3. A prominent RED banner should be visible directly under the header reading "MISSION PAUSED" with explanatory text noting active-search time is frozen
4. That red banner should contain a clearly visible "RESUME MISSION" button
5. There should be two timer displays labelled "ELAPSED" and "ACTIVE SEARCH"
6. The ELAPSED timer should be greater than the ACTIVE SEARCH timer (elapsed keeps running, active freezes on pause)
7. The main pause/resume button should read "Resume" (not "Pause")
8. There should be a "Finish" button that appears enabled
9. The mission name input and Start button should NOT be visible
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission-control contains "paused"',
        'mission-phase-chip shows "PAUSED"',
        'mission-paused-banner is visible with Resume control',
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
1. An alertdialog confirmation should be visible inside Mission Control
2. The dialog should contain a "Confirm Finish" button or similar confirmation text
3. The dialog should clearly communicate that finishing the mission is a significant action
4. The dialog should trap focus and be visually distinct from the surrounding Mission Control content
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
3. There should be a prominent "Resume" button to continue the interrupted mission
4. There should be a "Start Fresh" button to abandon the interrupted mission and begin a new one
5. The recovery section should clearly communicate that a previous mission was interrupted and needs an operator decision before continuing
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
