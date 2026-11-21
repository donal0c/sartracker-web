import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MissionControlViewModel } from '../../src/features/mission/use-mission-control-view-model'
import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'

const mocks = vi.hoisted(() => ({
  model: null as MissionControlViewModel | null,
  participantAttention: [] as string[],
  outingAttention: [] as string[],
}))

vi.mock('../../src/features/mission/use-mission-control-view-model', () => ({
  useMissionControlViewModel: () => {
    if (mocks.model === null) throw new Error('Mission control test model was not configured.')
    return mocks.model
  },
}))
vi.mock('../../src/features/mission/use-mission-section-summaries', () => ({
  useParticipantSectionSummary: () => ({ summary: '3 people', attention: mocks.participantAttention }),
  useOutingSectionSummary: () => ({ summary: 'No outing', attention: mocks.outingAttention, enabled: true }),
}))
vi.mock('../../src/components/participant-controls-section', () => ({
  ParticipantControlsSection: () => React.createElement('div', { 'data-testid': 'participants-stub' }),
}))
vi.mock('../../src/components/outing-controls-section', () => ({
  OutingControlsSection: () => React.createElement('div', { 'data-testid': 'outings-stub' }, 'Could not load outings'),
  OpenOutingFinishOffer: () => null,
}))

/**
 * Codex review of DON-341/342: in the simplified workspace Mission sits behind
 * a button, so anything that needs the operator must say so to the workspace,
 * and nothing that needs attention may sit behind a fold.
 */
describe('MissionControlPanel in the simplified workspace', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    mocks.model = null
    mocks.participantAttention = []
    mocks.outingAttention = []
    vi.clearAllMocks()
  })

  async function renderPanel(onAttentionChange = vi.fn()) {
    const { MissionControlPanel } = await import('../../src/components/mission-control-panel')
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(React.createElement(MissionControlPanel, { variant: 'simplified', onAttentionChange })))
    return onAttentionChange
  }

  it('asks for attention when recording participants at Start failed', async () => {
    mocks.model = createModel({ phase: 'active', startError: 'Mission started, but the participants could not be saved.' })
    const onAttentionChange = await renderPanel()
    expect(onAttentionChange).toHaveBeenLastCalledWith(true)
  })

  it('asks for attention when a participant warning holds its section open', async () => {
    mocks.model = createModel({ phase: 'active' })
    mocks.participantAttention = ['tracking scope warning']
    const onAttentionChange = await renderPanel()
    expect(onAttentionChange).toHaveBeenLastCalledWith(true)
  })

  it('does not raise participant attention on the new-mission screen', async () => {
    // The setup card is already open there; an empty roster must not lock or badge anything.
    mocks.model = createModel({ phase: 'idle', currentMission: null, canStart: true })
    mocks.participantAttention = ['roster error']
    const onAttentionChange = await renderPanel()
    expect(onAttentionChange).toHaveBeenLastCalledWith(false)
  })

  it('does not raise attention for normal progress such as history still loading', async () => {
    mocks.model = createModel({ phase: 'active' })
    mocks.participantAttention = ['history still loading', 'no participants selected']
    const onAttentionChange = await renderPanel()
    expect(onAttentionChange).toHaveBeenLastCalledWith(false)
  })

  it('stays calm when nothing needs the operator', async () => {
    mocks.model = createModel({ phase: 'active' })
    const onAttentionChange = await renderPanel()
    expect(onAttentionChange).toHaveBeenLastCalledWith(false)
  })

  it('shows an outing failure without first opening More mission options', async () => {
    mocks.model = createModel({ phase: 'active' })
    mocks.outingAttention = ['outing error']
    const onAttentionChange = await renderPanel()
    const outings = document.querySelector('[data-testid="mission-outings-section"]')
    expect(outings).not.toBeNull()
    expect(outings?.closest('details:not([open])')).toBeNull()
    expect(onAttentionChange).toHaveBeenLastCalledWith(true)
  })

  it('never folds a finished mission whose archive needs recovery, and asks for attention', async () => {
    mocks.model = createModel({
      phase: 'idle', currentMission: null, canStart: true,
      governanceMission: createMission({ status: 'finalized', storage_state: 'recovery_required' } as Partial<Mission>),
    })
    const onAttentionChange = await renderPanel()
    const card = document.querySelector('[data-testid="start-screen-finished-mission"]')
    expect(card).not.toBeNull()
    expect(card?.tagName).not.toBe('DETAILS')
    expect(card?.closest('details')).toBeNull()
    expect(onAttentionChange).toHaveBeenLastCalledWith(true)
  })

  it('cannot start a new mission while Resume is still in progress', async () => {
    let finishResume: () => void = () => {}
    const resumeRecoverable = vi.fn(() => new Promise<void>((resolve) => { finishResume = resolve }))
    const startFresh = vi.fn(async () => {})
    mocks.model = createModel({
      phase: 'recovery', currentMission: null,
      recoverableMission: createMission({ status: 'paused', name: 'Exercise Bravo' }),
      resumeRecoverable, startFresh,
    })
    await renderPanel()

    click('[data-testid="start-screen-resume-btn"]')
    expect(resumeRecoverable).toHaveBeenCalledTimes(1)
    expect((document.querySelector('[data-testid="start-screen-resume-btn"]') as HTMLButtonElement).disabled).toBe(true)
    expect((document.querySelector('[data-testid="start-screen-start-new-instead"]') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { finishResume(); await Promise.resolve() })
    expect((document.querySelector('[data-testid="start-screen-resume-btn"]') as HTMLButtonElement).disabled).toBe(false)
  })
})

function createModel(overrides: Partial<MissionControlViewModel> = {}): MissionControlViewModel {
  const phase = overrides.phase ?? 'active'
  return {
    phase,
    currentMission: createMission({ status: phase === 'paused' ? 'paused' : 'active' }),
    recoverableMission: null,
    governanceMission: null,
    governanceCandidates: [],
    selectGovernanceMission: vi.fn(async () => {}),
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
