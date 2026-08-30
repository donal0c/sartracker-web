import { expect, test, type Page } from '@playwright/test'

const SYNTHETIC_ARCHIVE_PASSPHRASE = 'Synthetic!Archive123'
const MISSION_NAME = 'Archive Review Browser Proof'

test.describe('C9 archive-backed Mission Review operator flow [DON-253 / BCP-16]', () => {
  test('opens a verified archive read-only, keeps the residual warning visible, and closes back to live review', async ({
    page,
  }) => {
    await openBrowserHarness(page)
    const archive = await createVerifiedSyntheticArchive(page)

    await page.getByTestId('open-mission-review-workspace').click()
    const workspace = page.getByTestId('mission-review-workspace')
    const archiveControl = page.getByTestId('mission-archive-review-control')
    await expect(workspace).toBeVisible()
    await expect(archiveControl).toContainText(MISSION_NAME)
    await expect(archiveControl).toContainText('Verified encrypted archive')
    await expect(archiveControl).toContainText('1 retained archive')
    await expect(archiveControl).not.toContainText(archive.archivePath)

    await page.getByTestId(`archive-review-select-${archive.archiveId}`).click()
    const credential = page.getByTestId('archive-review-secret')
    await expect(credential).toHaveAttribute('type', 'password')
    await credential.fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
    await expect(page.getByTestId('archive-review-open')).toBeEnabled()
    await page.getByTestId('archive-review-open').click()

    const banner = page.getByTestId('mission-review-archive-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Archived mission - read-only')
    await expect(banner).toContainText('Verified archive · SHA-256')
    await expect(banner).toContainText('permission-restricted temporary plaintext review session')
    await expect(banner).toContainText('Close Archive Review to remove it')
    await expect(banner).not.toContainText(archive.archivePath)
    await expect(page.getByTestId('archive-review-secret')).toHaveCount(0)

    await expect(workspace.getByText('Database Path', { exact: true })).toHaveCount(0)
    await expect(workspace.getByText('Backup Path', { exact: true })).toHaveCount(0)
    await expect(page.getByTestId(/^mission-review-open-path-/u)).toHaveCount(0)

    await page.getByRole('button', { name: 'Replay', exact: true }).click()
    await expect(page.getByTestId('mission-replay-workspace')).toBeVisible()
    await expect(page.getByTestId('mission-replay-workspace')).toContainText('Replay is read-only')
    await expect(banner).toBeVisible()

    await page.getByRole('button', { name: 'Search Passes', exact: true }).click()
    await expect(page.getByTestId('search-operations-read-only')).toBeVisible()
    await expect(page.getByTestId('search-operation-entry')).toHaveCount(0)
    await expect(page.getByTestId('search-assignment-record')).toHaveCount(0)
    await expect(page.getByTestId('search-pass-record')).toHaveCount(0)
    await expect(banner).toBeVisible()

    await page.getByTestId('mission-review-close-archive').click()
    await expect(banner).toHaveCount(0)

    await page.getByRole('button', { name: 'Mission Details', exact: true }).click()
    await expect(workspace.getByText('Database Path', { exact: true })).toBeVisible()
    await expect(workspace.getByText('Backup Path', { exact: true })).toBeVisible()
    await expect(page.getByTestId(/^mission-review-open-path-/u).first()).toBeVisible()
    await expect(archiveControl).toContainText('Verified encrypted archive')
  })

  test('archives live rows only after every check, retains read-only review, and persists the archived timeline [DON-253 / BCP-16]', async ({
    page,
  }) => {
    await openBrowserHarness(page)
    const archive = await createVerifiedSyntheticArchive(page)

    await page.getByTestId('open-mission-review-workspace').click()
    const archiveControl = page.getByTestId('mission-archive-review-control')
    await expect(page.getByTestId(`archive-storage-state-${archive.missionId}`)).toHaveText(
      'Storage: live',
    )
    await page.getByTestId(`archive-cleanup-open-${archive.missionId}`).click()

    const dialog = page.getByTestId('mission-archive-cleanup-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      'bulk evidence rows for this mission move out of the live database; the mission remains listed and reviewable from its verified encrypted archive; nothing is deleted from the archive; this is not an evidence-deletion feature.',
    )
    const checks = dialog
      .locator('section[aria-label="Cleanup safety checklist"]')
      .getByRole('listitem')
    await expect(checks).toHaveCount(13)
    await expect(checks.filter({ hasText: 'Pending:' })).toHaveCount(1)
    await expect(checks.filter({ hasText: 'Blocked:' })).toHaveCount(0)
    await expect(page.getByTestId('archive-cleanup-secret')).toHaveAttribute('type', 'password')

    const wrongCredential = 'Wrong!Archive1234'
    await page.getByTestId('archive-cleanup-secret').fill(wrongCredential)
    await page.getByTestId('archive-cleanup-confirmation').fill(MISSION_NAME)
    await expect(page.getByTestId('archive-cleanup-start')).toBeEnabled()
    await page.getByTestId('archive-cleanup-start').click()
    await expect(dialog).toContainText(
      'The archive credential was not accepted. The live mission and archive remain unchanged.',
    )
    await expect(dialog).not.toContainText(wrongCredential)
    await page.getByTestId('archive-cleanup-close').click()

    await page.getByTestId(`archive-cleanup-open-${archive.missionId}`).click()
    await page.getByTestId('archive-cleanup-secret').fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-cleanup-confirmation').fill(MISSION_NAME)
    await page.getByTestId('archive-cleanup-start').click()
    await expect(dialog).toContainText('Live-store archival completed.')
    await expect(dialog).toContainText(
      'The mission remains listed on its timeline and available through read-only archive review.',
    )
    await page.getByTestId('archive-cleanup-close').click()

    await expect(page.getByTestId(`archive-storage-state-${archive.missionId}`)).toHaveText(
      'Storage: archived',
    )
    await expect(page.getByTestId(`archive-cleanup-open-${archive.missionId}`)).toHaveCount(0)
    await expect(page.getByTestId('mission-unlock-btn')).toHaveCount(0)
    await expect(archiveControl).toContainText('Verified encrypted archive')

    await page.getByTestId(`archive-review-select-${archive.archiveId}`).click()
    await page.getByTestId('archive-review-secret').fill(SYNTHETIC_ARCHIVE_PASSPHRASE)
    await page.getByTestId('archive-review-open').click()
    await expect(page.getByTestId('mission-review-archive-banner')).toContainText(
      'Archived mission - read-only',
    )
    await page.getByRole('button', { name: 'Replay', exact: true }).click()
    await expect(page.getByTestId('mission-replay-workspace')).toContainText('Replay is read-only')
    await expect(page.getByRole('button', { name: /delete|unlock|archive live rows/i })).toHaveCount(0)
    await page.getByTestId('mission-review-close-archive').click()
    await expect(page.getByTestId('mission-review-archive-banner')).toHaveCount(0)

    await page.reload()
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker', { timeout: 15_000 })
    await page.waitForSelector('canvas', { timeout: 20_000 })
    await page.getByTestId('open-mission-review-workspace').click()
    await expect(page.getByTestId(`archive-storage-state-${archive.missionId}`)).toHaveText(
      'Storage: archived',
    )
    await expect(page.getByTestId(`archive-cleanup-open-${archive.missionId}`)).toHaveCount(0)
    await expect(page.getByTestId(`archive-review-select-${archive.archiveId}`)).toContainText(
      'Verified encrypted archive',
    )
  })
})

async function openBrowserHarness(page: Page): Promise<void> {
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toContainText('SAR Tracker', { timeout: 15_000 })
  await page.waitForSelector('canvas', { timeout: 20_000 })
}

async function createVerifiedSyntheticArchive(page: Page): Promise<{
  readonly archiveId: string
  readonly archivePath: string
  readonly missionId: string
}> {
  await page.getByTestId('mission-name-input').fill(MISSION_NAME)
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toContainText('active')
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
  await expect(page.getByTestId('mission-governance-card')).toContainText('finalized')

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
