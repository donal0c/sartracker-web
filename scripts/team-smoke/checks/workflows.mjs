/**
 * Operator workflows on the packaged app: coordinates, markers with
 * attachments, GPX import, replay and basemaps, the encrypted archive, and
 * settings/support-bundle privacy.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { delay, launchApp } from '../lib/app.mjs'
import { startMockTraccar } from '../lib/mock-traccar.mjs'
import {
  ARCHIVE_PASSPHRASE,
  archiveMission,
  bodyText,
  closeWorkspace,
  connectProvider,
  finishMission,
  placeMarker,
  startMission,
} from '../lib/operator.mjs'
import { expectProduct } from '../lib/results.mjs'
import { withStore } from '../lib/store.mjs'

/** A 2x2 PNG used as a marker photo. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
)

/** Writes a 30-point timed GPX track near the mock provider's area. */
async function writeGpx(file) {
  const start = Date.now() - 30 * 60_000
  const points = Array.from({ length: 30 }, (_, index) =>
    `<trkpt lat="${(51.97 + index * 0.0002).toFixed(6)}" lon="${(-9.7 + index * 0.0002).toFixed(6)}">`
      + `<time>${new Date(start + index * 60_000).toISOString()}</time></trkpt>`)
  await writeFile(file, `<?xml version="1.0"?><gpx version="1.1" creator="team-smoke"><trk><name>Smoke walk</name><trkseg>${points.join('')}</trkseg></trk></gpx>`)
}

