/**
 * Tracking truth: with a real-time mock provider, every stored fix equals what
 * the provider served, the mission survives every interruption gap-free, and a
 * provider outage is visible and backfilled. The tracking row also starts a
 * mission with a 48 h lookback against known provider history (DON-291); it
 * cannot pass unless both parts ran.
 */

import path from 'node:path'

import { delay, launchApp } from '../lib/app.mjs'
import { LOOKBACK_HOURS, startHistoryTraccar } from '../lib/history-traccar.mjs'
import { startMockTraccar } from '../lib/mock-traccar.mjs'
import {
  addParticipantAfterStart, bodyText, closeWorkspace, connectProvider, missionPhase, resumeIfPrompted,
  startMission, startMissionWithLookback, togglePause,
} from '../lib/operator.mjs'
import { expectProduct } from '../lib/results.mjs'
import { missionFixes } from '../lib/store.mjs'

const WALKERS = ['Walker Alpha', 'Walker Bravo']
const PARTICIPANTS = [...WALKERS, 'Stationary Charlie']

/**
 * Compares stored fixes with the provider and, for walking devices, requires
 * contiguous indices ending close to the provider's latest fix.
 *
 * @returns {{fixes: number, perDevice: Record<number, {first: number, last: number, missing: number[]}>}}
 */
export function verifyFixes(mock, fixes, { firstExpectedIndex, firstExpectedByDevice = { 1: firstExpectedIndex, 2: firstExpectedIndex }, requireRecentWithin = 4, preservedFixes = [] } = {}) {
  if ([1, 2].some((device) => !Number.isSafeInteger(firstExpectedByDevice[device]) || firstExpectedByDevice[device] < 0)) {
    throw new Error('An independently captured expected first fix index is required.')
  }
  const mismatches = []
  const byDevice = new Map()
  for (const fix of fixes) {
    const served = mock.fixFor(fix.sourcePositionId)
    if (served === null || served.latitude !== fix.lat || served.longitude !== fix.lon
      || Date.parse(served.fixTime) !== fix.time) {
      mismatches.push(fix.sourcePositionId)
    }
    const device = Math.floor(fix.sourcePositionId / 1_000_000)
    byDevice.set(device, [...(byDevice.get(device) ?? []), fix.sourcePositionId % 1_000_000])
  }
  expectProduct(mismatches.length === 0,
    `${mismatches.length}/${fixes.length} stored fixes differ from the provider (e.g. ${mismatches.slice(0, 3).join(', ')}).`)
  const retained = new Map(fixes.map((fix) => [fix.sourcePositionId, fix]))
  expectProduct(preservedFixes.every((fix) => {
    const after = retained.get(fix.sourcePositionId)
    return after !== undefined && after.lat === fix.lat && after.lon === fix.lon && after.time === fix.time
  }), 'Previously stored fixes were lost or changed across the interruption.')
  const perDevice = {}
  for (const device of [1, 2]) {
    const expectedFirst = firstExpectedByDevice[device]
    const indices = [...new Set(byDevice.get(device) ?? [])].sort((a, b) => a - b)
    expectProduct(indices.length > 0, `No fixes stored for walking device ${device}.`)
    const first = indices[0]
    const last = indices[indices.length - 1]
    const present = new Set(indices)
    const missing = []
    for (let index = expectedFirst; index <= last; index += 1) if (!present.has(index)) missing.push(index)
    expectProduct(missing.length === 0, `Device ${device} has ${missing.length} missing fixes between expected ${expectedFirst} and ${last}.`)
    expectProduct(last >= expectedFirst, `Device ${device} has no eligible mission fixes.`)
    expectProduct(mock.latestIndex() - last <= requireRecentWithin,
      `Device ${device} stopped at fix ${last}; provider is at ${mock.latestIndex()}.`)
    perDevice[device] = { expectedFirst, first, last, missing }
  }
  return { fixes: fixes.length, perDevice }
}

/** Captures eligibility from setup records, never from the surviving fix rows. */
export function participantFirstIndices(mock, missionStart, participants) {
  return Object.fromEntries([1, 2].map((device) => {
    const participant = participants.find((entry) => entry.kind === 'device'
      && entry.traccar_device_id === String(device) && entry.removed_at === null)
    const from = Math.max(Date.parse(missionStart), Date.parse(participant?.effective_from))
    if (!Number.isFinite(from)) throw new Error(`Missing or invalid participant start for walker ${device}.`)
    return [device, mock.firstIndexAtOrAfter(from)]
  }))
}

