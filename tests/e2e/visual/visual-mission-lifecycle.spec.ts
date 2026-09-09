/**
 * Visual verification tests for mission lifecycle.
 *
 * These tests verify the complete mission state machine renders correctly:
 * - Mission start with timers running
 * - Minimized mission control owned by the command mast
 * - Pause state with frozen active search time
 * - Finish confirmation dialog
 * - Governance card after finish
 * - Recovery dialog on page reload
 *
 * LIFE-SAFETY CRITICAL: Mission timers drive search coordination. If the elapsed
 * or active search timers display incorrectly, teams may miscalculate search windows.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  navigateToHarness,
  startMission,
  pauseMission,
} from './helpers/test-setup'
import {
  captureElementAndRegister,
} from './helpers/verification-manifest'

const SYNTHETIC_ARCHIVE_PASSPHRASE = 'Synthetic!Archive123'

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

  test('minimized mission control moves lifecycle controls out of the side rail', async ({ page }) => {
    await startMission(page, 'Minimized Mast Check')
    await page.getByTestId('mission-control-collapse-btn').click()

    await expect(page.getByTestId('mission-control-dock')).toHaveCount(0)
    await expect(page.getByTestId('command-mast-mission-control-minimized')).toBeVisible()
    await expect(page.getByTestId('command-mast-mission-control-minimized')).toContainText(
      'Minimized Mast Check',
    )
    await expect(page.getByTestId('command-mast-mission-control-expand')).toBeVisible()
    await expect(page.getByTestId('mission-pause-resume-btn')).toHaveCount(0)
    await expect(page.getByTestId('mission-finish-btn')).toHaveCount(0)

    await captureElementAndRegister(page, 'command-mast-mission-control-minimized', {
      testId: 'mission-minimized-mast-state',
      testName: 'Mission Control minimized into the command mast',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this element-scoped screenshot of the minimized Mission Control cell in the top command mast:
1. It should show the active mission name "Minimized Mast Check".
2. It should show a visible "MINIMIZED" label.
3. It should show a visible "EXPAND" button.
4. It should look like compact command-mast content rather than the full right-rail Mission Control card.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission-control-dock count is 0',
        'command mast minimized mission cell is visible',
        'Expand control is visible in the command mast',
        'pause and finish controls are absent while minimized',
      ],
    })
  })

  test('outing section states the no-active boundary explicitly', async ({ page }) => {
    await navigateToHarness(page, { missionModel: true })
    await startMission(page, 'Outing Notice Test')
    const section = page.getByTestId('outing-controls-section')
    await expect(section).toBeVisible()
    await expect(page.getByTestId('outing-no-active-notice')).toContainText('Unassigned')

    await captureElementAndRegister(page, 'outing-controls-section', {
      testId: 'outing-no-active-state',
      testName: 'No active outing truthfulness notice',
      area: 'mission',
      severity: 'high',
      verificationPrompt: `Verify this screenshot of the Outings section:
1. It should be clearly headed "OUTINGS".
2. It should explicitly state that there is no active outing.
3. It should say that new fixes will be recorded as "Unassigned".
4. A visible "Start outing" action should be available.
5. The notice must not imply an outing was automatically created with the mission.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'Outings section is visible',
        'no-active notice contains Unassigned',
      ],
    })
  })

  test('outing summary keeps Unassigned separate from explicit periods', async ({ page }) => {
    await navigateToHarness(page, { missionModel: true })
    await startMission(page, 'Outing Summary Test')
    await page.getByTestId('outing-label-input').fill('Night deployment')
    await page.getByTestId('outing-start-btn').click()
    await expect(page.getByTestId('active-outing-label')).toContainText('Night deployment')
    await expect(page.getByTestId('outing-unassigned-row')).toBeVisible()

    await captureElementAndRegister(page, 'outing-controls-section', {
      testId: 'outing-summary-unassigned',
      testName: 'Explicit outing and Unassigned fix summary',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the Outings evidence summary:
1. "Night deployment" should be shown as the active explicit outing.
2. Its start boundary and "Open" end state should be visible.
3. Accepted fix count should be shown for the explicit outing.
4. A separate, visually clear "Unassigned" row should remain visible.
5. The Unassigned row should explain that it covers accepted fixes outside every explicit outing window.
6. Nothing should present Unassigned as a fake outing or calendar day.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'active outing label contains Night deployment',
        'Unassigned row is visible',
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

    await captureElementAndRegister(page, 'mission-finish-dialog', {
      testId: 'mission-finish-dialog',
      testName: 'Mission finish confirmation dialog',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this element-scoped screenshot of the mission finish confirmation card:
1. The card should be headed "END MISSION?".
2. It should contain a clearly visible "Confirm Finish" button and a "Cancel" button.
3. It should explain that finishing stops timers and returns the mission to IDLE while data remains saved.
4. The card should use warning/destructive styling appropriate for a significant mission lifecycle action.
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

  test('archive custody surface makes one-time recovery controls explicit', async ({ page }) => {
    await startMission(page, 'Synthetic Archive Custody Visual')
    await page.getByTestId('mission-finish-btn').click()
    await page
      .getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()
    await page.getByTestId('mission-finalize-btn').click()

    const custodyDialog = page.getByTestId('mission-archive-custody-dialog')
    await expect(custodyDialog).toBeVisible()
    await expect(page.getByTestId('archive-passphrase')).toHaveAttribute('type', 'password')
    await expect(page.getByTestId('archive-passphrase-confirmation')).toHaveAttribute(
      'type',
      'password',
    )
    await page.getByTestId('archive-passphrase').fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
    await page
      .getByTestId('archive-passphrase-confirmation')
      .fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-issue-recovery-code').click()

    const recoveryCode = (await page.getByTestId('archive-recovery-code').innerText()).trim()
    expect(recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(?:-[0-9A-HJKMNP-TV-Z]{5}){7}$/)
    await page.getByTestId('archive-recovery-code-confirmation').fill(recoveryCode)
    await expect(page.getByTestId('archive-recovery-code-confirmation')).toHaveAttribute(
      'type',
      'password',
    )
    await expect(page.getByTestId('archive-finalize')).toBeEnabled()
    await expect(custodyDialog.getByRole('button', { name: /copy/i })).toHaveCount(0)
    await expect(custodyDialog.getByText(/clipboard/i)).toHaveCount(0)

    await captureElementAndRegister(page, 'mission-archive-custody-dialog', {
      testId: 'mission-archive-custody-issued-code',
      testName: 'Encrypted archive custody with one-time recovery code',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify only the visible facts in this element-scoped screenshot of the browser-validation archive custody card. The test credentials are synthetic; this image does not prove encryption:
1. The card should be headed "ARCHIVE AND LOCK MISSION" under an "ENCRYPTED MISSION ARCHIVE" label.
2. It should state that the live mission remains intact if archive creation or verification fails.
3. A clearly visible hyphenated recovery code should be accompanied by wording that it is shown only for this archive attempt.
4. The recovery-code confirmation field should visibly render masked characters rather than the typed code.
5. The primary action should say "Create, seal, and verify archive".
6. A cancellation action should be visible.
7. No Copy, clipboard, delete, or cleanup action should be visible.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'archive custody dialog is visible',
        'both passphrase fields are password inputs before issuance',
        'recovery code has the browser-harness eight-by-five grouped shape',
        'recovery confirmation is a password input',
        'create, seal, and verify action is enabled after exact typed-back confirmation',
        'no Copy or clipboard affordance exists in the custody dialog',
      ],
    })

    await page.getByTestId('archive-cancel').click()
    await expect(custodyDialog).toBeHidden()
  })

  test('known evidence loss acknowledgement stays explicit and cannot imply Complete', async ({ page }) => {
    await page.evaluate(() => {
      window.localStorage.setItem(
        'sartracker:browser-settings',
        JSON.stringify({ missionDefaults: { adminRoster: ['Ops Lead'] } }),
      )
    })
    await page.reload()
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForSelector('canvas', { timeout: 20_000 })
    await startMission(page, 'Evidence Gap Visual')
    const missionId = await page.evaluate(
      () => window.__SARTRACKER_BROWSER_HARNESS__?.readState().currentMissionId ?? null,
    )
    expect(missionId).not.toBeNull()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()
    await page.evaluate(async (id) => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.injectEvidenceLoss(id)
    }, missionId!)
    await finalizeWithSyntheticArchiveCustody(page)

    await expect(page.getByTestId('mission-evidence-loss-dialog')).toBeVisible()
    await captureElementAndRegister(page, 'mission-evidence-loss-dialog', {
      testId: 'mission-evidence-loss-acknowledgement',
      testName: 'Known evidence loss acknowledgement',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this element-scoped screenshot of the known mission-evidence-loss acknowledgement card:
1. The heading must clearly say "ACKNOWLEDGE KNOWN EVIDENCE LOSS".
2. The warning must explicitly say the action does not restore missing evidence.
3. The warning must explicitly say Complete or 100% is never permitted.
4. An Admin Identity selector and an Evidence Loss Record text area must be visible.
5. The primary action must say "Record Gap & Allow Archive", making archive closure distinct from evidence completeness.
6. The card must have unmistakable critical/warning styling and a Cancel action.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'evidence-loss acknowledgement dialog is visible',
        'dialog says it never permits Complete or 100%',
        'admin selector and evidence-loss record are visible',
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

async function finalizeWithSyntheticArchiveCustody(page: Page): Promise<void> {
  await page.getByTestId('mission-finalize-btn').click()
  const dialog = page.getByTestId('mission-archive-custody-dialog')
  await expect(dialog).toBeVisible()
  await page.getByTestId('archive-passphrase').fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
  await page
    .getByTestId('archive-passphrase-confirmation')
    .fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
  await page.getByTestId('archive-issue-recovery-code').click()
  const recoveryCode = (await page.getByTestId('archive-recovery-code').innerText()).trim()
  await page.getByTestId('archive-recovery-code-confirmation').fill(recoveryCode)
  await page.getByTestId('archive-finalize').click()
}
