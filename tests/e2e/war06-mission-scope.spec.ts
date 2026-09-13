import { expect, test } from '@playwright/test'
import type { TrackingSnapshot } from '../../src/features/tracking/tracking-types'

type BrowserRepairControl = {
  deliverOld: () => Promise<void>
  ready: () => void
  fresh: () => Promise<void>
  stop: () => Promise<void>
}

test('keeps online status and identifies cached rows after partial live hydration [DON-267 Claude review]', async ({ page }, testInfo) => {
  await page.goto('/?missionHarness=1')
  await page.getByTestId('mission-name-input').fill('WAR06 Mixed Recovery')
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('mission-control')).toContainText('active')
  await page.evaluate(async () => {
    const [{ startTrackingRuntime }, { useMissionStore }, { applyTrackingSnapshot, applyTrackingStatus },
      { createParticipationScope }] = await Promise.all([
      import('/src/features/tracking/start-tracking-runtime.ts'),
      import('/src/features/mission/mission-store.ts'),
      import('/src/features/tracking/tracking-store.ts'),
      import('/src/features/participants/participation-scope.ts'),
    ])
    const missionId = useMissionStore.getState().currentMission!.id
    const timestamp = new Date().toISOString()
    const ids = ['live-device', 'cache-device']
    const devices = ids.map((device_id) => ({ device_id, name: device_id === 'live-device' ? 'Live responder' : 'Cached responder',
      status: 'online' as const, last_seen: timestamp, unique_id: null, category: null }))
    const positions = ids.map((device_id) => ({ device_id, id: `cached-${device_id}`, lat: 52.1, lon: -9.7,
      altitude: null, speed: null, battery: null, accuracy: 4, timestamp, timestamp_source: 'fix' as const,
      fix_time_unverified: false, source: 'synthetic', data_origin: 'cache' as const,
      cache_age_seconds: 0, device_cache_stale: false }))
    let ready = false
    let notify = (): void => undefined
    let hooks!: Parameters<Parameters<typeof startTrackingRuntime>[0]['createPoller']>[1]
    const stop = await startTrackingRuntime({
      config: { baseUrl: 'http://synthetic.invalid' }, createClient: () => ({}),
      createPoller: (_client, candidate) => { hooks = candidate; return {
        start: () => undefined, stop: async () => undefined, requestPollNow: () => undefined,
      } },
      cache: { read: async () => JSON.stringify({ mission_id: missionId, cached_at: timestamp, devices, positions,
        breadcrumbs: [{ ...positions[1], id: 'restored-trail' }] }), write: async () => '' }, writeCache: false,
      missionStore: { getActiveMission: async () => null, listPositions: async () => [],
        upsertDevice: async () => undefined, addPosition: async () => undefined },
      missionModelEnabled: true, readParticipationScopeStatus: () => ready ? 'ready' : 'loading',
      readParticipationScope: () => createParticipationScope({ participants: ids.map((id) => ({
        id, mission_id: missionId, kind: 'device', traccar_device_id: id, mission_team_id: null,
        traccar_group_id: null, team_name: null, provenance: 'explicit', effective_from: '2026-01-01T00:00:00Z',
        added_at: '2026-01-01T00:00:00Z', added_by: 'Synthetic coordinator', removed_at: null, removed_by: null,
      })), membershipEvents: [] }),
      subscribeParticipationScope: (listener) => { notify = listener; return () => undefined },
      applySnapshot: (snapshot) => applyTrackingSnapshot(snapshot, missionId, ids), applyStatus: applyTrackingStatus,
    })
    hooks.onCurrentSnapshot({ devices: [devices[0]!], positions: [{ ...positions[0]!,
      id: 'live-overlap', lat: 53.2, lon: -8.2, data_origin: 'live' }], breadcrumbs: [] },
    { historyResetKey: missionId, missionEvidenceId: null },
    { missionId: null, claim: () => undefined, complete: () => undefined })
    hooks.onStatusChange({ mode: 'online', warning: null, lastSuccessAt: timestamp, consecutiveFailures: 0, recovered: true })
    ready = true
    notify()
    ;(window as unknown as { war06Stop: () => Promise<void> }).war06Stop = stop
  })
  await page.getByTestId('open-devices-workspace').click()
  const workspace = page.getByTestId('devices-workspace')
  await expect(workspace).toContainText('Showing last known positions from cache')
  await expect(page.getByTestId('devices-tracking-mode')).toHaveText('online')
  await expect(page.getByTestId('device-source-live-device')).toHaveText('Live')
  await expect(page.getByTestId('device-source-cache-device')).toHaveText('Cache')
  await page.getByTestId('device-select-name-live-device').click()
  await expect(page.getByTestId('devices-inspector')).toContainText('53.20000, -8.20000')
  await page.screenshot({ path: testInfo.outputPath('war06-mixed-cache-live.png'), fullPage: true })
  await page.evaluate(() => (window as unknown as { war06Stop: () => Promise<void> }).war06Stop())
})

