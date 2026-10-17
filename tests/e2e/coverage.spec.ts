import { expect, test, type Page } from '@playwright/test'
import { seedCoverageMission } from './helpers/coverage-test-setup'

test.describe('complete mission-history coverage [DON-275]', () => {
  test('keeps renderer failure visible during live changes and recovers promptly [DON-325]', async ({ page }, testInfo) => {
    await page.clock.install()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await seedCoverageMission(page)
    const panel = page.getByTestId('coverage-status-panel')
    await expect(panel).toContainText('All mission history shown')
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
    await page.evaluate(async () => {
      const [{ getBrowserHarnessStore }, { useCoverageStore }] = await Promise.all([
        import('/src/features/browser-validation/browser-harness-store.ts'),
        import('/src/features/tracking/coverage-store.ts'),
      ])
      const { controller, state } = useCoverageStore.getState()
      if (controller === null || state.status !== 'complete' || state.tileCatalog === null) {
        throw new Error('Expected displayed and attested coverage.')
      }
      const period = state.tileCatalog.periods[0]
      if (period === undefined) throw new Error('Expected a coverage period.')
      controller.notifyRendererFailure({
        missionId: state.missionId, periodKey: period.periodKey,
        revisionDigest: period.revisionDigest,
        ...(state.tileCatalog.activationId === undefined ? {} : { activationId: state.tileCatalog.activationId }),
        message: 'Coverage tile could not be decoded.',
      })
      const store = getBrowserHarnessStore()
      await store.addPositionsBulk({ mission_id: state.missionId, positions: [{
        source_position_id: 'don325-recovery-live-fix', device_id: 'alpha',
        lat: 52.012, lon: -9.741, timestamp: new Date().toISOString(), timestamp_source: 'fix',
      }] })
      const manifest = await store.readCoverageManifest(state.missionId)
      await controller.notifyChanged(state.missionId, manifest.changeSeq)
    })
    await expect(page.getByTestId('coverage-error')).toBeVisible()
    await expect(page.getByTestId('coverage-partial')).toHaveCount(0)
    await expect(panel).not.toContainText('All mission history shown')
    await panel.screenshot({ path: testInfo.outputPath('coverage-error-during-live-change.png') })
    await page.clock.runFor(249)
    await expect(page.getByTestId('coverage-error')).toBeVisible()
    await page.clock.runFor(1001)
    await expect(panel).toContainText('All mission history shown')
    await expect(page.getByTestId('coverage-error')).toHaveCount(0)
    await panel.screenshot({ path: testInfo.outputPath('coverage-prompt-renderer-recovery.png') })
  })

  test('coalesces new saved fixes and verifies Complete after ingest goes quiet [DON-325]', async ({ page }, testInfo) => {
    await page.clock.install()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await seedCoverageMission(page)
    const panel = page.getByTestId('coverage-status-panel')
    await expect(panel).toContainText('All mission history shown')
    await page.evaluate(async () => {
      const [{ getBrowserHarnessStore }, { useCoverageStore }] = await Promise.all([
        import('/src/features/browser-validation/browser-harness-store.ts'),
        import('/src/features/tracking/coverage-store.ts'),
      ])
      const store = getBrowserHarnessStore()
      const { controller, state } = useCoverageStore.getState()
      if (controller === null || state.status !== 'complete') throw new Error('Expected attested initial coverage.')
      const original = store.readCoverageManifest
      sessionStorage.setItem('don325-manifest-reads', '0')
      Object.defineProperty(store, 'readCoverageManifest', { configurable: true, value: async (missionId: string) => {
        sessionStorage.setItem('don325-manifest-reads', String(Number(sessionStorage.getItem('don325-manifest-reads')) + 1))
        return original(missionId)
      } })
      for (let index = 1; index <= 20; index += 1) {
        await store.addPositionsBulk({ mission_id: state.missionId, positions: [{
          source_position_id: `don325-new-${index}`, device_id: 'alpha',
          lat: 52.011 + index * 0.0001, lon: -9.741,
          timestamp: new Date(Date.now() + index * 1000).toISOString(), timestamp_source: 'fix',
        }] })
        await controller.notifyChanged(state.missionId, state.changeSeq + index)
      }
    })
    await expect(page.getByTestId('coverage-partial')).toBeVisible()
    await expect(panel).not.toContainText('All mission history shown')
    expect(await page.evaluate(() => sessionStorage.getItem('don325-manifest-reads'))).toBe('0')
    await panel.screenshot({ path: testInfo.outputPath('coverage-background-partial.png') })

    await page.clock.fastForward(30_001)

    await expect(panel).toContainText('All mission history shown')
    expect(await page.evaluate(() => sessionStorage.getItem('don325-manifest-reads'))).toBe('2')
    await panel.screenshot({ path: testInfo.outputPath('coverage-background-complete.png') })
  })

  test('a moving coverage revision stays partial and recovers with Retry [DON-254]', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await seedCoverageMission(page)
    const panel = page.getByTestId('coverage-status-panel')
    await expect(panel).toContainText('All mission history shown')
    await page.evaluate(async () => {
      const [{ getBrowserHarnessStore }, { useCoverageStore }] = await Promise.all([
        import('/src/features/browser-validation/browser-harness-store.ts'),
        import('/src/features/tracking/coverage-store.ts'),
      ])
      const store = getBrowserHarnessStore()
      const original = store.readCoverageManifest
      Object.defineProperty(store, 'readCoverageManifest', { configurable: true, value: async () => {
        Object.defineProperty(store, 'readCoverageManifest', { configurable: true, value: original })
        throw new Error('coverage-revision-moved: Coverage inventory changed while loading history.')
      } })
      await useCoverageStore.getState().controller?.refresh()
    })
    await expect(page.getByTestId('coverage-partial')).toBeVisible()
    await expect(page.getByTestId('coverage-error')).toHaveCount(0)
    await expect(panel).not.toContainText('All mission history shown')
    await panel.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await panel.screenshot({ path: 'tmp/native-runtime-repair/claude-coverage-partial.png' })
    await page.getByTestId('coverage-retry').click()
    await expect(panel).toContainText('All mission history shown')
    await panel.evaluate(element => element.scrollIntoView({ block: 'center' }))
    await panel.screenshot({ path: 'tmp/native-runtime-repair/claude-coverage-recovered.png' })
  })

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
