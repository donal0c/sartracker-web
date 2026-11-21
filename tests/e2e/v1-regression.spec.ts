/**
 * V1 Regression E2E Coverage (sartracker-web-8gw)
 *
 * Pins user-visible regressions that have already been fixed once in this
 * codebase. Each test should fail red if its specific fix is reverted.
 *
 * Scope:
 *  - tracking layer per-device visibility actually flips MapLibre filter state
 *  - cold-start-offline shows a clear "showing last known positions" warning
 *    before the first live poll succeeds
 */
import { expect, test, type Page } from '@playwright/test'
import { openMissionPanel, openWorkspacePanel } from './helpers/workspace-panels'

async function waitForShell(page: Page) {
  const title = page.getByTestId('app-title')
  await title.waitFor({ state: 'visible', timeout: 10_000 })
  await expect(title).toContainText('SAR Tracker')
  await page.waitForSelector('canvas', { timeout: 15_000 })
}

async function readMapFilterState(page: Page) {
  return page.evaluate(() => {
    const map = (
      window as Window & {
        __SARTRACKER_MAP__?: {
          getLayer: (layerId: string) => unknown
          getFilter: (layerId: string) => unknown
        }
      }
    ).__SARTRACKER_MAP__

    if (map === undefined) {
      throw new Error('Map instance is unavailable.')
    }

    const readFilter = (layerId: string) =>
      map.getLayer(layerId) === undefined ? null : (map.getFilter(layerId) ?? null)

    return {
      trackingDevicesCircle: readFilter('tracking-devices-circle'),
      trackingDevicesLabel: readFilter('tracking-devices-label'),
      trackingDevicesHalo: readFilter('tracking-devices-halo'),
    }
  })
}

