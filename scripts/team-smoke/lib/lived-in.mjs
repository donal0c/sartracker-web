/**
 * A lived-in profile for checks that otherwise start from a fresh one: a
 * finished training mission with a marker, layers left hidden in Layers and a
 * non-default basemap, as a team laptop looks after a few call-outs. Saved
 * view state must never stop recording, GPX auto-show or replay (DON-299
 * class 4) [DON-317].
 */

import { delay, launchApp } from './app.mjs'
import { connectProvider, finishMission, placeMarker, startMission, switchBasemap } from './operator.mjs'

/** Layers a team commonly leaves hidden between missions. */
const HIDDEN_LAYER_NODES = ['layer-tracking-breadcrumbs', 'group-map-tools', 'group-gpx-tracks']

/**
 * Seeds `profile` through the app itself, then stops it. Returns a short
 * description of what was seeded, for the check's evidence.
 *
 * @param {object} ctx team-smoke check context
 * @param {string} profile profile directory the check will use
 * @param {{providerUrl?: string}} [options]
 * @returns {Promise<string>}
 */
export async function seedLivedInProfile(ctx, profile, { providerUrl } = {}) {
  const app = await launchApp(ctx, { profile, label: 'lived-in-seed' })
  if (providerUrl !== undefined) await connectProvider(app.page, providerUrl)
  await startMission(app.page, 'Earlier Training', [])
  await placeMarker(app.page, { name: 'Training IPP', x: 500, y: 300 })
  await finishMission(app.page)
  await delay(2000)

  const t = (id) => app.page.getByTestId(id)
  await t('sidebar-tab-layers').click()
  await t('layer-expand-all-btn').click()
  const hidden = []
  for (const node of HIDDEN_LAYER_NODES) {
    const toggle = t(`layer-visibility-${node}`)
    if (await toggle.count() === 0) continue
    await toggle.uncheck()
    hidden.push(node)
  }
  if (hidden.length === 0) throw new Error('No layer could be hidden while seeding the lived-in profile.')
  const basemap = await switchBasemap(app.page)
  await delay(1500)
  await app.stop()
  return `lived-in profile (finished mission, hidden ${hidden.join(', ')}, basemap ${basemap})`
}
