/**
 * Packaged checks for team-facing issues that previously had only browser or
 * unit coverage (release-checklist register, 30 September 2026).
 *
 * - DON-281: after crashes, Archive & Lock with an empty Admin Roster must
 *   complete, routing through Settings when an evidence-loss acknowledgement
 *   is required (13.4's "Read first" issue).
 * - DON-288: launched without the test box's GPU workaround flag, the map must
 *   render, or the operator must see the message and "Restart with software
 *   rendering"; the button must relaunch the app with a drawn map and remember it.
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { chromium } from 'playwright'

import { delay, launchApp } from '../lib/app.mjs'
import { startMockTraccar } from '../lib/mock-traccar.mjs'
import { archiveMission, bodyText, connectProvider, finishMission, resumeIfPrompted, startMission } from '../lib/operator.mjs'
import { expectProduct } from '../lib/results.mjs'

export default [
  {
    check: 'Mission lifecycle and crash recovery',
    id: 'crash-archive',
    timeoutMs: 20 * 60_000,
    async run(ctx) {
      const mock = await startMockTraccar()
      ctx.cleanups.push(() => mock.close())
      const profile = path.join(ctx.runDir, 'profile')
      let app = await launchApp(ctx, { profile, label: 'crash-archive-1' })
      await connectProvider(app.page, mock.url)
      await startMission(app.page, 'Crash Archive Smoke', ['Walker Alpha', 'Walker Bravo'])
      await delay(30_000)

      // A renderer crash and a power cut, as a field laptop might see.
      const session = await app.page.context().newCDPSession(app.page)
      void session.send('Page.crash').catch(() => {})
      await Promise.race([app.exited, delay(20_000)])
      await app.kill()
      app = await launchApp(ctx, { profile, label: 'crash-archive-2' })
      await resumeIfPrompted(app.page)
      await delay(20_000)
      await app.stop('SIGKILL')
      app = await launchApp(ctx, { profile, label: 'crash-archive-3' })
      await resumeIfPrompted(app.page)
      await delay(20_000)

      await finishMission(app.page)
      await delay(1500)
      await archiveMission(app.page)
      const t = (id) => app.page.getByTestId(id)
      const dialog = t('mission-evidence-loss-dialog')
      const needsAck = await dialog.waitFor({ timeout: 20_000 }).then(() => true, () => false)
      let route = 'no evidence-loss acknowledgement was required'
      if (needsAck) {
        await app.shot('evidence-loss-dialog')
        const emptyNotice = dialog.getByTestId('admin-roster-empty-notice')
        expectProduct(await emptyNotice.isVisible().catch(() => false),
          `Evidence-loss acknowledgement with no Admin Roster gave no route to Settings: ${(await dialog.innerText()).slice(0, 200)}`)
        await t('mission-evidence-loss-reason').fill('Crashes during the release smoke.')
        await emptyNotice.getByTestId('admin-roster-open-settings').click()
        await t('settings-admin-roster').fill('Smoke Admin')
        await t('settings-save').click()
        await dialog.waitFor({ timeout: 20_000 })
        await t('mission-evidence-loss-confirm').click()
        await dialog.waitFor({ state: 'hidden', timeout: 20_000 })
        await archiveMission(app.page)
        route = 'the empty Admin Roster routed through Settings and back, then the acknowledgement was accepted'
      }
      const archived = await app.page.getByText(/Mission archived to/).first()
        .waitFor({ timeout: 180_000 }).then(() => true, () => false)
      await app.shot('archived')
      expectProduct(archived, `Archive did not complete after crashes with an empty Admin Roster (DON-281): ${(await bodyText(app.page)).slice(0, 200)}`)
      await app.stop()
      return `After a renderer crash and a SIGKILL with an empty Admin Roster, Archive & Lock completed; ${route} [DON-281].`
    },
  },
  {
    check: 'Replay, basemaps and layers',
    id: 'no-gpu-flag',
    manualSteps: ['Look at the no-gpu-flag screenshots: a drawn map, or the message and button, then the map after the software-rendering restart.'],
    async run(ctx) {
      // The team launches without the test box's workaround; so does this check.
      const appArgs = ctx.appArgs.filter((arg) => arg !== '--ignore-gpu-blocklist')
      const profile = path.join(ctx.runDir, 'profile')
      const app = await launchApp({ ...ctx, appArgs }, { profile, label: 'no-gpu-flag' })
      await delay(8000)
      const state = await app.page.evaluate(() => {
        const probe = document.createElement('canvas')
        const webgl = Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
        const mapCanvas = document.querySelector('.maplibregl-canvas') !== null
        return { webgl, mapCanvas }
      })
      await app.shot('no-gpu-flag')
      if (state.webgl) {
        await app.stop()
        expectProduct(state.mapCanvas, 'WebGL is available without the flag but no map canvas was drawn.')
        return 'WebGL available without the workaround flag; map canvas present.'
      }

      // WebGL unavailable: the operator must see why and be offered the restart [DON-288].
      const panel = app.page.getByTestId('map-renderer-unavailable')
      const button = app.page.getByTestId('restart-with-software-rendering')
      const panelShown = await panel.isVisible().catch(() => false)
      const buttonShown = await button.isVisible().catch(() => false)
      if (!panelShown || !buttonShown) {
        const text = await bodyText(app.page).catch(() => '')
        await app.stop()
        expectProduct(false, `Without --ignore-gpu-blocklist WebGL is unavailable and the map message or restart button is missing (DON-288): ${text.slice(0, 200)}`)
      }
      // app.relaunch() reuses the launch arguments, including the DevTools port.
      // From the click on, the replacement app is always stopped and its exit verified.
      try {
        await button.click()
        const exitCode = await Promise.race([app.exited, delay(60_000).then(() => 'timeout')])
        expectProduct(exitCode !== 'timeout', 'Restart with software rendering did not close the app within 60 s.')
        const stored = JSON.parse(await readFile(path.join(profile, 'gpu-rendering-preference.json'), 'utf8').catch(() => 'null'))
        expectProduct(stored?.softwareRendering === true, 'The software-rendering choice was not remembered in the profile.')
        const page = await connectRelaunched(app.port)
        const drawn = await page.locator('.maplibregl-canvas').first()
          .waitFor({ timeout: 30_000 }).then(() => true, () => false)
        await page.screenshot({ path: path.join(ctx.runDir, 'no-gpu-flag-after-restart.png') })
        expectProduct(drawn, 'After Restart with software rendering the map still did not draw.')
      } finally {
        await stopListenerOnPort(app.port)
      }
      return 'WebGL unavailable without the flag; the operator saw the message, Restart with software rendering relaunched the app, the map drew, and the choice was remembered.'
    },
  },
]

/** Connects to the app that relaunched itself on the same DevTools port and returns its window. */
async function connectRelaunched(port) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const ok = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false)
    if (ok) break
    await delay(500)
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  let page
  while (page === undefined && Date.now() < deadline) {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => !candidate.url().startsWith('devtools'))
    if (page === undefined) await delay(250)
  }
  expectProduct(page !== undefined, 'The app did not reopen a window after Restart with software rendering.')
  return page
}

/**
 * Stops the process listening on the DevTools port (the relaunched app, which
 * the runner did not start), escalating to SIGKILL and verifying it is gone.
 */
async function stopListenerOnPort(port) {
  const listeners = async () => {
    try {
      const { stdout } = await promisify(execFile)('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
      return stdout.split(/\s+/u).filter(Boolean).map(Number)
    } catch (error) {
      // lsof exits 1 when nothing listens; anything else means it could not check.
      if (error?.code === 1) return []
      throw new Error(`Could not check for the relaunched app on port ${port}: ${error?.message ?? error}`)
    }
  }
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const pids = await listeners()
    if (pids.length === 0) return
    for (const pid of pids) {
      try { process.kill(pid, signal) } catch { /* already gone */ }
    }
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && (await listeners()).length > 0) await delay(500)
  }
  if ((await listeners()).length > 0) throw new Error(`The relaunched app on port ${port} would not stop.`)
}
