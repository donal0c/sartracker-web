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
    readonly recordIngestRejections: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly recordIngestEvidenceLoss: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly stageRendererEvidenceUncertainty: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly resolveRendererEvidenceUncertainty: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly stageRendererEvidenceIncident: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly resolveRendererEvidenceIncidents: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
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

  it('blocks every renderer evidence mutation after custody recovery becomes required', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-recovery-evidence-'))
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
      const mission = await store.createMission({ name: 'Recovery evidence fence' })
      await store.stageRendererEvidenceIncident({
        incident_id: 'incident-before-recovery',
        scopes: [{ mission_id: mission.id, scope_reason: 'active_mission' }],
      })
      await store.finishMission(mission.id)
      await vi.waitFor(async () => {
        await expect(store.getMission(mission.id)).resolves.toMatchObject({
          status: 'finished',
          storage_state: 'recovery_required',
        })
      })

      const expected = { code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED' }
      await expect(store.recordIngestRejections({
        mission_id: mission.id,
        rejections: [{
          deliveryId: 'post-recovery-rejection',
          anomalyKey: 'source:post-recovery',
          deviceId: 'tracker-1',
          sourcePositionId: 'post-recovery',
          reasonClass: 'invalid_coordinates',
          receivedAt: '2026-08-22T10:00:00.000Z',
          canonicalEvidence: { source_position_id: 'post-recovery' },
        }],
      })).rejects.toMatchObject(expected)
      await expect(store.recordIngestEvidenceLoss({
        mission_id: mission.id,
        reason: 'mission_persistence_failed',
      })).rejects.toMatchObject(expected)
      await expect(store.stageRendererEvidenceUncertainty({
        mission_id: mission.id,
        incident_id: 'uncertainty-after-recovery',
        scope_reason: 'finished_unfinalized_mission',
      })).rejects.toMatchObject(expected)
      await expect(store.resolveRendererEvidenceUncertainty({
        mission_id: mission.id,
        incident_id: 'incident-before-recovery',
        outcome: 'lost',
      })).rejects.toMatchObject(expected)
      await expect(store.stageRendererEvidenceIncident({
        incident_id: 'incident-after-recovery',
        scopes: [{
          mission_id: mission.id,
          scope_reason: 'finished_unfinalized_mission',
        }],
      })).rejects.toMatchObject(expected)
      await expect(store.resolveRendererEvidenceIncidents({
        outcome: 'lost',
      })).rejects.toMatchObject(expected)
    } finally {
      await store.prepareClose()
      store.close()
    }
  })

  it('keeps the correction recovery blocker after its journal directory disappears before restart', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-recovery-missing-journal-'))
    roots.push(root)
    const journalDirectory = path.join(root, 'correction-attachment-journals')
    await mkdir(journalDirectory)
    const operation = Object.assign(Promise.reject(new Error('recovery failed')), {
      workerExited: Promise.resolve(),
    })
    const firstStore = createElectronMissionStore({
      userDataPath: root,
      startArchiveCorrectionAttachmentRecovery: () => operation,
    })
    const mission = await firstStore.createMission({ name: 'Missing journal recovery fence' })
    await firstStore.finishMission(mission.id)
    await vi.waitFor(async () => {
      await expect(firstStore.getMission(mission.id)).resolves.toMatchObject({
        storage_state: 'recovery_required',
      })
    })
    await firstStore.prepareClose()
    firstStore.close()
    await rm(journalDirectory, { recursive: true, force: true })

    const secondStore = createElectronMissionStore({ userDataPath: root })
    try {
      await expect(secondStore.getMission(mission.id)).resolves.toMatchObject({
        status: 'finished',
        storage_state: 'recovery_required',
      })
      await expect(secondStore.finalizeMission(mission.id)).rejects.toMatchObject({
        code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
      })
    } finally {
      await secondStore.prepareClose()
      secondStore.close()
    }
  })
})
