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

  it('collapses active mission controls while keeping safety controls and restore affordance visible', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    missionControlMock.model = createModel({ phase: 'active' })

    render(React.createElement(MissionControlPanel))
    expect(query('[data-testid="mission-pause-resume-btn"]')).not.toBeNull()

    click('[data-testid="mission-control-collapse-btn"]')

    expect(query('[data-testid="mission-pause-resume-btn"]')).not.toBeNull()
    expect(query('[data-testid="mission-finish-btn"]')).not.toBeNull()
    expect(text('[data-testid="mission-control-collapsed-summary"]')).toContain(
      'Panel Space Mission',
    )
    expect(query('[data-testid="mission-control-expand-btn"]')).not.toBeNull()
  })

  it('does not offer collapse while paused', async () => {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    missionControlMock.model = createModel({ phase: 'paused' })

    render(React.createElement(MissionControlPanel))

    expect(query('[data-testid="mission-control-collapse-btn"]')).toBeNull()
    expect(query('[data-testid="mission-paused-banner"]')).not.toBeNull()
    expect(query('[data-testid="mission-pause-resume-btn"]')).not.toBeNull()
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
    governanceBusy: false,
    governanceFeedback: null,
    adminRoster: [],
    selectedAdmin: '',
    setSelectedAdmin: vi.fn(),
    unlockReason: '',
    setUnlockReason: vi.fn(),
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
    confirmFinalize: vi.fn(),
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

function text(selector: string): string {
  const element = query(selector)
  if (element === null) {
    throw new Error(`Expected ${selector} to exist.`)
  }
  return element.textContent ?? ''
}
