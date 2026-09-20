#!/usr/bin/env node
import { _electron as electron } from 'playwright'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { validateCoordinateSurface } from './coordinate-surface-receipts.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Exercise real packaged controls, public persistence and rendered source without browser-harness injection. */
export async function runCoordinateSurface({ appPath, evidencePath, developmentTestHarness = false }) {
  if (![appPath, evidencePath].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('Coordinate probe requires absolute paths.')
  await mkdir(evidencePath, { recursive: true, mode: 0o700 })
  const profilePath = path.join(evidencePath, 'coordinate-profile')
  await mkdir(profilePath, { mode: 0o700 })
  const report = { schema: 'sartracker-coordinate-surface-v1', contractId: 'C13', facts: null, runtime: null,
    cleanup: { applicationClosed: false, profileRemoved: false }, failure: null, qualificationExecuted: false }
  let app
  let page
  let failure
  try {
    const args = process.platform === 'linux' ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'] : []
    if (developmentTestHarness) args.unshift(path.join(projectRoot, 'electron/main.cjs'))
    const env = { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profilePath, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }
    delete env.ELECTRON_RENDERER_URL
    app = await electron.launch({ executablePath: appPath, args, env, timeout: 30_000 })
    const runtime = await app.evaluate(({ app }) => ({ executable: process.execPath, app: app.getAppPath(), profile: app.getPath('userData') }))
    if (runtime.profile !== profilePath || (!developmentTestHarness && !runtime.app.endsWith('.asar'))) throw new Error('Coordinate probe runtime or profile custody differs.')
    report.runtime = { ...runtime, executableIdentity: await hashCandidateFile(runtime.executable),
      asarIdentity: developmentTestHarness ? null : await hashCandidateFile(runtime.app) }
    page = await app.firstWindow()
    page.on('dialog', dialog => { void dialog.accept().catch(() => undefined) })
    page.setDefaultTimeout(15_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-title').waitFor()
    await page.getByTestId('open-coordinate-converter').click()
    const conversions = []
    await page.getByTestId('coordinate-mode-dd').click()
    await page.getByTestId('coordinate-input-latitude').fill('52.179337')
    await page.getByTestId('coordinate-input-longitude').fill('-9.464944')
    await page.getByTestId('coordinate-convert-btn').click()
    conversions.push({ mode: 'dd', input: ['52.179337', '-9.464944'], grid: await cardValue(page, 'ig') })
    await page.screenshot({ path: path.join(evidencePath, 'coordinate-golden.png'), fullPage: true })
    await page.getByTestId('coordinate-mode-ig').click()
    await page.getByTestId('coordinate-input-irish-grid-ref').fill('Q 99842 04015')
    await page.getByTestId('coordinate-convert-btn').click()
    conversions.push({ mode: 'ig', input: ['Q 99842 04015'], dd: await cardValue(page, 'dd') })
    await page.getByTestId('coordinate-mode-dms').click()
    await page.getByTestId('coordinate-input-dms-latitude').fill('52°10\'45.613"N')
    await page.getByTestId('coordinate-input-dms-longitude').fill('9°27\'53.798"W')
    await page.getByTestId('coordinate-convert-btn').click()
    conversions.push({ mode: 'dms', input: ['52°10\'45.613"N', '9°27\'53.798"W'], grid: await cardValue(page, 'ig') })
    const rejected = []
    await page.getByTestId('coordinate-mode-dd').click()
    for (const input of ['NaN', 'Infinity', '91', '-91']) {
      await page.getByTestId('coordinate-input-latitude').fill(input)
      await page.getByTestId('coordinate-input-longitude').fill('-9')
      await page.getByTestId('coordinate-convert-btn').click()
      const error = await page.getByTestId('coordinate-converter-dialog').locator('p.text-rose-300').innerText()
      const target = page.getByTestId('coordinate-go-to-btn')
      rejected.push({ input, error, goToDisabled: await target.count() === 0 || await target.isDisabled() })
    }
    await page.screenshot({ path: path.join(evidencePath, 'coordinate-rejected.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await page.getByTestId('mission-name-input').fill('C13 coordinate surface')
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('drawing-toolbar-expand').click()
    await page.getByTestId('drawing-tool-bearing_line').click({ force: true })
    await page.locator('.maplibregl-canvas').click({ position: { x: 620, y: 260 }, force: true })
    await page.getByTestId('drawing-name-input').fill('C13 magnetic east')
    await page.getByTestId('drawing-bearing-type-input').selectOption('magnetic')
    await page.getByTestId('drawing-bearing-input').fill('90')
    await page.getByTestId('drawing-bearing-distance-input').fill('2000')
    const conversionLabel = (await page.getByTestId('drawing-bearing-conversion').innerText()).trim()
    await page.screenshot({ path: path.join(evidencePath, 'coordinate-bearing.png'), fullPage: true })
    await page.getByTestId('drawing-save-btn').click()
    await page.getByTestId('drawing-dialog').waitFor({ state: 'hidden' })
    const stored = await page.evaluate(async () => {
      const store = window.sartrackerElectron.missionStore
      const missions = await store.listMissions()
      const mission = missions.find(value => value.name === 'C13 coordinate surface')
      const drawings = await store.listDrawings(mission.id)
      const drawing = drawings.find(value => value.name === 'C13 magnetic east')
      return { id: drawing.id, geometry: JSON.parse(drawing.geometry_json) }
    })
    await page.waitForFunction(id => {
      const map = window.__SARTRACKER_MAP__
      return map && Object.values(map.getStyle().sources).some(source => source.type === 'geojson'
        && typeof source.data === 'object' && source.data.features?.some(feature => feature.properties?.drawingId === id && feature.properties.featureKind === 'geometry'))
    }, stored.id)
    const rendered = await page.evaluate(id => {
      const map = window.__SARTRACKER_MAP__
      for (const [sourceId, source] of Object.entries(map.getStyle().sources)) {
        const feature = source.type === 'geojson' && typeof source.data === 'object'
          ? source.data.features?.find(value => value.properties?.drawingId === id && value.properties.featureKind === 'geometry') : null
        if (feature) return { sourceId, drawingId: feature.properties.drawingId, renderedGeometry: feature.geometry }
      }
      throw new Error('Persisted drawing missing from rendered source.')
    }, stored.id)
    const measurementCoordinates = await page.evaluate(() => {
      const map = window.__SARTRACKER_MAP__
      return [[680, 240], [820, 300]].map(point => { const coordinate = map.unproject(point); return [coordinate.lng, coordinate.lat] })
    })
    await page.getByTestId('drawing-tool-measure').click()
    await page.locator('.maplibregl-canvas').click({ position: { x: 680, y: 240 }, force: true })
    await page.locator('.maplibregl-canvas').click({ position: { x: 820, y: 300 }, force: true })
    const measurement = { count: await page.getByTestId('measurement-count').innerText(), text: await page.getByTestId('measurement-list').innerText(), coordinates: measurementCoordinates }
    report.facts = { conversions, rejected, conversionLabel, geometry: stored.geometry.geometry ?? stored.geometry,
      persistedDrawingId: stored.id, ...rendered, measurement }
    validateCoordinateSurface(report.facts)
    await page.screenshot({ path: path.join(evidencePath, 'coordinate-measurement.png'), fullPage: true })
  } catch (error) {
    failure = error
    report.failure = 'Coordinate producer did not complete; retained bounded stderr has the failing step.'
    if (page) await page.screenshot({ path: path.join(evidencePath, 'coordinate-failure.png'), fullPage: true, timeout: 5_000 }).catch(() => undefined)
  } finally {
    if (app) {
      try { await app.close(); report.cleanup.applicationClosed = true } catch (error) { failure ??= error }
    }
    if (report.cleanup.applicationClosed) {
      try { await rm(profilePath, { recursive: true }); report.cleanup.profileRemoved = true } catch (error) { failure ??= error }
    }
    await writeFile(path.join(evidencePath, 'coordinate-surface-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  }
  if (failure) throw failure
  return report
}

/** Read only the visible value beneath a converter card label, excluding its Copy control. */
async function cardValue(page, kind) { return (await page.getByTestId(`coordinate-result-${kind}`).locator('p').last().innerText()).trim() }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Coordinate probe requires exactly app and evidence paths.')
  const [appPath, evidencePath] = process.argv.slice(2)
  await runCoordinateSurface({ appPath, evidencePath }).catch(error => { console.error(String(error.message).slice(0, 1500)); process.exitCode = 1 })
}
