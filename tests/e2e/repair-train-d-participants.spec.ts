import { expect, test } from '@playwright/test'

test('keeps a re-added group visibly pending until every selected member completes [DON-271]', async ({ page }) => {
  await page.goto('/?missionHarness=1&missionModel=1')
  await page.getByTestId('app-title').waitFor()
  await page.evaluate(async () => {
    await window.__SARTRACKER_BROWSER_HARNESS__!.setParticipantDiscovery({
      groups: [{ group_id: '101', name: 'Train D team', parent_group_id: null }],
      devices: [{ device_id: '22', name: 'Member A', status: 'online', last_seen: new Date().toISOString(), unique_id: 'train-d-a', category: null, group_id: '101' }],
    })
  })
  await page.getByTestId('participant-group-picker').getByText('Train D team', { exact: true }).click()
  await page.getByTestId('mission-name-input').fill('Train D group progress')
  await page.getByTestId('mission-offset-input').fill('2')
  await page.getByTestId('mission-start-btn').click()
  await page.getByTestId('participant-active-list').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('participant-active-list')).toContainText('No mission participants')
  const earlierLocal = await page.evaluate(async () => {
    await window.__SARTRACKER_BROWSER_HARNESS__!.setParticipantDiscovery({
      groups: [{ group_id: '101', name: 'Train D team', parent_group_id: null }],
      devices: ['22', '11'].map((device_id) => ({ device_id, name: `Member ${device_id}`, status: 'online' as const, last_seen: new Date().toISOString(), unique_id: `train-d-${device_id}`, category: null, group_id: '101' })),
    })
    const date = new Date(Date.now() - 3_600_000)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  })
  await expect(page.getByTestId('participant-device-picker')).toHaveCount(0)
  await page.getByTestId('participant-add-kind').selectOption('device')
  await expect(page.getByTestId('participant-add-ref').locator('option[value="11"]')).toHaveCount(1)
  await expect(page.getByTestId('participant-add-ref').locator('option[value="11"]')).toHaveText('Member 11')
  await page.getByTestId('participant-add-kind').selectOption('group')
  await page.getByTestId('participant-add-ref').selectOption('101')
  await page.getByTestId('participant-effective-from').fill(earlierLocal)
  await page.getByTestId('participant-add-btn').click()
  await expect(page.getByTestId('participant-backfill-status')).toContainText('2/2 starting group members')
  await page.evaluate(async () => {
    const storePath = '/src/features/browser-validation/browser-harness-store.ts'
    const runtimePath = '/src/features/participants/participant-store.ts'
    const { getBrowserHarnessStore } = await import(/* @vite-ignore */ storePath)
    const { useParticipantStore } = await import(/* @vite-ignore */ runtimePath)
    const store = getBrowserHarnessStore()
    const state = window.__SARTRACKER_BROWSER_HARNESS__!.readState()
    const mission = state.missions[0]!
    for (const checkpoint of state.participantBackfillCheckpoints.filter((entry) => entry.traccar_device_id === '11')) {
      await store.upsertParticipantBackfillCheckpoint({ ...checkpoint, reconciled_until: checkpoint.window_to, completed: true })
    }
    await useParticipantStore.getState().controller.refreshMission(mission.id)
  })
  await expect(page.getByTestId('participant-backfill-status')).toContainText('pending / retrying for 1/2 starting group members')
  await page.getByTestId('participant-backfill-status').scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('pending-group-progress.png'), fullPage: true })
  await page.getByTestId('mission-finish-btn').click()
  await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
  await expect(page.getByTestId('mission-control')).toContainText('participant history backfill checkpoint(s) are incomplete')
  expect(await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__!.readState().missions[0]!.status)).toBe('active')
  await page.screenshot({ path: test.info().outputPath('pending-group-finish.png'), fullPage: true })
})

test('shows unknown legacy group scope and keeps Finish closed [DON-271]', async ({ page }) => {
  await page.goto('/?missionHarness=1&missionModel=1')
  await page.getByTestId('app-title').waitFor()
  await page.evaluate(async () => {
    await window.__SARTRACKER_BROWSER_HARNESS__!.setParticipantDiscovery({
      groups: [{ group_id: '101', name: 'Legacy team', parent_group_id: null }],
      devices: [{ device_id: '1', name: 'Member A', status: 'online', last_seen: new Date().toISOString(), unique_id: 'legacy-a', category: null, group_id: '101' }],
    })
  })
  await page.getByTestId('participant-group-picker').getByText('Legacy team', { exact: true }).click()
  await page.getByTestId('mission-name-input').fill('Train D unknown legacy scope')
  await page.getByTestId('mission-offset-input').fill('2')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('participant-active-list')).toContainText('Legacy team')
  await page.evaluate(() => {
    const state = window.__SARTRACKER_BROWSER_HARNESS__!.readState()
    sessionStorage.setItem('sartracker:browser-harness', JSON.stringify({
      ...state,
      missionParticipants: state.missionParticipants.map((participant) => ({
        ...participant, starting_member_device_ids_json: null,
      })),
      groupMembershipEvents: [],
      participantBackfillCheckpoints: [],
    }))
  })
  await page.reload()
  await expect(page.getByTestId('mission-recovery-dialog')).toBeVisible()
  await page.getByTestId('mission-recovery-dialog').getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByTestId('participant-backfill-status')).toContainText('unknown historical group scope')
  await expect(page.getByTestId('participant-backfill-status')).not.toContainText('0/0')
  await page.getByTestId('participant-backfill-status').scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('unknown-legacy-scope.png'), fullPage: true })
  await page.getByTestId('mission-finish-btn').click()
  await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish', exact: true }).click()
  await expect(page.getByTestId('mission-control')).toContainText('legacy group history scope is unknown')
  expect(await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__!.readState().missions[0]!.status)).toBe('active')
})
