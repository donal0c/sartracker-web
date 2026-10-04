import { expect, test, type Page } from '@playwright/test'
import { openMissionSections } from './helpers/mission-sections'

const KMRT = { group_id: 'group-kmrt', name: 'KMRT', parent_group_id: null }
const MISC = { group_id: 'group-misc', name: 'Miscellaneous', parent_group_id: null }

function device(deviceId: string, name: string, groupId: string) {
  return {
    device_id: deviceId, name, status: 'online' as const, last_seen: new Date().toISOString(),
    unique_id: `unique-${deviceId}`, category: null, group_id: groupId,
  }
}

const KMRT_DEVICE = device('11', 'KMRT One', KMRT.group_id)
const MISC_DEVICE = device('22', 'Misc One', MISC.group_id)

/** Sets what the fake Traccar server currently reports to a catalogue refresh. */
async function setServer(
  page: Page,
  server: { readonly groups: unknown[]; readonly devices: unknown[] } | { readonly error: string },
): Promise<void> {
  await page.evaluate(async (value) => {
    await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantCatalogueServer(value as never)
  }, server)
}

test.describe('Traccar group choices refresh on demand [DON-330]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor()
    await page.evaluate(async (fixture) => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery(fixture as never)
    }, { groups: [KMRT], devices: [KMRT_DEVICE] })
    await setServer(page, { groups: [KMRT], devices: [KMRT_DEVICE] })
  })

  test('mission setup lists a group added on the server since startup, and selecting it adds only its members', async ({ page }) => {
    const groups = page.getByTestId('participant-group-picker')
    await expect(groups).toContainText('KMRT')
    await expect(groups).not.toContainText('Miscellaneous')

    await setServer(page, { groups: [KMRT, MISC], devices: [KMRT_DEVICE, MISC_DEVICE] })
    // Finishing a mission returns to mission setup, which refreshes the catalogue.
    await page.getByTestId('mission-name-input').fill('Round trip')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()

    await expect(groups).toContainText('Miscellaneous')
    await expect(page.getByTestId('participant-selected-count')).toContainText('0 selected')

    await groups.getByRole('checkbox', { name: /Miscellaneous/u }).check()
    await expect(page.getByTestId('participant-selected-count')).toContainText('1 selected')
    await expect(page.getByTestId('participant-device-picker').getByRole('checkbox', { name: /KMRT One/u })).not.toBeChecked()
    await expect(page.getByTestId('participant-device-picker').getByRole('checkbox', { name: /Misc One/u })).toBeChecked()
  })

  test('Add group in an active mission refreshes the list and enrols nothing until the group is chosen', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Active add')
    await page.getByTestId('mission-start-btn').click()
    await openMissionSections(page, ['participants'])

    await page.getByTestId('participant-add-kind').selectOption('group')
    const choices = page.getByTestId('participant-add-ref')
    await expect(choices).toContainText('KMRT')
    await expect(choices).not.toContainText('Miscellaneous')

    await setServer(page, { groups: [KMRT, MISC], devices: [KMRT_DEVICE, MISC_DEVICE] })
    await page.getByTestId('participant-add-kind').selectOption('device')
    await page.getByTestId('participant-add-kind').selectOption('group')
    await expect(choices).toContainText('Miscellaneous')
    await expect(page.getByTestId('participant-active-list')).not.toContainText('Miscellaneous')
    expect(await readParticipantKinds(page)).toEqual([])

    await choices.selectOption(MISC.group_id)
    await page.getByTestId('participant-history-start-now').check()
    await page.getByTestId('participant-add-btn').click()
    await expect(page.getByTestId('participant-active-list')).toContainText('Miscellaneous')
    expect(await readParticipantKinds(page)).toEqual(['group'])
  })

  test('a failed refresh is an error with Retry, keeps existing choices, and never looks like an empty list', async ({ page }) => {
    await page.getByTestId('mission-name-input').fill('Failing refresh')
    await page.getByTestId('mission-start-btn').click()
    await openMissionSections(page, ['participants'])

    await setServer(page, { error: 'Traccar answered 503' })
    await page.getByTestId('participant-add-kind').selectOption('group')

    const error = page.getByTestId('participant-catalogue-error')
    await expect(error).toContainText('Traccar answered 503')
    await expect(page.getByTestId('participant-add-ref')).toContainText('KMRT')

    await setServer(page, { groups: [KMRT, MISC], devices: [KMRT_DEVICE, MISC_DEVICE] })
    await page.getByTestId('participant-catalogue-retry').click()
    await expect(error).toHaveCount(0)
    await expect(page.getByTestId('participant-add-ref')).toContainText('Miscellaneous')
  })
})

async function readParticipantKinds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window.__SARTRACKER_BROWSER_HARNESS__?.readState()
    const mission = state?.missions.at(-1)
    return (state?.missionParticipants ?? [])
      .filter((entry) => entry.mission_id === mission?.id && entry.removed_at === null)
      .map((entry) => entry.kind)
      .sort()
  })
}
