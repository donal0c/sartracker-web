import { expect, test } from '@playwright/test'

import { navigateToHarness, startMission } from './helpers/test-setup'
import { captureElementAndRegister } from './helpers/verification-manifest'

test.describe('Visual: GPX and layer readability', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await navigateToHarness(page)
    await startMission(page, 'GPX Layer Visual')
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
<gpx version="1.1" creator="visual">
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
<gpx version="1.1" creator="visual">
  <trk><trkseg>
    <trkpt lat="52.0200" lon="-9.7200"></trkpt>
    <trkpt lat="52.0300" lon="-9.7300"></trkpt>
  </trkseg></trk>
</gpx>`,
        },
      ])
    })
    await page.getByTestId('mission-control-collapse-btn').click()
    await expect(page.getByTestId('mission-control')).not.toBeVisible()
  })

  test('GPX colour controls and layer tree remain readable at smaller desktop size', async ({
    page,
  }) => {
    await page.getByTestId('sidebar-tab-tools').click()
    const alphaImportId = await page.evaluate(() => {
      const state = window.__SARTRACKER_BROWSER_HARNESS__?.readState()
      return state?.gpxImports.find((entry) => entry.display_name === 'alpha')?.id ?? null
    })
    expect(alphaImportId).not.toBeNull()
    const alphaColour = page.getByTestId(`gpx-import-color-${alphaImportId}`)
    await expect(alphaColour).toBeVisible()
    await alphaColour.getByTestId(`gpx-import-color-${alphaImportId}-hex`).fill('#F032E6')
    await alphaColour.getByTestId(`gpx-import-color-${alphaImportId}-hex`).blur()
    await expect(page.getByTestId('gpx-import-list')).toContainText('alpha')
    await expect(page.getByTestId('gpx-import-list')).toContainText('bravo')
    await page.getByTestId('gpx-import-list').scrollIntoViewIfNeeded()

    await captureElementAndRegister(page, 'gpx-import-list', {
      testId: 'gpx-colour-controls-small-display',
      testName: 'GPX colour controls at smaller desktop size',
      area: 'layers',
      severity: 'high',
      verificationPrompt: `Verify this screenshot of the SAR Tracker imported GPX track list at a smaller 1280x720 desktop size:
1. There should be two imported tracks visible, "alpha" and "bravo".
2. At least one imported track row should show a "Track colour" control with multiple colour swatches.
3. The colour control should include a hex input field and a visible colour preview square.
4. The source path / secondary text should be readable against the dark background.
5. The controls should not overlap, clip, or overflow horizontally.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'gpx-import-panel visible',
        'alpha and bravo imported tracks visible',
        'per-import colour control visible',
      ],
    })

    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-expand-group-gpx-tracks').click()
    await expect(page.getByTestId('layer-panel')).toContainText('GPX Tracks')
    await expect(page.locator('[data-testid^="layer-row-layer-gpx-"]').first()).toBeVisible()
    await page.getByTestId('layer-tree').scrollIntoViewIfNeeded()
    await page.getByTestId('layer-row-group-gpx-tracks').scrollIntoViewIfNeeded()

    await captureElementAndRegister(page, 'layer-branch-group-gpx-tracks', {
      testId: 'layer-tree-readable-small-display',
      testName: 'Expanded Layer Tree readability at smaller desktop size',
      area: 'layers',
      severity: 'high',
      verificationPrompt: `Verify this screenshot of the SAR Tracker Layer Tree scroll region at a smaller 1280x720 desktop size:
1. The tree should be expanded enough to show the "GPX Tracks" group.
2. The imported GPX track rows, including "alpha" and "bravo", should be readable.
3. Visibility checkboxes should be noticeably larger than tiny default checkboxes and should look easy to click.
4. Layer labels should use a readable font size and should not look cramped.
5. The tree should not show horizontal overflow, clipped labels, or overlapping controls.
6. Muted/detail text in the tree should remain readable against the dark background.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'layer-panel visible',
        'GPX Tracks group visible',
        'at least one imported GPX layer row visible',
      ],
    })
  })
})
