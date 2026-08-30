// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchOperationsTab } from '../../src/components/mission-evidence-replay-tabs'
import { MissionReviewWorkspace } from '../../src/components/mission-review-workspace'
import { useMissionArchiveReviewStore } from '../../src/features/mission-review/mission-archive-review-store'
import { buildMissionReviewSnapshot } from '../../src/features/mission-review/mission-review-model'
import { useMissionReviewStore } from '../../src/features/mission-review/mission-review-store'
import { useMissionReviewWorkspaceStore } from '../../src/features/mission-review/mission-review-workspace-store'
import {
  createMissionReviewRuntimeState,
  type MissionReviewController,
} from '../../src/features/mission-review/start-mission-review-runtime'
import { useMissionStore } from '../../src/features/mission/mission-store'
import type {
  Mission,
  MissionArchiveInfo,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

const ARCHIVE_DATABASE_PATH = '/private/tmp/archive-review/session/mission-store.sqlite'
const ARCHIVE_BACKUP_PATH = '/private/tmp/archive-review/session/mission-store.sqlite.backup'
const CIPHERTEXT_SHA256 = 'c'.repeat(64)

const ACTIVE_LOOKING_ARCHIVED_MISSION: Mission = {
  id: 'mission-archive-fixed',
  name: 'Archived Active-Looking Mission',
  status: 'active',
  start_time: '2026-08-29T08:00:00.000Z',
  pause_time: null,
  finish_time: null,
  paused_seconds: 0,
  notes: null,
  schema_version: 13,
}

const FINALIZED_LIVE_MISSION: Mission = {
  ...ACTIVE_LOOKING_ARCHIVED_MISSION,
  id: 'mission-finalized-live-cleanup',
  name: 'Finalized Live Cleanup Mission',
  status: 'finalized',
  finish_time: '2026-08-29T10:00:00.000Z',
  storage_state: 'live',
}

const VERIFIED_CLEANUP_ARCHIVE: MissionArchiveInfo = {
  id: 'archive-finalized-live-cleanup',
  mission_id: FINALIZED_LIVE_MISSION.id,
  protected_finalization_epoch: 1,
  archive_kind: 'finalized',
  container_version: 2,
  archive_path: '/private/archive-custody/finalized-live.sararch',
  ciphertext_sha256: 'd'.repeat(64),
  size_bytes: 4_096,
  created_at: '2026-08-29T10:05:00.000Z',
  verified_at: '2026-08-29T10:06:00.000Z',
  previous_archive_id: null,
  previous_archive_sha256: null,
  revision_sequence: 1,
  revision_count: 1,
  supplement_authority: null,
  supplement_reason: null,
  supplement_created_at: null,
  status: 'verified',
  availability: 'present',
  availability_reason: null,
  slots: [
    { slotId: 'passphrase-v1', slotType: 'passphrase' },
    { slotId: 'recovery-v1', slotType: 'recovery' },
  ],
  last_non_machine_unwrap_at: null,
}

const SEALED_UNVERIFIED_ARCHIVE: MissionArchiveInfo = {
  ...VERIFIED_CLEANUP_ARCHIVE,
  id: 'archive-finalized-sealed-unverified',
  verified_at: null,
  status: 'sealed',
  last_non_machine_unwrap_at: null,
}

const VERIFICATION_PASSPHRASE = 'Verify-Archive-Passphrase-2026!'
const VERIFICATION_RECOVERY_CODE = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'

const ARCHIVE_SESSION = Object.freeze({
  sessionId: '987c24da-d3cf-4cac-84d2-b1df45a0e94c',
  archiveId: 'archive-v2-verified',
  missionId: ACTIVE_LOOKING_ARCHIVED_MISSION.id,
  containerVersion: 2 as const,
  encrypted: true,
  verified: true,
  immutable: true,
  ciphertextSha256: CIPHERTEXT_SHA256,
  previousArchiveId: null,
  openedAt: '2026-08-30T09:00:00.000Z',
  plaintextResidual: 'permission_restricted_session_open' as const,
})

describe('archive-backed Mission Review workspace safety [DON-253 / BCP-16]', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    useMissionStore.setState({
      phase: 'idle',
      currentMission: null,
      recoverableMission: null,
      governanceMission: null,
      governanceController: null,
    })
    useMissionReviewWorkspaceStore.setState({ open: true })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useMissionReviewWorkspaceStore.setState({ open: false })
    useMissionReviewStore.setState(useMissionReviewStore.getInitialState())
    useMissionArchiveReviewStore.setState(useMissionArchiveReviewStore.getInitialState())
    vi.restoreAllMocks()
  })

  it('keeps a path-free verified archive banner visible while operators move between Review tabs', async () => {
    installArchiveReviewState()
    await act(async () => {
      root.render(createElement(MissionReviewWorkspace))
      await Promise.resolve()
      await Promise.resolve()
    })

    assertVerifiedBanner()
    expect(host.textContent).not.toContain(ARCHIVE_DATABASE_PATH)
    expect(host.textContent).not.toContain(ARCHIVE_BACKUP_PATH)
    expect(host.textContent).not.toMatch(/database path|backup path|scratch path|session directory/iu)

    clickTab('Marker Log')
    await act(async () => { await Promise.resolve() })
    assertVerifiedBanner()
    clickTab('Layer Console')
    await act(async () => { await Promise.resolve() })
    assertVerifiedBanner()
    expect(host.querySelector('[data-testid="mission-review-close-archive"]')).not.toBeNull()
  })

  it('refreshes both live Review and Saved Mission Archives from the visible Refresh action', async () => {
    const refreshSelectedMission = vi.fn().mockResolvedValue(undefined)
    const refreshTimeline = vi.fn().mockResolvedValue(undefined)
    installArchiveReviewState({ refreshSelectedMission })
    useMissionArchiveReviewStore.setState({
      controller: {
        refreshTimeline,
        verifyArchive: vi.fn(),
        cancelArchiveVerification: vi.fn(),
        openArchive: vi.fn(),
        closeArchiveReview: vi.fn(),
        dispose: vi.fn(),
      } as never,
    })

    await act(async () => {
      root.render(createElement(MissionReviewWorkspace))
      await Promise.resolve()
      await Promise.resolve()
    })
    refreshTimeline.mockClear()
    refreshSelectedMission.mockClear()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="mission-review-refresh"]')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(refreshSelectedMission).toHaveBeenCalledOnce()
    expect(refreshTimeline).toHaveBeenCalledOnce()
  })

  it('opens mission-scoped cleanup from the Saved Mission Archives timeline', async () => {
    const refreshSelectedMission = vi.fn().mockResolvedValue(undefined)
    installArchiveReviewState({ refreshSelectedMission })
    useMissionReviewStore.setState({ source: 'live', archiveSession: null } as never)
    const readGovernanceCleanupState = vi.fn().mockResolvedValue({
      archive: VERIFIED_CLEANUP_ARCHIVE,
      eligibility: {
        eligible: false,
        startableWithCredential: true,
        blockers: ['fresh_non_machine_unlock_required'],
        storageState: 'live',
      },
    })
    const startGovernanceCleanup = vi.fn().mockResolvedValue({
      missionId: FINALIZED_LIVE_MISSION.id,
      archiveId: VERIFIED_CLEANUP_ARCHIVE.id,
      state: 'completed',
      storageState: 'archived',
      movedRows: 42,
    })
    useMissionStore.setState({
      governanceController: {
        readGovernanceCleanupState,
        startGovernanceCleanup,
        cancelGovernanceArchiveOperation: vi.fn().mockResolvedValue(true),
      } as never,
    })
    const refreshTimeline = vi.fn().mockResolvedValue(undefined)
    useMissionArchiveReviewStore.setState({
      controller: {
        refreshTimeline,
        openArchive: vi.fn().mockResolvedValue(undefined),
        closeArchiveReview: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined),
      },
      timeline: [{
        mission: FINALIZED_LIVE_MISSION,
        archives: [VERIFIED_CLEANUP_ARCHIVE],
      }],
      phase: 'idle',
      activeOperationId: null,
      activeArchiveId: null,
      activeSession: null,
      progress: null,
      recoveryRequired: 'none',
      error: null,
    })

    await act(async () => {
      root.render(createElement(MissionReviewWorkspace))
      await Promise.resolve()
    })
    const openCleanup = host.querySelector<HTMLButtonElement>(
      `[data-testid="archive-cleanup-open-${FINALIZED_LIVE_MISSION.id}"]`,
    )
    expect(openCleanup).not.toBeNull()
    await act(async () => {
      openCleanup?.click()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await Promise.resolve()
    })

    expect(readGovernanceCleanupState).toHaveBeenCalledWith(FINALIZED_LIVE_MISSION.id)
    expect(host.querySelector('[data-testid="mission-archive-cleanup-dialog"]')).not.toBeNull()

    setDialogInput('archive-cleanup-secret', 'Four calm words 2026!')
    setDialogInput('archive-cleanup-confirmation', FINALIZED_LIVE_MISSION.name)
    refreshTimeline.mockClear()
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="archive-cleanup-start"]')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(startGovernanceCleanup).toHaveBeenCalledOnce()
    expect(refreshTimeline).toHaveBeenCalledOnce()
    expect(refreshSelectedMission).toHaveBeenCalledOnce()
  })

  it('retries a sealed archive from Saved Mission Archives with both original credentials', async () => {
    const refreshSelectedMission = vi.fn().mockResolvedValue(undefined)
    installArchiveReviewState({ refreshSelectedMission })
    useMissionReviewStore.setState({ source: 'live', archiveSession: null } as never)
    const refreshTimeline = vi.fn().mockResolvedValue(undefined)
    const verifyArchive = vi.fn().mockResolvedValue({
      ...SEALED_UNVERIFIED_ARCHIVE,
      status: 'verified',
      verified_at: '2026-08-30T17:00:00.000Z',
    })
    useMissionArchiveReviewStore.setState({
      controller: {
        refreshTimeline,
        verifyArchive,
        cancelArchiveVerification: vi.fn().mockResolvedValue(true),
        openArchive: vi.fn().mockResolvedValue(undefined),
        closeArchiveReview: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined),
      },
      timeline: [{
        mission: FINALIZED_LIVE_MISSION,
        archives: [SEALED_UNVERIFIED_ARCHIVE],
      }],
      phase: 'idle',
      activeOperationId: null,
      activeArchiveId: null,
      activeSession: null,
      progress: null,
      recoveryRequired: 'none',
      error: null,
    })

    await act(async () => {
      root.render(createElement(MissionReviewWorkspace))
      await Promise.resolve()
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>(
        `[data-testid="archive-verify-retry-${SEALED_UNVERIFIED_ARCHIVE.id}"]`,
      )?.click()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(host.querySelector('[data-testid="mission-archive-verification-dialog"]'))
      .not.toBeNull()

    refreshTimeline.mockClear()
    setDialogInput('archive-verification-passphrase', VERIFICATION_PASSPHRASE)
    setDialogInput('archive-verification-recovery-code', VERIFICATION_RECOVERY_CODE)
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="archive-verification-start"]')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(verifyArchive).toHaveBeenCalledOnce()
    expect(verifyArchive).toHaveBeenCalledWith(expect.objectContaining({
      archiveId: SEALED_UNVERIFIED_ARCHIVE.id,
      passphrase: VERIFICATION_PASSPHRASE,
      recoveryCode: VERIFICATION_RECOVERY_CODE,
      operationId: expect.stringMatching(/^[0-9a-f-]{36}$/iu),
    }))
    await vi.waitFor(() => {
      expect(refreshTimeline).toHaveBeenCalledOnce()
      expect(refreshSelectedMission).toHaveBeenCalledOnce()
    })
    expect(host.textContent).not.toContain(VERIFICATION_PASSPHRASE)
    expect(host.textContent).not.toContain(VERIFICATION_RECOVERY_CODE)
  })

  it('opens a retired marker-version attachment through its exact archived reference', async () => {
    const openAttachment = vi.fn().mockResolvedValue(true)
    installArchiveReviewState({ openAttachment })
    await act(async () => {
      root.render(createElement(MissionReviewWorkspace))
      await Promise.resolve()
      await Promise.resolve()
    })

    clickTab('Marker Log')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const historical = host.querySelector<HTMLButtonElement>(
      '[data-testid="mission-review-archived-attachment-marker-version-retired"]',
    )
    expect(historical).not.toBeNull()
    expect(historical?.textContent ?? '').toContain('retired-clue.jpg')

    await act(async () => {
      historical?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(openAttachment).toHaveBeenCalledWith({
      attachmentPath: 'retired-clue.jpg',
      referenceKind: 'marker_version',
      referenceId: 'marker-version-retired',
    })
  })

  it('shows retained search evidence but no mutation controls for an archive read source', () => {
    act(() => root.render(createElement(SearchOperationsTab, {
      controller: { load: vi.fn() } as unknown as MissionReviewController,
      hideMutationControls: true,
      operations: archiveSearchOperations(),
      readOnly: true,
      reviewBusy: false,
      writeBlocked: false,
    })))

    expect(host.querySelector('[data-testid="search-area-area-archive-1"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="search-pass-pass-archive-1"]')).not.toBeNull()
    const readOnlyNotice = host.querySelector('[data-testid="search-operations-read-only"]')
    expect(readOnlyNotice).not.toBeNull()
    expect(readOnlyNotice?.textContent ?? '')
      .toMatch(/permanently read-only/iu)
    for (const testId of [
      'search-operation-entry',
      'search-operation-coordinator',
      'search-assignment-team',
      'search-assignment-participants',
      'search-assignment-notes',
      'search-assignment-record',
      'search-pass-assignment',
      'search-pass-outcome',
      'search-pass-start',
      'search-pass-end',
      'search-pass-participants',
      'search-pass-clues',
      'search-pass-tracks',
      'search-pass-notes',
      'search-pass-record',
    ]) {
      expect(host.querySelector(`[data-testid="${testId}"]`)).toBeNull()
    }
  })

  it('keeps the workspace visible until an opening archive restore is cancelled, joined, and cleaned', async () => {
    installArchiveReviewState()
    useMissionReviewStore.setState({ source: 'live', archiveSession: null } as never)
    const terminalCleanup = deferred<void>()
    const closeArchiveReview = vi.fn(() => terminalCleanup.promise)
    useMissionArchiveReviewStore.setState({
      controller: {
        refreshTimeline: vi.fn().mockResolvedValue(undefined),
        openArchive: vi.fn().mockResolvedValue(undefined),
        closeArchiveReview,
        dispose: vi.fn().mockResolvedValue(undefined),
      },
      timeline: [],
      phase: 'opening',
      activeOperationId: '44c0b79d-f4ad-45db-ac2d-1360c9adf8fd',
      activeArchiveId: 'archive-v2-verified',
      activeSession: null,
      progress: null,
      recoveryRequired: 'none',
      error: null,
    })
    await act(async () => {
      root.render(createElement(MissionReviewWorkspace))
    })

    const closeButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="workspace-close-btn"]',
    )
    expect(closeButton).not.toBeNull()
    act(() => closeButton?.click())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const remainedVisibleWhileCleanupPending = useMissionReviewWorkspaceStore.getState().open

    terminalCleanup.resolve()
    await act(async () => {
      await terminalCleanup.promise
      await Promise.resolve()
    })

    expect(closeArchiveReview).toHaveBeenCalledOnce()
    expect(remainedVisibleWhileCleanupPending).toBe(true)
    expect(useMissionReviewWorkspaceStore.getState().open).toBe(false)
  })

  it.each([
    { layout: 'full', missionPhase: 'idle' as const },
    { layout: 'docked', missionPhase: 'active' as const },
  ])('shows a persistent global plaintext cleanup warning in $layout Review while its data source remains live', async ({ missionPhase }) => {
    const closeArchiveReview = vi.fn().mockRejectedValue(
      new Error('permission-restricted plaintext sweep unavailable'),
    )
    installCleanupBlockedLiveReviewState(closeArchiveReview)
    useMissionStore.setState({ phase: missionPhase })

    await act(async () => {
      root.render(createElement(MissionReviewWorkspace))
    })

    expect(useMissionReviewStore.getState()).toMatchObject({
      source: 'live',
      archiveSession: null,
    })
    expect(useMissionArchiveReviewStore.getState()).toMatchObject({
      phase: 'error',
      activeSession: ARCHIVE_SESSION,
    })
    const banner = host.querySelector<HTMLElement>(
      '[data-testid="mission-review-archive-banner"]',
    )
    expect(banner).not.toBeNull()
    expect(banner?.textContent ?? '').toMatch(/permission-restricted temporary plaintext/iu)
    expect(banner?.textContent ?? '').toMatch(/plaintext cleanup failed safely/iu)
    expect(host.textContent).not.toContain(ARCHIVE_DATABASE_PATH)
    expect(host.textContent).not.toContain(ARCHIVE_BACKUP_PATH)

    const retryClose = host.querySelector<HTMLButtonElement>(
      '[data-testid="mission-review-close-archive"]',
    )
    expect(retryClose).not.toBeNull()
    expect(retryClose?.textContent ?? '').toMatch(/retry close archive review/iu)

    clickTab('Marker Log')
    expect(host.querySelector('[data-testid="mission-review-archive-banner"]')).not.toBeNull()

    await act(async () => {
      retryClose?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(closeArchiveReview).toHaveBeenCalledOnce()
    expect(host.querySelector('[data-testid="mission-review-archive-banner"]')).not.toBeNull()
    expect(host.textContent).toMatch(/plaintext cleanup failed safely/iu)
  })

  it.each([
    { layout: 'full', missionPhase: 'idle' as const },
    { layout: 'docked', missionPhase: 'active' as const },
  ])('shows opening-cleanup ownership without a public session in $layout Review', async ({ missionPhase }) => {
    const closeArchiveReview = vi.fn().mockResolvedValue(undefined)
    installArchiveReviewState()
    useMissionReviewStore.setState({ source: 'live', archiveSession: null } as never)
    useMissionArchiveReviewStore.setState({
      controller: {
        refreshTimeline: vi.fn().mockResolvedValue(undefined),
        openArchive: vi.fn().mockResolvedValue(undefined),
        closeArchiveReview,
        dispose: vi.fn().mockResolvedValue(undefined),
      },
      timeline: [],
      phase: 'error',
      activeOperationId: '44c0b79d-f4ad-45db-ac2d-1360c9adf8fd',
      activeArchiveId: ARCHIVE_SESSION.archiveId,
      activeSession: null,
      progress: null,
      recoveryRequired: 'plaintext_cleanup',
      error: 'Archive Review plaintext cleanup failed safely.',
    })
    useMissionStore.setState({ phase: missionPhase })

    await act(async () => {
      root.render(createElement(MissionReviewWorkspace))
    })

    const banner = host.querySelector<HTMLElement>(
      '[data-testid="mission-review-archive-banner"]',
    )
    expect(banner).not.toBeNull()
    expect(banner?.textContent ?? '').toMatch(/archive review cleanup required/iu)
    expect(banner?.textContent ?? '').toMatch(/temporary plaintext.*may remain/iu)
    expect(host.textContent).not.toContain(ARCHIVE_DATABASE_PATH)
    expect(host.textContent).not.toContain(ARCHIVE_BACKUP_PATH)
  })

  function installArchiveReviewState(
    controllerOverrides: Partial<MissionReviewController> = {},
  ): void {
    const snapshot = buildMissionReviewSnapshot({
      mission: ACTIVE_LOOKING_ARCHIVED_MISSION,
      info: {
        schema_version: 13,
        database_path: ARCHIVE_DATABASE_PATH,
        backup_path: ARCHIVE_BACKUP_PATH,
      },
      events: [],
      markers: [],
      devices: [],
      breadcrumbCount: 0,
      drawings: [],
      helicopters: [],
      gpxImports: [],
      layerMetadata: [],
    })
    const runtime = createMissionReviewRuntimeState({
      missions: [ACTIVE_LOOKING_ARCHIVED_MISSION],
      selectedMissionId: ACTIVE_LOOKING_ARCHIVED_MISSION.id,
      snapshot,
      searchOperations: archiveSearchOperations(),
    })
    useMissionReviewStore.setState({
      ...runtime,
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
      controller: {
        load: vi.fn().mockResolvedValue(undefined),
        listArchiveAttachmentPage: vi.fn().mockResolvedValue({
          entries: [{
            attachmentPath: 'retired-clue.jpg',
            referenceKind: 'marker_version',
            referenceId: 'marker-version-retired',
          }],
          nextCursor: null,
          totalCount: 1,
        }),
        openAttachment: vi.fn().mockResolvedValue(true),
        ...controllerOverrides,
      } as unknown as MissionReviewController,
    } as never)
  }

  function installCleanupBlockedLiveReviewState(
    closeArchiveReview: ReturnType<typeof vi.fn>,
  ): void {
    installArchiveReviewState()
    useMissionReviewStore.setState({ source: 'live', archiveSession: null } as never)
    useMissionArchiveReviewStore.setState({
      controller: {
        refreshTimeline: vi.fn().mockResolvedValue(undefined),
        openArchive: vi.fn().mockResolvedValue(undefined),
        closeArchiveReview,
        dispose: vi.fn().mockResolvedValue(undefined),
      },
      timeline: [],
      phase: 'error',
      activeOperationId: null,
      activeArchiveId: ARCHIVE_SESSION.archiveId,
      activeSession: ARCHIVE_SESSION,
      progress: null,
      recoveryRequired: 'plaintext_cleanup',
      error: 'Archive Review plaintext cleanup failed safely.',
    })
  }

  function assertVerifiedBanner(): void {
    const banner = host.querySelector('[data-testid="mission-review-archive-banner"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent ?? '').toContain('Archived mission - read-only')
    expect(banner?.textContent ?? '').toContain(
      `Verified archive · SHA-256 ${CIPHERTEXT_SHA256.slice(0, 12)}`,
    )
    expect(banner?.textContent ?? '').toMatch(/permission-restricted temporary plaintext/iu)
  }

  function clickTab(label: string): void {
    const candidate = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent === label)
    if (candidate === undefined) {
      throw new Error(`Expected Review tab ${label}.`)
    }
    act(() => candidate.click())
  }
})

