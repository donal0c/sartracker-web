#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { inspectPrivateMapTiles } from './private-map-receipt.mjs'
import { installOfficialMapRenderCapture, isOfficialRasterSourceReady,
  resetOfficialMapsSettings, xyzTileBounds } from '../../build/electron-official-map-qualification-smoke-lib.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const MAP_ID = 'official_discovery_topo'
const CAPTURE = '__PRIVATE_MAP_RENDER_PROOF__'

// Never send library errors (which can contain paths, coordinates or image data)
// to retained stdout/stderr. The wrapper retains the phase code on failure.
let phase = 'input'
main().catch(() => { console.error(`PRIVATE_MAP_PROBE_FAILED_${phase.toUpperCase()}`); process.exitCode = 1 })

/** Exercise one exact private map in a disposable offline packaged profile. */
async function main() {
  const [appPath, evidencePath, mapPath] = process.argv.slice(2)
  if (![appPath, evidencePath, mapPath].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('INPUT')
  const source = await hashCandidateFile(mapPath)
  await mkdir(evidencePath, { recursive: true, mode: 0o700 })
  const profile = path.join(evidencePath, '.private-map-profile')
  await mkdir(profile, { recursive: false, mode: 0o700 })
  const privateCopy = path.join(profile, 'private-map.mbtiles')
  let app
  let report
  try {
    await copyFile(mapPath, privateCopy)
    if ((await hashCandidateFile(privateCopy)).sha256 !== source.sha256) throw new Error('COPY')
    phase = 'independent_decode'
    const database = new Database(privateCopy, { readonly: true, fileMustExist: true })
    let inspected
    try {
      if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('SQLITE')
      inspected = inspectPrivateMapTiles(database)
    } finally { database.close() }
    phase = 'launch'
    const env = { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }
    delete env.ELECTRON_RENDERER_URL
    app = await electron.launch({ executablePath: appPath,
      args: ['--ozone-platform=x11', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'], env })
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
    await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined, null, { timeout: 30_000 })
    const runtime = await app.evaluate(({ app: nativeApp }) => ({ isPackaged: nativeApp.isPackaged,
      asarPath: nativeApp.getAppPath(), executablePath: process.execPath }))
    if (!runtime.isPackaged || !runtime.asarPath.endsWith('.asar')) throw new Error('RUNTIME')
    phase = 'registration'
    const current = await page.evaluate(() => window.sartrackerElectron.loadAppSettings())
    const reset = resetOfficialMapsSettings(current)
    const configured = await page.evaluate(async ({ settings, packagePath, mapId }) => {
      return window.sartrackerElectron.saveAppSettings({ ...settings,
        officialMaps: { ...settings.officialMaps, packages: [{ sourceType: 'mbtiles', mapId, packagePath }] } })
    }, { settings: reset, packagePath: privateCopy, mapId: MAP_ID })
    const mapPackage = configured.officialMaps.packages[0]
    const providerDisabled = configured.officialMaps.sourceType === 'none'
      && configured.officialMaps.sourcePath === '' && configured.officialMaps.availableSources.length === 0
    if (!providerDisabled || mapPackage?.status !== 'ready' || mapPackage.attestation?.sha256 !== source.sha256
        || mapPackage.tileCount !== inspected.facts.tileCount) throw new Error('ATTESTATION')
    const tile = await page.evaluate(({ target, mapId }) => window.sartrackerElectron.fetchOfficialMapTile(
      `sartracker-official-map://tile/${mapId}/${target.z}/${target.x}/${target.y}.png`), { target: inspected.target, mapId: MAP_ID })
    const servedTileMatchesSource = createHash('sha256').update(Buffer.from(tile.bytesBase64, 'base64')).digest('hex') === inspected.target.sha256
    const servedTileDecoded = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const valid = [256, 512].includes(bitmap.width) && bitmap.height === bitmap.width
      bitmap.close()
      return valid
    }, tile.bytesBase64)
    phase = 'render'
    let externalMapRequests = 0
    page.on('request', request => {
      if (/^https?:/u.test(request.url()) && request.url() !== 'https://example.com/private-map-network-probe') externalMapRequests++
    })
    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId(`basemap-btn-${MAP_ID}`).click()
    await page.waitForFunction(id => window.__SARTRACKER_MAP__.getStyle()?.sources?.[id] !== undefined, MAP_ID, { timeout: 30_000 })
    await page.evaluate(installOfficialMapRenderCapture, { key: CAPTURE, sourceId: MAP_ID, deadlineAt: Date.now() + 60_000 })
    const bounds = xyzTileBounds(inspected.target.z, inspected.target.x, inspected.target.y)
    await page.evaluate(({ bounds: targetBounds, zoom }) => window.__SARTRACKER_MAP__.jumpTo({
      center: [(targetBounds.west + targetBounds.east) / 2, (targetBounds.south + targetBounds.north) / 2], zoom, bearing: 0, pitch: 0,
    }), { bounds, zoom: inspected.target.z - 1 })
    await page.waitForFunction(key => {
      const evidence = window[key]?.latest
      return evidence?.mapLoaded && evidence.officialSourceLoaded && evidence.capturedAtRender
        && evidence.sampledPixels.some(pixel => pixel[3] > 0)
    }, CAPTURE, { timeout: 45_000 })
    const rendered = await page.evaluate(key => window[key].latest, CAPTURE)
    const targetViewConfirmed = await page.evaluate(({ bounds: targetBounds, zoom }) => {
      const map = window.__SARTRACKER_MAP__
      const center = map.getCenter()
      return Math.abs(map.getZoom() - zoom) < 1e-6 && center.lng > targetBounds.west && center.lng < targetBounds.east
        && center.lat > targetBounds.south && center.lat < targetBounds.north
    }, { bounds, zoom: inspected.target.z - 1 })
    const sourceLoaded = isOfficialRasterSourceReady(rendered, MAP_ID)
    const renderFrameObserved = rendered.capturedAtRender === true && rendered.frameCount > 0
    phase = 'operator_check'
    const toggle = page.getByTestId('basemap-menu-toggle')
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    const coverage = page.getByTestId('basemap-offline-coverage')
    await coverage.getByTestId('check-offline-map-coverage').click()
    await coverage.getByText('Current view tiles verified', { exact: true }).waitFor({ timeout: 60_000 })
    const text = await coverage.innerText()
    const counts = text.match(/(\d+)\/(\d+) local tiles/u)
    const fieldReady = /\bField ready\b/u.test(await page.getByTestId('field-readiness-checklist').innerText())
    const networkBlocked = await page.evaluate(async () => {
      try { await fetch('https://example.com/private-map-network-probe', { cache: 'no-store' }); return false } catch { return true }
    })
    if (!counts) throw new Error('VIEW_COUNTS')
    phase = 'custody'
    const after = await hashCandidateFile(mapPath)
    const copyAfter = await hashCandidateFile(privateCopy)
    report = {
      schema: 'sartracker-private-offline-map-v1',
      runtime: { isPackaged: true, executableSha256: (await hashCandidateFile(runtime.executablePath)).sha256,
        asarSha256: (await hashCandidateFile(runtime.asarPath)).sha256 },
      map: { sha256: source.sha256, bytes: source.bytes, ...inspected.facts },
      observations: { providerDisabled, networkBlocked, externalMapRequests, servedTileMatchesSource, servedTileDecoded,
        sourceLoaded, renderFrameObserved, targetViewConfirmed, viewComplete: Number(counts[1]) === Number(counts[2]), fieldReady,
        viewTotalTiles: Number(counts[2]), viewUsableTiles: Number(counts[1]),
        privateInputUnchanged: after.sha256 === source.sha256 && copyAfter.sha256 === source.sha256 },
      custody: { privateBytesRetained: false, privateScreenshotsRetained: false },
      process: { exitCode: null, signal: null },
    }
    const child = app.process()
    await app.close(); app = null
    report.process = { exitCode: child.exitCode, signal: child.signalCode }
  } finally {
    try { if (app) await app.close() } finally { await rm(profile, { recursive: true, force: true }) }
  }
  // Only the closed schema is retained. No map frame, tile, location or path is evidence output.
  await writeFile(path.join(evidencePath, 'private-map-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
}
