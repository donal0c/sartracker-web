import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { captureAndRegister } from './visual/helpers/verification-manifest'

test.describe('M22 GPX import parity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?missionHarness=1&missionModel=1')
    const title = page.getByTestId('app-title')
    await title.waitFor({ state: 'visible', timeout: 10000 })
    await expect(title).toContainText('SAR Tracker')
    await page.waitForSelector('canvas', { timeout: 15000 })
    await page.getByTestId('mission-name-input').fill('GPX Mission')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await page.getByTestId('sidebar-tab-tools').click()
    await expect(page.getByTestId('gpx-import-panel')).toBeVisible()
  })

  test('renders imported GPX tracks in the panel, layer catalog, review workspace, and map source', async ({
    page,
  }) => {
    await page.getByTestId('outing-label-input').fill('Team Alpha outing')
    await page.getByTestId('outing-start-btn').click()
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
    await expect(page.getByTestId('gpx-import-panel')).toContainText('1 shown')
    const importId = await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__
      ?.readState().gpxImports.find((entry) => entry.display_name === 'alpha')?.id ?? null)
    expect(importId).not.toBeNull()
    await expect(page.getByTestId('gpx-outing-assigned-by')).toHaveAttribute('maxlength', '120')
    await page.getByTestId('gpx-outing-assigned-by').fill('Coordinator One')
    await page.getByTestId(`gpx-import-outing-${importId}`).selectOption({ label: 'Team Alpha outing' })
    await expect(page.getByTestId('gpx-import-status')).toContainText('new evidence revision')
    await expect.poll(async () => page.evaluate(() => {
      const state = window.__SARTRACKER_BROWSER_HARNESS__?.readState()
      const imported = state?.gpxImports.find((entry) => entry.display_name === 'alpha')
      const outing = state?.outings.find((entry) => entry.label === 'Team Alpha outing')
      return { matches: imported?.outing_id === outing?.id, revision: imported?.revision_sequence }
    })).toEqual({ matches: true, revision: 2 })

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

  test('keeps exact GPX geometry and settles import when the outing ends [AUD-01 AUD-05 AUD-10]', async ({ page }) => {
    const source = readFileSync('tests/fixtures/gpx-extension-fidelity.gpx', 'utf8')
      .replace('>Ridge party<', '><![CDATA[Ridge party]]><')
    await page.getByTestId('outing-label-input').fill('Import race outing')
    await page.getByTestId('outing-start-btn').click()
    await expect(page.getByTestId('active-outing-label')).toBeVisible()
    await page.evaluate((contents) => {
      const original = crypto.subtle.digest.bind(crypto.subtle)
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => { release = resolve })
      crypto.subtle.digest = async (...args) => { await gate; return await original(...args) }
      const pending = window.__SARTRACKER_BROWSER_HARNESS__!.importGpxFiles([
        { sourcePath: '/tracks/fidelity.gpx', fileName: 'fidelity.gpx', contents },
      ])
      Object.assign(window, { releaseGpxDigest: () => { crypto.subtle.digest = original; release?.() }, pendingGpxImport: pending })
    }, source)
    await expect(page.getByTestId('gpx-import-files')).toContainText('Importing')
    await page.getByTestId('outing-end-btn').click()
    await expect(page.getByTestId('outing-no-active-notice')).toBeVisible()
    await page.evaluate(async () => {
      const gate = window as unknown as { releaseGpxDigest(): void; pendingGpxImport: Promise<unknown> }
      gate.releaseGpxDigest()
      await gate.pendingGpxImport
    })
    await expect(page.getByTestId('gpx-import-files')).not.toContainText('Importing')
    await expect(page.getByTestId('gpx-import-panel')).toContainText('1 shown')
    const geometry = await page.evaluate(() => window.__SARTRACKER_BROWSER_HARNESS__!.readState().gpxImports[0].geometry_json)
    expect(JSON.parse(geometry)).toEqual({ type: 'MultiLineString', coordinates: [[[-9.7, 52], [-9.701, 52.001]]] })
    await page.getByTestId('mission-control-collapse-btn').click()
    await page.getByTestId('gpx-import-panel').scrollIntoViewIfNeeded()
    await captureAndRegister(page, {
      testId: 'repair-train-b-gpx-settlement', testName: 'GPX import settles after End Outing', area: 'layers', severity: 'critical',
      verificationPrompt: 'Verify the visible GPX panel: 1. Its count says 1 shown. 2. The import control says Import Files, not Importing. 3. The imported track fidelity is visible. 4. There is no import error banner. Browser-only controls may correctly be disabled.',
      playwrightAssertions: ['Outing ended during held import', 'Import settled', 'One import shown', 'Geometry contains exactly two canonical source points'],
    })
  })

  test('shows retained interrupted-import provenance after runtime recovery [DON-274]', async ({ page }) => {
    await page.evaluate(() => {
      window.__SARTRACKER_BROWSER_HARNESS__?.injectGpxImportIssues([{
        batch_id: 'interrupted-batch',
        file_name: 'team-alpha.gpx',
        reason: 'Import was interrupted after source bytes were retained.',
        rejection_count: 3,
        recorded_at: '2026-08-27T10:00:00.000Z',
        projection_warnings: ['file_name_truncated'],
      }])
    })

    await expect(page.getByTestId('gpx-import-error')).toContainText(
      '1 persisted GPX import issue',
    )
    await expect(page.getByTestId('gpx-import-issues')).toContainText('team-alpha.gpx')
    await expect(page.getByTestId('gpx-import-issues')).toContainText(
      'interrupted after source bytes were retained',
    )
    await expect(page.getByTestId('gpx-import-issues')).toContainText(
      '3 rejected point/segment records retained with the exact source',
    )
    await expect(page.getByTestId('gpx-import-issues')).toContainText(
      'Some retained issue fields were shortened for safe display',
    )
  })

  test('pages imported GPX projections without accumulating renderer evidence [DON-274]', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const harness = window.__SARTRACKER_BROWSER_HARNESS__
      if (harness === undefined) throw new Error('Browser harness API unavailable.')
      await harness.importGpxFiles(Array.from({ length: 26 }, (_, index) => {
        const suffix = String(index).padStart(2, '0')
        return {
          sourcePath: `/tracks/paged-${suffix}.gpx`,
          fileName: `paged-${suffix}.gpx`,
          contents: `<gpx version="1.1"><trk><trkseg><trkpt lat="52.${suffix}" lon="-9.70" /><trkpt lat="52.${suffix}" lon="-9.71" /></trkseg></trk></gpx>`,
        }
      }))
    })

    await expect(page.getByTestId('gpx-import-pagination')).toContainText(
      'More imported evidence is available',
    )
    await expect(page.getByTestId('gpx-import-list')).toContainText('paged-00')
    await expect(page.getByTestId('gpx-import-list')).not.toContainText('paged-25')

    await page.getByTestId('gpx-import-next-page').click()

    await expect(page.getByTestId('gpx-import-pagination')).toContainText('This is the final page')
    await expect(page.getByTestId('gpx-import-list')).toContainText('paged-25')
    await expect(page.getByTestId('gpx-import-list')).not.toContainText('paged-00')

    await page.getByTestId('gpx-import-first-page').click()
    await expect(page.getByTestId('gpx-import-list')).toContainText('paged-00')
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