async function seedTrackingDevices(page: Page) {
  await page.evaluate(async () => {
    const harness = window.__SARTRACKER_BROWSER_HARNESS__
    if (harness === undefined) {
      throw new Error('Browser harness API unavailable.')
    }
    // Use the installed harness boundary. A runtime Vite-module import can
    // complete its mutation and then lose the evaluation context if the dev
    // server performs a dependency reload.
    await harness.injectTrackingSnapshot({
      devices: [
        {
          device_id: 'alpha',
          name: 'Alpha Team',
          status: 'online',
          last_seen: '2026-04-09T16:00:00.000Z',
          unique_id: null,
          category: null,
        },
        {
          device_id: 'bravo',
          name: 'Bravo Team',
          status: 'online',
          last_seen: '2026-04-09T15:50:00.000Z',
          unique_id: null,
          category: null,
        },
      ],
      positions: [
        {
          id: 'pos-alpha',
          device_id: 'alpha',
          lat: 51.95,
          lon: -9.85,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-04-09T16:00:00.000Z',
          source: null,
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
        {
          id: 'pos-bravo',
          device_id: 'bravo',
          lat: 51.96,
          lon: -9.84,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-04-09T15:50:00.000Z',
          source: null,
          data_origin: 'live' as const,
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
      breadcrumbs: [],
    })
  })
}

test.describe('V1 regression: cold-start-offline operator-visible warning', () => {
  test.setTimeout(45_000)

  test('operator sees an explicit "showing last known positions" warning when only cached tracking is available', async ({
    page,
  }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Cold Start Offline Test')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')

    // Simulate cold-start-from-cache: snapshot + status the runtime would publish
    // when start-tracking-runtime hydrates from a usable cache and no live poll
    // has succeeded yet.
    await page.evaluate(async () => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      if (harness === undefined) {
        throw new Error('Browser harness API unavailable.')
      }
      await harness.injectTrackingSnapshot({
        devices: [
          {
            device_id: 'cached-1',
            name: 'Cached Team',
            status: 'online',
            last_seen: '2026-04-09T15:50:00.000Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [
          {
            id: 'cached-pos-1',
            device_id: 'cached-1',
            lat: 51.95,
            lon: -9.85,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            timestamp: '2026-04-09T15:50:00.000Z',
            source: null,
            data_origin: 'cache' as const,
            cache_age_seconds: 120,
            device_cache_stale: false,
          },
        ],
        breadcrumbs: [],
      }, {
        mode: 'offline',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: '2026-04-09T15:50:00.000Z',
        warning: 'OFFLINE MODE — showing last known positions from cache.',
      })
    })

    // The new layout raises a full-width alarm that cannot be closed, and the
    // Tracking panel says the map shows the last positions received, not a live feed.
    const alarm = page.getByTestId('ws-alarm')
    await expect(alarm).toBeVisible({ timeout: 5_000 })
    await expect(alarm).toContainText('TRACKING LOST')
    await expect(alarm).toContainText(/may not be current/i)
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-panel')).toContainText(/last positions received/i)
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('New positions have stopped arriving.')
  })
})

test.describe('V1 regression: steady tracking status remains visually stable [DON-261]', () => {
  test.setTimeout(45_000)

  test('an empty breadcrumb result does not re-show the amber loading warning on the next poll', async ({
    page,
  }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Steady Tracking Status')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')
    await openWorkspacePanel(page, 'tracking')

    const result = await page.evaluate(async () => {
      const [
        { createPollingManager },
        { applyTrackingSnapshot, applyTrackingStatus },
      ] = await Promise.all([
        import('/src/features/tracking/polling-manager.ts'),
        import('/src/features/tracking/tracking-store.ts'),
      ])

      let scheduledPoll: (() => void) | null = null
      let resolveSteadyBreadcrumbs:
        | ((positions: readonly never[]) => void)
        | null = null
      let breadcrumbRequestCount = 0
      const warningSequence: Array<string | null> = []

      const poller = createPollingManager(
        {
          authenticate: async () => undefined,
          getDevices: async () => [
            {
              device_id: 'empty-history-team',
              name: 'Empty History Team',
              status: 'online',
              last_seen: '2026-07-29T14:00:00.000Z',
              unique_id: null,
              category: null,
            },
          ],
          getCurrentPositions: async () => [
            {
              id: 'empty-history-position',
              device_id: 'empty-history-team',
              lat: 51.95,
              lon: -9.85,
              altitude: null,
              speed: null,
              battery: null,
              accuracy: null,
              timestamp: '2026-07-29T14:00:00.000Z',
              source: null,
              data_origin: 'live' as const,
              cache_age_seconds: null,
              device_cache_stale: false,
            },
          ],
          getBreadcrumbs: () => {
            breadcrumbRequestCount += 1
            if (breadcrumbRequestCount === 1) {
              return Promise.resolve([])
            }
            return new Promise<readonly never[]>((resolve) => {
              resolveSteadyBreadcrumbs = resolve
            })
          },
        },
        {
          intervalMs: 5_000,
          staleThresholdMs: 60 * 60 * 1000,
          onSnapshot: (snapshot) => {
            applyTrackingSnapshot(snapshot)
          },
          onStatusChange: (status) => {
            warningSequence.push(status.warning)
            applyTrackingStatus(status)
          },
          now: () => new Date('2026-07-29T14:00:00.000Z'),
          setTimeout: (callback) => {
            if (typeof callback !== 'function') {
              throw new Error('Expected a polling callback.')
            }
            scheduledPoll = () => callback()
            return 1
          },
          clearTimeout: () => undefined,
        },
      )

      poller.start()
      while (warningSequence.length < 2) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

      warningSequence.length = 0
      const isAmberLoadingMessageVisible = () =>
        document.body.textContent?.includes(
          'Current fixes loaded; loading breadcrumb history.',
        ) === true
      let amberLoadingMessageBecameVisible = false
      const observer = new MutationObserver(() => {
        if (isAmberLoadingMessageVisible()) {
          amberLoadingMessageBecameVisible = true
        }
      })
      observer.observe(document.body, {
        characterData: true,
        childList: true,
        subtree: true,
      })

      if (scheduledPoll === null) {
        throw new Error('The next tracking poll was not scheduled.')
      }
      const statusMessageBeforePoll =
        document.querySelector('[data-testid="ws-tracking-happened"]')?.textContent ?? null
      scheduledPoll()
      while (resolveSteadyBreadcrumbs === null) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const statusMessageWhileHistoryPending =
        document.querySelector('[data-testid="ws-tracking-happened"]')?.textContent ?? null

      resolveSteadyBreadcrumbs([])
      while (warningSequence.length < 2) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

      observer.disconnect()
      poller.stop()
      return {
        warningSequence,
        amberLoadingMessageBecameVisible,
        statusMessageBeforePoll,
        statusMessageWhileHistoryPending,
      }
    })

    expect(result.warningSequence).toEqual([null, null])
    expect(result.amberLoadingMessageBecameVisible).toBe(false)
    // The Tracking panel's "What has happened" line holds steady across the
    // poll: no loading wording appears while the breadcrumb history is pending.
    // Healthy telemetry (was "Telemetry stream healthy"): connected and running,
    // with no lost, disconnected or loading wording, before and during the poll.
    expect(result.statusMessageBeforePoll).toMatch(/^(Positions are coming in normally\.|Tracking is running, with something to check\.)/u)
    expect(result.statusMessageBeforePoll).not.toMatch(/loading|not connected|stopped arriving/iu)
    await expect(page.getByTestId('ws-tracking-headline')).not.toContainText(/not connected|TRACKING LOST|history not complete/iu)
    expect(result.statusMessageWhileHistoryPending).toBe(result.statusMessageBeforePoll)
    await expect(page.getByTestId('ws-tracking-happened')).toHaveText(
      result.statusMessageBeforePoll ?? '',
    )
  })
})

// The old mast cell is gone (DON-341); the top bar's tracking line replaced it and keeps the same rule.
test.describe('Tracking line never reads as a positions/stale ratio (sartracker-web-zq9)', () => {
  test.setTimeout(45_000)

  test('the tracking line names out-of-date positions instead of a ratio', async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Mast Tracking Ratio Regression')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')

    // Two healthy positions, one stale-cached. Pre-fix this rendered as the
    // visually impossible "ONLINE 3/1" ratio in the mast.
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot, applyTrackingStatus }] = await Promise.all([
        import('/src/features/tracking/tracking-store.ts'),
      ])
      applyTrackingSnapshot({
        devices: [
          { device_id: 'd1', name: 'Team 1', status: 'online', last_seen: '2026-04-09T16:00:00.000Z', unique_id: null, category: null },
          { device_id: 'd2', name: 'Team 2', status: 'online', last_seen: '2026-04-09T15:50:00.000Z', unique_id: null, category: null },
          { device_id: 'd3', name: 'Team 3', status: 'offline', last_seen: '2026-04-09T15:00:00.000Z', unique_id: null, category: null },
        ],
        positions: [
          { id: 'p1', device_id: 'd1', lat: 51.95, lon: -9.85, altitude: null, speed: null, battery: null, accuracy: null, timestamp: '2026-04-09T16:00:00.000Z', source: null, data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false },
          { id: 'p2', device_id: 'd2', lat: 51.96, lon: -9.84, altitude: null, speed: null, battery: null, accuracy: null, timestamp: '2026-04-09T15:50:00.000Z', source: null, data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false },
          { id: 'p3', device_id: 'd3', lat: 51.97, lon: -9.83, altitude: null, speed: null, battery: null, accuracy: null, timestamp: '2026-04-09T15:00:00.000Z', source: null, data_origin: 'cache' as const, cache_age_seconds: 600, device_cache_stale: true },
        ],
        breadcrumbs: [],
      })
      applyTrackingStatus({ mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: '2026-04-09T16:00:01.000Z', warning: null })
    })

    const cell = page.getByTestId('ws-tracking-headline')
    await expect(cell).toBeVisible()
    await expect(cell).toContainText('1 position out of date')
    // Defends against the pre-fix `${positions.length}/${staleCount}` regression
    // that produced impossible ratios such as "3/1" inside the cell.
    // Only the headline words: the "Last update" timestamp after them holds a date.
    const cellText = ((await cell.textContent()) ?? '').split('Last update')[0]
    expect(cellText).not.toMatch(/\b\d+\s*\/\s*\d+\b/)
    // Connection state (was the mast's ONLINE): Tracking says it is running, not lost or disconnected.
    await expect(cell).not.toContainText(/not connected|TRACKING LOST/u)
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('Tracking is running, with something to check.')
    // Exactly one stale position (was STALE 1), named once in the issue list.
    await expect(page.getByTestId('ws-tracking-happened').locator('li', { hasText: 'out of date' })).toHaveText(['1 position out of date'])
    // Three fixes (was FIX 3): all three people listed with a position on the map.
    await openWorkspacePanel(page, 'people')
    await expect(page.getByTestId('ws-people-count')).toHaveText('3')
    for (const id of ['d1', 'd2', 'd3']) await expect(page.getByTestId(`ws-position-${id}`)).toBeVisible()
  })

  test('idle state shows no ratio chrome', async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)

    const cell = page.getByTestId('ws-tracking-headline')
    await expect(cell).toBeVisible()
    await expect(cell).not.toContainText('out of date')
    const cellText = (await cell.textContent()) ?? ''
    expect(cellText).not.toMatch(/\b\d+\s*\/\s*\d+\b/)
    // Connection state (was IDLE): nothing is connected before a mission starts.
    await expect(cell).toContainText('Tracking not connected')
    // No fixes and nothing stale (was FIX 0, STALE 0): no roster to count, nothing out of date.
    await expect(page.getByTestId('ws-toggle-people')).toHaveText('People')
    await expect(page.getByTestId('ws-toggle-people')).toBeDisabled()
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('Tracking is not connected.')
    await expect(page.getByTestId('ws-tracking-happened')).not.toContainText('out of date')
  })
})

