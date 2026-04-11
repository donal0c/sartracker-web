import { expect, test } from '@playwright/test'

test.describe('M22 GPX import parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('GPX Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
  })

  test('renders imported GPX tracks in the panel, layer catalog, review workspace, and map source', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      if (harness === undefined) {
        throw new Error('Browser harness API unavailable.')
      }

      await harness.importGpxFiles([
        {
          sourcePath: '/tracks/alpha.gpx',
          fileName: 'alpha.gpx',
          contents: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="playwright">
  <trk>
    <trkseg>
      <trkpt lat="52.0000" lon="-9.7000"></trkpt>
      <trkpt lat="52.0100" lon="-9.7100"></trkpt>
    </trkseg>
  </trk>
</gpx>`,
        },
      ])
    })

    await expect(page.getByTestId('gpx-import-list')).toContainText('alpha')
    await expect(page.getByTestId('gpx-import-panel')).toContainText('1 imported')

    await page.getByTestId('layer-expand-group-gpx-tracks').click()
    await expect(page.getByTestId('layer-tree')).toContainText('GPX Tracks')
    await expect(page.getByTestId('layer-tree')).toContainText('alpha')

    await page.getByTestId('layer-tree').getByText('alpha', { exact: true }).click()
    await expect(page.getByTestId('layer-inspector')).toContainText('gpx_tracks')

    await expect.poll(async () => {
      return page.evaluate(() => {
        const map = (window as Window & {
          __SARTRACKER_MAP__?: {
            getStyle: () => {
              sources?: Record<string, { data?: { features?: unknown[] } }>
            }
          }
        }).__SARTRACKER_MAP__
        const source = map?.getStyle().sources?.['mission-gpx-imports']
        const features = source?.data?.features
        return Array.isArray(features) ? features.length : 0
      })
    }).toBe(1)

    await page.getByTestId('open-mission-review-workspace').click()
    await expect(page.getByTestId('mission-review-workspace')).toBeVisible()
    await expect(page.getByTestId('mission-review-workspace')).toContainText('GPX Imports')
    await expect(page.getByTestId('mission-review-workspace')).toContainText('GPX Import Created')
    await expect(page.getByTestId('mission-review-workspace')).toContainText('/tracks/alpha.gpx')
  })
})
