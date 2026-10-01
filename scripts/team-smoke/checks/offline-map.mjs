/**
 * Offline map package: the Discovery package the team actually holds imports
 * through Settings, is verified ready, is selectable as a basemap with the
 * network blocked, and is still ready after a restart (TB13-02 / DON-144).
 *
 * The native file picker is answered by the app's test-only hook
 * (SARTRACKER_ELECTRON_TEST_OFFICIAL_MAP_PACKAGE_PATH); the import and
 * verification after it are the product's own.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { delay, launchApp } from '../lib/app.mjs'
import { bodyText, closeWorkspace, waitForBasemapLabel } from '../lib/operator.mjs'
import { NotTested, expectProduct } from '../lib/results.mjs'

const VERIFY_TIMEOUT_MS = 5 * 60_000

export default [
  {
    check: 'Offline map package',
    id: 'offline-map',
    timeoutMs: 20 * 60_000,
    manualSteps: ['Inspect the Discovery Topo screenshots (before and after restart) for rendered map tiles.'],
    async run(ctx) {
      const source = ctx.options.mapPackage
      if (source === undefined) {
        throw new NotTested("Pass --map-package: the Discovery .mbtiles the team actually holds.")
      }
      const hash = createHash('sha256')
      await pipeline(createReadStream(source), hash)
      const sourceSha = hash.digest('hex')
      const profile = path.join(ctx.runDir, 'profile')
      const env = {
        SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
        SARTRACKER_ELECTRON_TEST_OFFICIAL_MAP_PACKAGE_PATH: path.resolve(source),
      }

      const first = await launchApp(ctx, { profile, label: 'offline-map', env })
      const t = (id) => first.page.getByTestId(id)
      await t('open-settings-workspace').click()
      await delay(800)
      await t('choose-official-map-package').click()
      // Choosing adds a pending (unverified) package; Save & Close verifies it.
      await t('official-map-package-status').getByText(/0\/1 ready/u).waitFor({ timeout: VERIFY_TIMEOUT_MS })
      await t('settings-save').click()
      const closed = await t('settings-save').waitFor({ state: 'detached', timeout: VERIFY_TIMEOUT_MS }).then(() => true, () => false)
      if (!closed) await first.shot('save-did-not-close')
      expectProduct(closed, `Save & Close did not complete: ${(await bodyText(first.page)).slice(0, 300)}`)
      const stored = await waitForStoredPackage(profile, VERIFY_TIMEOUT_MS)
      expectProduct(stored.status === 'ready', `Package not ready after import: ${stored.status}: ${stored.message}`)
      await closeWorkspace(first.page)
      await selectDiscovery(first)
      await first.shot('discovery-before-restart')
      await first.stop()

      const second = await launchApp(ctx, { profile, label: 'offline-map-restart', env: { SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' } })
      await second.page.getByTestId('open-settings-workspace').click()
      await delay(1500)
      const status = (await second.page.getByTestId('official-map-package-status').innerText()).replace(/\s+/gu, ' ')
      await second.shot('settings-after-restart')
      expectProduct(/1\/1 ready/u.test(status), `After restart the package panel shows: ${status.slice(0, 200)}`)
      await closeWorkspace(second.page)
      // The operator's map must survive the restart, not be re-selected [DON-304].
      const afterRestart = await waitForBasemapLabel(second.page, 'Discovery Topo')
      await second.shot('discovery-after-restart')
      expectProduct(afterRestart.includes('Discovery Topo'),
        `After restart the map is "${afterRestart}", not Discovery Topo.`)
      await second.stop()
      const restarted = await readStoredPackage(profile)
      expectProduct(restarted?.status === 'ready', `After restart the stored package is ${restarted?.status}.`)

      return `Team package sha256 ${sourceSha.slice(0, 16)}… imported offline and verified ready `
        + `(z${stored.minZoom}–${stored.maxZoom}, ${stored.tileCount} tiles); Discovery Topo selected; still ready and still the map after restart.`
    },
  },
]

/** Selects the Discovery Topo basemap and confirms the menu label changed. */
async function selectDiscovery(app) {
  const toggle = app.page.getByTestId('basemap-menu-toggle')
  await toggle.click()
  await delay(400)
  await app.page.getByText('Discovery Topo', { exact: true }).last().click()
  await delay(5000)
  const label = (await toggle.innerText()).replace(/\s+/gu, ' ')
  expectProduct(label.includes('Discovery Topo'), `Selecting Discovery Topo left the basemap as ${label}.`)
}

/** Reads the one registered official map package from the profile's settings. */
async function readStoredPackage(profile) {
  try {
    const settings = JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8'))
    return settings?.officialMaps?.packages?.[0] ?? null
  } catch {
    return null
  }
}

/** Waits until Settings has saved a verified (or rejected) package record. */
async function waitForStoredPackage(profile, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const stored = await readStoredPackage(profile)
    if (stored !== null && stored.status !== undefined && stored.status !== 'pending') return stored
    await delay(1000)
  }
  throw new Error('No saved package record appeared in settings.json.')
}