test.describe('V1 regression: tracking visibility filter through to MapLibre', () => {
  test.setTimeout(45_000)

  test('hiding a single tracking device updates the MapLibre device-circle filter', async ({
    page,
  }) => {
    await page.goto('/?missionHarness=1')
    await waitForShell(page)
    await openMissionPanel(page)
    await page.getByTestId('mission-name-input').fill('Tracking Visibility Test')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toHaveAttribute('data-mission-phase', 'active')

    await seedTrackingDevices(page)

    // Wait for the catalog to surface both devices.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const { useLayerCatalogStore } = await import(
              '/src/features/layers/layer-catalog-store.ts'
            )
            return useLayerCatalogStore
              .getState()
              .root.children.flatMap((group) => group.children)
              .flatMap((layer) => layer.children.map((feature) => feature.id))
          }),
        { timeout: 10_000 },
      )
      .toEqual(expect.arrayContaining(['feature:device:alpha', 'feature:device:bravo']))

    // Per-person visibility lives in the People panel in the new layout.
    await openWorkspacePanel(page, 'people')

    // Confirm baseline: the MapLibre filter does not exclude bravo.
    const baseline = await readMapFilterState(page)
    expect(JSON.stringify(baseline.trackingDevicesCircle)).not.toContain('bravo')

    // Click the per-device visibility toggle for bravo.
    const bravoToggle = page.getByTestId('ws-position-bravo')
    await expect(bravoToggle).toBeVisible({ timeout: 10_000 })
    await bravoToggle.click()

    // The device-circle filter must now include bravo in the !in list.
    await expect
      .poll(
        async () => JSON.stringify((await readMapFilterState(page)).trackingDevicesCircle),
        { timeout: 5_000 },
      )
      .toContain('bravo')
    // Alpha must remain visible.
    expect(JSON.stringify((await readMapFilterState(page)).trackingDevicesCircle)).not.toContain(
      '"alpha"',
    )

    // Re-show: filter no longer mentions bravo.
    await bravoToggle.click()
    await expect
      .poll(
        async () => JSON.stringify((await readMapFilterState(page)).trackingDevicesCircle),
        { timeout: 5_000 },
      )
      .not.toContain('bravo')
  })
})
