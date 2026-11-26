import { expect, test } from '@playwright/test'

import { openMissionPanel, openParticipantPickers } from '../helpers/workspace-panels'
import { navigateToHarness } from './helpers/test-setup'
import { captureElementAndRegister } from './helpers/verification-manifest'

test.describe('Visual: Mission Participants [DON-271]', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page, { missionModel: true })
  })

  test('mission start shows an explicit nothing-preselected participant step', async ({ page }) => {
    await seedDiscovery(page, 3)
    const step = page.getByTestId('participant-selection-step')
    await expect(step).toBeVisible()
    await expect(page.getByTestId('participant-selected-count')).toContainText('0 selected')
    await expect(page.getByTestId('participant-none-selected-notice')).toBeVisible()

    await captureElementAndRegister(page, 'participant-selection-step', {
      testId: 'participant-mission-start-selection',
      testName: 'Explicit mission-start participant selection',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker's mission-start participant selection step:
1. The section is clearly headed "Who's taking part".
2. It says to tick the team below and that a team's group can be set in Settings so it is ticked each time.
3. The selected count is visibly "0 selected".
4. A Groups picker is visible with readable group names and current-member hints, and a folded "Add one person at a time" option for individual devices.
5. Every visible checkbox is unchecked.
6. A clear notice says that with nobody ticked the mission can still start, but nobody will show on the map until they are added.
7. The surface looks like a deliberate safety decision, not a disabled or failed form.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'participant selection step is visible',
        'selected count is 0',
        'no-participants consequence notice is visible',
      ],
    })
  })

  test('participant management shows provenance and pending backfill honestly', async ({ page }) => {
    await seedDiscovery(page, 3)
    await openParticipantPickers(page)
    await page.getByTestId('participant-device-picker').getByText('Device 1', { exact: true }).click()
    await page.getByTestId('mission-name-input').fill('Participant Visual Mission')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await openParticipantPickers(page)
    await page.getByTestId('participant-add-ref').selectOption('2')
    const earlier = await localDatetime(page, Date.now() - 60 * 60 * 1_000)
    await page.getByTestId('participant-effective-from').fill(earlier)
    await page.getByTestId('participant-add-btn').click()

    await expect(page.getByTestId('participant-active-list')).toContainText('Device 1')
    await expect(page.getByTestId('participant-active-list')).toContainText('Device 2')
    const backfillStatuses = page.getByTestId('participant-backfill-status')
    await expect(backfillStatuses).toHaveCount(2)
    await expect(backfillStatuses.first()).toContainText('still loading')
    await expect(backfillStatuses.last()).toContainText('still loading')
    // The required history-start choice makes the section taller than the
    // visible panel; frame it from its heading so every checklist item is in view.
    await page.getByTestId('participant-management').evaluate((section) => section.scrollIntoView({ block: 'start' }))

    await captureElementAndRegister(page, 'participant-management', {
      testId: 'participant-management-provenance-backfill',
      testName: 'Participant provenance and pending history backfill',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of active-mission participant management:
This is the simplified panel's "Change who's taking part" fold, in plain words (DON-368); its heading sits above the fold and is not part of this capture.
1. The list starts at its top edge: the first row is not cut off.
2. Device 1 and Device 2 are separately listed; neither identity is merged or ambiguous.
3. Each row says whether it is one person or a group and the time from which their positions count ("from …"). A coordinator's own choice carries no extra note.
4. Both devices visibly say their earlier positions are still loading, not loaded.
5. Each participant has a distinct Remove action.
6. The lower add controls include a One person / A group choice, a device choice, a "Show their positions from" choice listing Mission start (with its time), Now (no earlier history) and Custom with a time field, and an Add action.
7. No text suggests loading earlier positions delays the current live position.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'both participant rows are visible',
        'pending backfill status is visible for both participant rows',
      ],
    })
  })

  test('a start offset warns that earlier history needs selected participants [DON-291]', async ({ page }) => {
    await seedDiscovery(page, 3)
    await page.getByTestId('mission-offset-input').fill('48')
    await expect(page.getByTestId('participant-lookback-notice')).toBeVisible()
    await expect(page.getByTestId('participant-none-selected-notice')).toBeVisible()

    await captureElementAndRegister(page, 'participant-selection-step', {
      testId: 'participant-lookback-start-notice',
      testName: 'Start offset explains which participants get earlier history',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker's mission-start participant selection step with a start offset entered:
1. The section is headed "Who's taking part" and shows "0 selected".
2. A clearly visible amber notice says rolling back the start only brings in earlier tracks for people ticked here before Start.
3. The separate nobody-ticked notice is still visible and readable.
4. Both notices are legible against the background and are not clipped.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'lookback notice is visible after entering a 48 h offset',
        'no-participants notice is visible',
      ],
    })
  })

  test('selection above the supported envelope warns and does not truncate', async ({ page }) => {
    await seedDiscovery(page, 101)
    await page.getByTestId('participant-device-picker').locator('input[type="checkbox"]').evaluateAll(
      (checkboxes) => checkboxes.forEach((checkbox) => (checkbox as HTMLInputElement).click()),
    )
    await expect(page.getByTestId('participant-selected-count')).toContainText('101 selected')
    await expect(page.getByTestId('participant-envelope-warning')).toBeVisible()

    await captureElementAndRegister(page, 'participant-selection-step', {
      testId: 'participant-envelope-warning-101',
      testName: 'Persistent warn-and-proceed boundary above 100 devices',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the participant picker above its qualified envelope:
1. The selected count visibly says "101 selected".
2. A prominent persistent warning says the supported and qualified envelope is 100 active devices.
3. The warning states performance/qualification guarantees do not extend past 100.
4. The warning explicitly says all selected devices will still be included.
5. The picker remains usable; the UI does not look hard-refused or truncated.
6. No copy suggests only the first 100 devices will be saved or displayed.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'selected count is 101',
        'envelope warning is visible',
      ],
    })
  })

  test('unfinished participant history blocks mission finish with an actionable warning', async ({ page }) => {
    await seedDiscovery(page, 3)
    await openParticipantPickers(page)
    await page.getByTestId('participant-device-picker').getByText('Device 1', { exact: true }).click()
    await page.getByTestId('mission-name-input').fill('Backfill Finish Visual Mission')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('participant-backfill-status')).toContainText('still loading')

    await openMissionPanel(page)
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog')
      .getByRole('button', { name: 'Confirm Finish' })
      .click()
    await expect(page.getByTestId('mission-control')).toContainText(
      "Can't finish yet. SAR Tracker is still fetching earlier tracks",
    )
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    await expect(page.getByTestId('mission-finish-dialog').getByTestId('mission-history-retry')).toHaveText('Try again')

    await captureElementAndRegister(page, 'mission-finish-dialog', {
      testId: 'participant-backfill-finish-fence',
      testName: 'Mission finish blocked by incomplete participant history',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker's still-open finish decision after participant history backfill blocked completion:
1. The decision remains clearly headed "END MISSION?" rather than presenting a finished or archived state.
2. A prominent, legible error says "Can't finish yet" because SAR Tracker is still fetching earlier tracks for a number of people.
3. The error tells the coordinator to check the internet connection and press Try again, and a "Try again" button is shown with it.
4. The dialog still offers distinct "Confirm Finish" and "Cancel" actions so the operator can retry or back out.
5. The failure reads as an actionable safety refusal, not as a generic crash, blank surface, or success message.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission remains active',
        'pending backfill is visible',
        'finish refusal is visible',
        'Try again is offered',
      ],
    })
  })
})

async function seedDiscovery(page: import('@playwright/test').Page, count: number): Promise<void> {
  await page.evaluate(async (deviceCount) => {
    await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
      groups: [{ group_id: '101', name: 'Hill Team', parent_group_id: null }],
      devices: Array.from({ length: deviceCount }, (_, index) => ({
        device_id: String(index + 1),
        name: `Device ${index + 1}`,
        status: 'online' as const,
        last_seen: new Date().toISOString(),
        unique_id: `device-${index + 1}`,
        category: null,
        group_id: index < 2 ? '101' : null,
      })),
    })
  }, count)
}

async function localDatetime(
  page: import('@playwright/test').Page,
  timestamp: number,
): Promise<string> {
  return page.evaluate((value) => {
    const date = new Date(value)
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }, timestamp)
}
