import { expect, test } from '@playwright/test'

import { missionPhase, openMissionSection, outageWarning, returnReplayToLive, trackingStatus } from '../../scripts/team-smoke/lib/operator.mjs'
import { moreMenuItem, openMissionReview, openParticipantPickers, pressPauseResume } from '../../scripts/workspace-panels.mjs'

/**
 * DON-353: the team-smoke helpers drive the packaged app's new layout. Run
 * them against the browser harness so a helper that reads a hidden element,
 * skips a closed fold or reaches into a closed menu fails here, not on the
 * release box.
 */
test.describe('team-smoke navigation helpers [DON-353]', () => {
  test('helpers reach real controls and read only what the operator sees', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
    await page.evaluate(async () => {
      const seen = new Date(Date.now() - 60_000).toISOString()
      await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
        groups: [{ group_id: '101', name: 'Hill Team', parent_group_id: null }],
        devices: [
          { device_id: '1', name: 'Alpha Team', status: 'online', last_seen: seen, unique_id: 'a1', category: null, group_id: '101' },
          { device_id: '3', name: 'Charlie Team', status: 'online', last_seen: seen, unique_id: 'c3', category: null, group_id: null },
        ],
      })
    })

    // Before Start the top bar says "Start a mission".
    expect(await missionPhase(page)).toBe('IDLE')

    // The device list starts in a closed fold; the helper opens it and waits for entries.
    await expect(page.getByTestId('participant-device-picker')).toBeHidden()
    const devices = await openParticipantPickers(page, { require: 'device' })
    await expect(devices!.getByText('Charlie Team', { exact: true })).toBeVisible()
    const groups = await openParticipantPickers(page, { require: 'group' })
    await expect(groups!.getByText('Hill Team', { exact: true })).toBeVisible()

    // Start closes the Mission panel; the phase is still read from the top bar.
    await page.getByTestId('mission-name-input').fill('Navigation Harness')
    await devices!.getByText('Charlie Team', { exact: true }).click()
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await expect(page.getByTestId('ws-mission-host')).toBeHidden()
    expect(await missionPhase(page)).toBe('ACTIVE')

    // The shared section opener reopens Mission and waits for the participants.
    await openMissionSection(page, 'participants')
    await expect(page.getByTestId('participant-management')).toBeVisible()

    // The paused alarm is not outage evidence, and no internal condition is reported.
    expect(await pressPauseResume(page)).toBe('PAUSED')
    expect(await missionPhase(page)).toBe('PAUSED')
    await expect(page.getByTestId('ws-alarm')).toBeVisible()
    expect(await outageWarning(page)).toBe('')
    expect(await trackingStatus(page)).not.toMatch(/condition/u)
    expect(await pressPauseResume(page)).toBe('Running')

    // Diagnostics and Review live in the More menu, which starts closed.
    await expect(page.getByTestId('ws-more-menu')).toBeHidden()
    await expect(await moreMenuItem(page, 'open-diagnostics-workspace')).toBeVisible()
    await openMissionReview(page)
    await expect(page.getByTestId('mission-review-workspace')).toBeVisible()

    // Return to Live is required to leave Replay, not clicked on a best-effort basis.
    expect(await returnReplayToLive(page)).toBe('not-in-replay')
    await page.getByRole('button', { name: 'Replay', exact: true }).click()
    await page.getByTestId('mission-replay-seek').click()
    await expect(page.getByTestId('mission-replay-return-live')).toBeVisible()
    expect(await returnReplayToLive(page)).toBe('live')
    await page.getByTestId('workspace-close-btn').click()

    // The map tools the smoke uses take an ordinary click, not a forced one.
    await page.getByTestId('drawing-toolbar-expand').click().catch(() => undefined)
    await page.getByTestId('drawing-tool-measure').click({ timeout: 5_000 })
    await page.getByTestId('drawing-tool-search_area').click({ timeout: 5_000 })
    await page.keyboard.press('Escape')

    // An unreadable phase is an error, never an empty value that compares equal.
    await page.evaluate(() => document.querySelector('[data-testid="ws-mission-phase"]')?.remove())
    await expect(missionPhase(page)).rejects.toThrow(/no mission phase/u)
  })
})
