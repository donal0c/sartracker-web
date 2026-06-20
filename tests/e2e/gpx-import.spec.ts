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
    await page.getByTestId('sidebar-tab-tools').click()
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

    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-expand-group-gpx-tracks').click()
    await expect(page.getByTestId('layer-tree')).toContainText('GPX Tracks')
    await expect(page.getByTestId('layer-tree')).toContainText('alpha')

    await page.getByTestId('layer-tree').getByText('alpha', { exact: true }).click()
    await expect(page.getByTestId('layer-inspector')).toContainText('gpx_tracks')

    await expect.poll(async () => {
      return page.evaluate(() => {
        const map = (window as Window & {
          __SARTRACKER_MAP__?: {
            querySourceFeatures: (sourceId: string) => unknown[]
          }
        }).__SARTRACKER_MAP__
        return map?.querySourceFeatures('mission-gpx-imports').length ?? 0
      })
    }, { timeout: 10000 }).toBeGreaterThan(0)

    await page.getByTestId('open-mission-review-workspace').click()
    await expect(page.getByTestId('mission-review-workspace')).toBeVisible()
    await expect(page.getByTestId('mission-review-workspace')).toContainText('GPX Imports')
    await expect(page.getByTestId('mission-review-workspace')).toContainText('GPX Import Created')
    await expect(page.getByTestId('mission-review-workspace')).toContainText('/tracks/alpha.gpx')
  })

  test('DON-194: changes individual GPX colours and keeps the layer tree readable on smaller displays', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
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
  <trk><trkseg>
    <trkpt lat="52.0000" lon="-9.7000"></trkpt>
    <trkpt lat="52.0100" lon="-9.7100"></trkpt>
  </trkseg></trk>
</gpx>`,
        },
        {
          sourcePath: '/tracks/bravo.gpx',
          fileName: 'bravo.gpx',
          contents: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="playwright">
  <trk><trkseg>
    <trkpt lat="52.0200" lon="-9.7200"></trkpt>
    <trkpt lat="52.0300" lon="-9.7300"></trkpt>
  </trkseg></trk>
</gpx>`,
        },
      ])
    })

    const alphaImportId = await page.evaluate(() => {
      const state = window.__SARTRACKER_BROWSER_HARNESS__?.readState()
      return state?.gpxImports.find((entry) => entry.display_name === 'alpha')?.id ?? null
    })
    expect(alphaImportId).not.toBeNull()

    const alphaColour = page.getByTestId(`gpx-import-color-${alphaImportId}`)
    await expect(alphaColour).toBeVisible()
    await alphaColour.getByTestId(`gpx-import-color-${alphaImportId}-hex`).fill('#F032E6')
    await alphaColour.getByTestId(`gpx-import-color-${alphaImportId}-hex`).blur()

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const map = (window as Window & {
            __SARTRACKER_MAP__?: {
              querySourceFeatures: (sourceId: string) => Array<{ properties?: Record<string, unknown> }>
            }
          }).__SARTRACKER_MAP__
          const feature = map
            ?.querySourceFeatures('mission-gpx-imports')
            .find((candidate) => candidate.properties?.displayName === 'alpha')
          return feature?.properties?.color ?? null
        }),
      )
      .toBe('#F032E6')

    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-expand-group-gpx-tracks').click()

    const alphaRow = page
      .locator('[data-testid^="layer-row-layer-gpx-"]')
      .filter({ hasText: 'alpha' })
    const alphaCheckbox = alphaRow.locator('input[type="checkbox"]')
    const checkboxBox = await alphaCheckbox.boundingBox()
    expect(checkboxBox?.width).toBeGreaterThanOrEqual(20)
    expect(checkboxBox?.height).toBeGreaterThanOrEqual(20)

    const alphaLabel = alphaRow.locator('button').filter({ hasText: 'alpha' })
    const labelFontSize = await alphaLabel.evaluate((element) =>
      Number.parseFloat(window.getComputedStyle(element).fontSize),
    )
    expect(labelFontSize).toBeGreaterThanOrEqual(14)
    const layerPanelOverflow = await page.getByTestId('layer-panel').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(layerPanelOverflow.scrollWidth).toBeLessThanOrEqual(layerPanelOverflow.clientWidth + 1)
  })
})
