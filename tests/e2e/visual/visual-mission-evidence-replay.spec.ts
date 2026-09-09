import { expect, test } from '@playwright/test'

import { navigateToHarness, startMission } from './helpers/test-setup'
import { captureElementAndRegister } from './helpers/verification-manifest'
import { formatDublinDateTimeLocal } from '../../../src/features/mission-review/dublin-local-time'

const SYNTHETIC_ARCHIVE_PASSPHRASE = 'Visual archive passphrase 2026!'

test.describe('Visual: mission evidence and replay', () => {
  test('replay keeps Live context explicit and surfaces incomplete/static evidence', async ({ page }) => {
    await navigateToHarness(page)
    await startMission(page, 'Replay Evidence Mission')
    await page.evaluate(async () => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.importGpxFiles([{
        sourcePath: '/tracks/mixed-evidence.gpx',
        fileName: 'mixed-evidence.gpx',
        contents: `<gpx version="1.1"><trk><trkseg>
          <trkpt lat="52" lon="-9.7"><time>2026-04-10T12:00:00Z</time></trkpt>
          <trkpt lat="52.01" lon="-9.71"></trkpt>
        </trkseg></trk></gpx>`,
      }])
    })
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByRole('button', { name: 'Replay', exact: true }).click()
    await page.getByTestId('mission-replay-seek').click()
    await expect(page.getByTestId('mission-replay-workspace')).toContainText('data known at selected time')
    await expect(page.getByTestId('mission-replay-limitation-undated_gpx_static')).toBeVisible()
    await expect(page.getByTestId('mission-replay-display-filters')).toContainText(
      'Undated GPX remains static and is excluded from precise replay',
    )
    const acceptedReplayTime = await page.getByTestId('mission-replay-time').inputValue()
    await page.getByRole('button', { name: 'Mission Details', exact: true }).click()
    await page.getByRole('button', { name: 'Replay', exact: true }).click()
    await expect(page.getByTestId('mission-replay-time')).toHaveValue(acceptedReplayTime)
    await page.setViewportSize({ width: 1440, height: 1200 })

    await captureElementAndRegister(page, 'mission-replay-workspace', {
      testId: 'mission-replay-data-known-at-time',
      testName: 'Truthful mission evidence replay state',
      area: 'mission-review',
      severity: 'critical',
      verificationPrompt: `Verify the SAR Tracker Replay workspace:
1. It must explicitly say Replay is data known at the selected time, not a historical screen.
2. It must state that the operational live map/current safety positions remain live.
3. A selected local time and Europe/Dublin timezone must be visible.
4. Exact-evidence progress/counts must be visible.
5. An evidence limitation must explicitly explain that undated GPX remains static and is excluded from precise replay.
6. A clear Return to Live / now action must be visible.
Report PASS or FAIL for each item and overall.`,
      playwrightAssertions: [
        'Replay data-known-at-time label is visible',
        'undated GPX static limitation is visible',
        'undated GPX exclusion is visible beside display filters',
        'accepted replay time remains visible after switching away and back',
        'Return to Live action is visible',
      ],
    })
  })

  test('repeated passes remain visibly coordinator-declared', async ({ page }) => {
    await navigateToHarness(page, { missionModel: true })
    await startMission(page, 'Repeated Pass Mission')
    await page.getByTestId('outing-label-input').fill('Operational period 1')
    await page.getByTestId('outing-start-btn').click()
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-search_area').click({ force: true })
    await clickMap(page, 500, 180); await clickMap(page, 650, 220); await clickMap(page, 540, 340)
    await page.locator('.maplibregl-canvas').first().click({ position: { x: 540, y: 340 }, button: 'right', force: true })
    await page.getByTestId('drawing-name-input').fill('Area Alpha')
    await page.getByTestId('drawing-save-btn').click()
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByRole('button', { name: 'Search Passes', exact: true }).click()
    await page.getByTestId('search-operation-coordinator').fill('Coordinator One')
    await page.getByTestId('search-operation-area').selectOption({ label: 'Area Alpha' })
    await page.getByTestId('search-operation-outing').selectOption({ label: 'Operational period 1' })
    await page.getByTestId('search-assignment-team').fill('Team 1')
    await page.getByTestId('search-assignment-record').click()
    await page.getByTestId('search-pass-assignment').selectOption({ index: 1 })
    const passWindow = await page.evaluate(() => {
      const outing = window.__SARTRACKER_BROWSER_HARNESS__?.readState().outings
        .find((entry) => entry.label === 'Operational period 1')
      if (outing === undefined) throw new Error('Operational period 1 was not found.')
      return { startedAt: outing.started_at, endedAt: new Date().toISOString() }
    })
    await page.getByTestId('search-pass-start').fill(
      formatDublinDateTimeLocal(passWindow.startedAt),
    )
    await page.getByTestId('search-pass-end').fill(
      formatDublinDateTimeLocal(passWindow.endedAt),
    )
    await page.getByTestId('search-pass-record').click()
    await page.getByTestId('search-pass-outcome').selectOption('full')
    await page.getByTestId('search-pass-record').click()
    await expect(page.locator('[data-testid^="search-pass-search-pass-"]')).toHaveCount(2)

    await captureElementAndRegister(page, 'mission-review-workspace', {
      testId: 'search-pass-coordinator-entry-authority',
      testName: 'Coordinator-only search pass entry authority',
      area: 'mission-review',
      severity: 'critical',
      verificationPrompt: `Verify the visible Search Operations entry surface:
1. It must explicitly say coverage is advisory only.
2. The outcome control must be labelled coordinator-declared.
3. Search area, outing, and assignment must be explicit selectors rather than hidden first-item defaults.
4. The controls must not suggest geometry can automatically declare full completion.
Report PASS or FAIL for each item and overall.`,
      playwrightAssertions: [
        'coverage advisory copy is visible',
        'coordinator-declared outcome selector is visible',
        'explicit area, outing, and assignment selectors are visible',
      ],
    })
    await page.getByTestId('mission-review-workspace').evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    await captureElementAndRegister(page, 'search-operations-workspace', {
      testId: 'search-area-repeated-declared-passes',
      testName: 'Repeated coordinator-declared search passes',
      area: 'mission-review',
      severity: 'critical',
      verificationPrompt: `Verify the stable Search Operations surface:
1. Area Alpha must have a visible stable identity and geometry revision.
2. Both partial and full repeated passes must remain visible; one must not overwrite the other.
3. Each outcome must be explicitly labelled coordinator-declared.
Report PASS or FAIL for each item and overall.`,
      playwrightAssertions: [
        'two distinct pass records are rendered',
        'stable Area Alpha is visible',
        'coordinator-declared labels are visible',
      ],
    })

    await page.keyboard.press('Escape')
    await page.getByTestId('outing-end-btn').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
    await finalizeWithSyntheticArchiveCustody(page)
    await page.getByTestId('open-mission-review-workspace').click()
    await page.getByRole('button', { name: 'Search Passes', exact: true }).click()
    await expect(page.getByTestId('search-operations-read-only')).toBeVisible()
    await expect(page.getByTestId('search-operations-workspace')).toContainText('Area Alpha')
    await expect(page.locator('[data-testid^="search-pass-search-pass-"]')).toHaveCount(2)
    await expect(page.getByTestId('search-assignment-record')).toBeDisabled()
    await expect(page.getByTestId('search-pass-record')).toBeDisabled()

    await captureElementAndRegister(page, 'search-operations-workspace', {
      testId: 'search-operations-finalized-read-only',
      testName: 'Finalized mission search operations remain visibly read-only',
      area: 'mission-review',
      severity: 'critical',
      verificationPrompt: `Verify the finalized Search Operations surface:
1. It must explicitly say the finished or finalized mission is read-only.
2. It must state truthfully that retained Search Operations records remain permanently read-only.
3. The entry controls must look disabled and must not present an enabled Record action.
Report PASS or FAIL for each item and overall.`,
      playwrightAssertions: [
        'read-only governance notice is visible',
        'assignment and pass Record buttons are disabled',
        'retained Area Alpha and both passes remain present in the scrollable workspace',
      ],
    })
  })
})

async function clickMap(page: import('@playwright/test').Page, x: number, y: number) {
  await page.locator('.maplibregl-canvas').first().click({ position: { x, y }, force: true })
}

async function finalizeWithSyntheticArchiveCustody(
  page: import('@playwright/test').Page,
): Promise<void> {
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
}
