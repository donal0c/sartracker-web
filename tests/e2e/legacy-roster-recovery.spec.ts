import { expect, test } from '@playwright/test'

for (const resolution of ['attested-empty', 'supplied-members'] as const) {
  test(`coordinator recovers a removed legacy roster: ${resolution} [DON-271]`, async ({ page }) => {
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor()
    await page.evaluate(async () => {
      const modulePath = '/src/features/browser-validation/browser-harness-store.ts'
      const { getBrowserHarnessStore, readBrowserHarnessState } = await import(/* @vite-ignore */ modulePath)
      const store = getBrowserHarnessStore()
      const mission = await store.createMission({ name: 'Legacy recovery', start_time: new Date(Date.now() - 7200000).toISOString() })
      const [group] = await store.selectMissionParticipants({ mission_id: mission.id, groups: [
        { traccar_group_id: '101', name: 'Legacy rescue team', member_device_ids: [] }], devices: [], selected_by: 'Original coordinator' })
      await store.removeMissionParticipant({ mission_id: mission.id, participant_id: group.id, removed_by: 'Original coordinator' })
      const state = readBrowserHarnessState()
      sessionStorage.setItem('sartracker:browser-harness', JSON.stringify({ ...state,
        missionParticipants: state.missionParticipants.map((row: { id: string }) => ({ ...row, starting_member_device_ids_json: null })) }))
    })
    await page.reload()
    await page.getByTestId('mission-recovery-dialog').getByRole('button', { name: 'Resume', exact: true }).click()
    const form = page.getByTestId('legacy-roster-recovery')
    await expect(form).toContainText('removed group')
    await expect(form.getByTestId('legacy-roster-confirm')).toBeDisabled()
    await form.getByLabel('Coordinator name').fill('Coordinator Jane')
    await form.getByLabel('Recovery reason and evidence consulted').fill('Checked incident roster with team lead')
    await form.getByLabel('Roster resolution').selectOption(resolution)
    if (resolution === 'supplied-members') await form.getByLabel('Historical device IDs').fill('11, 22')
    await expect(form.getByTestId('legacy-roster-confirm')).toBeDisabled()
    await form.getByRole('checkbox').check()
    await form.screenshot({ path: test.info().outputPath(`attestation-${resolution}.png`) })
    await form.getByTestId('legacy-roster-confirm').click()
    await expect(form).toHaveCount(0)
    await expect(page.getByTestId('participant-management')).toContainText('coordinator-attested group members')
    await page.evaluate(() => {
      const state = window.__SARTRACKER_BROWSER_HARNESS__!.readState()
      if (state.missionParticipants[0]!.starting_member_device_ids_json !== null) throw new Error('Original roster overwritten')
      if (state.groupMembershipEvents.length !== 0) throw new Error('Fabricated membership observations')
      if (state.missionEvents.filter((event) => event.event_type === 'participant_roster_attested').length !== 1) throw new Error('Missing audit')
    })
    if (resolution === 'supplied-members') {
      await page.getByTestId('mission-finish-btn').click()
      await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish', exact: true }).click()
      await expect(page.getByTestId('mission-control')).toContainText('backfill')
      expect(await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__!.readState().missions[0]!.status)).toBe('active')
      await page.evaluate(async () => {
        const storePath = '/src/features/browser-validation/browser-harness-store.ts'
        const runtimePath = '/src/features/participants/participant-store.ts'
        const { getBrowserHarnessStore } = await import(/* @vite-ignore */ storePath)
        const { useParticipantStore } = await import(/* @vite-ignore */ runtimePath)
        const store = getBrowserHarnessStore()
        const state = window.__SARTRACKER_BROWSER_HARNESS__!.readState()
        for (const checkpoint of state.participantBackfillCheckpoints) {
          await store.upsertParticipantBackfillCheckpoint({ ...checkpoint, completed: true, reconciled_until: checkpoint.window_to })
        }
        await useParticipantStore.getState().controller.refreshMission(state.missions[0]!.id)
      })
    }
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__!.readState().missions[0]!.status)).toBe('finished')
  })
}