/**
 * Verifies a lookback mission's stored fixes against the history provider:
 * every row equals a provider fix, nothing predates mission start (checked to
 * the second inside the provider's dense boundary band), unselected devices
 * are absent, and every provider fix from mission start until shortly before
 * the app stopped is present for each expected device.
 *
 * @param {{denseBand: {from: number, to: number}, fixFor: (id: number) => any, fixesBetween: (deviceId: number, from: number, to: number) => any[]}} mock
 * @param {{sourcePositionId: number, lat: number, lon: number, time: number}[]} fixes
 * @param {{missionStart: number, until: number, expectedDevices: number[], excludedDevices: number[], tailToleranceMs?: number}} options
 */
export function verifyLookbackFixes(mock, fixes, { missionStart, until, expectedDevices, excludedDevices, tailToleranceMs = 60_000 }) {
  if (!Number.isFinite(missionStart) || missionStart <= mock.denseBand.from || missionStart >= mock.denseBand.to) {
    throw new Error('Mission start is outside the provider\'s dense boundary band; the window edge cannot be checked to the second.')
  }
  const mismatches = fixes.filter((fix) => {
    const served = mock.fixFor(fix.sourcePositionId)
    return served === null || served.latitude !== fix.lat || served.longitude !== fix.lon || Date.parse(served.fixTime) !== fix.time
  })
  expectProduct(mismatches.length === 0,
    `${mismatches.length}/${fixes.length} stored lookback fixes differ from the provider (e.g. ${mismatches.slice(0, 3).map((fix) => fix.sourcePositionId).join(', ')}).`)
  const early = fixes.filter((fix) => fix.time < missionStart)
  expectProduct(early.length === 0, `${early.length} stored fixes predate mission start ${new Date(missionStart).toISOString()}.`)
  const deviceOf = (fix) => Math.floor(fix.sourcePositionId / 1_000_000)
  const leaked = fixes.filter((fix) => excludedDevices.includes(deviceOf(fix)))
  expectProduct(leaked.length === 0, `${leaked.length} fixes stored for a device that was never selected.`)
  const perDevice = {}
  for (const device of expectedDevices) {
    const stored = new Set(fixes.filter((fix) => deviceOf(fix) === device).map((fix) => fix.sourcePositionId))
    const expected = mock.fixesBetween(device, missionStart, until - tailToleranceMs)
    const missing = expected.filter((fix) => !stored.has(fix.id))
    expectProduct(expected.length > 0, `Provider fixture has no in-window history for device ${device}.`)
    expectProduct(missing.length === 0,
      `Device ${device}: ${missing.length}/${expected.length} in-window provider fixes missing (first ${missing[0]?.fixTime}).`)
    perDevice[device] = { stored: stored.size, expected: expected.length, first: expected[0].fixTime }
  }
  return perDevice
}

/** Reads each participant row's history status text. */
async function participantHistoryStatuses(page) {
  return page.getByTestId('participant-backfill-status').allInnerTexts()
}

/**
 * Starts a mission 48 h back with known provider history while that history
 * is failing, then shows it complete, exact, visible and preserved on restart.
 */
