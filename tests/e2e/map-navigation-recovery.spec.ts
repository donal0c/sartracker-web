import { expect, test, type Page } from '@playwright/test'
import { mapTargetMarker } from './helpers/map-target'

test('new Go To wins over a delayed production basemap camera restore [AUD-06]', async ({ page }, testInfo) => {
  await page.route('https://**/*', (route) => route.abort())
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toBeVisible()
  await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined)
  await page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__!
    const { applyMapStylePreservingCamera } = await import('/src/features/map/apply-map-style-preserving-camera.ts')
    const originalOn = map.on
    // Hold the real helper's completion callback to deterministically put a
    // newer operator navigation ahead of the delayed restoration.
    map.on = ((event: string, listener: () => void) => {
      if (event === 'style.load') {
        ;(window as Window & { __TRAIN_C_RESTORE__?: () => void }).__TRAIN_C_RESTORE__ = listener
        return map
      }
      return originalOn.call(map, event, listener)
    }) as typeof map.on
    try {
      applyMapStylePreservingCamera(map, { version: 8, sources: {}, layers: [
        { id: 'synthetic-camera-test', type: 'background', paint: { 'background-color': '#dde6e8' } },
      ] })
    } finally {
      map.on = originalOn
    }
  })
  await navigateTo(page, '52.004677', '-9.748060')
  await page.getByTestId('coordinate-converter-dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await assertRenderedTarget(page, [-9.748060, 52.004677])
  await page.evaluate(() => {
    const restore = (window as Window & { __TRAIN_C_RESTORE__?: () => void }).__TRAIN_C_RESTORE__
    if (restore === undefined) throw new Error('Production camera restore was not captured')
    // Countercontrol a camera reset between request acceptance and style completion.
    // This is not an operator gesture: the latest navigation must remain authoritative.
    window.__SARTRACKER_MAP__!.jumpTo({ center: [-9.2, 52.2], zoom: 12 })
    restore()
  })
  await assertRenderedTarget(page, [-9.748060, 52.004677])
  await page.screenshot({ path: testInfo.outputPath('navigation-wins-camera-restore.png') })
})

test('basemap replacement during animated Go To settles at the destination [AUD-06]', async ({ page }, testInfo) => {
  await page.route('https://**/*', (route) => route.abort())
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toBeVisible()
  await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined)
  await page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__!
    const flyTo = map.flyTo
    map.flyTo = ((options, eventData) => flyTo.call(map, { ...options, duration: 4_000 }, eventData)) as typeof map.flyTo
  })
  await navigateTo(page, '52.179337', '-9.464944')
  await page.getByTestId('coordinate-converter-dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__SARTRACKER_MAP__!.isMoving())).toBe(true)
  await page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__!
    const { applyMapStylePreservingCamera } = await import('/src/features/map/apply-map-style-preserving-camera.ts')
    applyMapStylePreservingCamera(map, { version: 8, sources: {}, layers: [
      { id: 'reverse-order-background', type: 'background', paint: { 'background-color': '#e7e4d8' } },
    ] })
  })
  await assertRenderedTarget(page, [-9.464944, 52.179337])
  await page.screenshot({ path: testInfo.outputPath('navigation-switch-during-flight.png') })
})

