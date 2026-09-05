import React, { useEffect } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'
import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { useFocusModeStore } from '../../src/features/focus-mode/focus-mode-store'
import { useMissionStore } from '../../src/features/mission/mission-store'
import type { MissionControlViewModel } from '../../src/features/mission/use-mission-control-view-model'
import { useMissionControlViewModel } from '../../src/features/mission/use-mission-control-view-model'
import { useMissionReviewWorkspaceStore } from '../../src/features/mission-review/mission-review-workspace-store'
import { useParticipantStore } from '../../src/features/participants/participant-store'
import { useIngestHealthStore } from '../../src/features/tracking/ingest-health-store'

const mocks = vi.hoisted(() => ({
  loadAppSettings: vi.fn(),
}))

const ARCHIVE_CUSTODY = {
  operationId: '8b8fe5e4-1f0f-4b1b-87b2-36f7ff5c33a1',
  passphrase: 'Archive-Custody-2026',
  recoveryCode: '0123-4567-89AB-CDEF',
} as const

vi.mock('../../src/infrastructure/settings-store/tauri-settings-store', () => ({
  loadAppSettings: mocks.loadAppSettings,
}))

describe('useMissionControlViewModel', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-17T10:00:00.000Z'))
    mocks.loadAppSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      missionDefaults: {
        ...DEFAULT_APP_SETTINGS.missionDefaults,
        adminRoster: ['Incident Controller', 'Ops Lead'],
      },
    })
    resetStores()
  })

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    vi.useRealTimers()
    vi.clearAllMocks()
    resetStores()
  })

  it('requires duplicate mission-name acknowledgement before starting a conflicting mission', async () => {
    const controller = createController({
      hasMissionNameConflict: vi.fn().mockResolvedValue(true),
    })
    useMissionStore.setState({
      controller,
      phase: 'idle',
      currentMission: null,
      recoverableMission: null,
    })
    const { getModel } = renderHook()

    act(() => {
      getModel().setMissionName('  Duplicate Mission  ')
      getModel().setStartOffsetHours('2')
    })

    await act(async () => {
      await getModel().startMission()
    })

    expect(controller.startMission).not.toHaveBeenCalled()
    expect(getModel().duplicateWarning).toContain('Mission name already exists')

    await act(async () => {
      await getModel().startMission()
    })

    expect(controller.startMission).toHaveBeenCalledWith({
      name: 'Duplicate Mission',
      startTime: '2026-05-17T08:00:00.000Z',
    })
    expect(getModel().missionName).toBe('')
    expect(getModel().startOffsetHours).toBe('0')
    expect(getModel().duplicateWarning).toBeNull()
  })

  it('keeps lifecycle control enablement tied to mission phase', () => {
    useMissionStore.setState({
      controller: createController(),
      phase: 'idle',
      currentMission: null,
      recoverableMission: null,
    })
    const { getModel } = renderHook()

    expect(getModel().canStart).toBe(true)
    expect(getModel().canPauseOrResume).toBe(false)
    expect(getModel().canFinish).toBe(false)

    act(() => {
      useMissionStore.setState({
        phase: 'active',
        currentMission: createMission({ status: 'active' }),
        recoverableMission: null,
      })
    })

    expect(getModel().canStart).toBe(false)
    expect(getModel().canPauseOrResume).toBe(true)
    expect(getModel().canFinish).toBe(true)
    expect(getModel().pauseResumeLabel).toBe('Pause')
  })

  it('commits the explicit participant draft immediately after mission creation [DON-271]', async () => {
    const controller = createController()
    const selectInitialParticipants = vi.fn().mockResolvedValue([])
    useMissionStore.setState({ controller, phase: 'idle' })
    useParticipantStore.setState({
      controller: {
        selectInitialParticipants,
      } as never,
    })
    const { getModel } = renderHook()
    act(() => getModel().setMissionName('Explicit Selection Mission'))

    await act(async () => getModel().startMission())

    expect(selectInitialParticipants).toHaveBeenCalledWith('mission-1', 'Mission coordinator')
  })

  it('keeps mission-start input visible when initial participant persistence fails', async () => {
    const controller = createController()
    const selectInitialParticipants = vi.fn().mockRejectedValue(
      new Error('Participant selection could not be saved.'),
    )
    useMissionStore.setState({ controller, phase: 'idle' })
    useParticipantStore.setState({
      controller: { selectInitialParticipants } as never,
    })
    const { getModel } = renderHook()
    act(() => {
      getModel().setMissionName('Recoverable Selection Mission')
      getModel().setStartOffsetHours('2')
    })

    await act(async () => getModel().startMission())

    expect(getModel().startError).toMatch(/participant selection could not be saved/i)
    expect(getModel().missionName).toBe('Recoverable Selection Mission')
    expect(getModel().startOffsetHours).toBe('2')
  })

  it('loads admin roster when unlock is opened and sends selected unlock details', async () => {
    const governanceController = {
      refreshGovernanceMission: vi.fn().mockResolvedValue(undefined),
      finalizeGovernanceMission: vi.fn(),
      acknowledgeGovernanceEvidenceLoss: vi.fn(),
      unlockGovernanceMission: vi.fn().mockResolvedValue(createMission({ status: 'finished' })),
    }
    useMissionStore.setState({
      governanceController,
      governanceMission: createMission({ id: 'mission-finalized', status: 'finalized' }),
    })
    const { getModel } = renderHook()

    await act(async () => {
      getModel().setShowUnlockDialog(true)
      await Promise.resolve()
    })

    expect(mocks.loadAppSettings).toHaveBeenCalledOnce()
    expect(getModel().adminRoster).toEqual(['Incident Controller', 'Ops Lead'])
    expect(getModel().selectedAdmin).toBe('Incident Controller')

    act(() => {
      getModel().setUnlockReason('Correcting post-incident metadata.')
    })
    await act(async () => {
      await getModel().confirmUnlock()
    })

    expect(governanceController.unlockGovernanceMission).toHaveBeenCalledWith({
      mission_id: 'mission-finalized',
      admin_name: 'Incident Controller',
      reason: 'Correcting post-incident metadata.',
    })
    expect(getModel().showUnlockDialog).toBe(false)
    expect(getModel().unlockReason).toBe('')
  })

  it('binds recovery issuance, cancellation, and finalization custody to governance', async () => {
    const issuance = {
      operationId: ARCHIVE_CUSTODY.operationId,
      recoveryCode: ARCHIVE_CUSTODY.recoveryCode,
      expiresAt: '2026-05-17T10:10:00.000Z',
    }
    const finalizedMission = createMission({ id: 'mission-finished', status: 'finalized' })
    const finalizationResult = {
      mission: finalizedMission,
      archive: {
        id: 'archive-1',
        mission_id: finalizedMission.id,
        protected_finalization_epoch: 1,
        archive_kind: 'finalized' as const,
        container_version: 2 as const,
        archive_path: '/archives/mission-finished.sararch',
        ciphertext_sha256: 'a'.repeat(64),
        size_bytes: 1024,
        created_at: '2026-05-17T10:00:00.000Z',
        verified_at: '2026-05-17T10:01:00.000Z',
        previous_archive_id: null,
        status: 'verified' as const,
        availability: 'present' as const,
        availability_reason: null,
        slots: [
          { slotId: 'passphrase', slotType: 'passphrase' as const },
          { slotId: 'recovery', slotType: 'recovery' as const },
        ],
        last_non_machine_unwrap_at: '2026-05-17T10:01:00.000Z',
      },
    }
    const governanceController = {
      refreshGovernanceMission: vi.fn().mockResolvedValue(undefined),
      issueGovernanceArchiveRecoveryCode: vi.fn().mockResolvedValue(issuance),
      cancelGovernanceArchiveOperation: vi.fn().mockResolvedValue(true),
      finalizeGovernanceMission: vi.fn().mockResolvedValue(finalizationResult),
      acknowledgeGovernanceEvidenceLoss: vi.fn(),
      unlockGovernanceMission: vi.fn(),
    }
    useMissionStore.setState({
      governanceController,
      governanceMission: createMission({ id: 'mission-finished', status: 'finished' }),
    })
    const { getModel } = renderHook()

    await act(async () => {
      await expect(getModel().issueArchiveRecoveryCode('mission-finished')).resolves.toBe(issuance)
      await expect(getModel().cancelArchiveOperation(ARCHIVE_CUSTODY.operationId)).resolves.toBe(true)
      await expect(getModel().confirmFinalize(ARCHIVE_CUSTODY)).resolves.toBe(finalizationResult)
    })

    expect(governanceController.issueGovernanceArchiveRecoveryCode)
      .toHaveBeenCalledWith('mission-finished')
    expect(governanceController.cancelGovernanceArchiveOperation)
      .toHaveBeenCalledWith(ARCHIVE_CUSTODY.operationId)
    expect(governanceController.finalizeGovernanceMission)
      .toHaveBeenCalledWith('mission-finished', ARCHIVE_CUSTODY)
    expect(getModel().governanceFeedback).toContain('/archives/mission-finished.sararch')
  })

  it('binds cleanup checklist and completion to finalized mission governance', async () => {
    const cleanupState = {
      archive: { id: 'archive-1' },
      eligibility: {
        eligible: false,
        blockers: ['fresh_non_machine_unlock_required'],
        storageState: 'live',
      },
    }
    const cleanupResult = {
      missionId: 'mission-finalized',
      archiveId: 'archive-1',
      state: 'completed',
      storageState: 'archived',
      movedRows: 31,
    }
    const governanceController = {
      refreshGovernanceMission: vi.fn().mockResolvedValue(undefined),
      readGovernanceCleanupState: vi.fn().mockResolvedValue(cleanupState),
      startGovernanceCleanup: vi.fn().mockResolvedValue(cleanupResult),
    }
    useMissionStore.setState({
      governanceController: governanceController as never,
      governanceMission: createMission({
        id: 'mission-finalized',
        name: 'Cleanup Mission',
        status: 'finalized',
        storage_state: 'live',
      }),
    })
    const { getModel } = renderHook()

    act(() => getModel().setShowCleanupDialog(true))
    expect(getModel().showCleanupDialog).toBe(true)
    await act(async () => {
      await expect(getModel().loadCleanupState('mission-finalized')).resolves.toBe(cleanupState)
      await expect(getModel().startCleanup({
        missionId: 'mission-finalized',
        archiveId: 'archive-1',
        operationId: '11111111-1111-4111-8111-111111111111',
        slotType: 'passphrase',
        secret: 'Four calm words 2026!',
        confirmation: 'Cleanup Mission',
      })).resolves.toBe(cleanupResult)
    })
    expect(getModel().governanceFeedback).toMatch(/remains listed.*archive review/iu)
  })

  it('turns a known evidence-health finalization block into an audited admin flow [DON-276]', async () => {
    const governanceController = {
      refreshGovernanceMission: vi.fn().mockResolvedValue(undefined),
      finalizeGovernanceMission: vi.fn().mockRejectedValue(
        new Error(
          'Error invoking remote method: Mission archive operation failed safely '
          + '(ARCHIVE_EVIDENCE_HEALTH_BLOCKED).',
        ),
      ),
      acknowledgeGovernanceEvidenceLoss: vi.fn().mockResolvedValue({
        state: 'critical',
        reason: 'renderer_pending_evidence_lost',
        pendingCount: 0,
        corruptCount: 0,
        conflictCount: 0,
        rejectedCount: 0,
        affectedDeviceCount: 0,
        conflictDeviceIds: [],
        acknowledgedLoss: {
          adminName: 'Incident Controller',
          reason: 'Known runtime loss reviewed.',
          acknowledgedAt: '2026-08-26T17:00:00.000Z',
        },
      }),
      unlockGovernanceMission: vi.fn(),
    }
    useMissionStore.setState({
      governanceController,
      governanceMission: createMission({ id: 'mission-finished', status: 'finished' }),
      governanceEvidenceHealth: {
        state: 'critical',
        reason: 'renderer_pending_evidence_lost',
        pendingCount: 0,
        corruptCount: 0,
        conflictCount: 0,
        rejectedCount: 0,
        affectedDeviceCount: 0,
        conflictDeviceIds: [],
      },
    })
    useIngestHealthStore.setState({
      evidenceHealth: {
        state: 'critical',
        reason: 'renderer_pending_evidence_lost',
        pendingCount: 0,
        corruptCount: 0,
        conflictCount: 0,
        rejectedCount: 0,
        affectedDeviceCount: 0,
        conflictDeviceIds: [],
      },
    })
    const { getModel } = renderHook()

    await act(async () => {
      await expect(getModel().confirmFinalize(ARCHIVE_CUSTODY)).rejects.toThrow(
        /ARCHIVE_EVIDENCE_HEALTH_BLOCKED/i,
      )
      await Promise.resolve()
    })

    expect(getModel().showFinalizeDialog).toBe(false)
    expect(getModel().showEvidenceLossDialog).toBe(true)
    expect(getModel().actionError).toBeNull()
    expect(getModel().selectedAdmin).toBe('Incident Controller')

    act(() => getModel().setEvidenceLossReason('Known runtime loss reviewed.'))
    await act(async () => getModel().confirmEvidenceLossAcknowledgement())

    expect(governanceController.acknowledgeGovernanceEvidenceLoss).toHaveBeenCalledWith({
      mission_id: 'mission-finished',
      admin_name: 'Incident Controller',
      reason: 'Known runtime loss reviewed.',
    })
    expect(getModel().showEvidenceLossDialog).toBe(false)
    expect(getModel().governanceFeedback).toMatch(/complete remains unavailable/i)
  })

  it('does not offer evidence-loss acknowledgement for other degraded evidence', async () => {
    const governanceController = {
      refreshGovernanceMission: vi.fn().mockResolvedValue(undefined),
      finalizeGovernanceMission: vi.fn().mockRejectedValue(
        new Error('Degraded evidence health blocks finalization.'),
      ),
      acknowledgeGovernanceEvidenceLoss: vi.fn(),
      unlockGovernanceMission: vi.fn(),
    }
    useMissionStore.setState({
      governanceController,
      governanceMission: createMission({ id: 'mission-finished', status: 'finished' }),
      governanceEvidenceHealth: {
        state: 'critical',
        reason: 'outbox_corrupt_record',
        pendingCount: 0,
        corruptCount: 1,
        conflictCount: 0,
        rejectedCount: 0,
        affectedDeviceCount: 0,
        conflictDeviceIds: [],
      },
    })
    useIngestHealthStore.setState({
      evidenceHealth: {
        state: 'critical',
        reason: 'outbox_corrupt_record',
        pendingCount: 0,
        corruptCount: 1,
        conflictCount: 0,
        rejectedCount: 0,
        affectedDeviceCount: 0,
        conflictDeviceIds: [],
      },
    })
    const { getModel } = renderHook()

    await act(async () => {
      await expect(getModel().confirmFinalize(ARCHIVE_CUSTODY)).rejects.toThrow(
        /degraded evidence health blocks finalization/i,
      )
    })

    expect(getModel().showEvidenceLossDialog).toBe(false)
    expect(getModel().actionError).toMatch(/degraded evidence health blocks finalization/i)
  })

  function renderHook(): { readonly getModel: () => MissionControlViewModel } {
    let currentModel: MissionControlViewModel | null = null

    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(
        React.createElement(ModelProbe, {
          onModel: (model) => {
            currentModel = model
          },
        }),
      )
    })

    return {
      getModel: () => {
        if (currentModel === null) {
          throw new Error('Mission control model was not rendered.')
        }
        return currentModel
      },
    }
  }
})