async function lookbackPhase(ctx) {
  const name = 'Lookback Smoke'
  const mock = await startHistoryTraccar()
  ctx.cleanups.push(() => mock.close())
  mock.setHistoryFailing(true)
  const profile = path.join(ctx.runDir, 'lookback-profile')
  let app = await launchApp(ctx, { profile, label: 'lookback' })
  await connectProvider(app.page, mock.url)
  await startMissionWithLookback(app.page, { name, offsetHours: LOOKBACK_HOURS, devices: ['History Hotel', 'Walker Juliet'] })
  await addParticipantAfterStart(app.page, 'Late Lima', 'mission')
  const missionStart = Date.parse(await app.page.evaluate(async () =>
    (await window.sartrackerElectron.missionStore.getActiveMission())?.start_time))

  // While provider history fails, the incomplete state must be visible.
  await delay(20_000)
  const failingStatuses = await participantHistoryStatuses(app.page)
  await app.shot('lookback-history-failing')
  expectProduct(failingStatuses.length === 3 && failingStatuses.every((status) => /pending|retrying/i.test(status)),
    `History outage was not shown as incomplete: ${JSON.stringify(failingStatuses)}.`)

  mock.setHistoryFailing(false)
  const completeBy = Date.now() + 180_000
  let statuses = failingStatuses
  while (Date.now() < completeBy) {
    statuses = await participantHistoryStatuses(app.page)
    if (statuses.length === 3 && statuses.every((status) => /complete/i.test(status))) break
    await delay(5000)
  }
  expectProduct(statuses.every((status) => /complete/i.test(status)),
    `Lookback history did not complete within 180 s of provider recovery: ${JSON.stringify(statuses)}.`)
  await delay(20_000)
  await app.shot('lookback-complete-map')
  await app.page.getByTestId('open-devices-workspace').click()
  await delay(1500)
  const deviceList = await app.page.getByTestId('device-list-scroll').innerText()
  await app.shot('lookback-devices')
  await closeWorkspace(app.page)
  for (const device of ['History Hotel', 'Walker Juliet', 'Late Lima']) {
    expectProduct(deviceList.includes(device), `${device} is not shown in the device list after its history loaded.`)
  }
  expectProduct(!deviceList.includes('Unselected Kilo'), 'An unselected device is shown in the mission device list.')

  const stoppedAt = Date.now()
  await app.stop()
  const before = missionFixes(profile, name)
  const perDevice = verifyLookbackFixes(mock, before, {
    missionStart, until: stoppedAt, expectedDevices: [11, 12, 14], excludedDevices: [13],
  })

  // Restart: stored history is preserved and live tracking continues.
  app = await launchApp(ctx, { profile, label: 'lookback-restart' })
  await resumeIfPrompted(app.page)
  await delay(30_000)
  await app.stop()
  const after = missionFixes(profile, name)
  const retained = new Map(after.map((fix) => [fix.sourcePositionId, fix]))
  expectProduct(before.every((fix) => {
    const kept = retained.get(fix.sourcePositionId)
    return kept !== undefined && kept.lat === fix.lat && kept.lon === fix.lon && kept.time === fix.time
  }), 'Lookback fixes were lost or changed across restart.')
  const liveAfterRestart = after.filter((fix) => Math.floor(fix.sourcePositionId / 1_000_000) === 12 && fix.time > stoppedAt).length
  expectProduct(liveAfterRestart > 0, 'Walker Juliet recorded no live fixes after restart.')
  verifyLookbackFixes(mock, after, { missionStart, until: Date.now(), expectedDevices: [11, 12, 14], excludedDevices: [13], tailToleranceMs: 90_000 })

  return `${LOOKBACK_HOURS} h lookback (start ${new Date(missionStart).toISOString()}): during a history outage all 3 participant rows showed pending; `
    + `after recovery ${before.length} stored fixes equal the provider, none before start (1 s boundary band), unselected device absent, `
    + `pre-selected and late "From mission start" devices complete ${JSON.stringify(perDevice)}; `
    + `shown in the device list; ${after.length - before.length} further fixes after restart with all earlier rows preserved.`
}

/** Starts a mock, the app and a mission with participants. */
async function trackedMission(ctx, label, name) {
  const mock = await startMockTraccar()
  ctx.cleanups.push(() => mock.close())
  const profile = path.join(ctx.runDir, 'profile')
  const app = await launchApp(ctx, { profile, label })
  await connectProvider(app.page, mock.url)
  await startMission(app.page, name, PARTICIPANTS)
  const setup = await app.page.evaluate(async () => {
    const store = window.sartrackerElectron.missionStore
    const mission = await store.getActiveMission()
    return { missionStart: mission?.start_time, participants: await store.listMissionParticipants(mission.id) }
  })
  const firstExpectedByDevice = participantFirstIndices(mock, setup.missionStart, setup.participants)
  return { mock, profile, app, firstExpectedByDevice }
}

