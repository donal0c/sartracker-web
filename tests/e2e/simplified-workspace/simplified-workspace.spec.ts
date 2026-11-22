/**
 * Simplified workspace, the desktop default (DON-341) and its start screen
 * (DON-342): the team's core tasks must work, and a stopped map must be loud.
 * Set LAYOUT_SHOTS=<dir> to also save screenshots for review. Synthetic names
 * only; never put real team members here.
 *
 *   LAYOUT_SHOTS=tmp/simplified-workspace/shots npx playwright test tests/e2e/simplified-workspace --project=chromium --workers=1
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { openWorkspacePanel, pressPauseResume } from '../helpers/workspace-panels'

const SHOTS = process.env.LAYOUT_SHOTS
if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true })

test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 15_000 })
test.setTimeout(120_000)

const NAMES = [
  'Aoife Brennan', 'Brian Casey', 'Ciara Doyle', 'Declan Egan', 'Eimear Flynn', 'Fergal Gorman', 'Grainne Hayes',
  'Hugh Kelly', 'Imelda Lynch', 'Jack Moran', 'Kate Nolan', 'Liam Power', 'Maeve Quinn', 'Niall Ryan',
] as const

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

async function open(page: Page): Promise<void> {
  await page.goto('/?missionHarness=1&missionModel=1&coverage=1')
  await page.getByTestId('app-title').waitFor({ state: 'attached', timeout: 20_000 })
  await page.waitForSelector('canvas', { timeout: 20_000 })
  await page.waitForTimeout(2_000)
  await page.evaluate(async (names) => {
    const seen = new Date(Date.now() - 60_000).toISOString()
    await window.__SARTRACKER_BROWSER_HARNESS__?.setParticipantDiscovery({
      groups: [
        { group_id: '101', name: 'Rescue Team', parent_group_id: null },
        { group_id: '102', name: 'Visiting Team', parent_group_id: null },
      ],
      devices: names.map((name, index) => ({
        device_id: String(index + 1), name, status: 'online' as const, last_seen: seen,
        unique_id: `d${index}`, category: null, group_id: index < 12 ? '101' : '102',
      })),
    })
  }, NAMES)
}

/** Feeds a snapshot: the first device has not moved, the third has gone quiet. */
async function feed(page: Page, options: { readonly lost?: boolean } = {}): Promise<void> {
  await page.evaluate(async ({ names, lost }) => {
    const now = Date.now()
    const iso = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
    const fix = (id: string, device: string, lat: number, lon: number, minutes: number, speed: number) => ({
      id, device_id: device, lat, lon, altitude: 300, speed, battery: 70, accuracy: 6, timestamp: iso(minutes),
      source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false,
    })
    const walkers = names.map((_, index) => index).filter((index) => index !== 0)
    const breadcrumbs = walkers.flatMap((index) => [40, 30, 20, 10, 1].map((minutes, step) =>
      fix(`bc-${index}-${step}`, String(index + 1), 51.96 + index * 0.0035 + step * 0.0045, -9.78 + index * 0.0065 - step * 0.002, index === 2 ? minutes + 16 : minutes, 1.2)))
    const still = [50, 40, 30, 20, 10, 1].map((minutes, step) => fix(`still-${step}`, '1', 51.9985 + step * 0.000002, -9.7426, minutes, 0))
    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: names.map((name, index) => ({
        device_id: String(index + 1), name, status: index === 2 ? 'offline' as const : 'online' as const,
        last_seen: iso(index === 2 ? 17 : 1), unique_id: `d${index}`, category: 'person', group_id: index < 12 ? '101' : '102',
      })),
      positions: names.map((_, index) => index === 0
        ? fix('pos-0', '1', 51.9985 + 5 * 0.000002, -9.7426, 1, 0)
        : fix(`pos-${index}`, String(index + 1), 51.96 + index * 0.0035 + 4 * 0.0045, -9.78 + index * 0.0065 - 4 * 0.002, index === 2 ? 17 : 1, 1.2)),
      breadcrumbs: [...still, ...breadcrumbs],
    }, lost === true
      ? { mode: 'offline', consecutiveFailures: 4, recovered: false, lastSuccessAt: iso(7), warning: 'Traccar server is not answering. Showing last known positions.' }
      : { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: iso(0), warning: null })
  }, { names: NAMES, lost: options.lost })
  await page.waitForTimeout(900)
}

/** Chooses the team's default group in Settings, the way a coordinator does once. */
async function setDefaultGroup(page: Page): Promise<void> {
  await page.getByTestId('open-settings-workspace').click()
  await page.getByTestId('settings-default-participant-group').selectOption({ label: 'Rescue Team' })
  await page.getByTestId('settings-save').click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
}