for (const route of ['delayed history', 'participant hydration'] as const) {
  test(`rejects old mission ${route} while showing fresh selected current positions [DON-267]`, async ({ page }, testInfo) => {
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toBeVisible()
    await page.getByTestId('mission-name-input').fill('WAR06 Mission A')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.evaluate(async (route) => {
      const [{ startTrackingRuntime }, { useMissionStore }, { applyTrackingSnapshot, applyTrackingStatus },
        { createParticipationScope }, { useActiveMissionDevicesStore }] = await Promise.all([
        import('/src/features/tracking/start-tracking-runtime.ts'),
        import('/src/features/mission/mission-store.ts'),
        import('/src/features/tracking/tracking-store.ts'),
        import('/src/features/participants/participation-scope.ts'),
        import('/src/features/tracking/active-mission-devices-store.ts'),
      ])
      const missionA = useMissionStore.getState().currentMission!.id
      let loading = false
      let notify = (): void => undefined
      let hooks!: Parameters<Parameters<typeof startTrackingRuntime>[0]['createPoller']>[1]
      const timestamp = new Date().toISOString()
      /** Creates a distinctive old or fresh operator-visible current fix. */
      const snapshot = (old: boolean): TrackingSnapshot => {
        const position = { id: old ? 'old-a' : 'fresh-b', device_id: 'war06',
          lat: old ? 52 : 52.01, lon: -9.7, altitude: null, speed: null, battery: null,
          accuracy: 4, timestamp, timestamp_source: 'fix' as const, fix_time_unverified: false,
          source: 'synthetic', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false }
        return { devices: [{ device_id: 'war06', name: old ? 'OLD MISSION A' : 'FRESH MISSION B',
          status: 'online', last_seen: timestamp, unique_id: null, category: null, group_id: null }],
        positions: [position], breadcrumbs: old ? [
          { ...position, id: 'old-start', timestamp: new Date(Date.parse(timestamp) - 1_200_000).toISOString() }, position,
        ] : [] }
      }
      const stop = await startTrackingRuntime({
        config: { baseUrl: 'http://synthetic.invalid' }, createClient: () => ({}),
        createPoller: (_client, input) => { hooks = input; return {
          start: () => undefined, stop: async () => undefined, requestPollNow: () => undefined,
        } },
        cache: { read: async () => null, write: async () => '' }, writeCache: false,
        missionStore: { getActiveMission: async () => null, listPositions: async () => [],
          upsertDevice: async () => undefined, addPosition: async () => undefined },
        missionModelEnabled: true,
        readParticipationScopeStatus: () => loading ? 'loading' : 'ready',
        readParticipationScope: () => createParticipationScope({ participants: [{
          id: 'participant', mission_id: useMissionStore.getState().currentMission!.id,
          kind: 'device', traccar_device_id: 'war06', mission_team_id: null, traccar_group_id: null,
          team_name: null, provenance: 'explicit', effective_from: '2026-01-01T00:00:00Z',
          added_at: '2026-01-01T00:00:00Z', added_by: 'Synthetic coordinator', removed_at: null, removed_by: null,
        }], membershipEvents: [] }),
        subscribeParticipationScope: (listener) => { notify = listener; return () => undefined },
        applySnapshot: (value) => {
          const missionId = useMissionStore.getState().currentMission?.id ?? null
          applyTrackingSnapshot(value, missionId, missionId === null ? [] : ['war06'])
        },
        applyStatus: applyTrackingStatus,
      })
      useActiveMissionDevicesStore.getState().setDeviceActive(missionA, 'war06', true)
      await hooks.onSnapshot(snapshot(true), { historyResetKey: missionA, missionEvidenceId: null })
      const control: BrowserRepairControl = {
        deliverOld: () => hooks.onSnapshot(snapshot(true), { historyResetKey: missionA, missionEvidenceId: null }),
        ready: () => { loading = false; notify() },
        fresh: async () => {
          const missionId = useMissionStore.getState().currentMission!.id
          useActiveMissionDevicesStore.getState().setDeviceActive(missionId, 'war06', true)
          hooks.onCurrentSnapshot(snapshot(false), { historyResetKey: missionId, missionEvidenceId: null }, {
            missionId: null, claim: () => undefined, complete: () => undefined,
          })
          hooks.onStatusChange({ mode: 'online', consecutiveFailures: 0, recovered: false,
            lastSuccessAt: timestamp, warning: null })
        }, stop,
      }
      ;(window as unknown as { war06: BrowserRepairControl }).war06 = control
      if (route === 'participant hydration') { loading = true; await control.deliverOld() }
    }, route)
    await expect(page.getByTestId('stationary-attention-summary')).toBeVisible()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
    await page.getByTestId('mission-name-input').fill('WAR06 Mission B')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByText('WAR06 Mission B', { exact: true })).toBeVisible()
    await page.evaluate(async (route) => {
      const control = (window as unknown as { war06: BrowserRepairControl }).war06
      if (route === 'delayed history') await control.deliverOld()
      control.ready()
    }, route)
    await expect(page.getByTestId('stationary-attention-summary')).toHaveCount(0)
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByText('OLD MISSION A', { exact: true })).toHaveCount(0)
    await page.evaluate(() => (window as unknown as { war06: BrowserRepairControl }).war06.fresh())
    await expect(page.getByText('FRESH MISSION B', { exact: true }).first()).toBeVisible()
    await expect(page.getByTestId('devices-workspace')).toContainText('Live')
    await expect(page.getByTestId('stationary-attention-summary')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`war06-${route.replaceAll(' ', '-')}.png`), fullPage: true })
    await page.evaluate(() => (window as unknown as { war06: BrowserRepairControl }).war06.stop())
  })
}
