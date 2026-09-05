import { expect, test, type Page } from '@playwright/test'

import {
  captureAndRegister,
  captureElementAndRegister,
} from './helpers/verification-manifest'
import { navigateToHarness, startMission } from './helpers/test-setup'

const SYNTHETIC_ARCHIVE_PASSPHRASE = 'Synthetic!Archive123'
const MISSION_NAME = 'Archived Mission Visual Proof'

test.describe('Visual: archive-backed Mission Review [DON-253 / BCP-16]', () => {
  test('keeps archive identity, Replay, read-only status, and plaintext residual warning unmistakable', async ({
    page,
  }) => {
    await navigateToHarness(page)
    await startMission(page, MISSION_NAME)
    const archive = await finalizeWithSyntheticArchiveCustody(page)

    await page.getByTestId('open-mission-review-workspace').click()
    const archiveControl = page.getByTestId('mission-archive-review-control')
    await expect(archiveControl).toContainText(MISSION_NAME)
    await expect(archiveControl).toContainText('Verified encrypted archive')
    await expect(archiveControl).not.toContainText(archive.archivePath)

    await page.getByTestId(`archive-review-select-${archive.archiveId}`).click()
    const credential = page.getByTestId('archive-review-secret')
    await expect(credential).toHaveAttribute('type', 'password')
    await credential.fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-review-open').click()

    const banner = page.getByTestId('mission-review-archive-banner')
    await expect(banner).toContainText('Archived mission - read-only')
    await expect(banner).toContainText('permission-restricted temporary plaintext review session')
    await expect(banner).not.toContainText(archive.archivePath)
    await expect(page.getByTestId('archive-review-secret')).toHaveCount(0)
    await expect(page.getByTestId(/^mission-review-open-path-/u)).toHaveCount(0)

    await page.getByRole('button', { name: 'Replay', exact: true }).click()
    await expect(page.getByTestId('mission-replay-workspace')).toBeVisible()
    await expect(page.getByTestId('mission-replay-workspace')).toContainText('Replay is read-only')
    await expect(banner).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 1000 })

    await captureAndRegister(page, {
      testId: 'archive-review-read-only-residual-warning',
      testName: 'Verified archive review is visibly read-only with temporary plaintext warning',
      area: 'mission-review',
      severity: 'critical',
      verificationPrompt: `This is browser-validation evidence of the rendered operator flow only; it does not prove encryption, archive-byte integrity, restore correctness, or operating-system cleanup. Verify the visible Archive Review state:
1. A persistent, high-salience banner must say the archived mission is read-only.
2. The banner must identify a verified archive without exposing a full digest or filesystem path.
3. The banner must explicitly warn that a permission-restricted temporary plaintext review session exists while the archive is open.
4. A clearly visible Close Archive Review action must explain how the temporary plaintext session is removed.
5. The Mission Review tabs and Replay workspace must remain visibly available for retained-history review.
6. Replay must be labelled read-only; no edit, delete, finalize, unlock, or path-opening action should be visible.
Report PASS or FAIL for each item, then an overall PASS/FAIL. Do not interpret this browser-validation screenshot as proof that encryption occurred.`,
      playwrightAssertions: [
        'verified archive timeline entry was visible before opening',
        'archive credential input was a password field and was removed after opening',
        'persistent archived mission read-only banner is visible',
        'temporary plaintext residual warning and Close Archive Review action are visible',
        'Replay workspace is visible and explicitly read-only',
        'no live path-opening controls or private archive path are present',
        'browser validation does not claim to prove encryption',
      ],
    })

    await page.getByTestId('mission-review-close-archive').click()
    await expect(banner).toHaveCount(0)
    await page.getByRole('button', { name: 'Mission Details', exact: true }).click()
    await expect(page.getByTestId('mission-review-workspace').getByText('Database Path', {
      exact: true,
    })).toBeVisible()
  })

  test('makes cleanup scope, complete preconditions, and retained archived state explicit', async ({
    page,
  }) => {
    await navigateToHarness(page)
    await startMission(page, MISSION_NAME)
    const archive = await finalizeWithSyntheticArchiveCustody(page)

    await page.setViewportSize({ width: 1440, height: 1600 })
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByTestId(`archive-cleanup-open-${archive.missionId}`).click()
    const dialog = page.getByTestId('mission-archive-cleanup-dialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.locator('section[aria-label="Cleanup safety checklist"]').getByRole('listitem'),
    ).toHaveCount(15)
    await expect(dialog).toContainText('Passed: Cleanup recovery journal integrity is valid')
    await expect(dialog).toContainText('Passed: Live rows still match the finalization boundary')
    await page.getByTestId('archive-cleanup-secret').fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-cleanup-confirmation').fill(MISSION_NAME)
    await expect(page.getByTestId('archive-cleanup-start')).toBeEnabled()

    await captureElementAndRegister(page, 'mission-archive-cleanup-dialog', {
      testId: 'archive-cleanup-complete-preconditions',
      testName: 'Archive live rows requires a fresh credential and explicit complete checklist',
      area: 'mission-review',
      severity: 'critical',
      verificationPrompt: `This is browser-validation evidence of the rendered operator flow only; it does not prove desktop deletion, encryption, archive-byte identity, or operating-system cleanup. Verify the visible live-store archival dialog:
1. The heading must say "Archive live mission rows" and the scope text must say only bulk live-database evidence rows move.
2. It must explicitly say the mission remains listed and reviewable from its verified encrypted archive.
3. It must explicitly say nothing is deleted from the archive and this is not an evidence-deletion feature.
4. A fixed safety checklist must visibly enumerate every precondition with text status, not colour alone; all immutable checks should pass and a fresh credential should remain pending.
5. The checklist must explicitly show that cleanup recovery-journal integrity is valid.
6. The checklist must explicitly show that live rows still match the finalization boundary.
7. The archive credential must be visibly masked, and the exact mission-name confirmation must identify "${MISSION_NAME}".
8. The destructive-sounding action must be explicit and visually distinct, with a non-destructive Close action also visible.
9. No unlock, edit, archive deletion, filesystem path, raw digest, or custody-role assignment should be visible.
Report PASS or FAIL for each item, then an overall PASS/FAIL. Do not treat the screenshot as archive or deletion proof.`,
      playwrightAssertions: [
        'cleanup dialog is visible for the exact finalized-live saved mission',
        'all fifteen fixed safety checklist rows are rendered',
        'cleanup recovery-journal integrity is visibly passed',
        'live-row membership still matching the finalization boundary is visibly passed',
        'fresh archive credential is a masked password input',
        'exact mission-name confirmation is filled',
        'cleanup action is enabled only after the local confirmations',
      ],
    })

    await page.getByTestId('archive-cleanup-start').click()
    await expect(dialog).toContainText('Live-store archival completed.')
    await page.getByTestId('archive-cleanup-close').click()
    await expect(page.getByTestId(`archive-storage-state-${archive.missionId}`)).toHaveText(
      'Storage: archived',
    )
    await expect(page.getByTestId(`archive-cleanup-open-${archive.missionId}`)).toHaveCount(0)
    await expect(page.getByTestId(`archive-review-select-${archive.archiveId}`)).toBeVisible()

    await captureElementAndRegister(page, 'mission-archive-review-control', {
      testId: 'archive-cleanup-retained-archived-timeline',
      testName: 'Archived storage remains on the saved mission timeline with read-only review',
      area: 'mission-review',
      severity: 'critical',
      verificationPrompt: `This is browser-validation evidence of the rendered timeline only. Verify the visible Saved Mission Archives state after live-store archival:
1. "${MISSION_NAME}" must remain listed as a finalized saved mission.
2. Its storage label must explicitly say "Storage: archived".
3. Its verified encrypted archive revision must remain visible and selectable for review.
4. No "Review Archive Cleanup", unlock, edit, delete, or evidence-deletion control should remain.
5. The copy must say saved missions and chained archives are retained indefinitely for read-only review.
Report PASS or FAIL for each item, then an overall PASS/FAIL. Do not infer desktop deletion or archive integrity from this UI screenshot.`,
      playwrightAssertions: [
        'saved mission remains in the archive timeline',
        'storage state is archived',
        'verified encrypted archive remains selectable',
        'cleanup action is absent after completion',
      ],
    })
  })

  test('makes sealed verification retry and both original credentials explicit', async ({ page }) => {
    await navigateToHarness(page)
    await startMission(page, MISSION_NAME)
    const archive = await finalizeWithSyntheticArchiveCustody(page)
    await page.evaluate(async (archiveId) => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      if (harness === undefined) throw new Error('Browser archive harness is unavailable.')
      await harness.prepareArchiveVerificationRetryFixture(archiveId)
    }, archive.archiveId)

    await page.getByTestId('open-mission-review-workspace').click()
    await expect(page.getByTestId(`archive-review-select-${archive.archiveId}`)).toContainText(
      'Verification required',
    )
    await page.getByTestId(`archive-verify-retry-${archive.archiveId}`).click()
    const dialog = page.getByTestId('mission-archive-verification-dialog')
    await expect(dialog).toContainText('sealed but not verified')
    await expect(dialog).toContainText('original passphrase and original recovery code')
    await expect(page.getByTestId('archive-verification-passphrase')).toHaveAttribute(
      'type',
      'password',
    )
    await expect(page.getByTestId('archive-verification-recovery-code')).toHaveAttribute(
      'type',
      'password',
    )
    await expect(page.getByTestId('archive-verification-start')).toBeDisabled()

    await captureElementAndRegister(page, 'mission-archive-verification-dialog', {
      testId: 'archive-sealed-verification-retry',
      testName: 'Sealed archive exposes an explicit exhaustive verification retry',
      area: 'mission-review',
      severity: 'critical',
      verificationPrompt: `This is browser-validation evidence of the rendered operator route only; it does not prove cryptography, restored contents, or operating-system cleanup. Verify the visible archive-verification dialog:
1. The heading must say "Retry archive verification" and visibly state that the archive is sealed but not verified.
2. It must require both the original archive passphrase and the original archive recovery code, using two visibly masked inputs.
3. It must say existing archive bytes do not change.
4. It must explain that verification restores and compares every required item and uses permission-restricted scratch space that is swept automatically.
5. The Restore and verify action must be visibly disabled while both credentials are empty.
6. No create-new-archive, re-finalize, edit, delete, cleanup, filesystem path, raw digest, or custody-role assignment should be visible.
Report PASS or FAIL for each item, then an overall PASS/FAIL. Do not interpret the screenshot as proof that exhaustive verification occurred.`,
      playwrightAssertions: [
        'sealed archive is visibly labelled Verification required in the timeline',
        'verification retry dialog is visible',
        'both original credential inputs use password type',
        'verification action is disabled before both credentials are entered',
        'private archive path is not rendered',
      ],
    })
  })
})

async function finalizeWithSyntheticArchiveCustody(page: Page): Promise<{
  readonly archiveId: string
  readonly archivePath: string
  readonly missionId: string
}> {
  await page.getByTestId('mission-finish-btn').click()
  await page
    .getByTestId('mission-finish-dialog')
    .getByRole('button', { name: 'Confirm Finish' })
    .click()
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
  await expect(dialog).toBeHidden()

  return page.evaluate(() => {
    const state = window.__SARTRACKER_BROWSER_HARNESS__?.readState()
    const archive = state?.missionArchives.at(-1)
    if (archive === undefined || archive.status !== 'verified') {
      throw new Error('Expected one verified synthetic browser archive.')
    }
    return {
      archiveId: archive.id,
      archivePath: archive.archive_path,
      missionId: archive.mission_id,
    }
  })
}
