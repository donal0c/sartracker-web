import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MissionControlViewModel } from '../../src/features/mission/use-mission-control-view-model'
import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'

const missionControlMock = vi.hoisted(() => ({
  model: null as MissionControlViewModel | null,
}))

vi.mock('../../src/features/mission/use-mission-control-view-model', () => ({
  useMissionControlViewModel: () => {
    if (missionControlMock.model === null) {
      throw new Error('Mission control test model was not configured.')
    }
    return missionControlMock.model
  },
}))

describe('MissionControlPanel collapse behavior', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    missionControlMock.model = null
    vi.clearAllMocks()
  })

  it('requests top-mast minimization instead of rendering side-panel safety controls', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    const onMinimizedChange = vi.fn()
    missionControlMock.model = createModel({ phase: 'active' })

    render(React.createElement(MissionControlPanel, {
      minimized: false,
      onMinimizedChange,
    }))
    expect(query('[data-testid="mission-pause-resume-btn"]')).not.toBeNull()

    click('[data-testid="mission-control-collapse-btn"]')

    expect(onMinimizedChange).toHaveBeenCalledWith(true)
    expect(query('[data-testid="mission-control-collapsed-summary"]')).toBeNull()
  })

  it('renders nothing in the side panel while the top mast owns the minimized state', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    missionControlMock.model = createModel({ phase: 'active' })

    render(React.createElement(MissionControlPanel, {
      minimized: true,
      onMinimizedChange: vi.fn(),
    }))

    expect(query('[data-testid="mission-control"]')).toBeNull()
    expect(query('[data-testid="mission-pause-resume-btn"]')).toBeNull()
    expect(query('[data-testid="mission-finish-btn"]')).toBeNull()
  })

  it('does not offer collapse while paused', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    missionControlMock.model = createModel({ phase: 'paused' })

    render(React.createElement(MissionControlPanel))

    expect(query('[data-testid="mission-control-collapse-btn"]')).toBeNull()
    expect(query('[data-testid="mission-paused-banner"]')).not.toBeNull()
    expect(query('[data-testid="mission-pause-resume-btn"]')).not.toBeNull()
  })

  it('keeps a failed finish reason inside the open confirmation dialog', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    missionControlMock.model = createModel({
      actionError: 'Mission cannot be finished while participant history backfill is incomplete.',
      showFinishDialog: true,
    })

    render(React.createElement(MissionControlPanel))

    const dialog = query('[data-testid="mission-finish-dialog"]')
    expect(dialog?.querySelector('[data-testid="mission-action-error"]')?.textContent)
      .toContain('participant history backfill is incomplete')
  })

  it('renders the bounded encrypted archive custody flow instead of the legacy confirmation', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    missionControlMock.model = createModel({
      phase: 'idle',
      currentMission: null,
      governanceMission: createMission({ id: 'mission-finished', status: 'finished' }),
      showFinalizeDialog: true,
    })

    render(React.createElement(MissionControlPanel))
    await act(async () => {
      await import('../../src/features/mission/mission-archive-custody-dialog')
    })

    expect(query('[data-testid="mission-archive-custody-dialog"]')).not.toBeNull()
    expect(query('[data-testid="mission-finalize-confirm"]')).toBeNull()
  })

  it('offers Archive & Lock only for a finished mission whose live storage is proven', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    missionControlMock.model = createModel({
      phase: 'idle',
      currentMission: null,
      governanceMission: createMission({ status: 'finished', storage_state: 'live' }),
    })
    render(React.createElement(MissionControlPanel))
    expect(query('[data-testid="mission-finalize-btn"]')).not.toBeNull()

    for (const storageState of ['cleanup_in_progress', 'recovery_required'] as const) {
      missionControlMock.model = createModel({
        phase: 'idle',
        currentMission: null,
        governanceMission: createMission({
          id: `mission-finished-${storageState}`,
          status: 'finished',
          storage_state: storageState,
        }),
      })
      act(() => root?.render(React.createElement(MissionControlPanel)))
      expect(query('[data-testid="mission-finalize-btn"]')).toBeNull()
    }
  })

  it('shows explicit live/archived storage truth and withholds cleanup and unlock after cleanup', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    const setShowCleanupDialog = vi.fn()
    missionControlMock.model = createModel({
      phase: 'idle',
      currentMission: null,
      governanceMission: createMission({
        id: 'mission-finalized-live',
        status: 'finalized',
        storage_state: 'live',
      }),
      setShowCleanupDialog,
    })
    render(React.createElement(MissionControlPanel))

    expect(query('[data-testid="mission-storage-state"]')?.textContent).toContain('live')
    click('[data-testid="mission-cleanup-btn"]')
    expect(setShowCleanupDialog).toHaveBeenCalledWith(true)

    missionControlMock.model = createModel({
      phase: 'idle',
      currentMission: null,
      governanceMission: createMission({
        id: 'mission-finalized-archived',
        status: 'finalized',
        storage_state: 'archived',
      }),
    })
    act(() => root?.render(React.createElement(MissionControlPanel)))
    expect(query('[data-testid="mission-storage-state"]')?.textContent).toContain('archived')
    expect(query('[data-testid="mission-cleanup-btn"]')).toBeNull()
    expect(query('[data-testid="mission-unlock-btn"]')).toBeNull()
  })

  it('opens a neutral cleanup review before resumability is known in Mission Control', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    const setShowCleanupDialog = vi.fn()
    missionControlMock.model = createModel({
      phase: 'idle',
      currentMission: null,
      governanceMission: createMission({
        id: 'mission-cleanup-in-progress',
        status: 'finalized',
        storage_state: 'cleanup_in_progress',
      }),
      setShowCleanupDialog,
    })

    render(React.createElement(MissionControlPanel))

    const reviewCleanup = query('[data-testid="mission-cleanup-btn"]')
    expect(reviewCleanup?.textContent).toContain('Review Archive Cleanup')
    expect(query('[data-testid="mission-cleanup-resume-btn"]')).toBeNull()
    click('[data-testid="mission-cleanup-btn"]')
    expect(setShowCleanupDialog).toHaveBeenCalledWith(true)
  })

  function render(element: React.ReactElement): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(element)
    })
  }
})

