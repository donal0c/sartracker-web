/**
 * The team's own test mission, step by step, as they wrote it (SAR-QA-025,
 * 30 September 2026): start the AppImage, enter a mission name, set the roll
 * back time, press Start, and "Devices for KMRT should display": KMRT is the
 * team default group set once in Settings, so it is already ticked at Start
 * (DON-296); Discovery by default; convert coordinates; add a casualty
 * location; see where people are; Focus Mode; OpenTopoMap and satellite.
 *
 * Keep this in the team's order. Adding a group after Start (how TB13-03 /
 * DON-291 lost its 48 h of history) is covered by team-mission.
 */

import path from 'node:path'

import { delay, launchApp } from '../lib/app.mjs'
import {
  closeWorkspace, connectProvider, finishMission, openMissionSection, startMission, waitForBasemapLabel,
} from '../lib/operator.mjs'
import { expectProduct, NotTested } from '../lib/results.mjs'
import { isRetryableStoreRead } from '../lib/live-recording.mjs'
import { missionFixes } from '../lib/store.mjs'
import { TEAM_DEVICES, TEAM_GROUPS, startTeamTraccar } from '../lib/team-traccar.mjs'
import { addAfterStart, placeCasualty, trackingStatus, verifyTeamFixes, waitForBackfill } from './team-mission.mjs'

const MISSION = 'KMRT Workflow Smoke'
const TEAM_GROUP = 'KMRT Hasty'
const HOUR = 3_600_000
const ROLL_BACK_HOURS = 48
const BACKFILL_BUDGET_MS = 15 * 60_000
const VERIFY_TIMEOUT_MS = 5 * 60_000
const GROUP_LIST_TIMEOUT_MS = 45_000
const GROUP_RECORDING_TIMEOUT_MS = 150_000
/** DON-330: a group created in Traccar after SAR Tracker started. */
const NEW_GROUP = { id: 305, name: 'Miscellaneous' }
const NEW_GROUP_DEVICE = { id: 3051, name: 'Misc Alpha', lat: 51.93, lon: -9.7 }
/** A second new group, created mid-mission, so Add group has something genuinely new to find. */
const LATE_GROUP = { id: 306, name: 'Search Support' }
const LATE_GROUP_DEVICE = { id: 3061, name: 'Support Bravo', lat: 51.92, lon: -9.69 }

const groupId = TEAM_GROUPS.find((group) => group.name === TEAM_GROUP).id
const kmrt = TEAM_DEVICES.filter((entry) => entry.groupId === groupId)

