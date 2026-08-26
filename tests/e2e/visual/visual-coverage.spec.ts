import { expect, test, type Page } from '@playwright/test'

import { seedCoverageMission } from '../helpers/coverage-test-setup'
import {
  captureAndRegister,
  captureElementAndRegister,
} from './helpers/verification-manifest'

test.describe('Visual: complete mission-history coverage [DON-275]', () => {
  test('default complete coverage is calm and explicit', async ({ page }) => {
    await seedCoverageMission(page)
    await expect(page.getByTestId('coverage-status-panel')).toContainText(
      'All mission history shown',
    )

    await captureElementAndRegister(page, 'coverage-status-panel', {
      testId: 'coverage-default-complete-view',
      testName: 'Default all-mission history coverage',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this SAR Tracker mission-history status element:
1. It is clearly headed "MISSION HISTORY COVERAGE".
2. It calmly states "All mission history shown" without an incomplete or warning message.
3. It includes an Updated time so the completeness statement is time-bounded.
4. It offers a clear "Inspect exact fixes" action.
5. The compact violet treatment is readable and distinct from red safety alerts.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'coverage panel says All mission history shown',
        'exact-fix inspection action is visible',
      ],
    })
  })

  test('progress decrease and retained partial state remain honest', async ({ page }) => {
    await seedCoverageMission(page)
    const prior = await readCoverageNumbers(page)
    await beginDelayedLateFixRefresh(page)
    await expect.poll(async () => (await readCoverageNumbers(page)).total, {
      timeout: 7_000,
    }).toBe(prior.total + 1)
    const loading = await readCoverageNumbers(page)
    expect(loading.delivered).toBeLessThan(prior.delivered)

    await captureElementAndRegister(page, 'coverage-status-panel', {
      testId: 'coverage-honest-progress-decrease',
      testName: 'Database-backed history delivery progress after a late fix',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this SAR Tracker mission-history loading element:
1. It clearly says complete mission history is loading from saved evidence.
2. A visible progress bar is present.
3. Exact "N of M fixes" numbers are visible and N is lower than M.
4. The display does not claim 100% or "All mission history shown" while delivery is incomplete.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'coverage state has a larger total after a late fix',
        'delivered count decreased below total',
      ],
    })

    await page.evaluate(async () => {
      const { useCoverageStore } = await import('/src/features/tracking/coverage-store.ts')
      useCoverageStore.getState().controller?.cancel()
    })
    await expect(page.getByTestId('coverage-partial')).toContainText(
      'History incomplete — showing loaded coverage',
    )
    await captureElementAndRegister(page, 'coverage-status-panel', {
      testId: 'coverage-partial-retained-banner',
      testName: 'Cancelled coverage retains loaded history with an incomplete banner',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this SAR Tracker partial mission-history state:
1. A prominent, readable line says "History incomplete — showing loaded coverage".
2. The exact partial "N of M fixes" count and progress bar remain visible.
3. A clear Retry action is visible.
4. The panel does not claim all mission history is shown.
5. The wording makes retained coverage explicit rather than showing a blank failure state.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'partial banner is visible after controller cancellation',
        'progress numbers remain visible',
      ],
    })
    await page.evaluate(() => {
      window.sessionStorage.removeItem('sartracker:browser-harness:coverage-delay-ms')
    })
  })

  test('failed final claim never presents a false full progress bar', async ({ page }) => {
    await seedCoverageMission(page)
    await page.evaluate(async () => {
      const { applyCoverageState, useCoverageStore } = await import(
        '/src/features/tracking/coverage-store.ts'
      )
      const current = useCoverageStore.getState().state
      if (current.status === 'inactive') throw new Error('Coverage state is inactive.')
      applyCoverageState({
        ...current,
        status: 'error',
        deliveredFixCount: current.totalFixCount,
        blockers: [],
        lastErrorClass: 'timeout',
      })
    })

    const panel = page.getByTestId('coverage-status-panel')
    await expect(panel).toContainText('History incomplete')
    await expect(panel).toContainText('completeness is not yet verified')
    await expect(panel).toContainText('Reason: timeout')
    await expect(page.getByTestId('coverage-progress')).toHaveCount(0)
    await expect(page.getByTestId('coverage-retry')).toBeVisible()

    await captureElementAndRegister(page, 'coverage-status-panel', {
      testId: 'coverage-claim-unverified-honesty',
      testName: 'Failed final database claim withholds false full progress',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this SAR Tracker mission-history claim-failure state:
1. The panel clearly says history is incomplete.
2. It explicitly says completeness is not yet verified.
3. It gives timeout as the reason and offers a clear Retry action.
4. It does not show a progress bar or claim all mission history is shown.
5. The exact-fix inspection action remains available.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'incomplete and completeness-unverified wording is visible',
        'timeout reason and Retry are visible',
        'no progress bar is rendered at equal delivered and total counts',
      ],
    })
  })

  test('pending anomaly evidence never looks like complete coverage', async ({ page }) => {
    await seedCoverageMission(page)
    await page.evaluate(async () => {
      const { applyCoverageState, useCoverageStore } = await import(
        '/src/features/tracking/coverage-store.ts'
      )
      const current = useCoverageStore.getState().state
      if (current.status === 'inactive') throw new Error('Coverage state is inactive.')
      applyCoverageState({
        ...current,
        status: 'partial',
        blockers: ['renderer_evidence_pending'],
        deliveredFixCount: current.totalFixCount,
      })
    })

    const panel = page.getByTestId('coverage-status-panel')
    await expect(panel).toContainText('Anomaly evidence is waiting to be saved')
    await expect(panel).toContainText('Current positions remain live')
    await expect(page.getByTestId('coverage-progress')).toHaveCount(0)
    await expect(page.getByTestId('coverage-retry')).toHaveCount(0)

    await captureElementAndRegister(page, 'coverage-status-panel', {
      testId: 'coverage-evidence-pending-honesty',
      testName: 'Renderer-held anomaly evidence blocks a complete claim',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this SAR Tracker mission-history evidence-wait state:
1. The panel clearly says anomaly evidence is waiting to be saved.
2. It explicitly says history cannot be called complete yet.
3. It reassures the operator that current positions remain live.
4. It does not show a 100% progress bar or claim all mission history is shown.
5. It does not offer an irrelevant coverage Retry action.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'pending-evidence wording is visible',
        'current positions remain live',
        'no progress bar or Retry action is rendered',
      ],
    })
  })

  test('detached renderer never claims blank coverage is still shown', async ({ page }) => {
    await seedCoverageMission(page)
    await page.evaluate(async () => {
      const { applyCoverageState, useCoverageStore } = await import(
        '/src/features/tracking/coverage-store.ts'
      )
      const current = useCoverageStore.getState().state
      if (current.status === 'inactive') throw new Error('Coverage state is inactive.')
      applyCoverageState({
        ...current,
        status: 'partial',
        blockers: ['renderer_detached'],
      })
    })

    const panel = page.getByTestId('coverage-status-panel')
    await expect(panel).toContainText('Coverage is being reattached to the map')
    await expect(panel).toContainText('Current positions remain live')
    await expect(panel).not.toContainText('showing loaded coverage')
    await expect(page.getByTestId('coverage-progress')).toHaveCount(0)
    await expect(page.getByTestId('coverage-retry')).toHaveCount(0)

    await captureElementAndRegister(page, 'coverage-status-panel', {
      testId: 'coverage-renderer-reattaching-honesty',
      testName: 'Style-detached mission history withholds visible-coverage claims',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this SAR Tracker mission-history renderer-reattachment state:
1. The panel clearly says coverage is being reattached to the map.
2. It explicitly reassures the operator that current positions remain live.
3. It does not claim loaded history remains shown while coverage sources are detached.
4. It does not show a misleading 100% progress bar.
5. It does not offer Retry for the automatic style reattachment state.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'renderer reattachment wording is visible',
        'current positions remain live',
        'no retained-coverage claim, progress bar, or Retry action is rendered',
      ],
    })
  })

  test('pending history filter never looks complete before the map applies it', async ({ page }) => {
    await seedCoverageMission(page)
    await page.evaluate(async () => {
      const { applyCoverageState, useCoverageStore } = await import(
        '/src/features/tracking/coverage-store.ts'
      )
      const current = useCoverageStore.getState().state
      if (current.status === 'inactive') throw new Error('Coverage state is inactive.')
      applyCoverageState({
        ...current,
        status: 'partial',
        blockers: ['renderer_filter_pending'],
      })
    })

    const panel = page.getByTestId('coverage-status-panel')
    await expect(panel).toContainText('Applying the selected history filter to the map')
    await expect(panel).toContainText('Current positions remain live')
    await expect(page.getByTestId('coverage-progress')).toHaveCount(0)
    await expect(page.getByTestId('coverage-retry')).toHaveCount(0)

    await captureElementAndRegister(page, 'coverage-status-panel', {
      testId: 'coverage-filter-application-pending',
      testName: 'Selected history filter waits for map acknowledgement',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this SAR Tracker mission-history filter transition:
1. The panel clearly says the selected history filter is being applied to the map.
2. It explicitly says completion is paused rather than claiming selected history is complete.
3. It reassures the operator that current positions remain live.
4. It does not show a misleading 100% progress bar.
5. It does not offer Retry for this automatic map synchronization state.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'history-filter application wording is visible',
        'current positions remain live',
        'no progress bar or Retry action is rendered',
      ],
    })
  })

  test('selected-scope wording and Outside outings filter are explicit', async ({ page }) => {
    await seedCoverageMission(page)
    await page.getByTestId('mission-control-collapse-btn').click()
    await page.getByTestId('sidebar-tab-layers').click()
    await expandOnlyCoverageTree(page)
    await page.getByTestId('layer-visibility-feature-coverage-device-alpha').click()
    await page.getByTestId('sidebar-tab-tracking').click()
    await expect(page.getByTestId('coverage-status-panel')).toContainText(
      'All selected history shown',
    )

    await captureElementAndRegister(page, 'coverage-status-panel', {
      testId: 'coverage-selected-scope-omission',
      testName: 'Selected-history completion wording with omission summary',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this filtered SAR Tracker mission-history status:
1. It says "All selected history shown", not "All mission history shown".
2. It visibly says one device is omitted.
3. It explicitly says live positions are unchanged.
4. It still offers exact-fix inspection.
5. The filtered state looks deliberate and complete for the selected scope, not like missing evidence.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'selected-scope completion wording is visible',
        'one-device omission summary is visible',
      ],
    })

    await page.getByTestId('sidebar-tab-layers').click()
    await page.getByTestId('layer-visibility-feature-coverage-period-unassigned-00').click()
    await expect(page.getByTestId('layer-row-feature-coverage-period-unassigned-00'))
      .toContainText('Outside outings')
    await page.getByTestId('layer-tree').evaluate((element) => {
      const treeModule = element.parentElement
      const panel = element.closest<HTMLElement>('[data-testid="layer-panel"]')
      const expandedHeight = element.scrollHeight
      element.scrollTop = 0
      element.style.overflow = 'visible'
      element.style.flex = 'none'
      element.style.height = `${expandedHeight}px`
      if (treeModule instanceof HTMLElement) {
        treeModule.style.flex = 'none'
        treeModule.style.height = `${expandedHeight + 42}px`
      }
      if (panel !== null) {
        panel.style.flex = 'none'
        panel.style.height = 'auto'
      }
    })
    await captureElementAndRegister(page, 'layer-branch-group-coverage', {
      testId: 'coverage-outside-outings-filter',
      testName: 'Mission History filter tree with Outside outings',
      area: 'layers',
      severity: 'critical',
      verificationPrompt: `Verify this SAR Tracker Mission History filter tree:
1. The group is clearly labelled "Mission History".
2. Separate Participants and Outings sections are visible.
3. Alpha Team and Bravo Team appear as participant history controls.
4. "Ridge sweep" appears as an outing control.
5. A separate row is honestly labelled "Outside outings" and is not presented as a dated or invented outing.
6. The omitted Alpha and Outside outings checkboxes are visibly unchecked while other history remains selected.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'Mission History group is expanded',
        'Outside outings row is visible and omitted',
      ],
    })
  })

  test('omitting participant history leaves its live marker visible', async ({ page }) => {
    await seedCoverageMission(page)
    await page.evaluate(() => {
      window.__SARTRACKER_MAP__?.jumpTo({ center: [-9.742, 52.012], zoom: 13 })
    })
    await page.getByTestId('sidebar-tab-layers').click()
    await expandOnlyCoverageTree(page)
    await page.getByTestId('layer-visibility-feature-coverage-device-alpha').click()
    const filters = await page.evaluate(() => {
      const map = window.__SARTRACKER_MAP__
      return {
        live: map?.getFilter('tracking-devices-circle') ?? null,
        coverage: map?.getStyle().layers
          .filter((layer) => layer.id.startsWith('coverage-'))
          .map((layer) => map.getFilter(layer.id)) ?? [],
      }
    })
    expect(JSON.stringify(filters.live)).not.toContain('alpha')
    expect(JSON.stringify(filters.coverage)).toContain('alpha')

    await captureAndRegister(page, {
      testId: 'coverage-live-marker-independent',
      testName: 'Live Alpha marker remains while Alpha history is omitted',
      area: 'tracking',
      severity: 'critical',
      verificationPrompt: `Verify this full SAR Tracker operator view after Alpha Team history was omitted:
1. The Mission History layer tree is visible and Alpha Team's history checkbox is unchecked.
2. Bravo Team history remains checked.
3. The live map still visibly shows the current Alpha Team marker/label despite Alpha history being omitted.
4. The screen does not suggest that a history omission hides or stops live tracking.
5. The map and layer workspace remain readable without error overlays or blank coverage failures.
Report PASS or FAIL for each item, then an overall PASS/FAIL.`,
      playwrightAssertions: [
        'coverage-layer filters omit alpha',
        'live tracking-layer filter does not omit alpha',
      ],
    })
  })
})

async function beginDelayedLateFixRefresh(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.sessionStorage.setItem('sartracker:browser-harness:coverage-delay-ms', '4000')
    const [{ getBrowserHarnessStore }, { useCoverageStore }] = await Promise.all([
      import('/src/features/browser-validation/browser-harness-store.ts'),
      import('/src/features/tracking/coverage-store.ts'),
    ])
    const missionId = window.__SARTRACKER_BROWSER_HARNESS__?.readState().currentMissionId ?? null
    if (missionId === null) throw new Error('Coverage visual mission is unavailable.')
    await getBrowserHarnessStore().addPosition({
      mission_id: missionId,
      source_position_id: 'late-alpha-visual',
      device_id: 'alpha',
      lat: 52.018,
      lon: -9.748,
      timestamp: new Date().toISOString(),
      data_origin: 'live',
    })
    void useCoverageStore.getState().controller?.refresh()
  })
}

async function expandOnlyCoverageTree(page: Page): Promise<void> {
  await page.getByTestId('layer-collapse-all-btn').click()
  await page.getByTestId('layer-expand-group-coverage').click()
  await page.getByTestId('layer-expand-layer-coverage-devices').click()
  await page.getByTestId('layer-expand-layer-coverage-periods').click()
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
