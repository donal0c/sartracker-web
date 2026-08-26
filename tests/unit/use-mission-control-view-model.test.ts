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

  it('turns a known evidence-health finalization block into an audited admin flow [DON-276]', async () => {
    const governanceController = {
      refreshGovernanceMission: vi.fn().mockResolvedValue(undefined),
      finalizeGovernanceMission: vi.fn().mockRejectedValue(
        new Error('Degraded evidence health blocks finalization.'),
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
      await getModel().confirmFinalize()
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

    await act(async () => getModel().confirmFinalize())

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
