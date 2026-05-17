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

  it('loads admin roster when unlock is opened and sends selected unlock details', async () => {
    const governanceController = {
      refreshGovernanceMission: vi.fn().mockResolvedValue(undefined),
      finalizeGovernanceMission: vi.fn(),
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
