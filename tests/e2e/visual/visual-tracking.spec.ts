/**
 * Visual verification tests for GPS device tracking.
 *
 * These tests verify that tracking data displays correctly:
 * - Device positions rendered on map
 * - Tracking panel saying in plain words what happened and what to do
 * - Lost, paused and attention states in the top bar and alarm strip
 * - Breadcrumb trails visible on map
 * - People panel lists tracked devices
 *
 * LIFE-SAFETY CRITICAL: Incorrect tracking display could cause operators to
 * lose awareness of team positions on the mountain.
 */
import { expect, test, type Page } from '@playwright/test'
import { openWorkspacePanel } from '../helpers/workspace-panels'
import {
  navigateToHarness,
  startMission,
  pauseMission,
  injectStandardTracking,
} from './helpers/test-setup'
import {
  captureAndRegister,
  captureElementAndRegister,
} from './helpers/verification-manifest'

const TRACKING_DEVICE_LAYER_ID = 'tracking-devices-circle'
const TRACKING_BREADCRUMB_LAYER_ID = 'tracking-breadcrumbs-line'

test.describe('Visual: Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page)
    await startMission(page, 'Tracking Verification')
    await injectStandardTracking(page)
  })

  test('Tracking panel explains healthy tracking in plain words', async ({ page }) => {
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-headline')).toHaveAttribute('data-condition', 'ok')
    await expect(page.getByTestId('ws-tracking-headline')).toContainText('Tracking OK')
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('Positions are coming in normally')
    await expect(page.getByTestId('ws-toggle-people')).toContainText('People 3')

    await captureElementAndRegister(page, 'ws-tracking-panel', {
      testId: 'tracking-status-panel',
      testName: 'Tracking panel with healthy tracking',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Tracking panel while tracking is healthy. NOTE: device names and counts are in the People panel and on the People button (separate tests) and are NOT expected here. Check only what is in frame:
1. The panel is headed "Tracking" with a Close button
2. Under "What has happened" it says positions are coming in normally
3. Under "What the map is showing" it says the map shows the latest positions received, with a last-update date and time
4. Under "What to do" it says nothing needs doing
5. No red alarm, warning box or Reconnect button is shown
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'tracking headline condition is ok and reads Tracking OK',
        'ws-tracking-happened says positions are coming in normally',
        'People button counts 3',
      ],
    })
  })

  test('saved history transfer shows incomplete progress while current fixes remain visible [DON-254]', async ({ page }) => {
    try {
      await page.evaluate(async () => {
        const { createBreadcrumbQueryClient } = await import('/src/infrastructure/mission-store/breadcrumb-query-client.ts')
        const { startTrackingRuntime } = await import('/src/features/tracking/start-tracking-runtime.ts')
        const { applyTrackingStatus } = await import('/src/features/tracking/tracking-store.ts')
        const { useMissionStore } = await import('/src/features/mission/mission-store.ts')
        const missionId = useMissionStore.getState().currentMission.id
        let hooks
        let release
        let finished = false
        let failFinish = false
        const paused = new Promise((resolve) => { release = resolve })
        const row = (id) => JSON.stringify({ kind: 'position', value: { id, mission_id: missionId,
          device_id: '1', source_position_id: id, lat: 52, lon: -9, timestamp: '2026-09-12T10:00:00.000Z',
          timestamp_source: 'fix', data_origin: 'live' } }) + '\n'
        const client = createBreadcrumbQueryClient({
          startBreadcrumbQuery: async () => ({ version: 1, missionId, snapshotId: 'visual-snapshot',
            positionCount: 2, deviceTotalCount: 0, deviceSelectionCount: 0, droppedPositionCount: 0 }),
          readBreadcrumbQueryFrame: async ({ sequence }) => {
            if (sequence === 1) await paused
            return { snapshotId: 'visual-snapshot', sequence, payload: row(String(sequence)), done: sequence === 1 }
          },
          finishBreadcrumbQuery: async () => { if (failFinish) throw new Error('Synthetic history completion failure') },
          cancelBreadcrumbQuery: async () => true,
        })
        const stop = await startTrackingRuntime({
          config: { baseUrl: 'http://synthetic.invalid' }, createClient: () => ({}),
          createPoller: (_client, value) => { hooks = value; return { start() {}, stop() {} } },
          cache: { read: async () => null, write: async () => undefined },
          missionStore: { ...client, getActiveMission: async () => ({ id: missionId }),
            listPositions: async () => [], upsertDevice: async () => undefined, addPositionsBulk: async () => undefined },
          applySnapshot: () => undefined, applyStatus: applyTrackingStatus,
        })
        hooks.onStatusChange({ mode: 'online', warning: null, consecutiveFailures: 0, recovered: false, lastSuccessAt: null })
        const query = hooks.getCanonicalBreadcrumbs(missionId)
        Object.assign(window, {
          completeTransportVisual: async () => { release(); await query },
          failNextTransportVisual: async () => {
            failFinish = true
            try { await hooks.getCanonicalBreadcrumbs(missionId) }
            catch (error) {
              if (error instanceof Error && error.message === 'Synthetic history completion failure') return
              throw error
            }
            throw new Error('Expected the synthetic history failure')
          },
          finishTransportVisual: async () => {
            if (finished) return
            finished = true
            release()
            try {
              await query
            } finally {
              await stop()
            }
          },
        })
      })
      await openWorkspacePanel(page, 'tracking')
      await expect(page.getByTestId('tracking-status')).toContainText('1 of 2 selected fixes transferred; history is not yet complete')
      await expect(page.getByRole('progressbar', { name: 'Saved breadcrumb history transfer' })).toHaveAttribute('value', '1')
      await expect(page.getByRole('progressbar', { name: 'Saved breadcrumb history transfer' })).toHaveAttribute('max', '2')
      // Tracking stays live while history loads: no alarm, and all three people keep their positions.
      await expect(page.getByTestId('ws-alarm')).toHaveCount(0)
      await expect(page.getByTestId('ws-toggle-people')).toContainText('People 3')
      const harnessState = await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__?.readState() ?? null)
      expect(harnessState?.devices).toEqual(expect.arrayContaining([
        expect.objectContaining({ device_id: 'alpha', name: 'Alpha Team' }),
        expect.objectContaining({ device_id: 'bravo', name: 'Bravo Team' }),
      ]))
      expect(harnessState?.positions).toEqual(expect.arrayContaining([
        expect.objectContaining({ source_position_id: 'pos-alpha', device_id: 'alpha', lat: 51.9985, lon: -9.7426 }),
        expect.objectContaining({ source_position_id: 'pos-bravo', device_id: 'bravo', lat: 52.0012, lon: -9.7501 }),
      ]))
      await captureElementAndRegister(page, 'ws-tracking-panel', {
        testId: 'tracking-breadcrumb-transfer-progress', testName: 'Saved history transfer remains explicitly incomplete',
        area: 'tracking', severity: 'critical',
        verificationPrompt: 'Verify this screenshot of the SAR Tracker Tracking panel: 1. It is headed "Tracking" and does not describe a tracking failure. 2. The status clearly says 1 of 2 selected fixes transferred and history is not yet complete. 3. A visible progress bar is approximately half filled. 4. Progress text and bar are readable and not clipped.',
        playwrightAssertions: ['No tracking alarm while history loads', 'Alpha, Bravo and Charlie stay counted on the People button', 'Partial saved-history progress explicitly says incomplete'],
      })
      await page.evaluate(() => {
        const finish = (window as Window & { completeTransportVisual?: () => Promise<void> }).completeTransportVisual
        return finish?.()
      })
      await expect(page.getByTestId('tracking-status')).not.toContainText('selected fixes transferred')
      await expect(page.getByTestId('saved-history-transfer-status')).toHaveText('Saved history transfer complete.')
      await page.evaluate(() => (window as Window & { failNextTransportVisual: () => Promise<void> }).failNextTransportVisual())
      await expect(page.getByTestId('saved-history-transfer-status')).toContainText('Saved history could not be loaded')
      await expect(page.getByRole('progressbar', { name: 'Saved breadcrumb history transfer' })).toHaveCount(0)
      await captureElementAndRegister(page, 'ws-tracking-panel', {
        testId: 'tracking-breadcrumb-transfer-failed', testName: 'Failed history transfer remains visibly incomplete',
        area: 'tracking', severity: 'critical',
        verificationPrompt: 'Verify this screenshot of the SAR Tracker Tracking panel: 1. It is headed "Tracking". 2. Saved history could not be loaded is visible. 3. The status explicitly says history remains incomplete. 4. No loading progress bar remains.',
        playwrightAssertions: ['Failure is distinguished from completed transfer', 'Incomplete history remains explicit', 'Progress bar is removed after terminal failure'],
      })
    } finally {
      await page.evaluate(() => {
        const finish = (window as Window & { finishTransportVisual?: () => Promise<void> }).finishTransportVisual
        return finish?.()
      }).catch(() => undefined)
    }
  })

  test('bounded whole-route trail is explicit about display versus storage [DON-260]', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const { applyTrackingSnapshot, useTrackingStore } = await import(
        '/src/features/tracking/tracking-store.ts'
      )
      applyTrackingSnapshot({
        ...useTrackingStore.getState().snapshot,
        breadcrumbMetadata: {
          totalRetained: 3_000,
          totalObserved: 12_000,
          deviceBudgets: [
            {
              deviceId: 'alpha',
              retained: 3_000,
              sourceRetained: 3_000,
              total: 12_000,
              firstTimestamp: '2026-07-28T00:00:00.000Z',
              lastTimestamp: '2026-07-28T03:19:59.000Z',
              truncated: true,
            },
          ],
        },
      })
    })

    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('breadcrumb-display-summary')).toContainText(
      '3,000 of at least 12,000 known fixes',
    )
    await expect(page.getByTestId('breadcrumb-display-summary')).toContainText(
      'Full mission history remains stored',
    )

    await captureElementAndRegister(page, 'ws-tracking-panel', {
      testId: 'tracking-breadcrumb-bounded-summary',
      testName: 'Tracking status distinguishes bounded display from stored history',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker's bounded breadcrumb display disclosure:
1. The tracking panel should remain calm and readable, without looking like a connection failure
2. A distinct informational message should say the trail display is simplified
3. The message should clearly show "3,000 of at least 12,000 known fixes"
4. The message should explicitly say the full mission history remains stored
5. "What has happened" should still say positions are coming in normally
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'breadcrumb-display-summary contains 3,000 of at least 12,000 known fixes',
        'breadcrumb-display-summary says full mission history remains stored',
      ],
    })
  })

  test('offline tracking warning is a red stale-position alert', async ({ page }) => {
    await page.evaluate(async () => {
      const { applyTrackingStatus } = await import('/src/features/tracking/tracking-store.ts')
      applyTrackingStatus({
        mode: 'offline',
        consecutiveFailures: 2,
        recovered: false,
        lastSuccessAt: '2026-04-10T12:00:00.000Z',
        warning: 'OFFLINE MODE - showing last known positions.',
      })
    })

    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-headline')).toHaveAttribute('data-condition', 'lost')
    await expect(page.getByTestId('ws-alarm')).toContainText('TRACKING LOST')
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('New positions have stopped arriving')
    await expect(page.getByTestId('ws-tracking-panel')).toContainText('OFFLINE MODE')

    await captureAndRegister(page, {
      testId: 'tracking-offline-alert',
      testName: 'Tracking lost: red alarm strip, headline and Tracking panel',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker when live telemetry has failed during a mission:
1. A bright red alarm strip under the top bar says "TRACKING LOST" and that positions on the map may not be current
2. The tracking headline in the top bar is red/high-alert and says "TRACKING LOST", not amber or neutral
3. The Tracking panel on the right says new positions have stopped arriving and shows the "OFFLINE MODE" message
4. The panel says the map shows the last positions received, which may not be where people are now
5. The panel tells the operator not to rely on the map, to check the internet connection, and offers a Reconnect button
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'tracking headline condition is lost',
        'alarm strip says TRACKING LOST',
        'Tracking panel says new positions have stopped arriving',
        'Tracking panel contains OFFLINE MODE',
      ],
    })
  })

  test('current-position ingest warnings remain calm and explicit [DON-267]', async ({ page }) => {
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot, applyTrackingStatus, useTrackingStore }, { applyCurrentPositionRejections }] =
        await Promise.all([
          import('/src/features/tracking/tracking-store.ts'),
          import('/src/features/tracking/ingest-health-store.ts'),
        ])
      const snapshot = useTrackingStore.getState().snapshot
      applyTrackingSnapshot({
        ...snapshot,
        positions: snapshot.positions.map((position, index) => index === 0
          ? {
              ...position,
              timestamp_source: 'server' as const,
              fix_time_unverified: true,
              device_cache_stale: true,
            }
          : position),
      })
      applyTrackingStatus({
        mode: 'online',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: new Date().toISOString(),
        warning: 'DEVICE ROSTER UNAVAILABLE — current fixes are using last-known device details.',
      })
      applyCurrentPositionRejections([
        { deviceId: 'alpha', reason: 'invalid_coordinates', rowIndex: 1 },
      ])
    })

    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-headline')).toHaveAttribute('data-condition', 'attention')
    await expect(page.getByTestId('ws-alarm')).toHaveCount(0)
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('ROSTER UNAVAILABLE')
    await expect(page.getByTestId('current-position-ingest-warning')).toContainText(
      'Valid current fixes remain visible',
    )
    await expect(page.getByTestId('fix-time-unverified-warning')).toContainText(
      'uses server receipt clock, not verified Traccar fixTime',
    )
    await page.setViewportSize({ width: 1440, height: 1200 })

    await captureElementAndRegister(page, 'ws-tracking-panel', {
      testId: 'tracking-current-position-ingest-warning',
      testName: 'Current-position rejection and timestamp provenance warnings',
      area: 'tracking',
      severity: 'high',
      verificationPrompt: `Verify this screenshot of SAR Tracker's current-position health warnings:
1. "What has happened" must say tracking is running, with something to check, because valid current fixes are still publishing
2. A clear roster warning must say current fixes are using last-known device details
3. A separate position-data warning must report a rejected row and explicitly say valid current fixes remain visible
4. A separate FIX TIME UNVERIFIED warning must identify server-receipt provenance, retain the position for immediate safety, and exclude it from exact breadcrumb evidence
5. "What to do" must say to check the items listed and that tracking itself is still running
6. The warnings should be prominent amber attention states, not a red offline/emergency presentation
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'tracking headline condition is attention, with no alarm strip',
        'roster warning is visible',
        'rejected-row warning says valid current fixes remain visible',
        'server-receipt timestamp warning states immediate-safety visibility and exact-evidence exclusion',
      ],
    })
  })

  test('stationary attention is additive and keeps the current marker visible [DON-269]', async ({ page }) => {
    await page.evaluate(async () => {
      const { applyTrackingSnapshot } = await import('/src/features/tracking/tracking-store.ts')
      const base = { device_id: 'alpha', lon: -9.7426, altitude: 320, speed: 0, battery: 85, accuracy: 5, source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false }
      const first = { ...base, id: 'stationary-first', lat: 51.9985, timestamp: '2026-08-22T10:00:00.000Z' }
      const latest = { ...base, id: 'stationary-latest', lat: 51.99851, timestamp: '2026-08-22T10:20:00.000Z' }
      applyTrackingSnapshot({
        devices: [{ device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: latest.timestamp, unique_id: null, category: 'person' }],
        positions: [latest], breadcrumbs: [first, latest],
      })
    })
    await openWorkspacePanel(page, 'people')
    await expect(page.getByTestId('ws-person-status-alpha')).toContainText('Not moving')
    await expect(page.getByTestId('ws-tracking-headline')).toContainText('not moving')
    await captureAndRegister(page, {
      testId: 'tracking-stationary-attention-map',
      testName: 'Stationary attention halo remains additive to the current marker',
      area: 'tracking', severity: 'critical',
      verificationPrompt: `Verify SAR Tracker stationary attention on the map:
1. Alpha Team remains visibly represented by its normal current-position marker
2. A distinct amber attention ring is visible outside that marker
3. The normal marker remains centered, opaque, and readable rather than hidden or replaced
4. The top-bar tracking headline and the People panel both clearly report Alpha Team as not moving
5. No copy uses the word emergency
Report PASS or FAIL for each item, then overall PASS/FAIL.`,
      playwrightAssertions: ['People panel and tracking headline report not moving while the current snapshot remains published'],
    })
    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('device-attention-alpha')).toBeVisible()
    await captureAndRegister(page, {
      testId: 'tracking-stationary-attention-workspace',
      testName: 'Stationary attention review and acknowledgement',
      area: 'tracking', severity: 'critical',
      verificationPrompt: `Verify SAR Tracker stationary attention in the Devices workspace:
1. Alpha Team is clearly labelled with stationary attention
2. The detail inspector explains the duration without meaningful movement
3. An Acknowledge Attention action is visible
4. The accepted coordinates and normal device details remain visible
5. No copy uses the word emergency
Report PASS or FAIL for each item, then overall PASS/FAIL.`,
      playwrightAssertions: ['device attention label visible', 'acknowledge attention action visible'],
    })
  })

  test('conflict and degraded evidence health stay distinct from live position truth [DON-268]', async ({ page }) => {
    await page.evaluate(async () => {
      const { applyIngestEvidenceHealth } = await import('/src/features/tracking/ingest-health-store.ts')
      applyIngestEvidenceHealth({
        state: 'critical', reason: 'outbox_storage_unavailable', pendingCount: 1,
        corruptCount: 0, conflictCount: 1, rejectedCount: 1,
        affectedDeviceCount: 1, conflictDeviceIds: ['alpha'],
      })
    })
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ingest-evidence-health-warning')).toContainText('Current positions remain live')
    await expect(page.getByTestId('position-conflict-warning')).toContainText('first accepted fix remains displayed')
    await captureAndRegister(page, {
      testId: 'tracking-degraded-evidence-conflict',
      testName: 'Degraded evidence storage and source conflict warnings',
      area: 'tracking', severity: 'critical',
      verificationPrompt: `Verify SAR Tracker evidence-health warnings:
1. A critical evidence-health warning clearly says local evidence storage is unavailable
2. It says current positions remain live and finalization/archive export are blocked
3. A separate source-conflict warning says the first accepted fix remains displayed
4. Current device markers remain visible on the map
5. No raw source payload, coordinate, or device identifier is disclosed in the warnings
Report PASS or FAIL for each item, then overall PASS/FAIL.`,
      playwrightAssertions: ['evidence health warning visible', 'first accepted conflict truth visible'],
    })
  })

  test('runtime-shutdown evidence loss stays explicit and blocks completeness [DON-276]', async ({ page }) => {
    await page.evaluate(async () => {
      const { applyIngestEvidenceHealth } = await import('/src/features/tracking/ingest-health-store.ts')
      applyIngestEvidenceHealth({
        state: 'critical', reason: 'renderer_pending_evidence_lost', pendingCount: 0,
        corruptCount: 0, conflictCount: 0, rejectedCount: 1,
        affectedDeviceCount: 1, conflictDeviceIds: [],
      })
    })

    await openWorkspacePanel(page, 'tracking')
    const warning = page.getByTestId('ingest-evidence-health-warning')
    await expect(warning).toContainText(
      'rejected-position evidence may have been lost when the app closed unexpectedly',
    )
    await expect(warning).toContainText('finalization and archive export are blocked')

    await captureElementAndRegister(page, 'ws-tracking-panel', {
      testId: 'tracking-shutdown-evidence-loss',
      testName: 'Runtime-shutdown evidence loss blocks completeness',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify SAR Tracker's runtime-shutdown evidence-loss warning:
1. The panel is headed "Tracking" and does not say tracking was lost, because current positions are still the live safety priority.
2. A red critical evidence-health warning explicitly says rejected-position evidence may have been lost when the app closed unexpectedly.
3. The warning says current positions remain live.
4. The warning explicitly says mission finalization and archive export are blocked.
5. The presentation does not claim the lost anomaly evidence was saved or recoverable.
Report PASS or FAIL for each item, then overall PASS/FAIL.`,
      playwrightAssertions: [
        'runtime-shutdown evidence loss is explicit',
        'finalization and archive export are blocked',
      ],
    })
  })

  test('paused mission refresh suspension is a red stale-position alert', async ({ page }) => {
    await pauseMission(page)
    await page.evaluate(async () => {
      const { applyTrackingStatus } = await import('/src/features/tracking/tracking-store.ts')
      applyTrackingStatus({
        mode: 'idle',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: null,
        warning: 'Live refresh suspended while mission is paused.',
      })
    })
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-headline')).toHaveAttribute('data-condition', 'paused')
    await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
    await expect(page.getByTestId('ws-alarm-resume')).toBeVisible()
    await expect(page.getByTestId('ws-tracking-happened')).toContainText('positions are not updating')

    await captureAndRegister(page, {
      testId: 'tracking-paused-refresh-alert',
      testName: 'Paused mission: red alarm strip, headline and Tracking panel',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of SAR Tracker while the mission is paused:
1. A bright red alarm strip under the top bar says "MISSION PAUSED" and that positions are not updating, with a "Resume mission" button
2. The tracking headline in the top bar is red/high-alert and says "MISSION PAUSED"
3. The Tracking panel says the mission is paused, so positions are not updating
4. The panel says the map shows the last positions received, which may not be where people are now, and tells the operator to press Resume mission
5. This should not look like a normal idle or not-configured state
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'mission phase is PAUSED',
        'tracking headline condition is paused',
        'alarm strip says MISSION PAUSED with a Resume control',
        'Tracking panel says positions are not updating',
      ],
    })
  })

  test('paused mission on Full map keeps people and stale information in view [DON-353]', async ({ page }) => {
    // Replaces the retired collapsed-sidebar capture: with the panel hidden
    // and the mission paused, who is tracked and who is stale stay readable.
    await injectOneStalePosition(page)
    await pauseMission(page)
    await page.getByTestId('ws-full-map').click()
    await expect(page.getByTestId('ws-full-map')).toHaveText('Show panel')
    await expect(page.getByTestId('ws-people-panel')).toBeHidden()
    await expect(page.getByTestId('ws-alarm')).toContainText('MISSION PAUSED')
    await expect(page.getByTestId('ws-alarm-resume')).toBeVisible()
    await expect(page.getByTestId('ws-toggle-people')).toContainText('People 3')
    // Paused, no position is live, so all three need a look; the person who
    // was already stale is told apart in the People panel below.
    await expect(page.getByTestId('ws-people-attention')).toHaveText('3 ⚠')
    await expect(page.getByTestId('ws-tracking-headline')).toHaveAttribute('data-condition', 'paused')
    // The stale person is still named while paused.
    await expect(page.getByTestId('ws-tracking-problems')).toContainText('1 stale')

    await captureAndRegister(page, {
      testId: 'tracking-paused-full-map',
      testName: 'Paused mission on Full map: people count, stale badge and alarm stay visible',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this full-page screenshot of SAR Tracker with the mission paused and the side panel hidden (Full map):
1. The map fills the width below the top bar; no side panel is open
2. A bright red alarm strip says "MISSION PAUSED" and that positions are not updating, with a "Resume mission" button
3. The top bar's People button reads "People 3" with a separate amber attention badge reading "3 ⚠" (paused, no position is live, so everyone needs a look)
4. The top bar's tracking headline reads as paused (red/high alert) and still names "1 stale"; a callout on the map says Charlie Team was already out of date when updates stopped
5. A "Show panel" button in the top bar brings the panel back
6. Nothing in the top bar is cut off or overlapping
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'Full map on: button reads Show panel and the People panel is hidden',
        'alarm says MISSION PAUSED with a Resume control',
        'People button reads People 3 with attention badge "3 ⚠" (paused: none live)',
        'tracking headline condition is paused and names 1 stale',
      ],
    })

    // Show panel brings People back, still naming the stale person in words.
    await page.getByTestId('ws-full-map').click()
    await openWorkspacePanel(page, 'people')
    await expect(page.getByTestId('ws-person-status-charlie')).toContainText('Already out of date when updates stopped')
    await expect(page.getByTestId('ws-person-status-alpha')).toContainText('Last known position')
    for (const device of ['alpha', 'bravo', 'charlie']) await expect(page.getByTestId(`ws-person-${device}`)).toBeVisible()
    await captureElementAndRegister(page, 'ws-people-panel', {
      testId: 'tracking-paused-people-panel',
      testName: 'People panel while paused names the stale person in words',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker People panel while the mission is paused:
1. The panel lists exactly 3 teams: "Alpha Team", "Bravo Team", "Charlie Team"
2. Charlie Team's row says in words that it was "Already out of date when updates stopped", setting it apart from the others
3. Alpha and Bravo say "Last known position" with an age, because nothing updates while paused
4. Each team still has Location and Trail checkboxes
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'Alpha, Bravo and Charlie rows visible while paused',
        'Charlie row says Already out of date when updates stopped',
        'Alpha row says Last known position',
      ],
    })
  })

  test('map shows readable device labels and less dominant breadcrumb casing', async ({ page }) => {
    // Device names are listed in the People panel beside the map.
    await openWorkspacePanel(page, 'people')
    await expect(page.getByTestId('ws-person-alpha')).toContainText('Alpha Team')
    await expect(page.getByTestId('ws-person-bravo')).toContainText('Bravo Team')

    // Zoom the map closer to the device positions for readable labels
    await page.evaluate(() => {
      const map = (window as Window & { __SARTRACKER_MAP__?: {
        jumpTo: (opts: { center: [number, number]; zoom: number }) => void
      } }).__SARTRACKER_MAP__
      map?.jumpTo({ center: [-9.7415, 51.9964], zoom: 13.2 })
    })
    await waitForRenderedTrackingFeatures(page)
    await expect
      .poll(() => page.getByTestId('ws-search-time').innerText(), {
        message: 'mission search time is running before tracking map visual capture',
        timeout: 3000,
      })
      .not.toContain('00:00:00')

    await captureAndRegister(page, {
      testId: 'tracking-map-devices',
      testName: 'Device markers rendered on map (zoomed)',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker map zoomed to show tracking device markers:
1. The map should show a zoomed-in topographic view of a mountainous area (contour lines, terrain shading visible)
2. There should be at least 2 small colored device marker dots/icons visible on the map (typically green, cyan, or colored circles/pins)
3. Device text labels should be readable against the topographic map, using dark text with a light/white backing or halo rather than low-contrast colored text
4. The device markers should be positioned on the mountain terrain in the central area of the map (not off-screen or in corners)
5. There should be at least one visible breadcrumb trail line in the selected device colour, and the dark casing should be narrow/subdued enough that the selected colour remains obvious
6. The top bar should show the mission's search time running (time > 00:00:00)
7. The People panel on the right should list the tracked teams with Location and Trail checkboxes
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'tracking snapshot injected with Alpha Team and Bravo Team',
        'map screenshot captured after zooming to tracking positions',
      ],
    })
  })

  test('breadcrumb dot mode shows every authoritative fix without distance omission [DON-259]', async ({
    page,
  }) => {
    await page.getByTestId('open-devices-workspace').click()
    await page.getByTestId('breadcrumb-mode-dots').click()
    await page.getByTestId('device-breadcrumb-color-alpha').click()
    await page.getByTestId('device-color-option-FF7A00').click()
    await page.getByTestId('workspace-close-btn').click()
    await expect(page.getByTestId('devices-workspace')).toBeHidden()

    await page.evaluate(async () => {
      const fixBaseMs = Date.now() + 1_000
      const breadcrumbs = Array.from({ length: 4 }, (_entry, index) => ({
        id: `don-259-visual-${index + 1}`,
        device_id: 'alpha',
        lat: 51.997 + index * 0.00025,
        lon: -9.746 - index * 0.00025,
        altitude: null,
        speed: 2.5,
        battery: 84,
        accuracy: null,
        timestamp: new Date(fixBaseMs + index * 5_000).toISOString(),
        source: null,
        data_origin: 'live' as const,
        cache_age_seconds: null,
        device_cache_stale: false,
      }))

      await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
        devices: [
          {
            device_id: 'alpha',
            name: 'Alpha Team',
            status: 'online',
            last_seen: '2026-07-19T12:14:15.000Z',
            unique_id: null,
            category: 'person',
          },
        ],
        positions: [],
        breadcrumbs,
      })

      window.__SARTRACKER_MAP__?.jumpTo({
        center: [-9.74638, 51.99738],
        zoom: 15,
      })
    })

    await expect
      .poll(() => readDotModeRenderState(page), {
        message:
          'all four newly injected close-spaced breadcrumb dots join the exact mission trail before capture',
        timeout: 15_000,
      })
      .toEqual({
        injectedBreadcrumbDots: 4,
        currentDeviceMarkers: 0,
        alphaTrailLineRendered: true,
      })

    await captureAndRegister(page, {
      testId: 'tracking-breadcrumb-dots-faithful',
      testName: 'Every authoritative close tracking fix is visible in breadcrumb dot mode',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this zoomed SAR Tracker map after four closely spaced GPS fixes were added to the authoritative mission trail:
1. The four newly added orange breadcrumb dots should be visible along one short diagonal route near the centre of the map; earlier mission dots may also remain visible
2. An orange trail line should run underneath and through the dots: Breadcrumb dots mark exact fixes on top of the whole trail line, never instead of it
3. The dots should be distinct rather than collapsed into one marker or reduced to only the first and last point
4. The map should remain readable at this close zoom with normal topographic detail
5. No dialog or workspace should cover the route
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'MapLibre exact-dot source contains all four newly injected Alpha Team source identities',
        'whole-trail line layer stays visible under the dots [DON-338]',
        'breadcrumb display mode is dots',
        'Alpha Team breadcrumb colour is orange',
      ],
    })
  })

  test('People panel lists all tracked devices', async ({ page }) => {
    await openWorkspacePanel(page, 'people')
    const peoplePanel = page.getByTestId('ws-people-panel')
    await expect(peoplePanel).toBeVisible()
    await expect(page.getByTestId('ws-people-count')).toContainText('3')
    for (const device of ['alpha', 'bravo', 'charlie']) {
      await expect(page.getByTestId(`ws-person-${device}`)).toBeVisible()
      await expect(page.getByTestId(`ws-position-${device}`)).toBeChecked()
      await expect(page.getByTestId(`ws-trail-${device}`)).toBeChecked()
    }

    await captureElementAndRegister(page, 'ws-people-panel', {
      testId: 'tracking-layer-panel',
      testName: 'People panel with tracked devices',
      area: 'layers',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker People panel with tracking devices:
1. The panel is headed "People" with a count of 3, an "All devices" button and a Close button
2. It lists exactly 3 teams: "Alpha Team", "Bravo Team", "Charlie Team"
3. Each team has separate "Location" and "Trail" checkboxes, both ticked by default, so operators can show current positions with or without trails
4. An "Everyone" row lets the operator change Location and Trail for all teams at once
5. A team that needs attention (for example Charlie Team, offline) shows a short status in words, not only a colour
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'People panel is visible with a count of 3',
        'Alpha, Bravo and Charlie Team rows are visible',
        'each team has Location and Trail ticked',
      ],
    })
  })

  test('People button shows the people count and attention badge separately, never a ratio', async ({ page }) => {
    // Inject a fresh snapshot where one of the three latest positions is
    // stale so the People button shows both a count and an attention badge.
    // This keeps the regression the old mast cell had pinned: it once read
    // "ONLINE 3/1", which scans as the impossible ratio "3 of 1".
    await injectOneStalePosition(page)


    const people = page.getByTestId('ws-toggle-people')
    await expect(people).toContainText('People 3')
    // The exact values the old mast pinned (3 tracked, 1 stale), now two parts.
    await expect(page.getByTestId('ws-people-attention')).toHaveText('1 ⚠')
    await expect(page.getByTestId('ws-tracking-problems')).toHaveText('1 stale')
    const peopleText = (await people.textContent()) ?? ''
    expect(peopleText).not.toMatch(/\b\d+\s*\/\s*\d+\b/)
    // Only the problem words: the last-update date below them is not a count.
    const headlineText = (await page.getByTestId('ws-tracking-problems').textContent()) ?? ''
    expect(headlineText).not.toMatch(/\b\d+\s*\/\s*\d+\b/)

    await captureElementAndRegister(page, 'ws-top-bar', {
      testId: 'top-bar-people-count-no-ratio',
      testName: 'Top bar people count and tracking headline during an active mission',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker top bar during an active mission with one stale position:
1. The People button shows "People 3" and, separately, a small amber attention badge reading exactly "1 ⚠" (the number 1 and a warning sign). Mark FAIL if the badge is missing or shows any other number
2. The people count and the attention number are two distinct values. They are NOT combined into a single value like "3/1" or "1/3" — that exact regression is what this test exists to prevent. Mark item 2 FAIL only if you see a single visible "<digits>/<digits>" string treated as one value.
3. The tracking headline names the problem in words as exactly "1 stale", with a last-update time below
4. The mission button shows the mission as Running, with the search time beside it
5. The overall theme is dark; the attention badge and headline read as amber warnings, not red alarms
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'People button contains People 3',
        'attention badge reads exactly "1 ⚠"',
        'tracking headline problem words contain "1 stale"',
        'neither the People button nor the headline problem words match a digits/digits ratio',
      ],
    })
  })

  test('full operational view with tracking, top bar and People panel', async ({ page }) => {
    await expect(page.getByTestId('ws-search-time')).not.toHaveText('00:00:00')
    await expect(page.getByTestId('ws-people-panel')).toBeVisible()

    await captureAndRegister(page, {
      testId: 'tracking-full-operational',
      testName: 'Full operational view with active tracking',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this full-page screenshot of SAR Tracker in operational tracking mode. This broad frame checks layout only; detailed device-marker readability, tracking counts, and layer-list content are verified by separate element/zoomed screenshots in this suite.
1. MAP: A topographic map of the Kerry mountains takes most of the width, with tracked team markers on it
2. TOOLBAR: Maps and Map Tools controls sit at the top left of the map
3. COORDS: A coordinate bar is at the bottom of the map
4. TOP BAR: The team logo, a mission button showing the mission as Running, a running Search time clock and the tracking headline are at the top left
5. TOP BAR: People (with a count), Layers, Full map, Settings and More buttons are at the top right
6. SIDE PANEL: A People panel on the right lists the tracked teams with Location and Trail checkboxes
7. Theme should be dark with amber/gold accents
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'search time is running in the top bar',
        'People panel is open beside the map',
      ],
    })
  })
})

