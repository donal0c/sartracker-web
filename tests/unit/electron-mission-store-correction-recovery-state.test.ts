import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (input: Readonly<Record<string, unknown>>) => {
    readonly createMission: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly createOuting: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly renameOuting: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly recordIngestEvidenceLoss: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly acknowledgeIngestEvidenceLoss: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly finishMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly finalizeMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly getMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly prepareClose: () => Promise<void>
    readonly close: () => void
  }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('startup correction custody renderer state', () => {
  it('does not project a finished mission as ordinary live state while attachment recovery is pending', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-recovery-state-'))
    roots.push(root)
    await mkdir(path.join(root, 'correction-attachment-journals'))
    let release!: (value: Readonly<Record<string, unknown>>) => void
    const operation = Object.assign(new Promise((resolve) => { release = resolve }), {
      workerExited: Promise.resolve(),
    })
    const store = createElectronMissionStore({
      userDataPath: root,
      startArchiveCorrectionAttachmentRecovery: () => operation,
    })
    try {
      const mission = await store.createMission({ name: 'Recovery-gated mission' })
      await store.finishMission(mission.id)
      const projected = await store.getMission(mission.id)
      expect(projected).toMatchObject({
        status: 'finished',
        storage_state: 'recovery_required',
      })
    } finally {
      release({ recovered: 0 })
      await operation
      await store.prepareClose()
      store.close()
    }
  })

  it('blocks direct archive finalization after custody recovery fails at startup', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-recovery-finalize-'))
    roots.push(root)
    await mkdir(path.join(root, 'correction-attachment-journals'))
    const operation = Object.assign(Promise.reject(new Error('recovery failed')), {
      workerExited: Promise.resolve(),
    })
    const store = createElectronMissionStore({
      userDataPath: root,
      startArchiveCorrectionAttachmentRecovery: () => operation,
    })
    try {
      const mission = await store.createMission({ name: 'Recovery-blocked finalization' })
      await store.finishMission(mission.id)
      await vi.waitFor(async () => {
        await expect(store.getMission(mission.id)).resolves.toMatchObject({
          status: 'finished',
          storage_state: 'recovery_required',
        })
      })

      await expect(store.finalizeMission(mission.id)).rejects.toMatchObject({
        code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  })

  it('blocks outing and evidence-loss mutations while durable attachment recovery is required', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-recovery-writes-'))
    roots.push(root)
    await mkdir(path.join(root, 'correction-attachment-journals'))
    const operation = Object.assign(Promise.reject(new Error('recovery failed')), {
      workerExited: Promise.resolve(),
    })
    const store = createElectronMissionStore({
      userDataPath: root,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveCorrectionAttachmentRecovery: () => operation,
    })
    try {
      const mission = await store.createMission({ name: 'Recovery write fence' })
      const outing = await store.createOuting({ mission_id: mission.id, label: 'Before' })
      await store.recordIngestEvidenceLoss({
        mission_id: mission.id,
        reason: 'mission_persistence_failed',
        scope_reason: 'active_mission',
      })
      await store.finishMission(mission.id)
      await vi.waitFor(async () => {
        await expect(store.getMission(mission.id)).resolves.toMatchObject({
          status: 'finished',
          storage_state: 'recovery_required',
        })
      })

      await expect(store.renameOuting({
        mission_id: mission.id,
        outing_id: outing.id,
        label: 'Should be blocked',
      })).rejects.toMatchObject({
        code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
      })
      await expect(store.acknowledgeIngestEvidenceLoss({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Acknowledge the recorded loss after recovery.',
      })).rejects.toMatchObject({
        code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  })
})
