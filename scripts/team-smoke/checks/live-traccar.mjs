/**
 * Live Traccar: one approved device on the team's real server, GET-only.
 * Starts a mission with a 48 h roll back, adds the approved device after
 * Start with History from Mission start (the team's order, SAR-QA-023), and
 * requires every provider position in the window to be stored exactly.
 * It watches past one 5-minute history sweep, so positions a phone uploaded
 * late (fixTime long before serverTime, DON-305) are due too. A position the
 * server received before the backfill started is always due. One it received
 * during the check but too recently for the sweep to be due is not a PASS:
 * the row is NOT TESTED until a later comparison covers it.
 *
 * Private inputs stay private: the provider address, credentials and device
 * id are read in memory only and never written to results or logs. The
 * provider is only ever read (GET); nothing is sent to it.
 */

import { copyFile, lstat, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parsePrivateTargetSelector } from '../../../build/breadcrumb-live-exact-proof-lib.js'
import { delay, launchApp } from '../lib/app.mjs'
import { openMissionSection } from '../lib/operator.mjs'
import { NotTested, expectProduct } from '../lib/results.mjs'
import { withStore } from '../lib/store.mjs'
import { waitForBackfill } from './team-mission.mjs'

const MISSION = 'Live Traccar Check'
const ROLL_BACK_HOURS = 48
const LIVE_WATCH_MS = 7 * 60_000
const TAIL_TOLERANCE_MS = 2 * 60_000
const HOUR_MS = 3_600_000
// The app re-reads the last 6 h every 5 min, and older history in a newest-
// first pass (about 35 min on a 48 h mission). A late position is due once
// its server time is at least this far in the past.
const RECENT_WINDOW_MS = 6 * HOUR_MS
const RECENT_DUE_MS = 7 * 60_000
const OLDER_DUE_MS = 45 * 60_000

export default [
  {
    check: 'Live Traccar',
    id: 'live-traccar',
    timeoutMs: 30 * 60_000,
    async run(ctx) {
      const { liveConfig, liveSelector } = ctx.options
      if (liveConfig === undefined || liveSelector === undefined) {
        throw new NotTested('Pass --live-config and --live-selector (private; see the release-environment note).')
      }
      const selectorMeta = await lstat(liveSelector)
      const target = parsePrivateTargetSelector(await readFile(liveSelector, 'utf8'), {
        mode: selectorMeta.mode,
        uid: selectorMeta.uid,
        expectedUid: process.getuid?.(),
        isFile: selectorMeta.isFile(),
        isSymbolicLink: selectorMeta.isSymbolicLink(),
      })
      const profile = path.join(ctx.runDir, 'profile')
      await mkdir(profile, { recursive: true, mode: 0o700 })
      for (const name of ['settings.json', 'credentials.json']) {
        await copyFile(path.join(liveConfig, name), path.join(profile, name))
      }

      const app = await launchApp(ctx, { profile, label: 'live-traccar' })
      const t = (id) => app.page.getByTestId(id)
      const config = (await app.page.evaluate(async () =>
        window.sartrackerElectron?.loadRuntimeBootstrapSettings(false)))?.trackingConfig
      if (typeof config?.baseUrl !== 'string' || !config.baseUrl.startsWith('https://')) {
        throw new NotTested('The live profile has no HTTPS provider configured.')
      }
      const authorization = typeof config.token === 'string' && config.token !== ''
        ? `Bearer ${config.token}`
        : `Basic ${Buffer.from(`${config.email}:${config.password}`, 'utf8').toString('base64')}`
      const getJson = async (pathname, params = {}) => {
        const url = new URL(pathname, config.baseUrl)
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: authorization },
          redirect: 'error',
          signal: AbortSignal.timeout(60_000),
        })
        if (!response.ok) throw new Error(`provider GET ${pathname} returned HTTP ${response.status}`)
        return response.json()
      }
      try {
        await getJson('/api/server')
      } catch (error) {
        throw new NotTested(`Live server unreachable from the test box (${error instanceof Error ? error.name : 'error'}).`)
      }

      await t('mission-name-input').fill(MISSION)
      await t('mission-offset-input').fill(String(ROLL_BACK_HOURS))
      await t('mission-start-btn').click()
      await openMissionSection(app.page, 'participants')
      await t('participant-management').waitFor({ timeout: 20_000 })
      await delay(1500)
      await t('participant-add-kind').selectOption('device')
      await delay(300)
      await t('participant-add-ref').selectOption(String(target))
      await t('participant-history-start-mission').check()
      const backfillStartedMs = Date.now()
      await t('participant-add-btn').click()
      const backfill = await waitForBackfill(app.page, 10 * 60_000)
      expectProduct(backfill.seconds !== null, 'Approved device history did not complete within 10 min.')
      await delay(LIVE_WATCH_MS)
      await app.shot('live')

      const missionStart = await app.page.evaluate(async () =>
        (await window.sartrackerElectron.missionStore.getActiveMission())?.start_time)
      const until = new Date(Date.now() - TAIL_TOLERANCE_MS).toISOString()
      const provider = await getJson('/api/positions', { deviceId: String(target), from: missionStart, to: until })
      await app.stop()

      const stored = withStore(profile, (db) => db.prepare(
        'SELECT p.source_position_id AS id, p.lat, p.lon, p.timestamp FROM positions p JOIN missions m ON m.id = p.mission_id WHERE m.name = ? AND p.device_id = ?',
      ).all(MISSION, String(target)))
      const byId = new Map(stored.map((row) => [String(row.id), row]))
      const comparedAt = Date.parse(until) + TAIL_TOLERANCE_MS
      const missing = []
      const differing = []
      let notYetDue = 0
      let lateUploads = 0
      for (const position of provider) {
        const row = byId.get(String(position.id))
        const fixMs = Date.parse(position.fixTime)
        const serverMs = Date.parse(position.serverTime)
        const late = Number.isFinite(serverMs) && serverMs - fixMs > 5 * 60_000
        if (late) lateUploads += 1
        const dueMs = comparedAt - fixMs <= RECENT_WINDOW_MS ? RECENT_DUE_MS : OLDER_DUE_MS
        const arrivedDuringCheck = Number.isFinite(serverMs) && serverMs >= backfillStartedMs
        if (row === undefined && late && arrivedDuringCheck && comparedAt - serverMs < dueMs) notYetDue += 1
        else if (row === undefined) missing.push(position.id)
        else if (Number(row.lat) !== position.latitude || Number(row.lon) !== position.longitude
          || Date.parse(row.timestamp) !== Date.parse(position.fixTime)) differing.push(position.id)
      }
      const early = stored.filter((row) => Date.parse(row.timestamp) < Date.parse(missionStart) - 1000).length
      expectProduct(provider.length > 0, 'The approved device reported no positions in the 48 h window; nothing to compare.')
      const lateNote = `${lateUploads} uploaded late; ${notYetDue} received during the check too recently to be due`
      expectProduct(missing.length === 0 && differing.length === 0 && early === 0,
        `Of ${provider.length} provider positions: ${missing.length} missing, ${differing.length} differ; ${early} stored before mission start (${lateNote}).`)
      if (notYetDue > 0) {
        throw new NotTested(`${provider.length - notYetDue}/${provider.length} provider positions stored exactly; `
          + `${notYetDue} late uploads arrived too recently to be due, so completeness is unproven. Re-run live-traccar.`)
      }
      return `${provider.length}/${provider.length} provider positions for the approved device stored exactly (${lateNote}) `
        + `(48 h roll back, device added after Start with "Mission start", ${LIVE_WATCH_MS / 60_000} min live); provider read with GET only.`
    },
  },
]
