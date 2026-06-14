import { expect, test } from '@playwright/test'

test.describe('M21 diagnostics workspace', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
  })

  test('opens diagnostics, copies the support report, exports it, and repairs layer metadata', async ({
    page,
  }) => {
    await page.getByTestId('mission-name-input').fill('Diagnostics Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.evaluate(() => {
      window.localStorage.setItem(
        'sartracker:browser-settings',
        JSON.stringify({
          missionDefaults: {
            autoRefreshEnabled: true,
            autoRefreshIntervalSeconds: 30,
            autoSaveEnabled: true,
            autoSaveIntervalSeconds: 45,
            primaryMissionRoot: '/missions/primary',
            backupMissionRoot: '/missions/backup',
            coordinatorRoster: ['C1'],
            adminRoster: ['Ops Lead'],
          },
          dataSource: {
            providerType: 'traccar_http',
            baseUrl: 'https://traccar.example.com',
            authMode: 'basic',
            email: 'ops@example.com',
            autoConnect: true,
            trackingCacheEnabled: true,
            replayEnabled: false,
            replayStart: '',
            replayDurationHours: 4,
            secretPresent: true,
          },
          advanced: {
            repairLayerStructureAvailable: false,
          },
        }),
      )

      const rawHarness = window.sessionStorage.getItem('sartracker:browser-harness')
      if (rawHarness === null) {
        throw new Error('Browser harness state unavailable.')
      }

      const harness = JSON.parse(rawHarness) as { currentMissionId?: string | null }
      const missionId = harness.currentMissionId
      if (missionId === undefined || missionId === null) {
        throw new Error('Current mission id unavailable.')
      }

      window.sessionStorage.setItem(
        'sartracker:browser-layer-catalog',
        JSON.stringify({
          [missionId]: [
            {
              missionId,
              nodeId: 'feature:marker:marker-1',
              parentNodeId: 'layer:markers:clues',
              nodeKind: 'feature_item',
              alias: 'Legacy alias',
              isFavorite: false,
              isVisible: true,
              displayOrder: 0,
              metadataJson: null,
              updatedAt: '2026-04-11T01:00:00.000Z',
            },
          ],
        }),
      )
    })

    await page.getByTestId('open-diagnostics-workspace').click()
    await expect(page.getByTestId('diagnostics-workspace')).toBeVisible()
    await expect(page.getByTestId('diagnostics-workspace')).toContainText('Diagnostics Mission')
    await expect(page.getByTestId('diagnostics-workspace')).toContainText('https://traccar.example.com')

    await page.getByTestId('diagnostics-copy-report').click()
    await expect(page.getByTestId('diagnostics-feedback')).toContainText('copied')
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain(
      'Diagnostics Report',
    )

    await page.getByTestId('diagnostics-export-report').click()
    await expect(page.getByTestId('diagnostics-feedback')).toContainText('Exported')
    await expect(page.getByTestId('diagnostics-export-path')).toContainText('diagnostics-report')

    // The support bundle export reuses the diagnostics report in browser mode (no
    // crash/runtime history) but must produce a distinct support-bundle file name.
    await page.getByTestId('diagnostics-export-support-bundle').click()
    await expect(page.getByTestId('diagnostics-feedback')).toContainText('support bundle')
    await expect(page.getByTestId('diagnostics-export-path')).toContainText('support-bundle')

    await page.getByTestId('diagnostics-repair-layer-catalog').click()
    await expect(page.getByTestId('diagnostics-feedback')).toContainText('Layer catalog metadata reset')

    await expect.poll(async () => {
      return page.evaluate(() => {
        const rawHarness = window.sessionStorage.getItem('sartracker:browser-harness')
        if (rawHarness === null) {
          return null
        }

        const harness = JSON.parse(rawHarness) as { currentMissionId?: string | null }
        const missionId = harness.currentMissionId
        if (missionId === undefined || missionId === null) {
          return null
        }

        const raw = window.sessionStorage.getItem('sartracker:browser-layer-catalog')
        return raw === null ? null : JSON.parse(raw)[missionId] ?? null
      })
    }).toBeNull()
  })

  test('uses dialog semantics and returns focus to the diagnostics opener on Escape', async ({
    page,
  }) => {
    const opener = page.getByTestId('open-diagnostics-workspace')
    await opener.click()

    const dialog = page.getByRole('dialog', { name: 'Operational Diagnostics' })
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('workspace-close-btn')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('includes per-device breadcrumb render budget details in copied diagnostics [DON-159]', async ({
    page,
  }) => {
    await page.getByTestId('mission-name-input').fill('Breadcrumb Diagnostics')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')

    await page.evaluate(async () => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      if (harness === undefined) {
        throw new Error('Browser harness unavailable.')
      }

      await harness.injectTrackingSnapshot({
        devices: [
          {
            device_id: '2',
            name: 'Eamonn O Connor',
            status: 'online',
            last_seen: '2026-06-13T21:30:00.000Z',
            unique_id: null,
            category: null,
          },
          {
            device_id: '25',
            name: 'Richard Morrison',
            status: 'online',
            last_seen: '2026-06-12T18:30:03.974Z',
            unique_id: null,
            category: null,
          },
        ],
        positions: [
          {
            id: 'eoc-current',
            device_id: '2',
            lat: 52.1,
            lon: -9.7,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            timestamp: '2026-06-13T21:30:00.000Z',
            source: 'traccar',
            data_origin: 'live',
            cache_age_seconds: null,
            device_cache_stale: false,
          },
          {
            id: 'richard-current',
            device_id: '25',
            lat: 51.99,
            lon: -9.74,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            timestamp: '2026-06-12T18:30:03.974Z',
            source: 'traccar',
            data_origin: 'live',
            cache_age_seconds: null,
            device_cache_stale: false,
          },
        ],
        breadcrumbs: [],
        breadcrumbMetadata: {
          totalObserved: 28_280,
          totalRetained: 8_280,
          deviceBudgets: [
            {
              deviceId: '2',
              retained: 5_000,
              total: 25_000,
              firstTimestamp: '2026-06-13T01:00:00.000Z',
              lastTimestamp: '2026-06-13T21:30:00.000Z',
              truncated: true,
            },
            {
              deviceId: '25',
              retained: 3_280,
              total: 3_280,
              firstTimestamp: '2026-06-12T11:59:28.481Z',
              lastTimestamp: '2026-06-12T18:30:03.974Z',
              truncated: false,
            },
          ],
        },
      })
    })

    await page.getByTestId('open-diagnostics-workspace').click()
    await expect(page.getByTestId('diagnostics-workspace')).toBeVisible()
    await expect(page.getByTestId('diagnostics-workspace')).toContainText('Breadcrumb points')

    await page.getByTestId('diagnostics-copy-report').click()
    await expect(page.getByTestId('diagnostics-feedback')).toContainText('copied')
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain(
      'breadcrumb render retained: 8280 of 28280',
    )
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain(
      'breadcrumb device 2: retained=5000 total=25000',
    )
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain(
      'breadcrumb device 25: retained=3280 total=3280',
    )
    await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain(
      'Breadcrumb history is render-budgeted for 1 device',
    )
  })
})
