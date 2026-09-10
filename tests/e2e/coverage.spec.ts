import { expect, test, type Page } from '@playwright/test'
import { seedCoverageMission } from './helpers/coverage-test-setup'

test.describe('complete mission-history coverage [DON-275]', () => {
  test('AUD-14 uses structured completeness state instead of connection-warning wording', async ({ page }) => {
    await seedCoverageMission(page)
    const panel = page.getByTestId('coverage-status-panel')
    await expect(panel).toContainText('All mission history shown')
    await page.evaluate(async () => {
      const { useCoverageStore, applyCoverageState } = await import('/src/features/tracking/coverage-store.ts')
      const coverage = useCoverageStore.getState().state
      if (coverage.status === 'inactive') throw new Error('Expected loaded coverage')
      applyCoverageState({ ...coverage, status: 'partial', blockers: ['history_reconciliation_incomplete'] })
      const { useTrackingStore } = await import('/src/features/tracking/tracking-store.ts')
      const state = useTrackingStore.getState()
      state.applyStatus({ ...state.status, warning: 'Breadcrumb history incomplete for Alpha; retrying while current fixes remain live.' })
    })
    await expect(panel).toContainText('Saved history has not been reconciled')
    await expect(panel).not.toContainText('All mission history shown')
    await expect(page.getByTestId('tracking-counters')).toContainText('2')
    await page.evaluate(async () => {
      const { useTrackingStore } = await import('/src/features/tracking/tracking-store.ts')
      const state = useTrackingStore.getState()
      state.applyStatus({ ...state.status, warning: null })
    })
    await expect(panel).not.toContainText('All mission history shown')
    await page.evaluate(async () => {
      const { useCoverageStore, applyCoverageState } = await import('/src/features/tracking/coverage-store.ts')
      const coverage = useCoverageStore.getState().state
      if (coverage.status === 'inactive') throw new Error('Expected loaded coverage')
      applyCoverageState({ ...coverage, status: 'complete', blockers: [] })
    })
    await expect(panel).toContainText('All mission history shown')
  })
  test('live Breadcrumbs visibility does not hide Mission History or change its checked participants', async ({ page }) => {
    await seedCoverageMission(page)
    await expect(page.getByTestId('coverage-status-panel')).toContainText('All mission history shown')
    const before = await readCoverageLayerFilters(page)
    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-expand-all-btn').click()
    await page.getByTestId('layer-visibility-layer-tracking-breadcrumbs').uncheck()
    await expect(page.getByTestId('layer-visibility-feature-coverage-device-alpha')).toBeChecked()
    await expect(page.getByTestId('layer-visibility-feature-coverage-device-bravo')).toBeChecked()
    expect(await readCoverageLayerFilters(page)).toEqual(before)
    await page.getByTestId('layer-visibility-group-tracking').uncheck()
    expect(await readCoverageLayerFilters(page)).toEqual(before)
    await page.getByTestId('sidebar-tab-tracking').click()
    await expect(page.getByTestId('coverage-status-panel')).toContainText('All mission history shown')
  })
  test('shows all mission history by default and keeps live positions independent of omissions', async ({ page }) => {
    await seedCoverageMission(page)

    const coverageStatus = page.getByTestId('coverage-status-panel')
    await expect(coverageStatus).toContainText('All mission history shown')
    await expect(coverageStatus).not.toContainText('History incomplete')

    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-expand-all-btn').click()
    await expect(page.getByTestId('layer-row-group-coverage')).toContainText('Mission History')
    await expect(page.getByTestId('layer-row-feature-coverage-device-alpha')).toBeVisible()
    await expect(page.getByTestId('layer-row-feature-coverage-device-discovery-only')).toHaveCount(0)
    await expect(page.getByTestId('layer-row-feature-coverage-period-unassigned-00'))
      .toContainText('Outside outings')

    const trackingFilterBefore = await readMapLayerFilter(page, 'tracking-devices-circle')
    await page.getByTestId('layer-visibility-feature-coverage-device-alpha').click()

    await page.getByTestId('sidebar-tab-tracking').click()
    await expect(coverageStatus).toContainText('All selected history shown')
    await expect(coverageStatus).toContainText('1 device omitted')
    const trackingFilterAfter = await readMapLayerFilter(page, 'tracking-devices-circle')
    expect(trackingFilterAfter).toEqual(trackingFilterBefore)
    expect(JSON.stringify(await readCoverageLayerFilters(page))).toContain('alpha')
    await expect(page.getByTestId('tracking-counters')).toContainText('2')

    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-visibility-feature-coverage-period-unassigned-00').click()
    await page.getByTestId('sidebar-tab-tracking').click()
    await expect(coverageStatus).toContainText('1 device, Outside outings omitted')

    await page.getByTestId('sidebar-tab-layers').click()
    await page.locator(
      '[data-testid^="layer-visibility-feature-coverage-period-outing-00"]',
    ).first().click()
    await page.getByTestId('sidebar-tab-tracking').click()
    await expect(coverageStatus).toContainText(
      '1 device, 1 outing, Outside outings omitted',
    )
  })

  test('reports an honest decrease, retains partial coverage, retries, and resets delivery on reload', async ({ page }) => {
    test.setTimeout(60_000)
    await seedCoverageMission(page)
    const coverageStatus = page.getByTestId('coverage-status-panel')
    await expect(coverageStatus).toContainText('All mission history shown')
    const prior = await readCoverageNumbers(page)
    expect(prior.delivered).toBe(prior.total)

    await page.evaluate(async () => {
      window.sessionStorage.setItem('sartracker:browser-harness:coverage-delay-ms', '4000')
      const [{ getBrowserHarnessStore }, { useCoverageStore }] = await Promise.all([
        import('/src/features/browser-validation/browser-harness-store.ts'),
        import('/src/features/tracking/coverage-store.ts'),
      ])
      const state = window.__SARTRACKER_BROWSER_HARNESS__?.readState()
      const missionId = state?.currentMissionId ?? null
      if (missionId === null) throw new Error('Coverage test mission is unavailable.')
      await getBrowserHarnessStore().addPosition({
        mission_id: missionId,
        source_position_id: 'late-alpha',
        device_id: 'alpha',
        lat: 52.018,
        lon: -9.748,
        timestamp: new Date().toISOString(),
        data_origin: 'live',
      })
      void useCoverageStore.getState().controller?.refresh()
    })

    await expect.poll(async () => (await readCoverageNumbers(page)).total, {
      timeout: 7_000,
    }).toBe(prior.total + 1)
    const decreased = await readCoverageNumbers(page)
    expect(decreased.delivered).toBeLessThan(prior.delivered)

    await page.evaluate(async () => {
      const { useCoverageStore } = await import('/src/features/tracking/coverage-store.ts')
      useCoverageStore.getState().controller?.cancel()
    })
    await expect(coverageStatus).toContainText('History incomplete — showing loaded coverage')
    await expect(page.getByTestId('coverage-progress-text')).toHaveText(
      `${decreased.delivered} of ${decreased.total} fixes`,
    )

    await page.evaluate(() => {
      window.sessionStorage.removeItem('sartracker:browser-harness:coverage-delay-ms')
    })
    await page.getByTestId('coverage-retry').click()
    await expect(coverageStatus).toContainText('All mission history shown')

    await page.evaluate(() => {
      window.sessionStorage.setItem('sartracker:browser-harness:coverage-delay-ms', '4000')
    })
    await page.reload()
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId('mission-control').getByRole('button', { name: 'Resume' }).click()
    await expect(page.getByTestId('coverage-progress-text')).toHaveText(/^0 of \d+ fixes$/u)
    await page.evaluate(() => {
      window.sessionStorage.removeItem('sartracker:browser-harness:coverage-delay-ms')
    })
    await expect(page.getByTestId('coverage-status-panel')).toContainText(
      'All mission history shown',
      { timeout: 20_000 },
    )
  })

  test('reattaches complete mission history after a basemap style change', async ({ page }) => {
    await seedCoverageMission(page)
    await expect(page.getByTestId('coverage-status-panel')).toContainText(
      'All mission history shown',
    )
    await expect.poll(() => countCoverageLayers(page)).toBeGreaterThan(0)

    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId('basemap-btn-openstreetmap').click()
    await expect(page.getByTestId('basemap-menu-toggle')).toContainText('OpenStreetMap')

    await expect.poll(() => countCoverageLayers(page), { timeout: 5_000 }).toBeGreaterThan(0)
    await expect(page.getByTestId('coverage-status-panel')).toContainText(
      'All mission history shown',
    )
  })

  test('leaves the existing browser surface unchanged while the coverage flag is off', async ({ page }) => {
    await page.goto('/?missionHarness=1&missionModel=1')
    await page.getByTestId('app-title').waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByTestId('mission-name-input').fill('Coverage Flag Off')
    await page.getByTestId('mission-start-btn').click()
    await expect(page.getByTestId('mission-control')).toContainText('active')
    await expect(page.getByTestId('coverage-status-panel')).toHaveCount(0)
    await page.getByTestId('sidebar-tab-layers').click()
    await expect(page.getByTestId('layer-row-group-coverage')).toHaveCount(0)
  })
})

async function readMapLayerFilter(page: Page, layerId: string): Promise<unknown> {
  return page.evaluate((id) => window.__SARTRACKER_MAP__?.getFilter(id) ?? null, layerId)
}

async function readCoverageLayerFilters(page: Page): Promise<readonly unknown[]> {
  return page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__
    return map?.getStyle().layers
      .filter((layer) => layer.id.startsWith('coverage-'))
      .map((layer) => map.getFilter(layer.id)) ?? []
  })
}

async function countCoverageLayers(page: Page): Promise<number> {
  return page.evaluate(() => window.__SARTRACKER_MAP__?.getStyle().layers
    .filter((layer) => layer.id.startsWith('coverage-')).length ?? 0)
}

async function readCoverageNumbers(page: Page): Promise<{
  readonly delivered: number
  readonly total: number
}> {
  return page.evaluate(async () => {
    const { useCoverageStore } = await import('/src/features/tracking/coverage-store.ts')
    const state = useCoverageStore.getState().state
    if (state.status === 'inactive') throw new Error('Coverage state is inactive.')
    return { delivered: state.deliveredFixCount, total: state.totalFixCount }
  })
}
