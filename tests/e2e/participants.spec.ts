import { expect, test } from '@playwright/test'

test.describe('mission participants [DON-271]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor()
    await page.evaluate(async () => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
        groups: [{ group_id: '101', name: 'Hill Team', parent_group_id: null }],
        devices: [
          {
            device_id: '1', name: 'Alpha Team', status: 'online',
            last_seen: new Date().toISOString(), unique_id: 'alpha-1', category: null, group_id: null,
          },
          {
            device_id: '2', name: 'Bravo Team', status: 'online',
            last_seen: new Date().toISOString(), unique_id: 'bravo-2', category: null, group_id: null,
          },
        ],
      })
    })
  })

  test('selects at mission start, excludes non-participant evidence, then supports backdated add and removal', async ({ page }) => {
    const selection = page.getByTestId('participant-selection-step')
    await expect(selection).toBeVisible()
    await expect(page.getByTestId('participant-selected-count')).toContainText('0 selected')
    await page.getByTestId('participant-device-picker').getByText('Alpha Team', { exact: true }).click()
    await expect(page.getByTestId('participant-selected-count')).toContainText('1 selected')

    await page.getByTestId('mission-name-input').fill('Participant Flow')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('participant-active-list')).toContainText('Alpha Team')

    await injectTwoDeviceSnapshot(page)
    const initiallyPersistedDeviceIds = await page.evaluate(() =>
      window.__SARTRACKER_BROWSER_HARNESS__?.readState().devices.map((device) => device.device_id),
    )
    expect(initiallyPersistedDeviceIds).toEqual(['1'])
    await expect(page.getByTestId('tracking-status')).toContainText('1')

    await page.getByTestId('participant-add-ref').selectOption('2')
    const earlierLocalTime = await page.evaluate(() => {
      const value = new Date(Date.now() - 60 * 60 * 1_000)
      const pad = (part: number) => String(part).padStart(2, '0')
      return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
    })
    await page.getByTestId('participant-effective-from').fill(earlierLocalTime)
    await page.getByTestId('participant-add-btn').click()
    await expect(page.getByTestId('participant-active-list')).toContainText('Bravo Team')
    await expect(page.getByTestId('participant-backfill-status')).toContainText('pending')

    await injectTwoDeviceSnapshot(page)
    await expect(page.getByTestId('tracking-status')).toContainText('2')

    const bravoRow = page.getByTestId('participant-active-list').locator('div.sar-readout').filter({ hasText: 'Bravo Team' })
    await bravoRow.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByTestId('participant-active-list')).not.toContainText('Bravo Team')

    await injectTwoDeviceSnapshot(page)
    await expect(page.getByTestId('tracking-status')).toContainText('1')
    const retainedEvidenceDeviceIds = await page.evaluate(() =>
      window.__SARTRACKER_BROWSER_HARNESS__?.readState().positions.map((position) => position.device_id),
    )
    expect(retainedEvidenceDeviceIds).toContain('2')
  })

  test('auto-follows a selected group from observation time and shows the coordinator a notice', async ({ page }) => {
    await page.evaluate(async () => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
        groups: [{ group_id: '101', name: 'Hill Team', parent_group_id: null }],
        devices: [{
          device_id: '1', name: 'Alpha Team', status: 'online', last_seen: new Date().toISOString(),
          unique_id: 'alpha-1', category: null, group_id: '101',
        }],
      })
    })
    await page.getByTestId('participant-group-picker').getByText('Hill Team', { exact: true }).click()
    const groupCoveredDevice = page.getByTestId('participant-device-picker')
      .locator('label').filter({ hasText: 'Alpha Team' }).locator('input')
    await expect(groupCoveredDevice).toBeChecked()
    await expect(groupCoveredDevice).toBeDisabled()
    await page.getByTestId('mission-name-input').fill('Group Follow Mission')
    await page.getByTestId('mission-start-btn').click()

    await page.evaluate(async () => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
        groups: [{ group_id: '101', name: 'Hill Team renamed server-side', parent_group_id: null }],
        devices: [{
          device_id: '2', name: 'Bravo Team', status: 'online', last_seen: new Date().toISOString(),
          unique_id: 'bravo-2', category: null, group_id: '101',
        }],
      })
    })

    await expect(page.getByTestId('participant-membership-notice')).toHaveCount(2)
    await expect(page.getByTestId('participant-membership-notice').last()).toContainText(
      'No earlier evidence was invented',
    )
    await expect(page.getByTestId('participant-active-list')).toContainText('Hill Team')
    await expect(page.getByTestId('participant-active-list')).not.toContainText('renamed server-side')
    const state = await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__?.readState())
    expect(state?.groupMembershipEvents.map((event) => [event.traccar_device_id, event.change])).toEqual(
      expect.arrayContaining([['1', 'left'], ['2', 'member']]),
    )
    expect(state?.participantBackfillCheckpoints.some(
      (checkpoint) => checkpoint.traccar_device_id === '2',
    )).toBe(false)
  })

  test('shows a late-selected participant stale current fix without backdating mission evidence', async ({ page }) => {
    await page.getByTestId('participant-device-picker').getByText('Alpha Team', { exact: true }).click()
    await page.getByTestId('mission-name-input').fill('Stale Current Position Mission')
    await page.getByTestId('mission-offset-input').fill('1')
    await page.getByTestId('mission-start-btn').click()

    await page.getByTestId('participant-add-ref').selectOption('2')
    await page.getByTestId('participant-add-btn').click()
    await expect(page.getByTestId('participant-active-list')).toContainText('Bravo Team')

    await page.evaluate(async () => {
      const observedAt = new Date().toISOString()
      const staleFixAt = new Date(Date.now() - 13 * 60 * 1_000).toISOString()
      const devices = [
        {
          device_id: '1', name: 'Alpha Team', status: 'online' as const,
          last_seen: observedAt, unique_id: 'alpha-1', category: null, group_id: null,
        },
        {
          device_id: '2', name: 'Bravo Team', status: 'online' as const,
          last_seen: observedAt, unique_id: 'bravo-2', category: null, group_id: null,
        },
      ]
      const stalePositions = devices.map((device, index) => ({
        id: `stale-${device.device_id}`,
        device_id: device.device_id,
        lat: 52 + index / 100,
        lon: -9 - index / 100,
        altitude: null,
        speed: null,
        battery: null,
        accuracy: null,
        timestamp: staleFixAt,
        source: 'traccar',
        data_origin: 'live' as const,
        cache_age_seconds: null,
        device_cache_stale: false,
      }))
      await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
        devices,
        positions: stalePositions,
        breadcrumbs: stalePositions,
        rawBreadcrumbsForPersistence: stalePositions,
      })
    })

    await expect(page.getByTestId('tracking-status')).toContainText('2')
    const persistedDeviceIds = await page.evaluate(() =>
      window.__SARTRACKER_BROWSER_HARNESS__?.readState().positions.map(
        (position) => position.device_id,
      ),
    )
    expect(persistedDeviceIds).toContain('1')
    expect(persistedDeviceIds).not.toContain('2')
  })

  test('rejects a later group selection that would duplicate an active individual', async ({ page }) => {
    await page.evaluate(async () => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
        groups: [{ group_id: '101', name: 'Hill Team', parent_group_id: null }],
        devices: [{
          device_id: '1', name: 'Alpha Team', status: 'online',
          last_seen: new Date().toISOString(), unique_id: 'alpha-1',
          category: null, group_id: '101',
        }],
      })
    })
    await page.getByTestId('participant-device-picker').getByText('Alpha Team', { exact: true }).click()
    await page.getByTestId('mission-name-input').fill('Unique Participant Path Mission')
    await page.getByTestId('mission-start-btn').click()

    await page.getByTestId('participant-add-kind').selectOption('group')
    await page.getByTestId('participant-add-ref').selectOption('101')
    await page.getByTestId('participant-add-btn').click()

    await expect(page.getByTestId('participant-management')).toContainText(
      'Participant group already covers an active individual device.',
    )
    await expect(page.getByTestId('participant-active-list')).toContainText('Alpha Team')
    await expect(page.getByTestId('participant-active-list')).not.toContainText('Hill Team')
    const state = await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__?.readState())
    expect(state?.missionParticipants.filter((participant) => participant.removed_at === null)).toHaveLength(1)
    expect(state?.groupMembershipEvents).toEqual([])
  })

  test('warns above 100 selected devices and still allows every device to proceed', async ({ page }) => {
    await page.evaluate(async () => {
      await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
        groups: [],
        devices: Array.from({ length: 101 }, (_, index) => ({
          device_id: String(index + 1), name: `Device ${index + 1}`, status: 'online' as const,
          last_seen: new Date().toISOString(), unique_id: `device-${index + 1}`, category: null, group_id: null,
        })),
      })
    })
    await page.getByTestId('participant-device-picker').locator('input[type="checkbox"]').evaluateAll(
      (checkboxes) => checkboxes.forEach((checkbox) => (checkbox as HTMLInputElement).click()),
    )

    await expect(page.getByTestId('participant-selected-count')).toContainText('101 selected')
    await expect(page.getByTestId('participant-envelope-warning')).toContainText(
      'all selected devices will still be included',
    )
    await page.getByTestId('mission-name-input').fill('Envelope Warning Mission')
    await page.getByTestId('mission-start-btn').click()
    const activeParticipants = await page.evaluate(() =>
      window.__SARTRACKER_BROWSER_HARNESS__?.readState().missionParticipants.length,
    )
    expect(activeParticipants).toBe(101)
  })
})

async function injectTwoDeviceSnapshot(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const now = new Date().toISOString()
    const devices = [
      {
        device_id: '1', name: 'Alpha Team', status: 'online' as const,
        last_seen: now, unique_id: 'alpha-1', category: null, group_id: null,
      },
      {
        device_id: '2', name: 'Bravo Team', status: 'online' as const,
        last_seen: now, unique_id: 'bravo-2', category: null, group_id: null,
      },
    ]
    const positions = devices.map((device, index) => ({
      id: `${device.device_id}-${now}`,
      device_id: device.device_id,
      lat: 52 + index / 100,
      lon: -9 - index / 100,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp: now,
      source: 'traccar',
      data_origin: 'live' as const,
      cache_age_seconds: null,
      device_cache_stale: false,
    }))
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices,
      positions,
      breadcrumbs: positions,
      rawBreadcrumbsForPersistence: positions,
    })
  })
}