test('a never-loaded target expires and cannot reappear when the map recovers [AUD-06]', async ({ page }) => {
  // DIAGNOSTIC (temporary): record map identity, style and context events.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    const log: string[] = []
    w.__AUD06_LOG__ = log
    let current: { on: (e: string, f: () => void) => void, getStyle: () => { layers?: unknown[] } | undefined } | undefined
    let n = 0
    const layers = (m: typeof current) => { try { return String(m?.getStyle()?.layers?.length ?? 'none') } catch { return 'throw' } }
    Object.defineProperty(window, '__SARTRACKER_MAP__', {
      configurable: true,
      get: () => current,
      set: (v) => {
        current = v
        n += 1
        const id = n
        log.push(`${Math.round(performance.now())} map#${id} ${v === undefined ? 'unset' : 'set'}`)
        if (v === undefined) return
        for (const e of ['style.load', 'styledataloading', 'styledata', 'webglcontextlost', 'webglcontextrestored', 'remove', 'error']) {
          v.on(e, () => log.push(`${Math.round(performance.now())} map#${id} ${e} layers=${layers(v)}`))
        }
      },
    })
  })
  await page.clock.install()
  await page.route('https://**/*', (route) => route.abort())
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toBeVisible()
  await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined)
  const mark = (label: string) => page.evaluate((text) => {
    const w = window as unknown as Record<string, string[]>
    let count = 'none'
    try { count = String(window.__SARTRACKER_MAP__?.getStyle()?.layers?.length ?? 'none') } catch { count = 'throw' }
    w.__AUD06_LOG__.push(`${Math.round(performance.now())} MARK ${text} layers=${count}`)
  }, label)
  await mark('before setStyle(null)')
  await page.evaluate(() => window.__SARTRACKER_MAP__!.setStyle(null))
  await mark('after setStyle(null)')
  await navigateTo(page, '52.179337', '-9.464944')
  await mark('after navigateTo')
  const diagnostic = await page.evaluate(() => (window as unknown as Record<string, string[]>).__AUD06_LOG__.join('\n'))
  console.log(`AUD-06 diagnostic (attached=${String((await pendingTarget(page))?.attached)}):\n${diagnostic}`)
  // The style is gone, so the target is queued but cannot attach yet.
  expect(await pendingTarget(page), `AUD-06 diagnostic log:\n${diagnostic}`).toEqual({ latitude: 52.179337, longitude: -9.464944, attached: false })
  // Let its 30 s request lifetime run out.
  await page.clock.fastForward(30_001)
  await expect.poll(() => pendingTarget(page)).toBeNull()
  await page.evaluate(() => window.__SARTRACKER_MAP__!.setStyle({ version: 8, sources: {}, layers: [
    { id: 'recovered-background', type: 'background', paint: { 'background-color': '#dde6e8' } },
  ] }))
  await expect.poll(() => page.evaluate(() => window.__SARTRACKER_MAP__!.isStyleLoaded())).toBe(true)
  expect(await page.evaluate(() => window.__SARTRACKER_MAP__!.getLayer('coordinate-target-dot') === undefined)).toBe(true)
})

test('basemap application failure stays visible until the operator chooses another map', async ({ page }, testInfo) => {
  await page.route('https://**/*', (route) => route.abort())
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toBeVisible()
  await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined)
  await page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__!
    const setStyle = map.setStyle
    map.setStyle = (() => {
      map.setStyle = setStyle
      throw new Error('Synthetic style application failure')
    }) as typeof map.setStyle
  })
  await page.getByTestId('basemap-menu-toggle').click()
  await page.getByTestId('basemap-btn-esri_topo').click()
  await expect(page.getByTestId('map-health-degraded')).toContainText('Choose another basemap')
  await page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__!
    // Requests from the previous style may finish after setStyle has failed.
    // Exercise that ordering directly instead of depending on network timing.
    for (let index = 0; index < 5; index += 1) {
      map.fire('error', { tile: {}, error: new Error('Late tile request failed') })
    }
    map.fire('idle')
  })
  await expect(page.getByTestId('map-health-degraded')).toContainText('Choose another basemap')
  await page.screenshot({ path: testInfo.outputPath('basemap-failure-survives-late-tiles.png') })
  await page.getByTestId('basemap-menu-toggle').click()
  await page.getByTestId('basemap-btn-esri_topo').click()
  await expect.poll(() => page.evaluate(() =>
    Object.keys(window.__SARTRACKER_MAP__!.getStyle().sources).some((id) => id.includes('esri_topo')),
  )).toBe(true)
  await expect(page.getByTestId('map-health-degraded').filter({ hasText: 'Choose another basemap' })).toBeHidden()
  await page.evaluate(() => {
    for (let index = 0; index < 5; index += 1) {
      window.__SARTRACKER_MAP__!.fire('error', { tile: {}, error: new Error('New style tile request failed') })
    }
  })
  await expect(page.getByTestId('map-health-degraded')).toContainText('Some tiles failed to load')
})