/** Lists files under a directory with their size, newest first. */
async function filesUnder(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const full = path.join(entry.parentPath ?? entry.path, entry.name)
    out.push({ full, mtime: (await stat(full)).mtimeMs })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export default [
  {
    check: 'Coordinate conversion and rejection',
    id: 'coordinates',
    async run(ctx) {
      const app = await launchApp(ctx, { profile: path.join(ctx.runDir, 'profile'), label: 'coordinates' })
      const t = (id) => app.page.getByTestId(id)
      await t('open-coordinate-converter').click()
      await delay(500)
      const convert = async () => {
        await t('coordinate-convert-btn').click()
        await delay(300)
      }
      const resultOf = async (id) => (await t(id).count()) === 0 ? null : (await t(id).innerText()).replace(/\s+/gu, ' ')
      await t('coordinate-mode-dd').click()
      await t('coordinate-input-latitude').fill('52.179337')
      await t('coordinate-input-longitude').fill('-9.464944')
      await convert()
      const ddToIg = await resultOf('coordinate-result-ig')
      expectProduct(ddToIg?.includes('Q 99842 04015'), `52.179337, -9.464944 converted to ${ddToIg}, expected Q 99842 04015.`)
      await t('coordinate-input-latitude').fill('95')
      await convert()
      expectProduct(await resultOf('coordinate-result-ig') === null, 'Latitude 95 produced a result instead of an error.')
      await t('coordinate-mode-ig').click()
      await t('coordinate-input-irish-grid-ref').fill('Q 99842 04015')
      await convert()
      const igToDd = await resultOf('coordinate-result-dd')
      expectProduct(/52\.1793/.test(igToDd ?? '') && /-?9\.4649/.test(igToDd ?? ''), `Q 99842 04015 converted to ${igToDd}.`)
      await t('coordinate-input-irish-grid-ref').fill('V 80 84')
      await convert()
      const short = await resultOf('coordinate-result-ig')
      expectProduct(short?.includes('V 80500 84500'), `V 80 84 converted to ${short}, expected V 80500 84500.`)
      const rejected = []
      for (const bad of ['I 12345 67890', 'hello', 'V 1234 567']) {
        await t('coordinate-input-irish-grid-ref').fill(bad)
        await convert()
        expectProduct(await resultOf('coordinate-result-dd') === null, `"${bad}" produced a result instead of an error.`)
        rejected.push(bad)
      }
      await app.shot('rejections')
      await app.stop()
      return `DD↔IG round trip (Q 99842 04015); V 80 84 → V 80500 84500; rejected latitude 95, ${rejected.map((v) => `"${v}"`).join(', ')}.`
    },
  },
  {
    check: 'Markers, attachments and GPX import',
    id: 'markers-gpx',
    manualSteps: ['Import through the native file picker and verify all 30 GPX points and the marker attachment are shown.'],
    async run(ctx) {
      const profile = path.join(ctx.runDir, 'profile')
      const photo = path.join(ctx.runDir, 'evidence-photo.png')
      // The import bridge only accepts app-owned or operator-picked paths; the
      // profile's gpx-inbox is app-owned.
      const gpx = path.join(profile, 'gpx-inbox', 'smoke-walk.gpx')
      await writeFile(photo, PHOTO)
      await mkdir(path.dirname(gpx), { recursive: true })
      await writeGpx(gpx)
      const app = await launchApp(ctx, { profile, label: 'markers-gpx' })
      await startMission(app.page, 'Markers Smoke', [])
      await placeMarker(app.page, { name: 'Smoke IPP', x: 600, y: 400 })
      await placeMarker(app.page, { name: 'Rucksack with photo', x: 380, y: 300, type: 'clue', attachment: photo })
      const imported = await app.page.evaluate(async (file) => {
        const store = window.sartrackerElectron.missionStore
        const mission = await store.getActiveMission()
        return store.importGpxEvidencePaths({ missionId: mission.id, paths: [file] })
      }, gpx)
      await delay(3000)
      await app.page.getByTestId('sidebar-tab-tools').click().catch(() => {})
      await delay(1500)
      await app.shot('markers-gpx')
      await app.stop()
      const markers = withStore(profile, (db) => db.prepare('SELECT name FROM markers').all().map((row) => row.name))
      expectProduct(markers.includes('Smoke IPP') && markers.includes('Rucksack with photo'), `Stored markers: ${markers.join(', ')}.`)
      const photoHash = createHash('sha256').update(PHOTO).digest('hex')
      let attachmentMatch = false
      for (const file of await filesUnder(profile)) {
        if (file.full === photo || file.full === gpx) continue
        const bytes = await readFile(file.full).catch(() => null)
        if (bytes !== null && bytes.length === PHOTO.length && createHash('sha256').update(bytes).digest('hex') === photoHash) {
          attachmentMatch = true
          break
        }
      }
      expectProduct(attachmentMatch, 'No byte-identical copy of the attached photo was stored in the profile.')
      expectProduct(imported?.imports?.length === 1 && imported.failures?.length === 0,
        `GPX import returned ${JSON.stringify(imported).slice(0, 200)}.`)
      return `2 markers stored; photo attachment stored byte-identical; GPX (30 timed points) imported via the app's import bridge. Native file picker: check by hand.`
    },
  },
  {
    check: 'Replay, basemaps and layers',
    id: 'replay-basemaps',
    manualSteps: ['Inspect the basemap screenshots for rendered tiles; verify layer toggles and the reconstructed replay on the map.'],
    async run(ctx) {
      const mock = await startMockTraccar()
      ctx.cleanups.push(() => mock.close())
      const app = await launchApp(ctx, { profile: path.join(ctx.runDir, 'profile'), label: 'replay-basemaps' })
      const t = (id) => app.page.getByTestId(id)
      await connectProvider(app.page, mock.url)
      await startMission(app.page, 'Replay Smoke', ['Walker Alpha', 'Walker Bravo'])
      await delay(150_000)
      await t('open-mission-review-workspace').click()
      await delay(1200)
      await app.page.getByRole('button', { name: 'Replay', exact: true }).click()
      await delay(1500)
      const when = new Date(Date.now() - 60_000)
      const pad = (n) => String(n).padStart(2, '0')
      await t('mission-replay-time').fill(`${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`)
      await t('mission-replay-seek').click()
      await delay(6000)
      const state = (await t('mission-replay-reconstructed-state').innerText().catch(() => '')).replace(/\s+/gu, ' ')
      const replayError = await t('mission-replay-error').innerText().catch(() => null)
      await app.shot('replay')
      await t('mission-replay-return-live').click().catch(() => {})
      await delay(1000)
      await closeWorkspace(app.page)
      const phase = (await t('mission-phase-chip').innerText()).trim()
      expectProduct(replayError === null && state !== '', `Replay did not reconstruct state: ${replayError ?? 'empty state'}.`)
      expectProduct(/ACTIVE/i.test(phase), `Live mission became ${phase} after replay.`)
      const basemaps = []
      for (const name of ['ESRI Satellite', 'OpenStreetMap', 'ESRI World Topo', 'OpenTopoMap']) {
        await t('basemap-menu-toggle').click()
        await delay(400)
        await app.page.getByText(name, { exact: true }).last().click()
        await delay(3500)
        const label = (await t('basemap-menu-toggle').innerText()).replace(/\s+/gu, ' ')
        expectProduct(label.includes(name), `Selecting ${name} left the basemap as ${label}.`)
        basemaps.push(name)
        await app.shot(`basemap-${name.replace(/ /gu, '-')}`)
      }
      await app.stop()
      return `Replay reconstructed state 1 min back; live mission stayed ${phase}; basemaps ${basemaps.join(', ')} selected (review screenshots for tiles).`
    },
  },
  {
    check: 'Encrypted archive create and reopen',
    id: 'archive',
    async run(ctx) {
      const profile = path.join(ctx.runDir, 'profile')
      let app = await launchApp(ctx, { profile, label: 'archive-1' })
      const t = (id) => app.page.getByTestId(id)
      await startMission(app.page, 'Archive Smoke', [])
      await placeMarker(app.page, { name: 'Archive IPP', x: 600, y: 400 })
      await finishMission(app.page)
      await archiveMission(app.page)
      const archived = await app.page.getByText(/Mission archived to/).first()
        .waitFor({ timeout: 120_000 }).then(() => true, () => false)
      await app.shot('archived')
      expectProduct(archived, `Archive did not complete: ${(await bodyText(app.page)).slice(0, 200)}`)
      await app.stop()
      app = await launchApp(ctx, { profile, label: 'archive-2-reopen' })
      await app.page.getByTestId('open-mission-review-workspace').click()
      await delay(1500)
      await app.page.locator('[data-testid^=archive-review-select-]').first().click()
      await app.page.getByTestId('archive-review-secret').fill('Wrong-Passphrase-123!')
      await app.page.getByTestId('archive-review-open').click()
      await delay(6000)
      const wrongOpened = (await app.page.getByTestId('mission-review-archive-banner').count()) > 0
      await app.shot('wrong-passphrase')
      await app.page.getByTestId('archive-review-secret').fill(ARCHIVE_PASSPHRASE)
      await app.page.getByTestId('archive-review-open').click()
      const opened = await app.page.getByTestId('mission-review-archive-banner')
        .waitFor({ timeout: 60_000 }).then(() => true, () => false)
      await app.shot('reopened')
      await app.stop()
      expectProduct(!wrongOpened, 'The archive opened with a wrong passphrase.')
      expectProduct(opened, 'The archive did not reopen with the correct passphrase after restart.')
      return 'Finished, archived with passphrase and recovery code, restarted, reopened read-only; wrong passphrase refused.'
    },
  },
  {
    check: 'Settings, secrets and support bundle',
    id: 'settings-support',
    async run(ctx) {
      const mock = await startMockTraccar()
      ctx.cleanups.push(() => mock.close())
      const profile = path.join(ctx.runDir, 'profile')
      let app = await launchApp(ctx, { profile, label: 'settings-1' })
      await connectProvider(app.page, mock.url)
      await app.stop()
      app = await launchApp(ctx, { profile, label: 'settings-2' })
      const t = (id) => app.page.getByTestId(id)
      await t('open-settings-workspace').click()
      await delay(800)
      const url = await t('settings-provider-url').inputValue()
      const secretShown = await t('settings-provider-secret').inputValue()
      await closeWorkspace(app.page)
      const exportStarted = Date.now()
      await t('open-diagnostics-workspace').click()
      await delay(1500)
      await t('diagnostics-export-support-bundle').first().click()
      await delay(4000)
      await app.shot('support-bundle')
      await app.stop()
      expectProduct(url === mock.url, `Provider URL after restart is "${url}", expected ${mock.url}.`)
      expectProduct(secretShown === '', 'The stored secret was echoed into the Settings field.')
      const bundle = (await filesUnder(profile)).find((file) => file.mtime >= exportStarted - 1000 && /support/i.test(path.basename(file.full)))
      expectProduct(bundle !== undefined, 'No support bundle file was written.')
      const content = await readFile(bundle.full, 'utf8')
      const leaks = ['smoke-password', os.homedir(), os.userInfo().username === '' ? null : `/${os.userInfo().username}/`]
        .filter((needle) => needle !== null && content.includes(needle))
      expectProduct(leaks.length === 0, `Support bundle contains: ${leaks.join(', ')}.`)
      return `Provider settings persisted; secret field empty after restart; support bundle ${path.basename(bundle.full)} has no secret, home path or username.`
    },
  },
]