async function startMission(page: Page, options: { readonly defaultGroupSet?: boolean } = {}): Promise<void> {
  await page.getByTestId('mission-name-input').fill('Coomloughra Search')
  await page.getByTestId('mission-offset-input').fill('2')
  if (options.defaultGroupSet === true) await page.getByTestId('ws-change-participants').locator('summary').first().click()
  else await page.getByTestId('participant-group-picker').getByLabel(/Rescue Team/).check()
  await page.getByTestId('participant-group-picker').getByLabel(/Visiting Team/).check()
  await page.getByTestId('mission-start-btn').click()
  await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
  await feed(page)
  await page.evaluate(async () => {
    const { getBrowserHarnessStore } = await import('/src/features/browser-validation/browser-harness-store.ts')
    const { useCoverageStore } = await import('/src/features/tracking/coverage-store.ts')
    const { useParticipantStore } = await import('/src/features/participants/participant-store.ts')
    const store = getBrowserHarnessStore()
    const missionId = window.__SARTRACKER_BROWSER_HARNESS__?.readState().currentMissionId ?? null
    if (missionId === null) throw new Error('No current mission.')
    const checkpoints = await store.listParticipantBackfillCheckpoints(missionId)
    await Promise.all(checkpoints.map((checkpoint) => store.upsertParticipantBackfillCheckpoint({
      mission_id: checkpoint.mission_id, traccar_device_id: checkpoint.traccar_device_id,
      window_from: checkpoint.window_from, window_to: checkpoint.window_to,
      reconciled_until: checkpoint.window_to, completed: true,
    })))
    await useParticipantStore.getState().controller?.refreshBackfillCheckpoints(missionId)
    await useCoverageStore.getState().controller?.refresh()
  })
  await feed(page)
}

async function showPeople(page: Page): Promise<void> {
  await openWorkspacePanel(page, 'people')
}

/**
 * The alarm runs across the top of the map, flashing and unclosable, so the side
 * panel never moves under the pointer (DON-341, finding 2 on PR 76). Checks it
 * spans the map's width (within 2 px), is inside the window, is not covered by
 * anything, and sits above the map's corner controls (zoom, compass, Maps and tools).
 */
async function expectAlarmOverMap(page: Page): Promise<void> {
  const alarm = page.getByTestId('ws-alarm')
  await expect(alarm).toBeVisible()
  const placement = await alarm.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const map = document.querySelector('[data-testid="map-container"]')?.getBoundingClientRect() ?? null
    const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    const controls = [...document.querySelectorAll('.maplibregl-ctrl-top-left > *, .maplibregl-ctrl-top-right > *, [data-testid="basemap-switcher"], [data-testid="drawing-toolbar"]')]
      .map((control) => control.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => rect.top)
    return {
      box: { left: box.left, top: box.top, width: box.width, bottom: box.bottom },
      map: map === null ? null : { left: map.left, width: map.width },
      uncovered: centre !== null && element.contains(centre),
      inWindow: box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth,
      controlTops: controls,
    }
  })
  expect(placement.map, 'map on screen').not.toBeNull()
  expect(Math.abs(placement.box.left - (placement.map?.left ?? 0)), 'alarm starts at the map edge').toBeLessThanOrEqual(2)
  expect(Math.abs(placement.box.width - (placement.map?.width ?? 0)), 'alarm spans the map width').toBeLessThanOrEqual(2)
  expect(placement.inWindow, 'alarm inside the window').toBe(true)
  expect(placement.uncovered, 'nothing covers the alarm').toBe(true)
  for (const top of placement.controlTops) expect(top, 'map controls sit below the alarm').toBeGreaterThanOrEqual(placement.box.bottom - 0.5)
}

