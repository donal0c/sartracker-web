import { describe, expect, it } from 'vitest'

import {
  createIngestEvidenceFinalizationBoundary,
  readMissionCorrectionEvidenceRecoveryFailure,
} from '../../src/features/tracking/ingest-evidence-finalization-boundary'

describe('mission correction evidence recovery failure [DON-253]', () => {
  it('returns immutable facts only for the exact locally created failure', async () => {
    const bounded = createIngestEvidenceFinalizationBoundary(
      {
        finalizeMission: async () => undefined,
        unlockFinalizedMission: async () => undefined,
        restoreMissionForCorrection: async () => ({
          id: 'mission-1',
          status: 'finished',
          correction: { committed: true, cleanupComplete: true },
        }),
      },
      {
        flushMission: async () => undefined,
        runWithMissionFinishFence: async (_missionId, operation) => operation(),
        runWithMissionFinalizationFence: async (_missionId, operation) => operation(),
        reopenMissionEvidenceAfterUnlock: () => {
          throw new Error('renderer evidence unavailable')
        },
      },
    )
    let failure: unknown
    try {
      await bounded.restoreMissionForCorrection?.({
        mission_id: 'mission-1',
        archiveId: 'archive-1',
        operationId: 'operation-1',
        sessionId: 'session-1',
        admin_name: 'Duty Admin',
        reason: 'Authenticate the local recovery failure.',
      })
    } catch (error) {
      failure = error
    }
    const facts = readMissionCorrectionEvidenceRecoveryFailure(failure)

    expect(facts).toEqual({
      committed: true,
      cleanupComplete: true,
      evidenceReopenFailed: true,
    })
    expect(Object.isFrozen(facts)).toBe(true)
    expect(readMissionCorrectionEvidenceRecoveryFailure({ ...failure })).toBeNull()
  })

  it('does not inspect spoofed, inherited, getter, or Proxy properties', () => {
    let propertyRead = false
    const getterFailure = Object.defineProperty({}, 'archiveCorrectionCommitted', {
      get: () => {
        propertyRead = true
        throw new Error('getter must not run')
      },
    })
    const proxyFailure = new Proxy({}, {
      get: () => {
        propertyRead = true
        throw new Error('Proxy trap must not run')
      },
    })
    const spoofedFacts = {
      archiveCorrectionCommitted: true,
      archiveCorrectionCleanupComplete: true,
      archiveCorrectionEvidenceReopenFailed: true,
    }

    expect(readMissionCorrectionEvidenceRecoveryFailure(spoofedFacts)).toBeNull()
    expect(readMissionCorrectionEvidenceRecoveryFailure(
      Object.create(spoofedFacts) as object,
    )).toBeNull()
    expect(readMissionCorrectionEvidenceRecoveryFailure(getterFailure)).toBeNull()
    expect(readMissionCorrectionEvidenceRecoveryFailure(proxyFailure)).toBeNull()
    expect(propertyRead).toBe(false)
  })
})
