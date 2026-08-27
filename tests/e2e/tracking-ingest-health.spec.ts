import { expect, test } from '@playwright/test'

test.describe('BCP-01 current-position ingest health', () => {
  test.use({ timezoneId: 'Europe/Dublin' })

  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    await expect(page.getByTestId('app-title')).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.getByTestId('mission-name-input').fill('BCP-01 Ingest Health')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('keeps valid fixes visible beside rejection, roster, and unverified-time warnings [DON-267]', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot, applyTrackingStatus }, { applyCurrentPositionRejections }] =
        await Promise.all([
          import('/src/features/tracking/tracking-store.ts'),
          import('/src/features/tracking/ingest-health-store.ts'),
        ])

      applyTrackingSnapshot({
        devices: [{
          device_id: 'alpha',
          name: 'Alpha Team',
          status: 'online',
          last_seen: '2026-08-22T10:00:00.000Z',
          unique_id: null,
          category: 'person',
        }],
        positions: [{
          id: 'alpha-current',
          device_id: 'alpha',
          lat: 51.9985,
          lon: -9.7426,
          altitude: 320,
          speed: 1,
          battery: 85,
          accuracy: 8,
          timestamp: '2026-08-22T15:10:17.000Z',
          timestamp_source: 'server',
          fix_time_unverified: true,
          source: 'osmand',
          data_origin: 'live',
          cache_age_seconds: null,
          device_cache_stale: true,
        }],
        breadcrumbs: [],
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

    await expect(page.getByTestId('tracking-warning')).toContainText('ROSTER UNAVAILABLE')
    await expect(page.getByTestId('current-position-ingest-warning')).toContainText(
      'Valid current fixes remain visible',
    )
    await expect(page.getByTestId('fix-time-unverified-warning')).toContainText(
      'uses server receipt clock, not verified Traccar fixTime',
    )
    await expect(page.getByTestId('tracking-counters')).toContainText('1')

    await page.getByTestId('open-devices-workspace').click()
    await expect(page.getByTestId('device-ingest-warning-alpha')).toContainText(
      'Position row rejected',
    )
    await expect(page.getByTestId('device-source-alpha')).toContainText('Fix time unverified')
    await expect(page.getByTestId('device-fix-time-alpha')).toHaveText(
      '22/08/2026, 16:10:17 GMT+01:00 (Europe/Dublin)',
    )
    await expect(page.getByTestId('device-inspector-last-seen-alpha')).toHaveText(
      '22/08/2026, 11:00:00 GMT+01:00 (Europe/Dublin)',
    )
  })

  test('clears rejection and unverified-time warnings after a clean verified poll [DON-267]', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot }, { applyCurrentPositionRejections }] = await Promise.all([
        import('/src/features/tracking/tracking-store.ts'),
        import('/src/features/tracking/ingest-health-store.ts'),
      ])
      applyCurrentPositionRejections([
        { deviceId: 'alpha', reason: 'invalid_coordinates', rowIndex: 1 },
      ])
      applyTrackingSnapshot({
        devices: [],
        positions: [],
        breadcrumbs: [],
      })
    })
    await expect(page.getByTestId('current-position-ingest-warning')).toBeVisible()

    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot }, { applyCurrentPositionRejections }] = await Promise.all([
        import('/src/features/tracking/tracking-store.ts'),
        import('/src/features/tracking/ingest-health-store.ts'),
      ])
      applyCurrentPositionRejections([])
      applyTrackingSnapshot({
        devices: [],
        positions: [],
        breadcrumbs: [],
      })
    })

    await expect(page.getByTestId('current-position-ingest-warning')).toHaveCount(0)
    await expect(page.getByTestId('fix-time-unverified-warning')).toHaveCount(0)
  })

  test('keeps conflict and degraded evidence warnings visible while current positions stay live [DON-268]', async ({ page }) => {
    await page.evaluate(async () => {
      const [{ applyTrackingSnapshot }, { applyIngestEvidenceHealth }] = await Promise.all([
        import('/src/features/tracking/tracking-store.ts'),
        import('/src/features/tracking/ingest-health-store.ts'),
      ])
      applyTrackingSnapshot({ devices: [], positions: [], breadcrumbs: [] })
      applyIngestEvidenceHealth({
        state: 'degraded', reason: 'ledger_projection_failed', pendingCount: 1,
        corruptCount: 0, conflictCount: 1, rejectedCount: 0,
        affectedDeviceCount: 1, conflictDeviceIds: ['alpha'],
      })
    })
    await expect(page.getByTestId('ingest-evidence-health-warning')).toContainText('Current positions remain live')
    await expect(page.getByTestId('position-conflict-warning')).toContainText('first accepted fix remains displayed')
  })
})