function createModel(overrides: Partial<MissionControlViewModel> = {}): MissionControlViewModel {
  const phase = overrides.phase ?? 'active'
  return {
    phase,
    currentMission: createMission({ status: phase === 'paused' ? 'paused' : 'active' }),
    recoverableMission: null,
    governanceMission: null,
    focusModeActive: false,
    timerState: {
      elapsedSeconds: 3723,
      activeSeconds: phase === 'paused' ? 3600 : 3723,
    },
    missionName: '',
    setMissionName: vi.fn(),
    startOffsetHours: '0',
    setStartOffsetHours: vi.fn(),
    startError: null,
    actionError: null,
    duplicateWarning: null,
    showFinishDialog: false,
    setShowFinishDialog: vi.fn(),
    showFinalizeDialog: false,
    setShowFinalizeDialog: vi.fn(),
    showUnlockDialog: false,
    setShowUnlockDialog: vi.fn(),
    showCleanupDialog: false,
    setShowCleanupDialog: vi.fn(),
    showEvidenceLossDialog: false,
    setShowEvidenceLossDialog: vi.fn(),
    governanceBusy: false,
    governanceFeedback: null,
    adminRoster: [],
    selectedAdmin: '',
    setSelectedAdmin: vi.fn(),
    unlockReason: '',
    setUnlockReason: vi.fn(),
    evidenceLossReason: '',
    setEvidenceLossReason: vi.fn(),
    canOpenReview: true,
    openReviewWorkspace: vi.fn(),
    canStart: false,
    canPauseOrResume: true,
    pauseResumeLabel: phase === 'paused' ? 'Resume' : 'Pause',
    canFinish: true,
    startMission: vi.fn(),
    pauseOrResume: vi.fn(),
    confirmFinish: vi.fn(),
    resumeRecoverable: vi.fn(),
    startFresh: vi.fn(),
    issueArchiveRecoveryCode: vi.fn(),
    cancelArchiveOperation: vi.fn(),
    subscribeArchiveProgress: vi.fn(() => vi.fn()),
    confirmFinalize: vi.fn(),
    loadCleanupState: vi.fn(),
    startCleanup: vi.fn(),
    confirmEvidenceLossAcknowledgement: vi.fn(),
    confirmUnlock: vi.fn(),
    ...overrides,
  }
}

function createMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-1',
    name: 'Panel Space Mission',
    status: 'active',
    start_time: '2026-06-02T09:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 1,
    ...overrides,
  }
}

function click(selector: string): void {
  const element = query(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${selector} to be an HTML element.`)
  }
  act(() => element.click())
}

function query(selector: string): Element | null {
  return document.querySelector(selector)
}