test('latest repeated Go To survives delayed style loading and renders at the requested coordinate [AUD-06]', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await page.route('https://**/*', (route) => route.abort())
  await page.goto('/?missionHarness=1')
  await expect(page.getByTestId('app-title')).toBeVisible()
  await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined)
  await page.evaluate(() => window.__SARTRACKER_MAP__!.setStyle({
    version: 8, sources: {}, layers: [{ id: 'synthetic-background', type: 'background', paint: { 'background-color': '#dde6e8' } }],
  }))
  await expect.poll(() => page.evaluate(() => window.__SARTRACKER_MAP__!.isStyleLoaded())).toBe(true)
  let releaseStyle: (() => void) | undefined
  const styleGate = new Promise<void>((resolve) => { releaseStyle = resolve })
  let requested = false
  await page.route('**/train-c-delayed-style.json', async (route) => {
    requested = true
    await styleGate
    await route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'synthetic-replacement', type: 'background', paint: { 'background-color': '#dde6e8' } }] } })
  })
  await page.evaluate(() => {
    // URL fetch alone retains the previous usable style. Remove it to exercise
    // navigation with genuinely unavailable style structure.
    window.__SARTRACKER_MAP__!.setStyle(null)
    window.__SARTRACKER_MAP__!.setStyle('/train-c-delayed-style.json')
  })
  await expect.poll(() => requested).toBe(true)
  await expect.poll(() => page.evaluate(() => ({
    loaded: window.__SARTRACKER_MAP__!.isStyleLoaded(),
    layers: window.__SARTRACKER_MAP__!.getStyle()?.layers?.length ?? 0,
  }))).toEqual({ loaded: false, layers: 0 })
  await navigateTo(page, '52.179337', '-9.464944')
  await navigateTo(page, '52.004677', '-9.748060')
  // The previous timer expired while no style existed. A loading request must survive it.
  await page.waitForTimeout(8_200)
  releaseStyle!()
  await page.getByTestId('coordinate-converter-dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await assertRenderedTarget(page, [-9.748060, 52.004677])
  await page.screenshot({ path: testInfo.outputPath('navigation-loaded.png') })

  // The attached target expires after 8 s and the map takes its marker down.
  await expect.poll(() => mapTargetMarker(page), { timeout: 12_000 }).toBeNull()
  await navigateTo(page, '52.179337', '-9.464944')
  await page.getByTestId('coordinate-converter-dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await assertRenderedTarget(page, [-9.464944, 52.179337])
  await page.screenshot({ path: testInfo.outputPath('navigation-repeated.png') })
})

/** Reads the map's current go-to request from the running app's target store, or null when none. */
async function pendingTarget(page: Page): Promise<{ latitude: number; longitude: number; attached: boolean } | null> {
  return page.evaluate(async () => {
    const { useMapTargetStore } = await import('/src/features/map/map-target-store.ts')
    const target = useMapTargetStore.getState().activeTarget
    return target === null ? null : { latitude: target.latitude, longitude: target.longitude, attached: target.attached }
  })
}

/** Submits a real coordinate-converter navigation action. */
async function navigateTo(page: Page, latitude: string, longitude: string): Promise<void> {
  if (!(await page.getByTestId('coordinate-converter-dialog').isVisible())) {
    await page.getByTestId('open-coordinate-converter').click()
  }
  await page.getByTestId('coordinate-mode-dd').click()
  await page.getByTestId('coordinate-input-latitude').fill(latitude)
  await page.getByTestId('coordinate-input-longitude').fill(longitude)
  await page.getByTestId('coordinate-convert-btn').click()
  await page.getByTestId('coordinate-go-to-btn').click()
}

/** Verifies the rendered dot's geometry and screen position, beyond camera intention. */
async function assertRenderedTarget(page: Page, coordinate: [number, number]): Promise<void> {
  await expect.poll(() => page.evaluate(([longitude, latitude]) => {
    const map = window.__SARTRACKER_MAP__!
    if (!map.getLayer('coordinate-target-dot')) return { rendered: false, reason: 'layer missing' }
    const target = map.queryRenderedFeatures({ layers: ['coordinate-target-dot'] })
      .find((feature) => feature.geometry.type === 'Point' &&
        Math.abs(feature.geometry.coordinates[0]! - longitude!) < 0.00001 &&
        Math.abs(feature.geometry.coordinates[1]! - latitude!) < 0.00001)
    const projected = map.project([longitude!, latitude!])
    const canvas = map.getCanvas()
    return {
      rendered: target !== undefined,
      centered: Math.abs(projected.x - canvas.clientWidth / 2) < 3 && Math.abs(projected.y - canvas.clientHeight / 2) < 3,
      moving: map.isMoving(),
      coordinates: target?.geometry,
      center: map.getCenter(),
    }
  }, coordinate), { timeout: 6_000 }).toMatchObject({ rendered: true, centered: true, moving: false })
}
