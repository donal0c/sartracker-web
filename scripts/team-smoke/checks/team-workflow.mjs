/**
 * The team's own test mission, step by step, as they wrote it (SAR-QA-025,
 * 30 September 2026): start the AppImage, enter a mission name, set the roll
 * back time, press Start with nothing ticked, then add the one flat KMRT group
 * (SAR-QA-023/024); Discovery by default; convert coordinates; add a casualty
 * location; see where people are; Focus Mode; OpenTopoMap and satellite.
 *
 * Keep this in the team's order. Each step that the team does differently from
 * the other checks is the point of this check: they add participants after
 * Start, which is how TB13-03 (DON-291) lost its 48 h of history.
 */

import path from 'node:path'

import { delay, launchApp } from '../lib/app.mjs'
import { closeWorkspace, connectProvider } from '../lib/operator.mjs'
import { expectProduct } from '../lib/results.mjs'
import { missionFixes } from '../lib/store.mjs'
import { TEAM_DEVICES, TEAM_GROUPS, startTeamTraccar } from '../lib/team-traccar.mjs'
import { addAfterStart, placeCasualty, trackingStatus, verifyTeamFixes, waitForBackfill } from './team-mission.mjs'

const MISSION = 'KMRT Workflow Smoke'
const TEAM_GROUP = 'KMRT Hasty'
const HOUR = 3_600_000
const ROLL_BACK_HOURS = 48
const BACKFILL_BUDGET_MS = 15 * 60_000
const VERIFY_TIMEOUT_MS = 5 * 60_000

const groupId = TEAM_GROUPS.find((group) => group.name === TEAM_GROUP).id
const kmrt = TEAM_DEVICES.filter((entry) => entry.groupId === groupId)

