/**
 * Tracking truth: with a real-time mock provider, every stored fix equals what
 * the provider served, the mission survives every interruption gap-free, and a
 * provider outage is visible and backfilled.
 */

import path from 'node:path'

import { delay, launchApp } from '../lib/app.mjs'
import { startMockTraccar } from '../lib/mock-traccar.mjs'
import { bodyText, connectProvider, missionPhase, resumeIfPrompted, startMission, togglePause } from '../lib/operator.mjs'
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
function verifyFixes(mock, fixes, { requireRecentWithin = 4 } = {}) {
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
  const perDevice = {}
  for (const device of [1, 2]) {
    const indices = [...new Set(byDevice.get(device) ?? [])].sort((a, b) => a - b)
    expectProduct(indices.length > 0, `No fixes stored for walking device ${device}.`)
    const first = indices[0]
    const last = indices[indices.length - 1]
    const present = new Set(indices)
    const missing = []
    for (let index = first; index <= last; index += 1) if (!present.has(index)) missing.push(index)
    expectProduct(missing.length === 0, `Device ${device} has ${missing.length} missing fixes between ${first} and ${last}.`)
    expectProduct(mock.latestIndex() - last <= requireRecentWithin,
      `Device ${device} stopped at fix ${last}; provider is at ${mock.latestIndex()}.`)
    perDevice[device] = { first, last, missing }
  }
  return { fixes: fixes.length, perDevice }
}

/** Starts a mock, the app and a mission with participants. */
async function trackedMission(ctx, label, name) {
  const mock = await startMockTraccar()
  ctx.cleanups.push(() => mock.close())
  const profile = path.join(ctx.runDir, 'profile')
  const app = await launchApp(ctx, { profile, label })
  await connectProvider(app.page, mock.url)
  await startMission(app.page, name, PARTICIPANTS)
  return { mock, profile, app }
}

export default [
  {
    check: 'Tracking matches provider exactly',
    id: 'tracking',
    async run(ctx) {
      const name = 'Tracking Exactness Smoke'
      const { mock, profile, app } = await trackedMission(ctx, 'tracking', name)
      await delay(90_000)
      await app.shot('tracking')
      await app.stop()
      const result = verifyFixes(mock, missionFixes(profile, name))
      return `${result.fixes} stored fixes, 0 differ from provider coordinates/time; walkers contiguous `
        + `(${JSON.stringify(result.perDevice)}).`
    },
  },
  {
    check: 'Mission lifecycle and crash recovery',
    id: 'lifecycle',
    async run(ctx) {
      const name = 'Lifecycle Smoke'
      const findings = []
      let { mock, profile, app } = await trackedMission(ctx, 'lifecycle-1', name)
      await delay(40_000)

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
      const result = verifyFixes(mock, missionFixes(profile, name), { requireRecentWithin: 6 })
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
      const { mock, profile, app } = await trackedMission(ctx, 'outage', name)
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
      const result = verifyFixes(mock, missionFixes(profile, name))
      return `During the 90 s outage the tracking status showed "${warned.slice(0, 160)}"; after reconnect ${result.fixes} fixes, `
        + `walkers gap-free ${JSON.stringify(result.perDevice)}.`
    },
  },
]