export default [
  {
    // DON-330: Traccar groups created after startup are offered without a restart.
    check: 'Team mission scenario',
    id: 'team-group-refresh',
    timeoutMs: 15 * 60_000,
    async run(ctx) {
      const mock = await startTeamTraccar({ groupIds: [groupId] })
      ctx.cleanups.push(() => mock.close())
      const profile = path.join(ctx.runDir, 'profile')
      const app = await launchApp(ctx, { profile, label: 'group-refresh' })
      const t = (id) => app.page.getByTestId(id)
      await connectProvider(app.page, mock.url)

      // The server starts with KMRT only, and SAR Tracker has read it.
      const listsGroup = (name) => t('participant-group-picker').getByText(name, { exact: true }).first()
        .waitFor({ timeout: GROUP_LIST_TIMEOUT_MS }).then(() => true, () => false)
      expectProduct(await listsGroup(TEAM_GROUP), `Mission setup did not list ${TEAM_GROUP} within ${GROUP_LIST_TIMEOUT_MS / 1000} s of connecting; the group-refresh check cannot start.`)
      expectProduct(await t('participant-group-picker').getByText(NEW_GROUP.name, { exact: true }).count() === 0,
        `${NEW_GROUP.name} was listed before it existed in Traccar.`)

      // A team member creates the group in Traccar while SAR Tracker stays open.
      mock.addGroup(NEW_GROUP, [NEW_GROUP_DEVICE])

      // Opening mission setup again (a finished mission returns to it) must list it.
      await startMission(app.page, 'Setup Refresh Probe', [])
      await finishMission(app.page)
      const setupLists = await listsGroup(NEW_GROUP.name)
      await app.shot('group-refresh-setup')
      expectProduct(setupLists,
        `${NEW_GROUP.name} was created in Traccar after SAR Tracker started, but mission setup still does not list it after ${GROUP_LIST_TIMEOUT_MS / 1000} s; volunteers would have to restart the app (DON-330).`)

      // Start with KMRT only, then check it is recording.
      await t('mission-name-input').fill('Group Refresh Smoke')
      await t('participant-group-picker').getByText(TEAM_GROUP, { exact: true }).first().click()
      await t('mission-start-btn').click()
      await openMissionSection(app.page, 'participants')
      await t('participant-management').waitFor({ timeout: 20_000 })
      const kmrtIds = kmrt.map((entry) => entry.id)
      const kmrtRecording = await waitForFixes(profile, 'Group Refresh Smoke', () => kmrtIds, Date.now(), GROUP_RECORDING_TIMEOUT_MS)
      expectProduct(kmrtRecording, `${TEAM_GROUP} recorded no fixes within ${GROUP_RECORDING_TIMEOUT_MS / 1000} s of Start, before any group was added; the check cannot continue.`)

      // Another group appears mid-mission; opening Add group must list both.
      mock.addGroup(LATE_GROUP, [LATE_GROUP_DEVICE])
      await openMissionSection(app.page, 'participants')
      await t('participant-add-kind').selectOption('group')
      const choices = t('participant-add-ref')
      const addListed = async (name) => {
        const deadline = Date.now() + GROUP_LIST_TIMEOUT_MS
        while (Date.now() < deadline) {
          if ((await choices.locator('option').allInnerTexts()).some((text) => text.includes(name))) return true
          await delay(1000)
        }
        return false
      }
      const addListsNew = await addListed(NEW_GROUP.name)
      const addListsLate = await addListed(LATE_GROUP.name)
      await app.shot('group-refresh-add-group')
      expectProduct(addListsNew, `${NEW_GROUP.name} is missing from Add group during the mission although it exists in Traccar (DON-330).`)
      expectProduct(addListsLate, `${LATE_GROUP.name} was created in Traccar while the mission ran, but Add group does not list it after ${GROUP_LIST_TIMEOUT_MS / 1000} s (DON-330).`)
      const enrolled = () => app.page.evaluate(async () => {
        const store = window.sartrackerElectron.missionStore
        const mission = await store.getActiveMission()
        return (await store.listMissionParticipants(mission.id)).filter((entry) => entry.removed_at === null).map((entry) => entry.kind)
      })
      const beforeAdd = await enrolled()
      expectProduct(beforeAdd.length === 1,
        `Listing the new groups in Add group changed the mission's participants (${JSON.stringify(beforeAdd)}); nothing may be enrolled until the group is chosen (DON-330).`)

      // Explicitly add Miscellaneous only.
      const addedAt = Date.now()
      await addAfterStart(app.page, 'group', NEW_GROUP.name, 'now')
      const afterAdd = await enrolled()
      expectProduct(afterAdd.length === 2 && afterAdd.every((kind) => kind === 'group'),
        `After adding ${NEW_GROUP.name} the mission should hold two groups (${TEAM_GROUP} and ${NEW_GROUP.name}); it holds ${JSON.stringify(afterAdd)}.`)
      const miscRecording = await waitForFixes(profile, 'Group Refresh Smoke', () => [NEW_GROUP_DEVICE.id], addedAt, GROUP_RECORDING_TIMEOUT_MS)
      expectProduct(miscRecording, `${NEW_GROUP.name}'s device ${NEW_GROUP_DEVICE.name} recorded nothing within ${GROUP_RECORDING_TIMEOUT_MS / 1000} s of the group being added.`)
      const kmrtKeptRecording = await waitForFixes(profile, 'Group Refresh Smoke', () => kmrtIds, addedAt, GROUP_RECORDING_TIMEOUT_MS)
      await app.shot('group-refresh-added')
      expectProduct(kmrtKeptRecording,
        `${TEAM_GROUP} stopped recording after ${NEW_GROUP.name} was added: no new fix in ${GROUP_RECORDING_TIMEOUT_MS / 1000} s (DON-330).`)
      const stored = missionFixes(profile, 'Group Refresh Smoke')
      const devicesStored = new Set(stored.map((fix) => Math.floor(fix.sourcePositionId / 1_000_000)))
      const unexpected = [...devicesStored].filter((id) => !kmrtIds.includes(id) && id !== NEW_GROUP_DEVICE.id)
      await app.stop()
      expectProduct(unexpected.length === 0,
        `Adding ${NEW_GROUP.name} also recorded devices that were never added: ${unexpected.join(', ')} (${LATE_GROUP_DEVICE.name} is ${LATE_GROUP_DEVICE.id}) (DON-330).`)
      return `Groups created in Traccar after launch: ${NEW_GROUP.name} listed by mission setup without a restart; both it and ${LATE_GROUP.name} (created mid-mission) listed by Add group; `
        + `adding ${NEW_GROUP.name} enrolled only its device (${NEW_GROUP_DEVICE.name}) while ${TEAM_GROUP} kept recording.`
    },
  },
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
      /** Steps whose evidence is missing: NOT TESTED unless a product finding wins. */
      const notTested = []
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
      await setTeamDefaultGroup(app.page, TEAM_GROUP)
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
        const basemap = await waitForBasemapLabel(app.page, 'Discovery Topo')
        if (!basemap.includes('Discovery Topo')) findings.push(`Discovery was not the map after relaunch: "${basemap}"`)
      }

      // "Enter mission name, set roll back time, Start": the team default
      // group is already ticked, and nothing else [DON-296].
      await t('mission-name-input').fill(MISSION)
      await t('mission-offset-input').fill(String(ROLL_BACK_HOURS))
      const kmrtTicked = await waitUntilChecked(app.page.getByTestId('participant-group-picker')
        .locator('label', { hasText: TEAM_GROUP }).locator('input[type="checkbox"]'), 60_000)
      await app.shot('start-default-group-ticked')
      if (!kmrtTicked) findings.push(`${TEAM_GROUP} was not pre-ticked at Start although it is the team default group`)
      await t('mission-start-btn').click()
      await openMissionSection(app.page, 'participants')
      await t('participant-management').waitFor({ timeout: 20_000 })
      await delay(1500)
      const missionStart = Date.parse(await app.page.evaluate(async () =>
        (await window.sartrackerElectron.missionStore.getActiveMission())?.start_time))
      expectProduct(Number.isFinite(missionStart) && Math.abs(mock.t0 - ROLL_BACK_HOURS * HOUR - missionStart) < 10 * 60_000,
        `Mission start ${new Date(missionStart).toISOString()} is not about ${ROLL_BACK_HOURS} h before now.`)
      await app.shot('started-with-default-group')

      // "Devices for KMRT should display": from the 48 h roll back, untouched.
      const backfill = await waitForBackfill(app.page, BACKFILL_BUDGET_MS)
      expectProduct(backfill.seconds !== null,
        `KMRT history did not complete within ${BACKFILL_BUDGET_MS / 60_000} min: ${JSON.stringify(backfill.statuses).slice(0, 300)}.`)
      notes.push(`KMRT pre-ticked as the team default and started with the ${ROLL_BACK_HOURS} h roll back; history complete in ${backfill.seconds} s`)

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

      // DON-300 item 8: Traccar briefly lists no KMRT devices for one roster.
      // Agreed behaviour: no "left" is recorded; the only notices are "still
      // tracking them until the next roster confirms it", then "devices are
      // back ... nothing changed". Seeing the first proves the blank reached
      // the app. Notices are sampled throughout, so transient ones count too.
      const leftEvents = () => app.page.evaluate(async () => {
        const store = window.sartrackerElectron.missionStore
        const mission = await store.getActiveMission()
        return (await store.listGroupMembershipEvents(mission.id)).filter((event) => event.change === 'left').length
      })
      const visibleNotices = () => t('participant-membership-notice').allInnerTexts().catch(() => [])
      await t('sidebar-tab-tracking').click().catch(() => {})
      const noticesBefore = new Set(await visibleNotices())
      const seenNotices = new Set()
      const leftBefore = await leftEvents()
      mock.blankGroupForOneRoster(groupId)
      const blipStarted = Date.now()
      let settledSamples = 0
      while (settledSamples < 3 && Date.now() - blipStarted < 180_000) {
        await delay(2000)
        for (const notice of await visibleNotices()) if (!noticesBefore.has(notice)) seenNotices.add(notice)
        if (mock.rosterBlip().fullListingsAfter >= 2) settledSamples += 1
      }
      const blip = mock.rosterBlip()
      const leftAfter = await leftEvents()
      const finalNotices = await visibleNotices()
      await app.shot('after-blank-roster')
      const stillTracking = /missing from the tracking server's roster; SAR Tracker is still tracking/u
      const backAgain = /devices are back on the tracking server's roster; nothing changed/u
      const unexpected = [...seenNotices].filter((notice) => !stillTracking.test(notice) && !backAgain.test(notice))
      if (leftAfter !== leftBefore) findings.push(`one blank KMRT roster recorded ${leftAfter - leftBefore} "left" events (DON-300 item 8)`)
      if (unexpected.length > 0) findings.push(`one blank KMRT roster posted unexpected notices: "${unexpected.join(' / ').slice(0, 200)}" (DON-300 item 8)`)
      if (blip.blankListings !== 1 || blip.fullListingsAfter < 2 || ![...seenNotices].some((notice) => stillTracking.test(notice))) {
        notTested.push(`the blank roster did not visibly reach the app within 180 s (${JSON.stringify(blip)}, notices seen: ${[...seenNotices].length}), so the one-blank-roster step proves nothing`)
      } else if (!finalNotices.some((notice) => backAgain.test(notice)) || finalNotices.some((notice) => stillTracking.test(notice))) {
        findings.push(`after the KMRT roster came back, the notices did not say nothing changed: "${finalNotices.join(' / ').slice(0, 200)}" (DON-300 item 8)`)
      }
      await app.page.getByRole('button', { name: 'Acknowledge membership notices' }).click().catch(() => {})

      // Replay must use the same offline Discovery map, not the online default [DON-314].
      if (mapPackage !== undefined) {
        const replay = await replayBasemap(app)
        if (replay.mapId !== 'official_discovery_topo') findings.push(`Replay map is "${replay.mapId}", not Discovery Topo`)
        if (replay.tileFailure !== null) findings.push(`Replay Discovery tiles did not load: "${replay.tileFailure}"`)
      }

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
      if (notTested.length > 0) throw new NotTested(`${notTested.join('; ')}. Other steps passed: ${total} KMRT fixes exact.`)
      return `SAR-QA-025 replay: one blank KMRT roster recorded no "left" and no notice; ${total} KMRT fixes equal the provider from the ${ROLL_BACK_HOURS} h mission start; ${notes.join('; ')}; `
        + `coordinates converted; casualty stored; Focus Mode; OpenTopoMap and satellite selected; tracking "${status.slice(0, 80)}".`
    },
  },
]

