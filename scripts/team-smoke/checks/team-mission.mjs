/**
 * Team mission scenario (1.2a): one mission run the way the team runs it, on a
 * profile that already holds a finished mission, against a provider shaped
 * like a real deployment (about thirty devices in Traccar groups, stationary
 * heartbeats, a stale device, 60 h of history).
 *
 * Every team-reported bug so far needed realistic or carried-over state, while
 * the other rows exercise one subsystem each in a fresh profile at defaults.
 * This row combines them: a 48 h Start Offset; a group and a device ticked
 * before Start; a second group, a late device (Now) and a history-only device
 * (Mission start) added after Start; outings; a casualty marker and a
 * two-stage delete; a search area; timed and untimed GPX; a provider outage;
 * a phone that uploads its buffered hours late (DON-305); a quit and next-day
 * relaunch; replay into the backfilled window; and finish,
 * archive and reopen with the recovery code. Stored fixes are compared with
 * what the provider holds for each device from its own start.
 */

import { realpathSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { delay, launchApp } from '../lib/app.mjs'
import {
  ARCHIVE_PASSPHRASE, archiveMission, bodyText, closeWorkspace, connectProvider, finishMission,
  missionPhase, placeMarker, resumeIfPrompted, startMission,
} from '../lib/operator.mjs'
import { expectProduct } from '../lib/results.mjs'
import { missionFixes, withStore } from '../lib/store.mjs'
import { TEAM_DEVICES, TEAM_GROUPS, startTeamTraccar } from '../lib/team-traccar.mjs'

const HOUR = 3_600_000
const LOOKBACK_HOURS = 48
const BACKFILL_BUDGET_MS = 15 * 60_000
// DON-305: late uploads inside the recent window must be stored within one
// 5-minute anti-entropy tick, plus polling and persistence margin.
const LATE_UPLOAD_BUDGET_MS = 7 * 60_000
const MISSION = 'Team Mission Smoke'

const group = (name) => TEAM_GROUPS.find((entry) => entry.name === name)
const device = (name) => TEAM_DEVICES.find((entry) => entry.name === name)
const members = (groupName) => TEAM_DEVICES.filter((entry) => entry.groupId === group(groupName).id)

/**
 * Verifies stored fixes against the provider for every selected device from
 * its own history start, and that unselected devices are absent.
 *
 * @param {{fixFor: (id: number) => any, fixesBetween: (deviceId: number, from: number, to: number) => any[]}} mock
 * @param {{sourcePositionId: number, lat: number, lon: number, time: number}[]} fixes
 * @param {{starts: Record<number, number>, excluded: number[], until: number, tailToleranceMs?: number}} options
 * @returns {Record<number, {stored: number, expected: number}>}
 */
export function verifyTeamFixes(mock, fixes, { starts, excluded, until, tailToleranceMs = 90_000 }) {
  const deviceOf = (fix) => Math.floor(fix.sourcePositionId / 1_000_000)
  const differing = fixes.filter((fix) => {
    const served = mock.fixFor(fix.sourcePositionId)
    return served === null || served.latitude !== fix.lat || served.longitude !== fix.lon || Date.parse(served.fixTime) !== fix.time
  })
  expectProduct(differing.length === 0,
    `${differing.length}/${fixes.length} stored fixes differ from the provider (e.g. ${differing.slice(0, 3).map((fix) => fix.sourcePositionId).join(', ')}).`)
  const leaked = fixes.filter((fix) => excluded.includes(deviceOf(fix)))
  expectProduct(leaked.length === 0, `${leaked.length} fixes stored for devices that were never selected.`)
  const early = fixes.filter((fix) => starts[deviceOf(fix)] !== undefined && fix.time < starts[deviceOf(fix)])
  expectProduct(early.length === 0, `${early.length} stored fixes predate their device's history start.`)
  const perDevice = {}
  const gaps = []
  for (const [id, from] of Object.entries(starts)) {
    const stored = new Set(fixes.filter((fix) => deviceOf(fix) === Number(id)).map((fix) => fix.sourcePositionId))
    const expected = mock.fixesBetween(Number(id), from, until - tailToleranceMs)
    const missing = expected.filter((fix) => !stored.has(fix.id))
    if (missing.length > 0) gaps.push(`device ${id}: ${missing.length}/${expected.length} missing (first ${missing[0].fixTime})`)
    perDevice[id] = { stored: stored.size, expected: expected.length }
  }
  expectProduct(gaps.length === 0, `Provider fixes missing: ${gaps.slice(0, 5).join('; ')}.`)
  return perDevice
}

/** Writes a timed track and an untimed route (static evidence) into the app-owned inbox. */
async function writeGpxFiles(inbox) {
  await mkdir(inbox, { recursive: true })
  const start = Date.now() - 3 * HOUR
  const timed = Array.from({ length: 40 }, (_, index) =>
    `<trkpt lat="${(51.97 + index * 0.0002).toFixed(6)}" lon="${(-9.71 + index * 0.0002).toFixed(6)}">`
      + `<time>${new Date(start + index * 60_000).toISOString()}</time></trkpt>`)
  const untimed = Array.from({ length: 25 }, (_, index) =>
    `<trkpt lat="${(51.98 - index * 0.0002).toFixed(6)}" lon="${(-9.73 + index * 0.0003).toFixed(6)}"></trkpt>`)
  const timedFile = path.join(inbox, 'visiting-team-track.gpx')
  const untimedFile = path.join(inbox, 'planned-route-no-times.gpx')
  await writeFile(timedFile, `<?xml version="1.0"?><gpx version="1.1" creator="team-smoke"><trk><name>Visiting team track</name><trkseg>${timed.join('')}</trkseg></trk></gpx>`)
  await writeFile(untimedFile, `<?xml version="1.0"?><gpx version="1.1" creator="team-smoke"><trk><name>Planned route</name><trkseg>${untimed.join('')}</trkseg></trk></gpx>`)
  return [timedFile, untimedFile]
}

/** Reads the visible tracking health text. */
export async function trackingStatus(page) {
  const parts = []
  for (const id of ['tracking-warning', 'mast-tracking-cell', 'persistent-tracking-health', 'stationary-attention-summary']) {
    const locator = page.getByTestId(id)
    if (await locator.count() > 0) parts.push(await locator.first().innerText().catch(() => ''))
  }
  return parts.join(' / ').replace(/\s+/gu, ' ').trim()
}

/** Adds a participant during the mission with an explicit history choice. */
export async function addAfterStart(page, kind, label, historyFrom) {
  const t = (id) => page.getByTestId(id)
  await t('participant-add-kind').selectOption(kind)
  await delay(300)
  await t('participant-add-ref').selectOption({ label })
  await t(`participant-history-start-${historyFrom}`).check()
  await t('participant-add-btn').click()
  await delay(1500)
}

/** Waits until every participant row reports its history complete. */
export async function waitForBackfill(page, budgetMs) {
  const started = Date.now()
  let statuses = []
  while (Date.now() - started < budgetMs) {
    statuses = await page.getByTestId('participant-backfill-status').allInnerTexts()
    if (statuses.length > 0 && statuses.every((status) => /complete|no earlier history requested/i.test(status))) {
      return { seconds: Math.round((Date.now() - started) / 1000), statuses }
    }
    await delay(10_000)
  }
  return { seconds: null, statuses }
}

/** Draws a three-point search area and saves it with a name. */
async function drawSearchArea(page, name) {
  const canvas = page.locator('.maplibregl-canvas').first()
  await page.getByTestId('drawing-toolbar-expand').click().catch(() => {})
  await page.getByTestId('drawing-tool-search_area').click({ force: true })
  for (const position of [{ x: 440, y: 220 }, { x: 620, y: 220 }, { x: 540, y: 360 }]) {
    await canvas.click({ position, force: true })
    await delay(300)
  }
  await canvas.click({ position: { x: 540, y: 360 }, button: 'right', force: true })
  await page.getByTestId('drawing-dialog').waitFor({ timeout: 10_000 })
  await page.getByTestId('drawing-name-input').fill(name)
  await page.getByTestId('drawing-save-btn').click()
  await delay(1500)
  await page.getByTestId('drawing-toolbar-collapse').click().catch(() => {})
  await delay(500)
}

/** Places a casualty marker, first confirming save is blocked until required fields are set. */
export async function placeCasualty(page, { name, x, y }) {
  const t = (id) => page.getByTestId(id)
  await page.locator('.maplibregl-canvas').first().click({ position: { x, y }, force: true })
  await t('marker-dialog').waitFor({ timeout: 10_000 })
  await t('marker-dialog').getByText('Casualty', { exact: true }).click()
  await t('marker-name-input').fill(name)
  const blocked = await t('marker-save-btn').isDisabled()
  await t('marker-condition-input').selectOption('Medical Emergency')
  await t('marker-evacuation-priority-input').selectOption('Urgent')
  await t('marker-save-btn').click()
  await delay(2000)
  return blocked
}

/** Opens the marker at a point and deletes it through the two-stage confirmation. */
async function deleteMarkerAt(page, { x, y }) {
  const t = (id) => page.getByTestId(id)
  await page.locator('.maplibregl-canvas').first().click({ position: { x, y }, force: true })
  await t('marker-dialog').waitFor({ timeout: 10_000 })
  await t('marker-delete-btn').click()
  const confirmationShown = await t('marker-delete-confirmation').isVisible()
  await t('marker-delete-keep-btn').click()
  const keptOpen = await t('marker-dialog').isVisible()
  await t('marker-delete-btn').click()
  await t('marker-delete-confirm-btn').click()
  await delay(1500)
  return { confirmationShown, keptOpen }
}

/** Starts, then ends, an outing with a label. */
async function startOuting(page, label) {
  await page.getByTestId('outing-label-input').fill(label)
  await page.getByTestId('outing-start-btn').click()
  await delay(1500)
}

/** Formats a time for a datetime-local input in the machine's zone. */
function localInput(time) {
  const when = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`
}

export default [
  {
    check: 'Team mission scenario',
    id: 'team-mission',
    timeoutMs: 45 * 60_000,
    manualSteps: ['Inspect the scenario screenshots: tracks for both groups on the map, stationary and stale indicators, casualty marker and search area visible.'],
    async run(ctx) {
      const findings = []
      const notes = []
      const mock = await startTeamTraccar()
      ctx.cleanups.push(() => mock.close())
      // A walker's phone lost signal 5 h to 1 h ago and has not uploaded that
      // stretch yet, so the backfill cannot see it (DON-305).
      const lateWalker = members('KMRT Hasty').filter((entry) => entry.kind === 'walk')[1]
      const heldIds = mock.holdBack(lateWalker.id, mock.t0 - 5 * HOUR, mock.t0 - HOUR)
      const profile = path.join(ctx.runDir, 'profile')
      const [timedGpx, untimedGpx] = await writeGpxFiles(path.join(profile, 'gpx-inbox'))

      // A lived-in profile: yesterday's training mission, finished.
      let app = await launchApp(ctx, { profile, label: 'team-1-previous-mission' })
      await connectProvider(app.page, mock.url)
      await startMission(app.page, 'Yesterday Training', [])
      await placeMarker(app.page, { name: 'Training IPP', x: 500, y: 300 })
      await finishMission(app.page)
      await delay(2000)

      // Start 48 h back with a group and one device ticked before Start.
      const t = (id) => app.page.getByTestId(id)
      await t('mission-name-input').fill(MISSION)
      await t('mission-offset-input').fill(String(LOOKBACK_HOURS))
      await t('participant-group-picker').getByText('KMRT Hasty', { exact: true }).click()
      await t('participant-device-picker').getByText('Dog Handler', { exact: true }).click()
      await t('mission-start-btn').click()
      await t('participant-management').waitFor({ timeout: 20_000 })
      await delay(1500)
      const missionStart = Date.parse(await app.page.evaluate(async () =>
        (await window.sartrackerElectron.missionStore.getActiveMission())?.start_time))
      expectProduct(Number.isFinite(missionStart) && Math.abs(mock.t0 - LOOKBACK_HOURS * HOUR - missionStart) < 10 * 60_000,
        `Mission start ${new Date(missionStart).toISOString()} is not about ${LOOKBACK_HOURS} h before now.`)

      // After Start: a second group and a history-only device from mission start; a late joiner from now.
      await addAfterStart(app.page, 'group', 'KMRT Search', 'mission')
      await addAfterStart(app.page, 'device', 'Drone Operator', 'mission')
      const lateFrom = Date.now()
      await addAfterStart(app.page, 'device', 'Late Joiner', 'now')

      const backfill = await waitForBackfill(app.page, BACKFILL_BUDGET_MS)
      await app.shot('backfill')
      expectProduct(backfill.seconds !== null,
        `Participant history did not complete within ${BACKFILL_BUDGET_MS / 60_000} min: ${JSON.stringify(backfill.statuses).slice(0, 300)}.`)
      notes.push(`backfill of ${backfill.statuses.length} participant rows complete in ${backfill.seconds} s`)
      const lateStatus = backfill.statuses.find((status) => /no earlier history requested/i.test(status))
      if (lateStatus === undefined) findings.push('the late "Now" participant did not say no earlier history was requested')

      // The phone regains signal and uploads the buffered stretch in one burst.
      // Checked before the quit below, while the rest of the scenario runs.
      const heldStored = () => {
        const stored = new Set(missionFixes(profile, MISSION).map((fix) => fix.sourcePositionId))
        return heldIds.filter((id) => stored.has(id)).length
      }
      expectProduct(heldStored() === 0, `${heldStored()} held-back fixes were stored before the phone uploaded them; the late-upload phase proves nothing.`)
      const lateUploadedAt = mock.releaseHeld()
      // Observe recovery on its own clock while the scenario continues, so the
      // deadline is measured from when the burst is complete, not when checked.
      let lateCompleteAt = null
      const lateWatch = setInterval(() => {
        try {
          if (lateCompleteAt === null && heldStored() === heldIds.length) lateCompleteAt = Date.now()
        } catch { /* store busy; the next sample retries */ }
      }, 5_000)
      ctx.cleanups.push(async () => clearInterval(lateWatch))

      // Safety indicators with realistic state.
      await delay(20_000)
      const status = await trackingStatus(app.page)
      await app.shot('indicators')
      if (!/stationary attention/i.test(status)) findings.push(`no stationary attention for devices still for hours: "${status.slice(0, 160)}"`)
      if (!/stale/i.test(status)) findings.push(`no stale warning for a device silent 70 min: "${status.slice(0, 160)}"`)
      // DON-307: Minimize must work while yesterday's finished mission awaits Archive & Lock.
      await t('mission-control-collapse-btn').click()
      await delay(800)
      const minimizedShown = await t('command-mast-mission-control-minimized').isVisible().catch(() => false)
      const dockHidden = !(await t('mission-control-dock').isVisible().catch(() => false))
      if (!minimizedShown || !dockHidden) findings.push('Minimize did nothing while an earlier finished mission awaited Archive & Lock (DON-307)')
      await t('compact-mission-restore').click().catch(() => {})
      await delay(800)
      await t('open-devices-workspace').click()
      await delay(1500)
      const deviceList = await t('device-list-scroll').innerText()
      await app.shot('devices')
      // DON-295: nothing in Devices may narrow the mission. Hide one participant
      // across several polls as an operator would: it and the others must keep
      // recording while hidden, and the exact comparison at the end must hold.
      const narrowing = await app.page.locator('[data-testid^="device-active-toggle-"], [data-testid="device-filter-active"]').count()
      if (narrowing > 0) findings.push(`Devices still offers ${narrowing} control(s) that narrow the mission participants (DON-295)`)
      const dog = String(device('Dog Handler').id)
      const walker = String(members('KMRT Hasty').find((entry) => entry.kind === 'walk').id)
      const storedCounts = () => withStore(profile, (db) => Object.fromEntries(db.prepare(
        'SELECT p.device_id AS id, count(*) AS n FROM positions p JOIN missions m ON m.id = p.mission_id WHERE m.name = ? GROUP BY p.device_id',
      ).all(MISSION).map((row) => [String(row.id), Number(row.n)])))
      await t(`device-visibility-${dog}`).click()
      const hiddenFrom = storedCounts()
      await delay(70_000) // several live polls (walkers report every 20 s)
      const hiddenTo = storedCounts()
      await t(`device-visibility-${dog}`).click()
      await delay(500)
      for (const [label, id] of [['hidden Dog Handler', dog], ['KMRT Hasty walker', walker]]) {
        if (!((hiddenTo[id] ?? 0) > (hiddenFrom[id] ?? 0))) {
          findings.push(`${label} stored no new fixes while a device was hidden in Devices (${hiddenFrom[id] ?? 0} → ${hiddenTo[id] ?? 0}; DON-295)`)
        }
      }
      await closeWorkspace(app.page)
      for (const selected of [...members('KMRT Hasty'), ...members('KMRT Search'), device('Dog Handler'), device('Drone Operator'), device('Late Joiner')]) {
        if (!deviceList.includes(selected.name)) findings.push(`${selected.name} missing from the device list`)
      }
      for (const unselected of [...members('Visiting Team'), ...members('Unselected Team')]) {
        if (deviceList.includes(unselected.name)) findings.push(`unselected ${unselected.name} shown in the device list`)
      }

      // Outing 1: casualty marker, search area, other teams' GPX.
      await startOuting(app.page, 'Day 1 hasty search')
      const casualtyBlocked = await placeCasualty(app.page, { name: 'Casualty Subject', x: 700, y: 420 })
      if (!casualtyBlocked) findings.push('casualty marker could be saved before its required fields were set')
      await placeMarker(app.page, { name: 'Glove found', x: 360, y: 460, type: 'clue' })
      await drawSearchArea(app.page, 'Sector A1')
      const imported = await app.page.evaluate(async (paths) => {
        const store = window.sartrackerElectron.missionStore
        const mission = await store.getActiveMission()
        return store.importGpxEvidencePaths({ missionId: mission.id, paths })
      }, [timedGpx, untimedGpx])
      if (imported?.imports?.length !== 2 || imported?.failures?.length !== 0) {
        findings.push(`GPX import of a timed and an untimed file returned ${JSON.stringify(imported).slice(0, 200)}`)
      }
      // DON-306/309: retire a track; a renamed copy imports as a new track;
      // re-importing the same file deliberately brings the same track back,
      // and Replay keeps it hidden for the time it was retired.
      const retireTarget = imported?.imports?.[0]?.id
      expectProduct(typeof retireTarget === 'string',
        `GPX import returned no track to retire, so the DON-306/309 restore step cannot run: ${JSON.stringify(imported).slice(0, 200)}`)
      const copyGpx = timedGpx.replace(/\.gpx$/u, ' (copy).gpx')
      await copyFile(timedGpx, copyGpx)
      const reimport = await app.page.evaluate(async ({ importId, path: sourcePath, copy }) => {
        const store = window.sartrackerElectron.missionStore
        const mission = await store.getActiveMission()
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        // GPX only: a device filter naming no device drops every Traccar fix
        // (GPX is filtered by outing), so thousands of older fixes cannot push
        // the track past the first page; later pages are followed anyway.
        const shows = async (at) => {
          const query = {
            missionId: mission.id, selectedTime: new Date(at).toISOString(), timezone: 'Europe/Dublin',
            trackLimit: 500, objectLimit: 100, deviceIds: ['smoke-no-such-device'],
          }
          let page = await store.readMissionReplay(query, `smoke-don-309-${at}`)
          const matches = (rows) => (rows ?? []).some((row) => row.track_id === importId && row.source_type === 'gpx_point')
          let found = matches(page.tracks)
          for (let pages = 1; !found && page.nextCursor !== null && pages < 20; pages += 1) {
            page = await store.readMissionReplayTrackChunk({ ...query, cursor: page.nextCursor }, `smoke-don-309-${at}-${pages}`)
            found = matches(page.tracks)
          }
          if (!found && page.nextCursor !== null) throw new Error('Replay still had pages after 20; the DON-309 step cannot decide.')
          return found
        }
        const beforeRetire = Date.now()
        await pause(3000)
        await store.deleteGpxImport(importId)
        const copied = await store.importGpxEvidencePaths({ missionId: mission.id, paths: [copy] })
        await pause(3000)
        const insideGap = Date.now()
        await pause(3000)
        const again = await store.importGpxEvidencePaths({ missionId: mission.id, paths: [sourcePath] })
        await pause(3000)
        const afterRestore = Date.now()
        return {
          copied, again,
          replay: { beforeRetire: await shows(beforeRetire), insideGap: await shows(insideGap), afterRestore: await shows(afterRestore) },
        }
      }, { importId: retireTarget, path: timedGpx, copy: copyGpx })
      if (reimport.copied?.imports?.length !== 1 || reimport.copied?.failures?.length !== 0
        || reimport.copied?.imports?.[0]?.id === retireTarget) {
        findings.push(`a renamed copy of a retired GPX file did not import as a new track (DON-306): ${JSON.stringify(reimport.copied).slice(0, 200)}`)
      }
      if (reimport.again?.imports?.length !== 1 || reimport.again?.failures?.length !== 0
        || reimport.again?.imports?.[0]?.id !== retireTarget) {
        findings.push(`re-importing a retired GPX file did not bring the same track back (DON-309): ${JSON.stringify(reimport.again).slice(0, 200)}`)
      }
      const { beforeRetire, insideGap, afterRestore } = reimport.replay
      if (!beforeRetire || insideGap || !afterRestore) {
        findings.push(`Replay of a restored GPX track was not truthful (DON-309): shown before retirement ${beforeRetire}, `
          + `while retired ${insideGap} (expected false), after restore ${afterRestore}`)
      }
      // DON-320: the team keeps GPX files in a watched folder. Two rescans that
      // meet the unchanged retired file must add no import issue, and a
      // watched scan never restores it (DON-309). The call is the one the
      // Rescan Watches control makes; adding the folder needs the native picker.
      const rescans = await app.page.evaluate(async ({ paths, importId }) => {
        const store = window.sartrackerElectron.missionStore
        const mission = await store.getActiveMission()
        await store.deleteGpxImport(importId)
        const issueCount = async () =>
          (await store.listGpxImportIssues({ missionId: mission.id, limit: 100 })).entries.length
        const before = await issueCount()
        const results = []
        for (let pass = 0; pass < 2; pass += 1) {
          results.push(await store.importGpxEvidencePaths({
            missionId: mission.id, paths, skipRetiredSources: true,
          }))
        }
        return { before, after: await issueCount(), results }
      }, { paths: [timedGpx, untimedGpx, copyGpx], importId: retireTarget })
      if (rescans.after !== rescans.before || rescans.results.some((result) => (result?.failures?.length ?? 0) !== 0)) {
        findings.push(`watched-folder rescans of a retired GPX file added import issues (${rescans.before} → ${rescans.after}; DON-320): ${JSON.stringify(rescans.results).slice(0, 200)}`)
      }
      // Persisted state, not only the returned ids: the track stays retired
      // and nothing active stands in for its file.
      const afterRescans = withStore(profile, (db) => ({
        target: db.prepare('SELECT retired_at FROM gpx_track_imports WHERE id = ?').get(retireTarget),
        activeForFile: db.prepare(`SELECT COUNT(*) AS count FROM gpx_track_imports
          WHERE retired_at IS NULL AND id != ? AND source_path IN (?, ?)`).get(retireTarget, timedGpx, realpathSync(timedGpx)).count,
      }))
      if (rescans.results.some((result) => (result?.imports ?? []).some((entry) => entry?.id === retireTarget))
        || afterRescans.target?.retired_at == null || afterRescans.activeForFile !== 0) {
        findings.push(`a watched-folder rescan restored or replaced a retired GPX track; only a deliberate import may (DON-309): ${JSON.stringify(afterRescans)}`)
      }
      // DON-322: a malformed (non-retired) GPX in the watched folder reports
      // once, not on every rescan.
      const malformedGpx = timedGpx.replace(/\.gpx$/u, ' (malformed).gpx')
      await writeFile(malformedGpx, '<gpx version="1.1"><trk><trkseg><trkpt lat="51.9"', 'utf8')
      const malformedRescans = await app.page.evaluate(async (paths) => {
        const store = window.sartrackerElectron.missionStore
        const mission = await store.getActiveMission()
        const issueCount = async () =>
          (await store.listGpxImportIssues({ missionId: mission.id, limit: 100 })).entries.length
        const before = await issueCount()
        for (let pass = 0; pass < 2; pass += 1) {
          await store.importGpxEvidencePaths({ missionId: mission.id, paths, skipRetiredSources: true })
        }
        return { before, after: await issueCount() }
      }, [malformedGpx])
      if (malformedRescans.after !== malformedRescans.before + 1) {
        findings.push(`two watched-folder rescans of one malformed GPX file added ${malformedRescans.after - malformedRescans.before} import issues, not 1 (DON-322)`)
      }

      // Provider outage: visible, then backfilled.
      const beforeOutage = await trackingStatus(app.page)
      mock.setOffline(true)
      let outageShown = ''
      const outageStarted = Date.now()
      while (Date.now() - outageStarted < 60_000) {
        await delay(5000)
        const during = await trackingStatus(app.page)
        if (outageShown === '' && during !== beforeOutage && /unreachable|offline|error|retry|fail|lost|degraded|disconnect/i.test(during)) {
          outageShown = during
          await app.shot('outage')
        }
      }
      mock.setOffline(false)
      if (outageShown === '') findings.push('no visible warning during a 60 s provider outage')
      await delay(40_000)
      await t('outing-end-btn').click()
      await delay(1500)

      // DON-305: every late-uploaded fix is stored within one sweep tick.
      while (lateCompleteAt === null && Date.now() - lateUploadedAt < LATE_UPLOAD_BUDGET_MS) await delay(5_000)
      clearInterval(lateWatch)
      const lateStoredCount = heldStored()
      const lateSeconds = lateCompleteAt === null ? null : Math.round((lateCompleteAt - lateUploadedAt) / 1000)
      expectProduct(lateCompleteAt !== null && lateCompleteAt - lateUploadedAt <= LATE_UPLOAD_BUDGET_MS,
        `${heldIds.length - lateStoredCount}/${heldIds.length} fixes that ${lateWalker.name}'s phone uploaded late (fix times 5 h to 1 h old) `
          + `were not all stored within ${LATE_UPLOAD_BUDGET_MS / 60_000} min (complete after ${lateSeconds ?? 'never'} s; DON-305).`)
      notes.push(`${heldIds.length} late-uploaded fixes (5 h to 1 h old) all stored ${lateSeconds} s after upload (sampled every 5 s)`)

      // Overnight: quit, stay closed, relaunch next day and resume.
      await app.stop('SIGTERM')
      await delay(90_000)
      app = await launchApp(ctx, { profile, label: 'team-2-next-day' })
      const resumed = await resumeIfPrompted(app.page, 20_000)
      const phaseNextDay = await missionPhase(app.page)
      expectProduct(phaseNextDay === 'ACTIVE', `Mission was ${phaseNextDay} after the next-day relaunch (recovery prompt ${resumed ? 'accepted' : 'not shown'}).`)
      await startOuting(app.page, 'Day 2 line search')
      await delay(45_000)

      // Map Tools after a relaunch on a lived-in catalog (DON-118): Measure must work.
      const canvas = app.page.locator('.maplibregl-canvas').first()
      await app.page.getByTestId('drawing-toolbar-expand').click().catch(() => {})
      await app.page.getByTestId('drawing-tool-measure').click({ force: true })
      await canvas.click({ position: { x: 680, y: 240 }, force: true })
      await delay(400)
      await canvas.click({ position: { x: 820, y: 300 }, force: true })
      await delay(1500)
      const measured = (await app.page.getByTestId('measurement-count').innerText().catch(() => '0')).trim()
      await app.shot('measure-after-relaunch')
      if (measured !== '1') findings.push(`Measure after relaunch recorded ${measured} measurements, expected 1`)
      await app.page.getByTestId('drawing-toolbar-collapse').click().catch(() => {})
      await delay(500)

      // Two-stage delete of the clue.
      const deletion = await deleteMarkerAt(app.page, { x: 360, y: 460 })
      if (!deletion.confirmationShown || !deletion.keptOpen) findings.push('marker delete did not require a second confirmation, or Keep did not keep it')

      // Replay into the backfilled window (24 h after mission start).
      await app.page.getByTestId('open-mission-review-workspace').click()
      await delay(1500)
      await app.page.getByRole('button', { name: 'Replay', exact: true }).click()
      await delay(1500)
      await app.page.getByTestId('mission-replay-time').fill(localInput(missionStart + 24 * HOUR))
      await app.page.getByTestId('mission-replay-seek').click()
      await delay(8000)
      const replayState = (await app.page.getByTestId('mission-replay-reconstructed-state').innerText().catch(() => '')).replace(/\s+/gu, ' ')
      const replayError = await app.page.getByTestId('mission-replay-error').innerText().catch(() => null)
      const replayRecords = /(\d+) \/ (\d+) selected-time records read/u.exec(await bodyText(app.page))
      await app.shot('replay-day-1')
      await app.page.getByTestId('mission-replay-return-live').click().catch(() => {})
      await delay(1000)
      await closeWorkspace(app.page)
      if (replayError !== null || replayState === '') findings.push(`replay 24 h into the backfilled window failed: ${replayError ?? 'empty state'}`)
      // Replay folds evidence at max(fixTime, recorded_at), so history fetched by
      // the lookback backfill is not "known" at earlier replay times. Whether the
      // team expects tracks there is an open question (DON-293); report the count.
      notes.push(`replay at start+24 h read ${replayRecords === null ? 'an unknown number of' : replayRecords[2]} records (open question DON-293)`)

      await t('outing-end-btn').click()
      await delay(1500)
      const until = Date.now()
      await app.shot('before-finish')

      // Exactness for every selected device from its own start; nothing for unselected devices.
      const starts = Object.fromEntries([
        ...members('KMRT Hasty'), ...members('KMRT Search'), device('Dog Handler'), device('Drone Operator'),
      ].map((entry) => [entry.id, missionStart]))
      starts[device('Late Joiner').id] = lateFrom + 5000
      const fixes = missionFixes(profile, MISSION)
      const perDevice = verifyTeamFixes(mock, fixes, {
        starts,
        excluded: [...members('Visiting Team'), ...members('Unselected Team')].map((entry) => entry.id),
        until,
      })
      const lateEarly = fixes.filter((fix) => Math.floor(fix.sourcePositionId / 1_000_000) === device('Late Joiner').id
        && fix.time < lateFrom - 5000)
      if (lateEarly.length > 0) findings.push(`${lateEarly.length} Late Joiner fixes from before it was added with "Now"`)

      // Finish, archive, relaunch and reopen with the recovery code.
      await finishMission(app.page)
      const governanceSelect = t('mission-governance-select')
      const governanceName = ((await governanceSelect.count()) > 0
        ? await governanceSelect.locator('option:checked').innerText()
        : await t('mission-governance-card').innerText().catch(() => '')).replace(/\s+/gu, ' ')
      expectProduct(governanceName.includes(MISSION),
        `Archive & Lock offered a different mission after finishing "${MISSION}": "${governanceName.slice(0, 120)}" (DON-294).`)
      let recoveryCode = ''
      await t('mission-finalize-btn').click()
      await delay(800)
      await t('archive-passphrase').fill(ARCHIVE_PASSPHRASE)
      await t('archive-passphrase-confirmation').fill(ARCHIVE_PASSPHRASE)
      await t('archive-issue-recovery-code').click()
      await delay(500)
      recoveryCode = (await t('archive-recovery-code').innerText()).trim()
      await t('archive-recovery-code-confirmation').fill(recoveryCode)
      await t('archive-finalize').click()
      const archived = await app.page.getByText(/Mission archived to/).first()
        .waitFor({ timeout: 180_000 }).then(() => true, () => false)
      await app.shot('archived')
      expectProduct(archived, `Archive did not complete: ${(await bodyText(app.page)).slice(0, 200)}`)
      await app.stop()
      // The archive row button shows only the archive label; the mission name is
      // on its enclosing entry. Select the row by the archive id in the store.
      const archiveId = withStore(profile, (db) => db.prepare(
        'SELECT a.id FROM mission_archives a JOIN missions m ON m.id = a.mission_id WHERE m.name = ? ORDER BY a.rowid DESC LIMIT 1',
      ).get(MISSION)?.id)
      expectProduct(archiveId !== undefined, `No archive row was stored for "${MISSION}".`)
      app = await launchApp(ctx, { profile, label: 'team-3-reopen' })
      await app.page.getByTestId('open-mission-review-workspace').click()
      await delay(1500)
      await app.page.getByTestId(`archive-review-select-${archiveId}`).click({ timeout: 15_000 })
      await app.page.getByTestId('archive-review-slot-recovery').click()
      await app.page.getByTestId('archive-review-secret').fill(recoveryCode)
      await app.page.getByTestId('archive-review-open').click()
      const reopened = await app.page.getByTestId('mission-review-archive-banner')
        .waitFor({ timeout: 90_000 }).then(() => true, () => false)
      await app.shot('reopened-with-recovery-code')
      await app.stop()
      if (!reopened) findings.push('the archive did not reopen with its recovery code')

      const statuses = withStore(profile, (db) => Object.fromEntries(db.prepare('SELECT name, status FROM missions').all().map((row) => [row.name, row.status])))
      if (statuses[MISSION] !== 'finalized' || statuses['Yesterday Training'] !== 'finished') {
        findings.push(`archive locked the wrong mission: ${JSON.stringify(statuses)}`)
      }
      const drawings = withStore(profile, (db) => db.prepare('SELECT name FROM drawings').all().map((row) => row.name))
      if (!drawings.includes('Sector A1')) findings.push('search area Sector A1 was not stored')
      const summary = `${fixes.length} fixes across ${Object.keys(perDevice).length} selected devices equal the provider from each device's start `
        + `(48 h lookback; group + device before Start; group, history-only device and late "Now" device after Start); `
        + `unselected groups absent; ${notes.join('; ')}; overnight quit and next-day resume; outage shown "${outageShown.slice(0, 80)}"`
      expectProduct(findings.length === 0, `${findings.join('; ')}. Data: ${summary}.`)
      return `${summary}; Measure works after relaunch; stationary and stale indicators shown; casualty required fields enforced; two-stage delete; `
        + 'search area, timed and untimed GPX stored; replay into the backfilled window; archive reopened with the recovery code.'
    },
  },
]
