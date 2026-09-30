/**
 * Packaged checks for team-facing issues that previously had only browser or
 * unit coverage (release-checklist register, 30 September 2026).
 *
 * - DON-281: after crashes, Archive & Lock with an empty Admin Roster must
 *   complete, routing through Settings when an evidence-loss acknowledgement
 *   is required (13.4's "Read first" issue).
 * - DON-288: launched without the test box's GPU workaround flag, the map must
 *   render or the operator must see a message; never a silent black map.
 */

import path from 'node:path'

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
    manualSteps: ['Look at the no-gpu-flag screenshot: a drawn map, or a message the operator can act on.'],
    async run(ctx) {
      // The team launches without the test box's workaround; so does this check.
      const appArgs = ctx.appArgs.filter((arg) => arg !== '--ignore-gpu-blocklist')
      const app = await launchApp({ ...ctx, appArgs }, { profile: path.join(ctx.runDir, 'profile'), label: 'no-gpu-flag' })
      await delay(8000)
      const state = await app.page.evaluate(() => {
        const probe = document.createElement('canvas')
        const webgl = Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'))
        const mapCanvas = document.querySelector('.maplibregl-canvas') !== null
        return { webgl, mapCanvas }
      })
      const text = await bodyText(app.page)
      const message = /webgl|graphics|map (could not|cannot|is unavailable)|gpu/i.test(text)
      await app.shot('no-gpu-flag')
      await app.stop()
      expectProduct(state.webgl || message,
        'Without --ignore-gpu-blocklist WebGL is unavailable and no message explains the missing map (DON-288).')
      return state.webgl
        ? 'WebGL available without the workaround flag; map canvas present.'
        : 'WebGL unavailable without the flag; the operator sees a message.'
    },
  },
]
