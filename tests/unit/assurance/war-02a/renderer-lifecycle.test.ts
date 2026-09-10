// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGate, VirtualScheduler } from './virtual-scheduler'
import { loadIsolatedCommonJs } from './isolated-commonjs'
import type { MissionStore, MissionStoreModule, RendererCoordinatorModule } from './production-contracts'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../../../electron/mission-store.cjs') as MissionStoreModule
const coordinatorFile = require.resolve('../../../../electron/renderer-teardown-coordinator.cjs')

describe('WAR-02A renderer lifecycle evidence', () => {
  for (const outcome of ['lost', 'drained'] as const) {
    it(`historical renderer scope: ${outcome} preserves finished mission evidence through restart`, async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'war02a-renderer-'))
      let store: MissionStore | undefined
      let coordinator: ReturnType<RendererCoordinatorModule['createRendererTeardownCoordinator']> | undefined
      try {
        store = await createElectronMissionStore({ userDataPath: root })
        const first = await store.createMission({ name: 'First mission' })
        const clock = new VirtualScheduler()
        let switchWork: Promise<{ id: string }> | undefined
        clock.schedule('mission-switch', 5, () => {
          switchWork = store!.finishMission(first.id).then(() => store!.createMission({ name: 'Second mission' }))
        })
        clock.advanceTo(5)
        const second = await switchWork!
        const staged = createGate<void>('durable uncertainty written')
        const listeners = new Map<string, (event: unknown, input: unknown) => void>()
        const negative = process.env.WAR02A_NEGATIVE_CONTROL === 'renderer-active-only'
        const module = loadIsolatedCommonJs<RendererCoordinatorModule>(coordinatorFile, {}, negative ? {
          from: 'return missionStore.listRendererEvidenceScopesAwaitingClosure()',
          to: "return missionStore.listRendererEvidenceScopesAwaitingClosure().then(scopes => scopes.filter(scope => scope.scope_reason === 'active_mission'))",
        } : undefined)
        coordinator = module.createRendererTeardownCoordinator({
          ipcMain: {
            on: (channel, listener) => { listeners.set(channel, listener) },
            removeListener: (channel) => { listeners.delete(channel) },
          },
          missionStore: {
            ...store,
            stageRendererEvidenceIncident: async (input) => {
              await store!.stageRendererEvidenceIncident(input)
              await staged.wait()
            },
          },
          createRequestId: () => 'war02a-request-1',
          setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, timeoutMs: 10,
        })
        const webContents = { isDestroyed: () => false, send: () => {} }
        let preparation: Promise<unknown> | undefined
        clock.schedule('teardown', 0, () => { preparation = coordinator!.prepare({ webContents }, 'renderer_reload') })
        clock.advanceTo(5)
        clock.advanceTo(15)
        await staged.entered
        // The real durable incident has been written; completion is held at a named gate.
        clock.schedule('worker-completion', 0, () => { staged.release() })
        clock.advanceTo(15)
        if (outcome === 'lost') {
          await coordinator.markRendererUnavailable()
        } else {
          listeners.get('sartracker:app-runtime-teardown-ready')!({ sender: webContents }, { requestId: 'war02a-request-1', ok: true })
        }
        await preparation
        staged.assertSettled()
        coordinator.dispose()
        coordinator = undefined
        clock.assertIdle()
        await store.close()
        store = undefined
        let restartWork: Promise<MissionStore> | undefined
        clock.schedule('restart', 1, () => { restartWork = createElectronMissionStore({ userDataPath: root }) })
        clock.advanceTo(16)
        store = await restartWork!
        const firstHealth = await store.getIngestEvidenceHealth(first.id)
        const secondHealth = await store.getIngestEvidenceHealth(second.id)
        const expected = outcome === 'lost' ? 'renderer_pending_evidence_lost' : null
        expect(firstHealth.reason, 'finished mission evidence must retain durable loss ownership').toBe(expected)
        expect(secondHealth.reason).toBe(expected)
        expect(firstHealth.state).toBe(outcome === 'lost' ? 'critical' : 'healthy')
        expect(secondHealth.state).toBe(outcome === 'lost' ? 'critical' : 'healthy')
        expect(listeners.size).toBe(0)
        clock.assertIdle()
      } finally {
        coordinator?.dispose()
        await store?.close()
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})