function ModelProbe(props: { readonly onModel: (model: MissionControlViewModel) => void }) {
  const model = useMissionControlViewModel()

  useEffect(() => {
    props.onModel(model)
  }, [model, props])

  return null
}

function resetStores(): void {
  useMissionStore.setState({
    phase: 'idle',
    currentMission: null,
    recoverableMission: null,
    governanceMission: null,
    governanceEvidenceHealth: null,
    controller: null,
    governanceController: null,
  })
  useMissionReviewWorkspaceStore.setState({ open: false })
  useFocusModeStore.setState({ active: false })
  useParticipantStore.setState(useParticipantStore.getInitialState())
  useIngestHealthStore.setState(useIngestHealthStore.getInitialState())
}

function createController(overrides: Partial<ReturnType<typeof createController>> = {}) {
  return {
    startMission: vi.fn().mockResolvedValue(createMission()),
    hasMissionNameConflict: vi.fn().mockResolvedValue(false),
    pauseMission: vi.fn().mockResolvedValue(createMission({ status: 'paused' })),
    resumeMission: vi.fn().mockResolvedValue(createMission({ status: 'active' })),
    finishMission: vi.fn().mockResolvedValue(createMission({ status: 'finished' })),
    resumeRecoverableMission: vi.fn().mockResolvedValue(createMission({ status: 'active' })),
    startFresh: vi.fn().mockResolvedValue(createMission({ status: 'finished' })),
    ...overrides,
  }
}

function createMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    name: 'Mission Control Test',
    status: 'active',
    start_time: '2026-05-17T09:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 1,
    ...overrides,
  }
}
