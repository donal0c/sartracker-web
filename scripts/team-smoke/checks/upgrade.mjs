/**
 * Upgrade: a profile created by the team's currently installed release must
 * open in the new build with its missions, markers, drawings and fixes intact.
 */

import { cp } from 'node:fs/promises'
import path from 'node:path'

import { launchApp } from '../lib/app.mjs'
import { NotTested, expectProduct } from '../lib/results.mjs'
import { coreSnapshot, missionStatuses } from '../lib/store.mjs'

export default [
  {
    check: "Upgrade from the team's current release",
    id: 'upgrade',
    async run(ctx) {
      if (ctx.options.previousProfile === undefined) {
        throw new NotTested('Pass --previous-profile: a profile made by the currently installed team release, with an active and a finished mission.')
      }
      const profile = path.join(ctx.runDir, 'profile')
      await cp(ctx.options.previousProfile, profile, { recursive: true })
      const before = coreSnapshot(profile)
      const statusBefore = missionStatuses(profile)
      // Block the network so a copied profile can never poll a real provider
      // and add fixes; the recovery prompt is left unanswered for the same reason.
      const app = await launchApp(ctx, { profile, label: 'upgrade', env: { SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' } })
      await app.shot('opened')
      await app.stop()
      const after = coreSnapshot(profile)
      const statusAfter = missionStatuses(profile)
      const changed = Object.keys(before).filter((key) => before[key] !== after[key])
      expectProduct(changed.length === 0, `Changed after upgrade: ${changed.join(', ')}.`)
      const transitions = Object.keys(statusBefore)
        .filter((id) => statusBefore[id] !== statusAfter[id])
        .map((id) => `${statusBefore[id]}→${statusAfter[id]}`)
      const unexpected = transitions.filter((transition) => transition !== 'active→paused')
      expectProduct(unexpected.length === 0, `Unexpected mission status changes after upgrade: ${unexpected.join(', ')}.`)
      return `Previous-release profile opened; missions, markers, drawings and fixes row-for-row equal (counts ${before.counts})`
        + `${transitions.length > 0 ? `; active mission held paused for Resume (${transitions.join(', ')})` : ''}. `
        + 'Check the coverage panel of any carried-over active mission by eye.'
    },
  },
]
