import { expect, test } from '@playwright/test'

import { navigateToHarness } from './helpers/test-setup'
import { captureElementAndRegister } from './helpers/verification-manifest'

test.describe('Visual: Mission Participants [DON-271]', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page)
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
1. The section is clearly headed "MISSION PARTICIPANTS".
2. It says groups and individual devices can be selected and that nothing is pre-selected.
3. The selected count is visibly "0 selected".
4. Separate Groups and Devices picker areas are visible with readable names and current-member/reporting hints.
5. Every checkbox is visibly unchecked.
6. A clear notice explains that starting with none keeps reporting devices outside mission evidence and off the operational map until explicitly added.
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
    await page.getByTestId('participant-device-picker').getByText('Device 1', { exact: true }).click()
    await page.getByTestId('mission-name-input').fill('Participant Visual Mission')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('participant-add-ref').selectOption('2')
    const earlier = await localDatetime(page, Date.now() - 60 * 60 * 1_000)
    await page.getByTestId('participant-effective-from').fill(earlier)
    await page.getByTestId('participant-add-btn').click()

    await expect(page.getByTestId('participant-active-list')).toContainText('Device 1')
    await expect(page.getByTestId('participant-active-list')).toContainText('Device 2')
    await expect(page.getByTestId('participant-backfill-status')).toContainText('pending')

    await captureElementAndRegister(page, 'participant-management', {
      testId: 'participant-management-provenance-backfill',
      testName: 'Participant provenance and pending history backfill',
      area: 'mission',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of active-mission participant management:
1. The section is clearly headed "PARTICIPANTS" and shows an active-device count.
2. Device 1 and Device 2 are separately listed; neither identity is merged or ambiguous.
3. Each row visibly states device kind, explicit provenance, and an effective timestamp.
4. The later-added device visibly states that history backfill is pending or retrying, not complete.
5. Each participant has a distinct Remove action.
6. The lower add-participant controls include individual/group choice, device choice, optional effective-from, and an Add participant action.
7. No text suggests a pending backfill delays the current live position.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'both participant rows are visible',
        'pending backfill status is visible',
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