test.describe('Simplified workspace', () => {
    test('start a mission from one simple card', async ({ page }) => {
      await open(page)
      await expect(page.getByTestId('mission-start-btn')).toBeVisible()
      await expect(page.getByText('Roll back time (hours)')).toBeVisible()
      await expect(page.getByTestId('mission-finish-btn')).toBeHidden()
      // Troubleshooting does not need a mission first.
      await page.getByTestId('ws-tracking-headline').click()
      await expect(page.getByTestId('ws-tracking-panel')).toBeVisible()
      await page.getByTestId('ws-panel-close').click()
      await setDefaultGroup(page)
      await expect(page.getByTestId('ws-default-group-summary')).toContainText('Rescue Team')
      await shot(page, `1-start`)
      await startMission(page, { defaultGroupSet: true })
      await expect(page.getByTestId('mission-pause-resume-btn')).toBeHidden()
      await shot(page, `2-running`)
    })

    test('find a person, spot who has not moved, switch one off', async ({ page }) => {
      await open(page)
      await startMission(page)
      await showPeople(page)
      await expect(page.getByTestId('ws-people-count')).toHaveText(String(NAMES.length))
      // Problems come first, in words.
      await expect(page.getByTestId('ws-people-list').locator('li').first()).toContainText(/Not moving|Offline/)
      await expect(page.getByTestId('ws-person-status-3')).toContainText(/Offline|Out of date/)
      await shot(page, `3-people`)
      await page.getByTestId('ws-people-search').fill('niall')
      await expect(page.getByTestId('ws-people-list').locator('li')).toHaveCount(1)
      await page.getByTestId('ws-people-search').fill('')

      await page.getByTestId('ws-trail-5').uncheck()
      await expect(page.getByTestId('ws-trail-5')).not.toBeChecked()
      await expect(page.getByTestId('ws-position-5')).toBeChecked()
      await page.getByTestId('ws-position-6').uncheck()
      await expect(page.getByTestId('ws-position-6')).not.toBeChecked()
      // A filtered map must say so, even with People closed.
      await expect(page.getByTestId('ws-tracking-headline')).toContainText("1 person's location hidden on the map")
      await expect(page.getByTestId('ws-trail-6')).toBeChecked()
    })

    test('after Everyone off and one person on, a person who joins later stays off, as on the old screen', async ({ page }) => {
      // Regression from PR 72 (DON-341): the old screen's rule is parity-visibility batch 2.
      await open(page)
      await startMission(page)
      await showPeople(page)
      await page.getByTestId('ws-all-positions').uncheck()
      await page.getByTestId('ws-position-5').check()
      await expect(page.getByTestId('ws-position-5')).toBeChecked()
      await expect(page.getByTestId('ws-position-6')).not.toBeChecked()
      await expect(page.getByTestId('ws-all-positions')).toHaveJSProperty('indeterminate', true)

      // Someone joins with a fix after that choice.
      await page.evaluate(async () => {
        const { useTrackingStore } = await import('/src/features/tracking/tracking-store.ts')
        const snapshot = useTrackingStore.getState().snapshot
        const position = snapshot.positions[0]!
        useTrackingStore.getState().applySnapshot({
          ...snapshot,
          devices: [...snapshot.devices, { ...snapshot.devices[0]!, device_id: 'late-joiner', name: 'Late Joiner' }],
          positions: [...snapshot.positions, { ...position, id: 'pos-late-joiner', device_id: 'late-joiner' }],
        })
      })
      await expect(page.getByTestId('ws-position-late-joiner')).not.toBeChecked()
      // Everyone's Trail was left on, so the joiner's trail follows it.
      await expect(page.getByTestId('ws-trail-late-joiner')).toBeChecked()
      // The map agrees with People: the joiner's location is not drawn.
      await expect.poll(() => page.evaluate(async () => {
        const { useLayerVisibilityStore } = await import('/src/features/layers/layer-visibility-store.ts')
        return useLayerVisibilityStore.getState().hiddenDeviceIds.includes('late-joiner')
      })).toBe(true)
      await expect(page.getByTestId('ws-position-5')).toBeChecked()
    })

    test('a show or hide that cannot be saved says so in People and leaves the tick as saved', async ({ page }) => {
    await open(page)
    await startMission(page)
    await showPeople(page)
    await expect(page.getByTestId('ws-position-5')).toBeChecked()
    // The mission store refuses the next visibility write.
    await page.evaluate(async () => {
      const { useLayerCatalogStore } = await import('/src/features/layers/layer-catalog-store.ts')
      const state = useLayerCatalogStore.getState()
      const controller = state.controller
      if (controller === null) throw new Error('Layer catalog is not running.')
      useLayerCatalogStore.setState({ controller: { ...controller, setNodeVisibilities: () => Promise.reject(new Error('disk unavailable')) } })
    })
    // A plain click: the tick goes back to what was saved as soon as the save fails.
    await page.getByTestId('ws-position-5').click()
    await expect(page.getByTestId('ws-people-visibility-error')).toContainText('could not be saved')
    await expect(page.getByTestId('ws-people-visibility-error')).toContainText('disk unavailable')
    await expect(page.getByTestId('ws-position-5')).toBeChecked()
  })

  test('a failed show or hide followed by one that saves leaves no stale alert in People', async ({ page }) => {
    await open(page)
    await startMission(page)
    await showPeople(page)
    await expect(page.getByTestId('ws-position-5')).toBeChecked()
    // The first visibility write is held until the test fails it; later writes save normally.
    await page.evaluate(async () => {
      const { useLayerCatalogStore } = await import('/src/features/layers/layer-catalog-store.ts')
      const controller = useLayerCatalogStore.getState().controller
      if (controller === null) throw new Error('Layer catalog is not running.')
      const probe = window as unknown as { __failFirstWrite?: () => void }
      let calls = 0
      useLayerCatalogStore.setState({
        controller: {
          ...controller,
          setNodeVisibilities: (ids, visible) => {
            calls += 1
            if (calls === 1) {
              return new Promise((_resolve, reject) => { probe.__failFirstWrite = () => reject(new Error('disk unavailable')) })
            }
            return controller.setNodeVisibilities(ids, visible)
          },
        },
      })
    })
    const tick = page.getByTestId('ws-position-5')
    // Off: the map hides the person at once while the save is held.
    await tick.click()
    await expect(tick).not.toBeChecked()
    await page.waitForFunction(() => typeof (window as unknown as { __failFirstWrite?: unknown }).__failFirstWrite === 'function')
    // On again while the first save is still pending: this change waits behind it.
    await tick.click()
    // Now the first save fails, and the queued show saves.
    await page.evaluate(() => (window as unknown as { __failFirstWrite: () => void }).__failFirstWrite())
    // Wait on what was saved, not on time: person 5 is saved shown.
    await expect.poll(() => page.evaluate(async () => {
      const { useLayerCatalogStore } = await import('/src/features/layers/layer-catalog-store.ts')
      const entry = useLayerCatalogStore.getState().metadataEntries.find((item) => item.nodeId === 'feature:device:5')
      return entry?.isVisible ?? null
    })).toBe(true)
    await expect(tick).toBeChecked()
    await expect(page.getByTestId('ws-people-visibility-error')).toHaveCount(0)
  })

  test('a participant warning opens Mission and stays on the Mission button, without locking Tracking', async ({ page }) => {
    const setRosterError = (message: string | null) => page.evaluate(async (value) => {
      const path = '/src/features/participants/participant-store.ts'
      const { useParticipantStore } = await import(path)
      useParticipantStore.setState({ rosterError: value })
    }, message)
    await open(page)
    await startMission(page)
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeHidden()
    await expect(page.getByTestId('ws-mission-attention')).toHaveCount(0)

    await setRosterError('Could not read the Traccar groups.')
    await expect(page.getByTestId('mission-pause-resume-btn')).toBeVisible()
    await expect(page.getByTestId('mission-participants-section')).toHaveAttribute('data-open', 'true')
    await expect(page.getByTestId('ws-mission-attention')).toBeVisible()

    // The operator can still reach Tracking (for example Reconnect); the warning stays on the Mission button.
    await page.getByTestId('ws-tracking-headline').click()
    await expect(page.getByTestId('ws-tracking-panel')).toBeVisible()
    await expect(page.getByTestId('ws-mission-attention')).toBeVisible()

    await setRosterError(null)
    await expect(page.getByTestId('ws-mission-attention')).toHaveCount(0)
  })

  test('a refused Finish stays on the Mission button but never blocks Tracking (Reconnect)', async ({ page }) => {
    await open(page)
    await page.getByTestId('mission-name-input').fill('Refused Finish')
    await page.getByTestId('mission-offset-input').fill('2')
    await page.getByTestId('participant-group-picker').getByLabel(/Rescue Team/).check()
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await expect(page.getByTestId('participant-backfill-status').first()).toContainText('pending')

    // Finish is refused while participant history is still loading.
    await page.getByTestId('ws-mission-button').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
    await expect(page.getByTestId('mission-control')).toContainText('participant history backfill checkpoint(s) are incomplete')
    // Cancelling the dialog keeps the refusal on screen and flagged on the Mission button.
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('mission-finish-dialog')).toBeHidden()
    await expect(page.getByTestId('mission-control')).toContainText('participant history backfill checkpoint(s) are incomplete')
    await expect(page.getByTestId('ws-mission-attention')).toBeVisible()

    // Tracking still opens, and the refusal stays flagged on the Mission button.
    await page.getByTestId('ws-tracking-headline').click()
    await expect(page.getByTestId('ws-tracking-panel')).toBeVisible()
    await expect(page.getByTestId('mission-control')).toBeHidden()
    await expect(page.getByTestId('ws-mission-attention')).toBeVisible()

    // Opening Mission again shows the refusal in words.
    await page.getByTestId('ws-mission-button').click()
    await expect(page.getByTestId('mission-control')).toContainText('participant history backfill checkpoint(s) are incomplete')
  })

  test('All devices, Settings and Diagnostics never cover the alarm, running or paused, at either window size', async ({ page }) => {
    // Was: these modals filled the window over every warning, as on the old screen.
    await open(page)
    await startMission(page)
    const workspaces: ReadonlyArray<{ readonly name: string; readonly open: () => Promise<void>; readonly testId: string }> = [
      { name: 'All devices', testId: 'devices-workspace', open: async () => { await showPeople(page); await page.getByTestId('open-devices-workspace').click() } },
      { name: 'Settings', testId: 'settings-workspace', open: async () => { await page.getByTestId('open-settings-workspace').click() } },
      { name: 'Diagnostics', testId: 'diagnostics-workspace', open: async () => { await page.getByTestId('ws-more-button').click(); await page.getByTestId('open-diagnostics-workspace').click() } },
    ]
    const resumeUncovered = () => page.getByTestId('ws-alarm-resume').evaluate((button) => {
      const box = button.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return hit !== null && button.contains(hit)
    })
    for (const state of ['running', 'paused'] as const) {
      if (state === 'running') await feed(page, { lost: true })
      else { await feed(page); await pressPauseResume(page) }
      await expect(page.getByTestId('ws-alarm')).toContainText(state === 'running' ? 'TRACKING LOST' : 'MISSION PAUSED')
      for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
        await page.setViewportSize(size)
        for (const workspace of workspaces) {
          await workspace.open()
          await expect(page.getByTestId(workspace.testId), `${workspace.name} open`).toBeVisible()
          await expectAlarmOverMap(page)
          if (state === 'paused') expect(await resumeUncovered(), `Resume clickable over ${workspace.name}`).toBe(true)
          await page.keyboard.press('Escape')
          await expect(page.getByTestId(workspace.testId)).toBeHidden()
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 })
    }
  })

  test('lost tracking cannot be missed and pause is loud', async ({ page }) => {
      await open(page)
      await startMission(page)
      await feed(page, { lost: true })
      await expect(page.getByTestId('ws-alarm')).toContainText('TRACKING LOST')
      await expectAlarmOverMap(page)
      await expect(page.getByTestId('ws-tracking-headline')).not.toContainText('Traccar server')
      // The named call-outs add to the alarm rather than repeating it.
      await expect(page.getByTestId('ws-exceptions-more')).toHaveCount(0)
      if (await page.getByTestId('ws-exceptions').count() > 0) await expect(page.getByTestId('ws-exception-3')).toContainText('Already out of date')
      await shot(page, `4-lost`)
      await page.getByTestId('ws-tracking-headline').click()
      await expect(page.getByTestId('ws-tracking-advice')).toContainText('internet connection')
      await expect(page.getByTestId('ws-reconnect')).toBeVisible()
      await shot(page, `10-tracking-lost`)
      await page.getByTestId('ws-panel-close').click()
      await feed(page)
      await expect(page.getByTestId('ws-alarm')).toBeHidden()

      await page.getByTestId('ws-mission-button').click()
      await expect(page.getByTestId('mission-pause-resume-btn')).toBeVisible()
      await shot(page, `5-mission`)
      // Pause is never one click away from an accident.
      await page.getByTestId('mission-pause-resume-btn').click()
      await expect(page.getByTestId('ws-alarm')).toBeHidden()
      await page.getByTestId('ws-pause-confirm-no').click()
      await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
      await page.getByTestId('mission-pause-resume-btn').click()
      await page.getByTestId('ws-pause-confirm-yes').click()
      await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
      await page.getByTestId('ws-tracking-headline').click()
      await expect(page.getByTestId('ws-tracking-advice')).toContainText('Resume mission')
      await expect(page.getByTestId('ws-tracking-happened')).toContainText('The mission is paused')
      // The real pause publishes no update time; neither fact below may be lost to that.
      await expect(page.getByTestId('ws-tracking-headline')).not.toContainText('none yet')
      await expect(page.getByTestId('ws-tracking-advice')).not.toContainText('internet')
      await expect(page.getByTestId('ws-reconnect')).toHaveCount(0)
      await shot(page, `11-tracking-paused`)
      await page.getByTestId('ws-panel-close').click()
      await showPeople(page)
      await expect(page.getByTestId('ws-person-status-3')).toContainText('Already out of date when updates stopped')
      // Nothing under the alarm may read as current.
      await expect(page.getByTestId('ws-person-status-5')).toContainText('Last known position')
      await shot(page, `6-paused`)
      await page.getByTestId('ws-alarm-resume').click()
      await expect(page.getByTestId('ws-alarm')).toBeHidden()
      await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    })

    test('while paused, the alarm across the map and its Resume stay on screen whatever panel is open', async ({ page }) => {
      // The old screen held Mission open while paused. The new layout does not
      // (it would block Tracking's Reconnect); this alarm is what replaces it.
      await open(page)
      await startMission(page)
      await feed(page)
      await page.getByTestId('ws-mission-button').click()
      await page.getByTestId('mission-pause-resume-btn').click()
      await page.getByTestId('ws-pause-confirm-yes').click()
      await expect(page.getByTestId('ws-mission-phase')).toContainText('PAUSED')

      const alarmShows = async () => {
        await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
        await expect(page.getByTestId('ws-alarm-resume')).toBeVisible()
        await expect(page.getByTestId('ws-alarm-resume')).toBeEnabled()
        // Was: wider than 90% of 1440 px. It now spans the map, so the side panel never moves.
        await expectAlarmOverMap(page)
      }
      // Pausing closes Mission; nothing holds it open, so the alarm must carry the state.
      await expect(page.getByTestId('ws-mission-host')).toBeHidden()
      await alarmShows()
      for (const id of ['ws-toggle-people', 'ws-toggle-layers', 'ws-tracking-headline'] as const) {
        await page.getByTestId(id).click()
        await alarmShows()
      }
      // Reconnect stays reachable while paused: Tracking opens beside the alarm.
      await expect(page.getByTestId('ws-tracking-panel')).toBeVisible()
      await page.getByTestId('ws-panel-close').click()
      await page.getByTestId('ws-full-map').click()
      await alarmShows()
      // Every other panel, then the narrowest supported window with a panel open and closed.
      await page.getByTestId('ws-full-map').click()
      await page.getByTestId('ws-toggle-layers').click()
      await page.getByTestId('ws-open-tools').click()
      await expect(page.getByTestId('ws-tools-panel')).toBeVisible()
      await alarmShows()
      await page.getByTestId('ws-mission-button').click()
      await expect(page.getByTestId('ws-mission-host')).toBeVisible()
      await alarmShows()
      await page.setViewportSize({ width: 1280, height: 720 })
      await alarmShows()
      await page.getByTestId('ws-mission-close').click()
      await page.getByTestId('ws-full-map').click()
      await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')
      await alarmShows()
      await page.setViewportSize({ width: 1440, height: 900 })

      await page.getByTestId('ws-alarm-resume').click()
      await expect(page.getByTestId('ws-alarm')).toBeHidden()
      await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    })

    test('docked Review never covers the top bar or the paused alarm (DON-176)', async ({ page }) => {
      await open(page)
      await startMission(page)
      await feed(page)
      await page.getByTestId('ws-mission-button').click()
      await page.getByTestId('mission-pause-resume-btn').click()
      await page.getByTestId('ws-pause-confirm-yes').click()
      await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')

      await page.getByTestId('ws-more-button').click()
      await page.getByTestId('ws-open-review').click()
      await expect(page.getByTestId('mission-review-workspace')).toBeVisible()
      // Review docks below the alarm, which stays uncovered across the map.
      await expectAlarmOverMap(page)
      const [alarmBox, reviewBox] = await Promise.all([page.getByTestId('ws-alarm').boundingBox(), page.getByTestId('mission-review-workspace').boundingBox()])
      expect(reviewBox?.y ?? 0).toBeGreaterThanOrEqual((alarmBox?.y ?? 0) + (alarmBox?.height ?? 0) - 0.5)
      // Both stay clickable with Review open: a click that lands on Review would time out.
      await page.getByTestId('ws-mission-button').click({ timeout: 5_000 })
      await expect(page.getByTestId('mission-pause-resume-btn')).toBeVisible()
      await page.getByTestId('ws-alarm-resume').click({ timeout: 5_000 })
      await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
      await expect(page.getByTestId('mission-review-workspace')).toBeVisible()
    })

    test('map can fill the screen, and layers still open large', async ({ page }) => {
      await open(page)
      await startMission(page)
      await page.getByTestId('ws-full-map').click()
      await expect(page.getByTestId('ws-people-panel')).toHaveCount(0)
      await expect(page.getByTestId('ws-tracking-headline')).toBeVisible()
      // People closed: the problems are still named on the map, most urgent first.
      await expect(page.getByTestId('ws-exceptions').locator('button').first()).toContainText('Aoife Brennan')
      await expect(page.getByTestId('ws-exception-3')).toContainText('Ciara Doyle')
      await expect.poll(async () => ((await page.locator('canvas').first().boundingBox())?.width ?? 0) / 1440, { timeout: 5_000 }).toBeGreaterThan(0.95)
      await shot(page, `7-full-map`)

      await page.getByTestId('ws-toggle-layers').click()
      await expect(page.getByTestId('ws-layers-panel')).toBeVisible()
      // One panel at a time.
      await expect(page.getByTestId('ws-people-panel')).toHaveCount(0)
      await expect(page.getByTestId('layer-show-hidden-toggle')).toHaveCount(0)
      await expect(page.getByTestId('layer-row-group-tracking')).toHaveCount(0)
      await shot(page, `8-layers`)
    })

    test('tools stay reachable and the small screen still works', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 })
      await open(page)
      await startMission(page)
      await showPeople(page)
      await shot(page, `9-small-screen`)
      await page.getByTestId('ws-more-button').click()
      await expect(page.getByTestId('open-diagnostics-workspace')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.getByTestId('drawing-toolbar').waitFor()
      await page.getByTestId('coordinate-display').waitFor()
    })
})