test.describe('Visual: Tracking without basemap completion [DON-263]', () => {
  test('operational overlays remain visible over a pending raster background', async ({
    context,
    page,
  }) => {
    let releaseTiles = () => undefined
    const tileGate = new Promise<void>((resolve) => {
      releaseTiles = resolve
    })
    let heldTileCount = 0

    await context.route('https://tile.opentopomap.org/**', async (route) => {
      heldTileCount += 1
      await tileGate
      await route.abort().catch(() => undefined)
    })

    try {
      await navigateToHarness(page)
      await startMission(page, 'Pending Basemap Tracking Verification')
      await injectStandardTracking(page)
      await expect.poll(() => heldTileCount).toBeGreaterThan(0)
      await expect
        .poll(() => page.evaluate(() => window.__SARTRACKER_MAP__?.isStyleLoaded() ?? true))
        .toBe(false)
      await waitForRenderedTrackingFeatures(page)

      await captureElementAndRegister(page, 'map-container', {
        testId: 'tracking-pending-basemap-overlays',
        testName: 'Tracking overlays remain operational while raster tiles are pending',
        area: 'tracking',
        severity: 'critical',
        verificationPrompt: `Verify this SAR Tracker map capture taken while all OpenTopoMap tile requests are deliberately held open:
1. The raster background should be blank, dark, or visibly incomplete; a normal fully rendered topographic background is not expected
2. At least two colored current-device markers should still be visible in the map area
3. Device labels should remain readable against the incomplete background
4. At least one colored breadcrumb trail should connect tracking fixes
5. Map controls may remain visible, but no loading panel or error overlay should cover the operational markers or breadcrumb trail
6. The capture must make it visually credible that operational tracking is available independently of the missing raster background
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
        playwrightAssertions: [
          'OpenTopoMap tile requests are held open',
          'MapLibre isStyleLoaded is false',
          'at least two device markers and one breadcrumb trail are rendered',
        ],
      })
    } finally {
      releaseTiles()
      await context.unrouteAll({ behavior: 'ignoreErrors' })
    }
  })
})

async function readDotModeRenderState(page: Page): Promise<{
  readonly injectedBreadcrumbDots: number
  readonly currentDeviceMarkers: number
  readonly alphaTrailLineRendered: boolean
}> {
  return page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__
    const features =
      map?.queryRenderedFeatures(undefined, {
        layers: ['tracking-breadcrumbs-dots'],
      }) ?? []
    const injectedIdentityKeys = features.flatMap((feature) => {
      if (
        feature.properties?.featureKind !== 'breadcrumb' ||
        feature.properties.deviceId !== 'alpha' ||
        !String(feature.properties.sourcePositionId ?? '').startsWith('don-259-visual-') ||
        feature.geometry.type !== 'Point'
      ) {
        return []
      }
      return [String(feature.properties.sourcePositionId)]
    })
    return {
      injectedBreadcrumbDots: new Set(injectedIdentityKeys).size,
      currentDeviceMarkers:
        map?.queryRenderedFeatures(undefined, {
          layers: ['tracking-devices-circle'],
        }).length ?? 0,
      // DON-338: the whole-trail line is drawn underneath the exact dots.
      alphaTrailLineRendered: (map?.queryRenderedFeatures(undefined, {
        layers: ['tracking-breadcrumbs-line'],
      }) ?? []).some((feature) => feature.properties?.deviceId === 'alpha'),
    }
  })
}

async function waitForRenderedTrackingFeatures(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(({ deviceLayerId, breadcrumbLayerId }) => {
          const map = (window as Window & {
            __SARTRACKER_MAP__?: {
              getLayer: (id: string) => unknown
              queryRenderedFeatures: (geometry?: unknown, options?: { layers?: string[] }) => unknown[]
            }
          }).__SARTRACKER_MAP__
          if (map === undefined) {
            return { devices: 0, breadcrumbs: 0, ready: false }
          }
          if (map.getLayer(deviceLayerId) === undefined || map.getLayer(breadcrumbLayerId) === undefined) {
            return { devices: 0, breadcrumbs: 0, ready: false }
          }

          const devices = map.queryRenderedFeatures(undefined, { layers: [deviceLayerId] }).length
          const breadcrumbs = map.queryRenderedFeatures(undefined, {
            layers: [breadcrumbLayerId],
          }).length
          return {
            devices,
            breadcrumbs,
            ready: devices >= 2 && breadcrumbs >= 1,
          }
        }, {
          deviceLayerId: TRACKING_DEVICE_LAYER_ID,
          breadcrumbLayerId: TRACKING_BREADCRUMB_LAYER_ID,
        }),
      {
        message: 'tracking device markers and breadcrumb trail rendered before visual capture',
        timeout: 8000,
      },
    )
    .toEqual(expect.objectContaining({ ready: true }))
}

/**
 * Replaces the tracking snapshot with three people, one of whose latest
 * positions is stale, so the People button shows a count and an attention
 * badge and the headline names "1 stale".
 */
async function injectOneStalePosition(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const snapshot = {
      devices: [
        { device_id: 'alpha', name: 'Alpha Team', status: 'online' as const, last_seen: '2026-04-10T12:00:00.000Z', unique_id: null, category: 'person' },
        { device_id: 'bravo', name: 'Bravo Team', status: 'online' as const, last_seen: '2026-04-10T11:58:00.000Z', unique_id: null, category: 'person' },
        { device_id: 'charlie', name: 'Charlie Team', status: 'offline' as const, last_seen: '2026-04-10T10:30:00.000Z', unique_id: null, category: 'person' },
      ],
      positions: [
        { id: 'pos-alpha', device_id: 'alpha', lat: 51.9985, lon: -9.7426, altitude: 320, speed: 1, battery: 85, accuracy: 8, timestamp: '2026-04-10T12:00:00.000Z', source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false },
        { id: 'pos-bravo', device_id: 'bravo', lat: 52.0012, lon: -9.7501, altitude: 280, speed: 0.5, battery: 42, accuracy: 15, timestamp: '2026-04-10T11:58:00.000Z', source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false },
        { id: 'pos-charlie', device_id: 'charlie', lat: 51.995, lon: -9.738, altitude: 350, speed: 0, battery: 12, accuracy: 20, timestamp: '2026-04-10T10:30:00.000Z', source: 'cache' as const, cache_age_seconds: 600, device_cache_stale: true },
      ],
      breadcrumbs: [],
    }

    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot(snapshot, {
      mode: 'online',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: '2026-04-10T12:00:01.000Z',
      warning: null,
    })
  })
  await page.waitForTimeout(400)
}

const CREDENTIAL_WARNING = 'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'

test.describe('Visual: credential warning and problem words [DON-353]', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToHarness(page)
  })

  test('credential warning before a mission names the fix in the top bar', async ({ page }) => {
    await page.evaluate(async (warning) => {
      const { applyTrackingStatus } = await import('/src/features/tracking/tracking-store.ts')
      applyTrackingStatus({
        mode: 'idle', consecutiveFailures: 0, recovered: false, lastSuccessAt: null,
        warning, warningCodes: ['tracking_credentials_unreadable'],
      })
    }, CREDENTIAL_WARNING)
    const headline = page.getByTestId('ws-tracking-headline')
    await expect(headline).toHaveAttribute('data-condition', 'credentials')
    await expect(headline).toContainText('Re-enter password')
    await openWorkspacePanel(page, 'tracking')
    await expect(page.getByTestId('ws-tracking-happened')).toContainText(CREDENTIAL_WARNING)

    await captureAndRegister(page, {
      testId: 'tracking-credentials-before-mission',
      testName: 'Unreadable tracking password before a mission',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this full-page screenshot of SAR Tracker before any mission, when the saved tracking password cannot be read:
1. The top bar's tracking headline says "Re-enter password" in whole words, not a neutral "not connected"
2. A Tracking panel says the stored Traccar credentials could not be decrypted and to re-enter the password or token in Settings
3. Under "What to do" it points to Settings, Tracking sources
4. No Reconnect button is offered, because reconnecting cannot help until the password is entered again
5. The mission setup is still reachable; nothing claims tracking is healthy
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'headline condition is credentials and names Re-enter password',
        'Tracking panel quotes the credential warning',
      ],
    })
  })

  test('credential warning during a mission is the tracking-lost alarm with the fix', async ({ page }) => {
    await startMission(page, 'Credential check')
    await injectCredentialLoss(page, { stale: false, stillPerson: false })
    const headline = page.getByTestId('ws-tracking-headline')
    await expect(headline).toHaveAttribute('data-condition', 'credentials')
    await expect(page.getByTestId('ws-tracking-problems')).toContainText('Re-enter password')
    await expect(page.getByTestId('ws-alarm')).toContainText('TRACKING LOST')
    await expect(page.getByTestId('ws-alarm')).toContainText('password or token')

    await captureAndRegister(page, {
      testId: 'tracking-credentials-in-mission',
      testName: 'Unreadable tracking password during a mission',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this full-page screenshot of SAR Tracker mid-mission when the saved tracking password stops working:
1. A bright red alarm strip across the map says "TRACKING LOST": the saved tracking password or token cannot be used, and positions on the map may not be current
2. The top bar's tracking headline reads as lost tracking and shows "Re-enter password" in whole words (the re-entry wording is in the headline, not the alarm strip)
3. The mission still shows as Running in the top bar
4. Last positions remain on the map; nothing claims they are current
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'headline condition is credentials',
        'problem words contain Re-enter password',
        'alarm says TRACKING LOST and that the password or token cannot be used',
      ],
    })
  })

  test('problem words at 1024 px in a wide font keep safety words whole, ahead of the fix', async ({ page }) => {
    // CI's Linux fonts draw wider than macOS; Verdana/DejaVu reproduce them.
    await page.addStyleTag({ content: ':root, button { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' })
    await page.setViewportSize({ width: 1024, height: 720 })
    await startMission(page, 'Problem word fit')
    await injectCredentialLoss(page, { stale: true, stillPerson: true })
    const headline = page.getByTestId('ws-tracking-headline')
    await expect(headline).toHaveAttribute('aria-label', /1 position out of date/)
    await expect(headline).toHaveAttribute('aria-label', /1 person not moving/)
    const problems = page.getByTestId('ws-tracking-problems')
    await expect(problems).toContainText('1 stale')
    const fit = await problems.evaluate((element) => {
      const bar = element.closest('[data-testid="ws-tracking-headline"]')!.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      return { inside: box.right <= bar.right + 0.5 && box.width > 0, clipped: element.scrollWidth > element.clientWidth + 1 }
    })
    expect(fit).toEqual({ inside: true, clipped: false })

    await captureElementAndRegister(page, 'ws-top-bar', {
      testId: 'tracking-problem-words-1024-wide-font',
      testName: 'Combined problem words at 1024 px in a wide font',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this screenshot of the SAR Tracker top bar at 1024 px wide, in a wide font, while tracking is lost (password unreadable), one position is stale and one person is not moving:
1. The tracking headline shows "1 stale" first, as whole words, not cut mid-word or clipped at the edge
2. Any further problems are either named in whole words (for example "1 not moving", "Re-enter password") or counted as "+N more"; nothing is silently dropped
3. "Re-enter password", if shown, never comes before a person-safety word ("stale", "not moving")
4. No text overlaps the People, Layers or other top-bar buttons
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'aria-label names 1 position out of date and 1 person not moving',
        'problem words contain 1 stale, inside the bar and not clipped',
      ],
    })
  })
})

/**
 * The state the runtime reaches when the saved password stops working
 * mid-mission: idle, with the positions already received. With stillPerson,
 * Alpha has not moved for 20 minutes; with stale, Bravo's position is out of date.
 */
async function injectCredentialLoss(page: Page, options: { stale: boolean, stillPerson: boolean }): Promise<void> {
  await page.evaluate(async ({ stale, stillPerson, warning }) => {
    const now = Date.now()
    const iso = (ms: number) => new Date(ms).toISOString()
    const base = { lon: -9.7, altitude: null, speed: null, battery: null, accuracy: 4, source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null }
    const alpha = { ...base, device_id: 'alpha', lat: 52.0, device_cache_stale: false }
    const alphaFirst = { ...alpha, id: 'a1', timestamp: iso(now - 20 * 60_000) }
    const alphaLatest = { ...alpha, id: 'a2', lat: 52.00001, timestamp: iso(now - 30_000) }
    const bravo = { ...base, device_id: 'bravo', id: 'b1', lat: 52.1, device_cache_stale: true, timestamp: iso(now - 10 * 60_000) }
    await window.__SARTRACKER_BROWSER_HARNESS__!.injectTrackingSnapshot({
      devices: [
        { device_id: 'alpha', name: 'Alpha Team', status: 'online', last_seen: alphaLatest.timestamp, unique_id: null, category: 'person' },
        ...(stale ? [{ device_id: 'bravo', name: 'Bravo Team', status: 'online' as const, last_seen: bravo.timestamp, unique_id: null, category: 'person' }] : []),
      ],
      positions: stale ? [alphaLatest, bravo] : [alphaLatest],
      breadcrumbs: [...(stillPerson ? [alphaFirst] : []), alphaLatest, ...(stale ? [bravo] : [])],
    }, {
      mode: 'idle', consecutiveFailures: 0, recovered: false, lastSuccessAt: null,
      warning, warningCodes: ['tracking_credentials_unreadable'],
    })
  }, { ...options, warning: CREDENTIAL_WARNING })
}