export default [
  {
    check: 'Team mission scenario',
    id: 'team-workflow',
    timeoutMs: 30 * 60_000,
    manualSteps: [
      'On the release machine, press F11 with Focus Mode on (SAR-QA-025) and confirm the window goes full screen and back.',
      'Inspect the team-workflow screenshots: Discovery (when --map-package is given), OpenTopoMap and satellite tiles, the casualty marker, and KMRT tracks on the map.',
    ],
    async run(ctx) {
      const findings = []
      const notes = []
      const mock = await startTeamTraccar()
      ctx.cleanups.push(() => mock.close())
      const profile = path.join(ctx.runDir, 'profile')
      const mapPackage = ctx.options.mapPackage
      const env = mapPackage === undefined
        ? {}
        : { SARTRACKER_ELECTRON_TEST_OFFICIAL_MAP_PACKAGE_PATH: path.resolve(mapPackage) }

      // Setup the team already has: the provider and the Discovery package.
      let app = await launchApp(ctx, { profile, label: 'workflow-setup', env })
      await connectProvider(app.page, mock.url)
      if (mapPackage !== undefined) {
        await importDiscovery(app)
        await selectBasemap(app, 'Discovery Topo')
      } else {
        notes.push('Discovery not tested (no --map-package)')
      }
      await app.stop()

      // "Start pc, open AppImage from desktop": a fresh launch.
      app = await launchApp(ctx, { profile, label: 'workflow', env })
      const t = (id) => app.page.getByTestId(id)
      if (mapPackage !== undefined) {
        const basemap = (await t('basemap-menu-toggle').innerText()).replace(/\s+/gu, ' ')
        if (!basemap.includes('Discovery Topo')) findings.push(`Discovery was not the map after relaunch: "${basemap}"`)
      }

      // "Enter mission name, set roll back time, Start": nothing ticked.
      await t('mission-name-input').fill(MISSION)
      await t('mission-offset-input').fill(String(ROLL_BACK_HOURS))
      await t('mission-start-btn').click()
      await t('participant-management').waitFor({ timeout: 20_000 })
      await delay(1500)
      const missionStart = Date.parse(await app.page.evaluate(async () =>
        (await window.sartrackerElectron.missionStore.getActiveMission())?.start_time))
      expectProduct(Number.isFinite(missionStart) && Math.abs(mock.t0 - ROLL_BACK_HOURS * HOUR - missionStart) < 10 * 60_000,
        `Mission start ${new Date(missionStart).toISOString()} is not about ${ROLL_BACK_HOURS} h before now.`)
      const empty = (await t('participant-management').innerText()).replace(/\s+/gu, ' ')
      await app.shot('started-nothing-ticked')
      if (!/no (mission )?participants/i.test(empty)) findings.push(`starting with nothing ticked gave no visible "no participants" state: "${empty.slice(0, 160)}"`)

      // "Devices for KMRT should display": the team adds its group after Start.
      await addAfterStart(app.page, 'group', TEAM_GROUP, 'mission')
      const backfill = await waitForBackfill(app.page, BACKFILL_BUDGET_MS)
      expectProduct(backfill.seconds !== null,
        `KMRT history did not complete within ${BACKFILL_BUDGET_MS / 60_000} min: ${JSON.stringify(backfill.statuses).slice(0, 300)}.`)
      notes.push(`KMRT added after Start with "Mission start"; history complete in ${backfill.seconds} s`)

      // "Convert coordinates".
      await t('open-coordinate-converter').click()
      await delay(500)
      await t('coordinate-mode-dd').click()
      await t('coordinate-input-latitude').fill('52.179337')
      await t('coordinate-input-longitude').fill('-9.464944')
      await t('coordinate-convert-btn').click()
      await delay(300)
      const ig = (await t('coordinate-result-ig').innerText().catch(() => '')).replace(/\s+/gu, ' ')
      if (!ig.includes('Q 99842 04015')) findings.push(`coordinate conversion gave "${ig}", expected Q 99842 04015`)
      await closeWorkspace(app.page)
      await app.page.keyboard.press('Escape').catch(() => {})

      // "Add cas location".
      await placeCasualty(app.page, { name: 'Casualty Location', x: 700, y: 420 })
      const casualties = await app.page.evaluate(async () => {
        const store = window.sartrackerElectron.missionStore
        const mission = await store.getActiveMission()
        return (await store.listMarkers(mission.id)).filter((marker) => /casualty/i.test(marker.type ?? '')).length
      }).catch(() => null)
      if (casualties !== null && casualties < 1) findings.push('no casualty marker was stored')

      // "Know where people are".
      await delay(20_000)
      const status = await trackingStatus(app.page)
      await t('open-devices-workspace').click()
      await delay(1500)
      const roster = await t('device-list-scroll').innerText()
      await closeWorkspace(app.page)
      const missing = kmrt.filter((entry) => !roster.includes(entry.name)).map((entry) => entry.name)
      if (missing.length > 0) findings.push(`KMRT members missing from Devices: ${missing.join(', ')}`)
      await app.shot('where-people-are')

      // "F11 with Focus mode": Focus Mode here; F11 is a manual step.
      await t('focus-mode-toggle').click()
      await delay(1500)
      await app.shot('focus-mode')
      await t('focus-mode-toggle').click()
      await delay(1000)

      // "Open topo and satellite maps also vital".
      for (const name of ['OpenTopoMap', 'ESRI Satellite']) {
        await selectBasemap(app, name)
        await app.shot(`basemap-${name.replace(/ /gu, '-')}`)
      }

      // Every KMRT fix from mission start, exactly as the provider served it.
      const until = Date.now()
      const perDevice = verifyTeamFixes(mock, missionFixes(profile, MISSION), {
        starts: Object.fromEntries(kmrt.map((entry) => [entry.id, missionStart])),
        excluded: TEAM_DEVICES.filter((entry) => entry.groupId !== groupId).map((entry) => entry.id),
        until,
      })
      await app.stop()
      const total = Object.values(perDevice).reduce((sum, entry) => sum + entry.stored, 0)
      expectProduct(findings.length === 0, findings.join('; '))
      return `SAR-QA-025 replay: ${total} KMRT fixes equal the provider from the ${ROLL_BACK_HOURS} h mission start; ${notes.join('; ')}; `
        + `coordinates converted; casualty stored; Focus Mode; OpenTopoMap and satellite selected; tracking "${status.slice(0, 80)}".`
    },
  },
]

/** Imports the Discovery package through Settings (picker answered by the test hook). */
async function importDiscovery(app) {
  const t = (id) => app.page.getByTestId(id)
  await t('open-settings-workspace').click()
  await delay(800)
  await t('choose-official-map-package').click()
  await t('official-map-package-status').getByText(/0\/1 ready/u).waitFor({ timeout: VERIFY_TIMEOUT_MS })
  await t('settings-save').click()
  const closed = await t('settings-save').waitFor({ state: 'detached', timeout: VERIFY_TIMEOUT_MS }).then(() => true, () => false)
  expectProduct(closed, 'Save & Close did not complete after adding the Discovery package.')
}

/** Selects a basemap from the Maps menu and confirms the label changed. */
async function selectBasemap(app, name) {
  const toggle = app.page.getByTestId('basemap-menu-toggle')
  await toggle.click()
  await delay(400)
  await app.page.getByText(name, { exact: true }).last().click()
  await delay(4000)
  const label = (await toggle.innerText()).replace(/\s+/gu, ' ')
  expectProduct(label.includes(name), `Selecting ${name} left the basemap as ${label}.`)
}