test.describe('Start screen', () => {
  test('a new mission asks only for a name, roll back and Start, with the team default ticked', async ({ page }) => {
    await open(page)
    await setDefaultGroup(page)
    const start = page.getByTestId('start-screen-new')
    await expect(start).toBeVisible()
    await expect(page.getByTestId('start-screen-resume')).toHaveCount(0)
    await expect(page.getByTestId('mission-name-input')).toBeVisible()
    await expect(page.getByText('Roll back time (hours)')).toBeVisible()
    await expect(page.getByTestId('ws-default-group-summary')).toContainText('Rescue Team')
    // Everything else is folded away, but can still be changed before Start.
    await expect(page.getByTestId('participant-group-picker')).toBeHidden()
    await expect(page.getByTestId('participant-device-picker')).toBeHidden()
    await expect(page.getByTestId('mission-elapsed')).toBeHidden()
    await expect(page.getByTestId('mission-finish-btn')).toBeHidden()
    await expect(page.getByTestId('open-mission-review-workspace')).toHaveCount(0)
    await page.getByTestId('ws-change-participants').locator('summary').first().click()
    await expect(page.getByTestId('participant-group-picker').getByLabel(/Rescue Team/)).toBeChecked()
    await shot(page, 'start-new')
    await page.getByTestId('mission-name-input').fill('Exercise Alpha')
    await page.getByTestId('mission-offset-input').fill('1')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await expect(page.getByTestId('current-mission-name')).toHaveText('Exercise Alpha')
    // Adding one person at a time stays available from the running mission.
    await page.getByTestId('ws-mission-button').click()
    await expect(page.getByTestId('mission-participants-section')).toBeVisible()
  })

  test('on open, Resume reopens the last unfinished mission', async ({ page }) => {
    await open(page)
    await page.getByTestId('mission-name-input').fill('Exercise Bravo')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')

    await open(page)
    const resume = page.getByTestId('start-screen-resume')
    await expect(resume).toBeVisible()
    await expect(resume).toContainText('Exercise Bravo')
    // The top bar names the mission waiting to be resumed, never "No mission running".
    await expect(page.getByTestId('current-mission-name')).toHaveText('Exercise Bravo')
    // Resume is the first and largest choice; the new-mission form waits behind it.
    await expect(page.getByTestId('mission-name-input')).toHaveCount(0)
    await expect(page.getByTestId('participant-device-picker')).toHaveCount(0)
    await shot(page, 'start-resume')
    // Tracking lost while the resume card waits: the alarm runs above the card, never under it.
    await feed(page, { lost: true })
    await expectAlarmOverMap(page)
    const [alarmBox, cardBox] = await Promise.all([page.getByTestId('ws-alarm').boundingBox(), page.getByTestId('ws-mission-host').boundingBox()])
    expect(cardBox?.y ?? 0, 'resume card starts below the alarm').toBeGreaterThanOrEqual((alarmBox?.y ?? 0) + (alarmBox?.height ?? 0) - 0.5)
    await page.getByTestId('start-screen-resume-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await expect(page.getByTestId('current-mission-name')).toHaveText('Exercise Bravo')
  })

  test('Full map is remembered after a reload, as Focus Mode was', async ({ page }) => {
    await open(page)
    await page.getByTestId('mission-name-input').fill('Exercise Delta')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await showPeople(page)
    await page.getByTestId('ws-full-map').click()
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')

    await open(page)
    await page.getByTestId('start-screen-resume-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await expect(page.getByTestId('ws-full-map')).toHaveText('Show panel')
    await expect(page.getByTestId('ws-side')).toHaveAttribute('data-empty', 'true')

    // Show panel is remembered the same way.
    await page.getByTestId('ws-full-map').click()
    await expect(page.getByTestId('ws-people-panel')).toBeVisible()
    await open(page)
    await page.getByTestId('start-screen-resume-btn').click()
    await expect(page.getByTestId('ws-people-panel')).toBeVisible()
  })

  test('the unfinished-mission card cannot be closed while it waits to be resumed', async ({ page }) => {
    await open(page)
    await page.getByTestId('mission-name-input').fill('Exercise Echo')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')

    await open(page)
    await expect(page.getByTestId('start-screen-resume')).toBeVisible()
    await expect(page.getByTestId('ws-mission-close')).toBeDisabled()
    await expect(page.getByTestId('ws-mission-close')).toHaveAttribute('title', /must remain visible/)
    await page.getByTestId('ws-mission-button').click()
    await expect(page.getByTestId('start-screen-resume')).toBeVisible()
  })

  test('after Finish, the archive controls for that mission cannot be closed', async ({ page }) => {
    await open(page)
    await page.getByTestId('mission-name-input').fill('Exercise Foxtrot')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await page.getByTestId('ws-mission-button').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()

    await expect(page.getByTestId('mission-governance-card')).toBeVisible()
    await expect(page.getByTestId('ws-mission-close')).toBeDisabled()
    await page.getByTestId('ws-mission-button').click()
    await expect(page.getByTestId('mission-governance-card')).toBeVisible()
  })

  test('before any mission, the start card can still be closed for a clear map', async ({ page }) => {
    await open(page)
    await expect(page.getByTestId('mission-name-input')).toBeVisible()
    await page.getByTestId('ws-mission-close').click()
    await expect(page.getByTestId('ws-mission-host')).toBeHidden()
  })

  test('Layers, GPX and helicopters open in every phase; People says it needs a mission', async ({ page }) => {
    const checkPanels = async () => {
      await expect(page.getByTestId('ws-toggle-people')).toBeDisabled()
      await expect(page.getByTestId('ws-toggle-people')).toHaveAttribute('title', /Start or resume a mission/)
      await page.getByTestId('ws-toggle-layers').click()
      await expect(page.getByTestId('ws-layers-panel')).toBeVisible()
      await page.getByTestId('ws-open-tools').click()
      await expect(page.getByTestId('ws-tools-panel')).toBeVisible()
      await page.getByTestId('ws-tools-panel').getByTestId('ws-panel-close').click()
      await expect(page.getByTestId('ws-tools-panel')).toHaveCount(0)
    }

    // Before Start.
    await open(page)
    await checkPanels()

    // After Finish.
    await page.getByTestId('mission-name-input').fill('Exercise Golf')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await page.getByTestId('ws-mission-button').click()
    await page.getByTestId('mission-finish-btn').click()
    await page.getByTestId('mission-finish-dialog').getByRole('button', { name: 'Confirm Finish' }).click()
    await expect(page.getByTestId('mission-governance-card')).toBeVisible()
    await checkPanels()

    // In recovery, waiting to be resumed.
    await page.getByTestId('mission-name-input').fill('Exercise Hotel')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')
    await open(page)
    await expect(page.getByTestId('start-screen-resume')).toBeVisible()
    await checkPanels()
    // The start card stays on screen alongside the panels.
    await expect(page.getByTestId('start-screen-resume')).toBeVisible()
  })

  test('starting new instead of resuming asks first, then keeps the old record', async ({ page }) => {
    await open(page)
    await page.getByTestId('mission-name-input').fill('Exercise Charlie')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('ws-mission-phase')).toContainText('Running')

    await open(page)
    await page.getByTestId('start-screen-start-new-instead').click()
    await expect(page.getByTestId('start-screen-confirm-new')).toContainText('Exercise Charlie')
    await page.getByTestId('start-screen-confirm-new-no').click()
    await expect(page.getByTestId('start-screen-resume-btn')).toBeVisible()
    await page.getByTestId('start-screen-start-new-instead').click()
    await page.getByTestId('start-screen-confirm-new-yes').click()
    await expect(page.getByTestId('start-screen-new')).toBeVisible()
    await expect(page.getByTestId('mission-name-input')).toBeVisible()
  })
})
