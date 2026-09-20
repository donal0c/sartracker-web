#!/usr/bin/env node
import { _electron as electron, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAttentionScenario, startAttentionServer } from './attention-server.mjs'
import { validateAttentionSurface } from './attention-receipts.mjs'
import { validateCanonicalIngestSurface } from './canonical-ingest-receipts.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Run real provider-to-persistence-to-UI attention without browser-harness injection. */
export async function runAttentionProbe({ appPath, evidencePath, developmentTestHarness = false }) {
  if (![appPath, evidencePath].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('Attention probe requires absolute paths.')
  await mkdir(evidencePath, { recursive: true, mode: 0o700 })
  const profile = await mkdtemp(path.join(evidencePath, '.attention-profile-'))
  const source = createAttentionScenario(Date.now())
  const server = await startAttentionServer(source)
  const report = { schema: 'sartracker-attention-surface-v1', contractId: 'C06', developmentTestHarness,
    qualificationExecuted: false, runtime: null, facts: null, requests: server.requests,
    cleanup: { applicationClosed: false, serverClosed: false, profileRemoved: false }, failure: null }
  let app
  let page
  let failure
  try {
    await writeFile(path.join(profile, 'settings.json'), JSON.stringify({
      missionDefaults: { autoRefreshEnabled: true, autoRefreshIntervalSeconds: 5, autoSaveEnabled: true,
        autoSaveIntervalSeconds: 5, primaryMissionRoot: '', backupMissionRoot: '', coordinatorRoster: [], adminRoster: [] },
      dataSource: { providerType: 'traccar_http', baseUrl: server.url, authMode: 'basic', email: 'synthetic-attention@example.invalid',
        autoConnect: true, trackingCacheEnabled: false, replayEnabled: false, replayStart: '', replayDurationHours: 4 },
      officialMaps: { sourceType: 'none', sourcePath: '', status: 'not_configured', username: '', availableSources: [], serviceCount: 0, message: 'Not configured', packages: [] }, weather: { links: [] },
    }))
    await writeFile(path.join(profile, 'credentials.json'), JSON.stringify({ version: 1, traccar: { basic: { secret: 'synthetic-attention-secret' } } }))
    const args = process.platform === 'linux' ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'] : []
    if (developmentTestHarness) args.unshift(path.join(root, 'electron/main.cjs'))
    const env = { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }
    delete env.ELECTRON_RENDERER_URL
    app = await electron.launch({ executablePath: appPath, args, env, timeout: 30_000 })
    const runtime = await app.evaluate(({ app }) => ({ executable: process.execPath, app: app.getAppPath(), profile: app.getPath('userData') }))
    if (runtime.profile !== profile || (!developmentTestHarness && !runtime.app.endsWith('.asar'))) throw new Error('Attention runtime/profile identity differs.')
    report.runtime = { executableSha256: (await hashCandidateFile(runtime.executable)).sha256,
      asarSha256: developmentTestHarness ? null : (await hashCandidateFile(runtime.app)).sha256 }
    page = await app.firstWindow()
    page.setDefaultTimeout(30_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-title').waitFor()
    await page.getByTestId('mission-name-input').fill('C06 stationary attention')
    await page.getByTestId('mission-offset-input').fill('1')
    const devices = page.getByTestId('participant-device-picker').locator('input[type="checkbox"]')
    await expect(devices).toHaveCount(2, { timeout: 30_000 })
    for (let index = 0; index < 2; index++) await devices.nth(index).check()
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('stationary-attention-summary').waitFor({ timeout: 60_000 })
    await page.getByTestId('open-devices-workspace').click()
    const attention = await page.getByTestId('device-attention-1').innerText()
    const stale = await page.getByTestId('device-status-2').innerText()
    await page.screenshot({ path: path.join(evidencePath, 'attention-raised.png'), fullPage: true })
    const beforeAck = await evidenceDigest(page)
    const sourcePollsBeforeAck = server.requests.filter(request => request.method === 'GET' && request.path === '/api/positions').length
    await page.getByTestId('device-select-1').click()
    await page.getByTestId('acknowledge-stationary-attention').click()
    await expect(page.getByTestId('device-attention-1')).toContainText('Acknowledged')
    const acknowledged = await page.getByTestId('device-attention-1').innerText()
    await expect.poll(() => server.requests.filter(request => request.method === 'GET' && request.path === '/api/positions').length, { timeout: 30_000 }).toBeGreaterThan(sourcePollsBeforeAck)
    const afterAck = await evidenceDigest(page)
    const sourcePollsAfterAck = server.requests.filter(request => request.method === 'GET' && request.path === '/api/positions').length
    await page.screenshot({ path: path.join(evidencePath, 'attention-acknowledged.png'), fullPage: true })
    server.setStage('disconnected')
    await expect(page.getByTestId('tracking-mode-chip')).toHaveText(/offline|disconnected|not connected/i, { timeout: 60_000 })
    const disconnected = await page.getByTestId('tracking-mode-chip').innerText()
    await page.screenshot({ path: path.join(evidencePath, 'attention-disconnected.png'), fullPage: true })
    server.setStage('moving')
    await expect(page.getByTestId('tracking-mode-chip')).toHaveText(/online|live|connected/i, { timeout: 90_000 })
    await expect(page.getByTestId('device-attention-1')).toHaveCount(0, { timeout: 60_000 })
    const recovered = await page.getByTestId('tracking-mode-chip').innerText()
    await page.waitForFunction(() => Object.values(window.__SARTRACKER_MAP__?.getStyle()?.sources ?? {}).some(source =>
      source.type === 'geojson' && typeof source.data === 'object' && source.data.features?.some(feature =>
        feature.properties?.featureKind === 'device' && feature.properties?.deviceId === '1'
          && feature.geometry.coordinates[1] === 52.00101)))
    const renderedCurrent = await page.evaluate(() => {
      for (const source of Object.values(window.__SARTRACKER_MAP__.getStyle().sources)) {
        const feature = source.type === 'geojson' && typeof source.data === 'object'
          ? source.data.features?.find(feature => feature.properties?.featureKind === 'device' && feature.properties?.deviceId === '1') : null
        if (feature) return { coordinates: feature.geometry.coordinates, attention: feature.properties.attention }
      }
      throw new Error('Recovered current fix is missing from the map.')
    })
    const currentVisible = await page.getByTestId('device-select-1').isVisible()
    report.facts = { source, attention, acknowledged, stale, disconnected, recovered, cleared: true, currentVisible,
      renderedCurrent, evidenceBeforeAck: beforeAck.digest, evidenceAfterAck: afterAck.digest,
      durableBeforeAck: beforeAck.rows, durableAfterAck: afterAck.rows, sourcePollsBeforeAck, sourcePollsAfterAck }
    validateAttentionSurface(report.facts)
    validateCanonicalIngestSurface(report.facts)
    await page.screenshot({ path: path.join(evidencePath, 'attention-movement-cleared.png'), fullPage: true })
  } catch (error) {
    failure = error
    report.failure = error instanceof Error ? error.message.slice(0, 1200) : 'Attention producer failed.'
    if (page) await page.screenshot({ path: path.join(evidencePath, 'attention-failure.png'), fullPage: true, timeout: 5000 }).catch(() => undefined)
  } finally {
    try { if (app) await app.close(); report.cleanup.applicationClosed = true }
    catch (error) { failure ??= error }
    try { await server.close(); report.cleanup.serverClosed = true }
    catch (error) { failure ??= error }
    if (report.cleanup.applicationClosed && report.cleanup.serverClosed) {
      try { await rm(profile, { recursive: true, force: true }); report.cleanup.profileRemoved = true }
      catch (error) { failure ??= error }
    }
    await writeFile(path.join(evidencePath, 'attention-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  }
  if (failure) throw failure
  return report
}

/** Hash independently read durable rows around a presentation-only acknowledgement. */
async function evidenceDigest(page) {
  const rows = await page.evaluate(async () => {
    const store = window.sartrackerElectron.missionStore
    const mission = (await store.listMissions()).find(value => value.name === 'C06 stationary attention')
    const result = await store.listExactBreadcrumbDotPage({ missionId: mission.id, activeDeviceIds: [], limit: 2000, direction: 'latest', cursor: null }, crypto.randomUUID())
    if (result.hasEarlier || result.positions.length !== 3) throw new Error('Attention source evidence was incomplete.')
    const durable = await store.listPositions(mission.id)
    if (durable.length !== 3 || result.positions.some(row => !durable.some(value => value.id === row.id && value.timestamp === row.timestamp && value.lat === row.lat && value.lon === row.lon))) {
      throw new Error('Attention exact projection differs from durable source rows.')
    }
    return durable
  })
  return { rows, digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Attention producer requires exactly app and evidence paths.')
  await runAttentionProbe({ appPath: process.argv[2], evidencePath: process.argv[3] })
}