/**
 * Opens Review and replays the current time. Returns the Replay map's basemap
 * id and any basemap tile failure, with a screenshot taken before Review closes.
 */
async function replayBasemap(app) {
  const page = app.page
  await page.getByTestId('open-mission-review-workspace').click()
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  await page.getByTestId('mission-replay-seek').click()
  const canvas = page.getByTestId('mission-replay-map-canvas')
  await canvas.waitFor({ timeout: 60_000 })
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="mission-replay-map-canvas"]')?.getAttribute('data-basemap-id'),
  null, { timeout: 15_000 }).catch(() => {})
  await canvas.locator('canvas').first().waitFor({ timeout: 15_000 }).catch(() => {})
  // Tiles come from the local package; give them time to draw or to fail visibly.
  await delay(8000)
  const mapId = await canvas.getAttribute('data-basemap-id')
  const failure = page.getByTestId('mission-replay-map').getByText('Basemap tiles could not be loaded', { exact: false })
  const tileFailure = await failure.first().isVisible().catch(() => false)
    ? await failure.first().innerText()
    : null
  await app.shot('replay-basemap')
  await closeWorkspace(page)
  return { mapId, tileFailure }
}

/** Sets the team default group once in Settings, as the team would at setup [DON-296]. */
async function setTeamDefaultGroup(page, groupName) {
  await page.getByTestId('open-settings-workspace').click()
  await delay(800)
  const field = page.getByTestId('settings-default-participant-group')
  // Groups are listed once the provider roster has been read.
  await page.waitForFunction((name) => [...document.querySelectorAll('[data-testid="settings-default-participant-group"] option')]
    .some((option) => option.textContent === name), groupName, { timeout: 60_000 })
  await field.selectOption({ label: groupName })
  // Save & Close closes Settings only after the save succeeded.
  await page.getByTestId('settings-save').click()
  await page.getByTestId('settings-save').waitFor({ state: 'hidden', timeout: 30_000 })
}

/**
 * Waits for a checkbox to become checked; the group renders before the
 * complete roster that allows the default to be ticked has arrived.
 */
async function waitUntilChecked(checkbox, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await checkbox.isChecked().catch(() => false)) return true
    await delay(500)
  }
  return false
}

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

/**
 * Waits until the stored mission holds a fix from every device `devicesFn`
 * names with fix time after `sinceMs`, or the time is up. A store the app
 * holds busy for a moment is read again.
 */
async function waitForFixes(profile, missionName, devicesFn, sinceMs, timeoutMs) {
  const wanted = devicesFn()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const seen = new Set(missionFixes(profile, missionName)
        .filter((fix) => fix.time > sinceMs).map((fix) => Math.floor(fix.sourcePositionId / 1_000_000)))
      // A group counts as recording once any one of its devices has a new fix; all of KMRT's walkers are not required.
      if (wanted.some((id) => seen.has(id))) return true
    } catch (error) {
      if (!isRetryableStoreRead(error)) throw error
    }
    await delay(5000)
  }
  return false
}
