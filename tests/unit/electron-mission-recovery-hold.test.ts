import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type StoredMission = {
  readonly id: string
  readonly status: string
  readonly pause_time: string | null
  readonly paused_seconds: number
}

type StoredEvent = {
  readonly event_type: string
  readonly details_json: string | null
}

type RecoveryHoldStore = {
  readonly createMission: (input: { readonly name: string }) => Promise<StoredMission>
  readonly getMission: (missionId: string) => Promise<StoredMission>
  readonly getRecoverableMission: () => Promise<StoredMission | null>
  readonly pauseMission: (missionId: string) => Promise<StoredMission>
  readonly resumeMission: (missionId: string) => Promise<StoredMission>
  readonly holdMissionForRecovery: (missionId: string) => Promise<StoredMission>
  readonly resumeRecoveredMission: (missionId: string) => Promise<StoredMission>
  readonly listMissionEvents: (missionId: string) => Promise<readonly StoredEvent[]>
  readonly close: () => void
}

const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => RecoveryHoldStore
}

/**
 * DON-283: startup places a running mission on a recovery hold. Resuming after
 * a crash must lift only that hold; a pause the operator chose before the crash
 * survives recovery, including repeated crashes before the operator decides.
 */
describe('electron mission store recovery hold (DON-283)', () => {
  let userDataPath: string | null = null
  let store: RecoveryHoldStore | null = null

  afterEach(async () => {
    store?.close()
    store = null
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  async function openStore(): Promise<RecoveryHoldStore> {
    userDataPath ??= await mkdtemp(path.join(tmpdir(), 'sartracker-recovery-hold-'))
    store = createElectronMissionStore({ userDataPath })
    return store
  }

  /** Simulates a process crash and relaunch by reopening the same profile. */
  async function reopenStore(): Promise<RecoveryHoldStore> {
    store?.close()
    store = null
    return openStore()
  }

  async function eventTypesWithReasons(missionId: string): Promise<readonly string[]> {
    const events = await store!.listMissionEvents(missionId)
    return events
      .filter((event) => event.event_type === 'mission_paused' || event.event_type === 'mission_resumed')
      .map((event) => {
        const reason = event.details_json === null
          ? undefined
          : (JSON.parse(event.details_json) as { reason?: string }).reason
        return reason === undefined ? event.event_type : `${event.event_type}:${reason}`
      })
  }

  it('records the startup hold on a running mission as a recovery hold, not an operator pause', async () => {
    const opened = await openStore()
    const mission = await opened.createMission({ name: 'Running before crash' })

    await expect(opened.holdMissionForRecovery(mission.id)).resolves.toMatchObject({ status: 'paused' })

    expect(await eventTypesWithReasons(mission.id)).toEqual(['mission_paused:recovery_hold'])
  })

  it('returns a mission that was running before the crash to active on recovery resume', async () => {
    const opened = await openStore()
    const mission = await opened.createMission({ name: 'Running before crash' })
    await opened.holdMissionForRecovery(mission.id)

    await expect(opened.resumeRecoveredMission(mission.id)).resolves.toMatchObject({
      status: 'active',
      pause_time: null,
    })
    expect(await eventTypesWithReasons(mission.id)).toEqual([
      'mission_paused:recovery_hold',
      'mission_resumed:recovery_resume',
    ])
  })

  it('keeps a mission the operator paused before the crash paused, with no invented transition', async () => {
    const opened = await openStore()
    const mission = await opened.createMission({ name: 'Paused before crash' })
    const paused = await opened.pauseMission(mission.id)

    const relaunched = await reopenStore()
    await expect(relaunched.getRecoverableMission()).resolves.toMatchObject({ id: mission.id, status: 'paused' })

    const recovered = await relaunched.resumeRecoveredMission(mission.id)

    expect(recovered).toMatchObject({ status: 'paused', pause_time: paused.pause_time })
    expect(await eventTypesWithReasons(mission.id)).toEqual(['mission_paused'])
  })

  it('still returns a running mission to active after a second crash during recovery', async () => {
    const opened = await openStore()
    const mission = await opened.createMission({ name: 'Crashed twice' })
    await opened.holdMissionForRecovery(mission.id)

    const relaunched = await reopenStore()
    await expect(relaunched.getRecoverableMission()).resolves.toMatchObject({ status: 'paused' })

    await expect(relaunched.resumeRecoveredMission(mission.id)).resolves.toMatchObject({ status: 'active' })
  })

  it('uses the most recent pause: operator pause then resume then crash returns to active', async () => {
    const opened = await openStore()
    const mission = await opened.createMission({ name: 'Paused earlier' })
    await opened.pauseMission(mission.id)
    await opened.resumeMission(mission.id)
    await opened.holdMissionForRecovery(mission.id)

    await expect(opened.resumeRecoveredMission(mission.id)).resolves.toMatchObject({ status: 'active' })
  })

  it('refuses a recovery hold on a mission that is not running', async () => {
    const opened = await openStore()
    const mission = await opened.createMission({ name: 'Already paused' })
    await opened.pauseMission(mission.id)

    await expect(opened.holdMissionForRecovery(mission.id)).rejects.toThrow(/status 'paused'/u)
  })

  it('refuses recovery resume on a mission that is not paused', async () => {
    const opened = await openStore()
    const mission = await opened.createMission({ name: 'Still running' })

    await expect(opened.resumeRecoveredMission(mission.id)).rejects.toThrow(/status 'active'/u)
  })
})