/** Sets one React-controlled cleanup dialog input through the native value setter. */
function setDialogInput(testId: string, value: string): void {
  const element = document.querySelector(`[data-testid="${testId}"]`)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input ${testId}`)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Creates one externally settled promise for workspace lifecycle assertions. */
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Builds retained evidence plus mutation-eligible rows from an archive session. */
function archiveSearchOperations(): ReturnType<
  typeof createMissionReviewRuntimeState
>['searchOperations'] {
  return {
    areas: [{
      id: 'area-archive-1',
      mission_id: ACTIVE_LOOKING_ARCHIVED_MISSION.id,
      name: 'Retained search area',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      legacy_drawing_id: null,
      version_sequence: 1,
      updated_by: 'Coordinator',
      created_at: ACTIVE_LOOKING_ARCHIVED_MISSION.start_time,
      updated_at: ACTIVE_LOOKING_ARCHIVED_MISSION.start_time,
      retired_at: null,
    }],
    assignments: [{
      id: 'assignment-archive-1',
      mission_id: ACTIVE_LOOKING_ARCHIVED_MISSION.id,
      search_area_id: 'area-archive-1',
      outing_id: 'outing-archive-1',
      team_id: 'Team Alpha',
      participant_ids_json: '[]',
      notes: null,
      version_sequence: 1,
      updated_by: 'Coordinator',
      created_at: ACTIVE_LOOKING_ARCHIVED_MISSION.start_time,
      updated_at: ACTIVE_LOOKING_ARCHIVED_MISSION.start_time,
      retired_at: null,
    }],
    passes: [{
      id: 'pass-archive-1',
      mission_id: ACTIVE_LOOKING_ARCHIVED_MISSION.id,
      search_area_id: 'area-archive-1',
      assignment_id: 'assignment-archive-1',
      started_at: '2026-08-29T09:00:00.000Z',
      ended_at: '2026-08-29T10:00:00.000Z',
      outcome: 'full',
      notes: null,
      coordinator_name: 'Coordinator',
      participant_ids_json: '[]',
      clue_ids_json: '[]',
      track_evidence_ids_json: '[]',
      participant_count: 0,
      clue_count: 0,
      track_evidence_count: 0,
      version_sequence: 1,
      created_at: '2026-08-29T10:00:00.000Z',
    }],
    outings: [{
      id: 'outing-archive-1',
      mission_id: ACTIVE_LOOKING_ARCHIVED_MISSION.id,
      label: 'Operational period 1',
      started_at: ACTIVE_LOOKING_ARCHIVED_MISSION.start_time,
      ended_at: null,
      created_at: ACTIVE_LOOKING_ARCHIVED_MISSION.start_time,
      updated_at: ACTIVE_LOOKING_ARCHIVED_MISSION.start_time,
    }],
    pages: {
      areas: pageState(1),
      assignments: pageState(1),
      outings: pageState(1),
      passes: pageState(1),
    },
  }
}

/** Creates one empty bounded-page projection. */
function pageState(visibleCount: number) {
  return {
    search: '',
    pageNumber: 1,
    visibleCount,
    totalCount: visibleCount,
    hasMore: false,
    nextCursor: null,
    loading: false,
  }
}