export default [
  {
    check: 'Tracking matches provider exactly',
    id: 'tracking',
    async run(ctx) {
      const name = 'Tracking Exactness Smoke'
      const { mock, profile, app, firstExpectedByDevice } = await trackedMission(ctx, 'tracking', name)
      await delay(90_000)
      await app.shot('tracking')
      await app.stop()
      const result = verifyFixes(mock, missionFixes(profile, name), { firstExpectedByDevice })
      const lookback = await lookbackPhase(ctx)
      return `${result.fixes} stored fixes, 0 differ from provider coordinates/time; walkers contiguous `
        + `(${JSON.stringify(result.perDevice)}). ${lookback}`
    },
  },
  {
    check: 'Mission lifecycle and crash recovery',
    id: 'lifecycle',
    manualSteps: ['Close with the window X, reopen and confirm no false unexpected-shutdown report.'],
    async run(ctx) {
      const name = 'Lifecycle Smoke'
      const findings = []
      let { mock, profile, app, firstExpectedByDevice } = await trackedMission(ctx, 'lifecycle-1', name)
      await delay(40_000)
      const preservedFixes = missionFixes(profile, name)

      // Pause, then kill the main process as a power cut would.
      expectProduct(await togglePause(app.page) === 'PAUSED', 'Pause did not show PAUSED.')
      await app.stop('SIGKILL')
      app = await launchApp(ctx, { profile, label: 'lifecycle-2-after-sigkill' })
      expectProduct(await resumeIfPrompted(app.page), 'No recovery prompt after SIGKILL.')
      const phaseAfterKill = await missionPhase(app.page)
      if (phaseAfterKill !== 'PAUSED') findings.push(`mission paused before SIGKILL came back ${phaseAfterKill} after Resume`)
      if (phaseAfterKill === 'PAUSED') await togglePause(app.page)
      await delay(30_000)

      // Renderer crash closes the app by design; relaunch and resume.
      const session = await app.page.context().newCDPSession(app.page)
      void session.send('Page.crash').catch(() => {})
      await Promise.race([app.exited, delay(20_000)])
      await app.kill()
      app = await launchApp(ctx, { profile, label: 'lifecycle-3-after-renderer-crash' })
      expectProduct(await resumeIfPrompted(app.page), 'No recovery prompt after renderer crash.')
      expectProduct(await missionPhase(app.page) === 'ACTIVE', 'Mission not ACTIVE after resuming from renderer crash.')
      await delay(30_000)

      // Graceful quit, then a normal relaunch must not claim a crash. The
      // window X button cannot be driven faithfully over CDP; check it by hand.
      await app.stop('SIGTERM')
      app = await launchApp(ctx, { profile, label: 'lifecycle-4-after-graceful-quit' })
      const crashState = await app.page.evaluate(() => window.sartrackerElectron.readCrashRecoveryState())
      if (crashState?.uncleanShutdown === true) findings.push('a graceful quit was recorded as an unexpected shutdown')
      await resumeIfPrompted(app.page, 15_000)
      await delay(40_000)

      // Graceful quit.
      await app.stop('SIGTERM')
      const result = verifyFixes(mock, missionFixes(profile, name), { firstExpectedByDevice, requireRecentWithin: 6, preservedFixes })
      const summary = `pause, SIGKILL, renderer crash and graceful quit; ${result.fixes} fixes, walkers gap-free `
        + `${JSON.stringify(result.perDevice)}`
      expectProduct(findings.length === 0, `${findings.join('; ')}. Data: ${summary}.`)
      return `${summary}; pause state preserved; graceful quit not reported as a crash. Window X close: check by hand.`
    },
  },
  {
    check: 'Provider outage warning and backfill',
    id: 'outage',
    async run(ctx) {
      const name = 'Smoke Mission O'
      const { mock, profile, app, firstExpectedByDevice } = await trackedMission(ctx, 'outage', name)
      const trackingStatus = async () => {
        const parts = []
        for (const id of ['tracking-warning', 'mast-tracking-cell', 'persistent-tracking-health']) {
          const locator = app.page.getByTestId(id)
          if (await locator.count() > 0) parts.push(await locator.first().innerText().catch(() => ''))
        }
        return parts.join(' / ').replace(/\s+/gu, ' ').trim()
      }
      await delay(30_000)
      const before = await trackingStatus()
      const preservedFixes = missionFixes(profile, name)
      mock.setOffline(true)
      const outageStarted = Date.now()
      let warned = ''
      // Hold the full 90 s outage whatever the UI shows, sampling the tracking status.
      while (Date.now() - outageStarted < 90_000) {
        await delay(5000)
        const status = await trackingStatus()
        if (warned === '' && status !== before && /unreachable|offline|error|retry|fail|stale|lost|degraded|disconnect/i.test(status)) {
          warned = status
          await app.shot('during-outage')
        }
      }
      mock.setOffline(false)
      await delay(60_000)
      await app.shot('after-outage')
      await app.stop()
      expectProduct(warned !== '', `No tracking warning during a 90 s provider outage. Status stayed: "${before.slice(0, 160)}".`)
      const result = verifyFixes(mock, missionFixes(profile, name), { firstExpectedByDevice, preservedFixes })
      return `During the 90 s outage the tracking status showed "${warned.slice(0, 160)}"; after reconnect ${result.fixes} fixes, `
        + `walkers gap-free ${JSON.stringify(result.perDevice)}.`
    },
  },
]
