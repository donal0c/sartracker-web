import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MissionArchiveCleanupDialog,
  type MissionArchiveCleanupDialogProps,
} from '../../src/features/mission/mission-archive-cleanup-dialog'
import type {
  MissionArchiveInfo,
  MissionArchiveProgress,
  MissionCleanupBlocker,
  MissionCleanupResult,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const MISSION_ID = 'mission-cleanup-1'
const ARCHIVE_ID = 'archive-cleanup-1'
const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const MISSION_NAME = 'Glen Rescue 42'
const PASSPHRASE = 'Four calm words 2026!'
const RECOVERY_CODE = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const WARNING = 'bulk evidence rows for this mission move out of the live database; the mission remains listed and reviewable from its verified encrypted archive; nothing is deleted from the archive; this is not an evidence-deletion feature.'

describe('MissionArchiveCleanupDialog [DON-253]', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount())
    host?.remove()
    root = null
    host = null
    vi.restoreAllMocks()
  })

  it('states the exact scope and renders every fail-closed blocker without a destructive action', async () => {
    const blockers: MissionCleanupBlocker[] = [
      'archive_custody_busy',
      'archive_custody_mismatch',
      'archive_review_active',
      'cleanup_in_progress',
      'current_archive_not_verified',
      'current_finalization_epoch_mismatch',
      'evidence_health_not_clean',
      'finalization_fence_active',
      'fresh_non_machine_unlock_required',
      'mission_not_finalized',
      'operational_state_unsettled',
      'verification_proof_invalid',
    ]
    render(createProps({
      loadState: vi.fn().mockResolvedValue({
        archive: archive(),
        eligibility: {
          eligible: false,
          startableWithCredential: false,
          blockers,
          storageState: 'live',
        },
      }),
    }))
    await flush()

    expect(readText()).toContain(WARNING)
    for (const expected of [
      'archive work is active',
      'archive file does not match',
      'archive review is active',
      'cleanup is already in progress',
      'latest archive is not verified',
      'finalization epoch is not current',
      'evidence health is not clean',
      'finalization fence is active',
      'fresh passphrase or recovery code is required',
      'mission is not finalized',
      'operational evidence work is unsettled',
      'verification proof is invalid',
    ]) expect(readText().toLowerCase()).toContain(expected)
    expect(document.querySelector('[data-testid="archive-cleanup-secret"]')).toBeNull()
    expect(document.querySelector('[data-testid="archive-cleanup-start"]')).toBeNull()
    expect(readText().toLowerCase()).not.toContain('delete evidence')
  })

  it('renders the fixed checklist with audible passed, pending, and blocked states', async () => {
    render(createProps())
    await flush()

    expect(readText()).toContain('Passed: Mission is finalized')
    expect(readText()).toContain('Passed: Current archive is exhaustively verified')
    expect(readText()).toContain('Passed: Finalization epoch is current')
    expect(readText()).toContain('Passed: Exact archive custody identity matches')
    expect(readText()).toContain('Pending: Fresh passphrase or recovery code is required at start')
  })

  it('masks passphrase and recovery inputs and requires the exact mission name', async () => {
    render(createProps())
    await flush()
    expect(input('archive-cleanup-secret').type).toBe('password')
    setSelect('archive-cleanup-slot-type', 'recovery')
    expect(input('archive-cleanup-secret').type).toBe('password')
    setInput('archive-cleanup-secret', RECOVERY_CODE)
    setInput('archive-cleanup-confirmation', MISSION_NAME.toLowerCase())
    expect(button('archive-cleanup-start').disabled).toBe(true)
    setInput('archive-cleanup-confirmation', MISSION_NAME)
    expect(button('archive-cleanup-start').disabled).toBe(false)
  })

  it('submits one bounded credential, scrubs it immediately, and reports closed progress/completion', async () => {
    const completion = deferred<MissionCleanupResult>()
    const startCleanup = vi.fn(() => completion.promise)
    const listeners = new Set<(progress: MissionArchiveProgress) => void>()
    const onCompleted = vi.fn()
    render(createProps({
      startCleanup,
      onCompleted,
      subscribeProgress: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }))
    await flush()
    setInput('archive-cleanup-secret', PASSPHRASE)
    setInput('archive-cleanup-confirmation', MISSION_NAME)
    await click('archive-cleanup-start')

    expect(startCleanup).toHaveBeenCalledWith({
      missionId: MISSION_ID,
      archiveId: ARCHIVE_ID,
      operationId: OPERATION_ID,
      slotType: 'passphrase',
      secret: PASSPHRASE,
      confirmation: MISSION_NAME,
    })
    expect(document.querySelector('[data-testid="archive-cleanup-secret"]')).toBeNull()
    expect(readText()).not.toContain(PASSPHRASE)
    act(() => {
      for (const listener of listeners) listener(progress({
        completed: 50,
        detail: 'Moved live rows: positions',
      }))
    })
    expect(readText()).toContain('Moved live rows: positions')
    expect(readText()).toContain('50 rows moved')

    const result: MissionCleanupResult = {
      missionId: MISSION_ID,
      archiveId: ARCHIVE_ID,
      state: 'completed',
      storageState: 'archived',
      movedRows: 73,
    }
    completion.resolve(result)
    await flush()
    expect(onCompleted).toHaveBeenCalledWith(result)
    expect(state()).toBe('completed')
    expect(readText()).toMatch(/mission remains listed.*archive review/iu)
  })

  it('keeps durable completion terminal when the post-commit callback throws', async () => {
    render(createProps({
      onCompleted: vi.fn(() => { throw new Error('refresh failed after commit') }),
    }))
    await flush()
    setInput('archive-cleanup-secret', PASSPHRASE)
    setInput('archive-cleanup-confirmation', MISSION_NAME)
    await click('archive-cleanup-start')
    await flush()

    expect(state()).toBe('completed')
    expect(readText()).toContain('Live-store archival completed.')
    expect(readText()).toMatch(/timeline refresh failed/iu)
    expect(readText()).not.toContain('refresh failed after commit')
  })

  it('reports a separate warning when post-commit timeline refresh rejects', async () => {
    render(createProps({
      onCompleted: vi.fn().mockRejectedValue(new Error('timeline unavailable')),
    }))
    await flush()
    setInput('archive-cleanup-secret', PASSPHRASE)
    setInput('archive-cleanup-confirmation', MISSION_NAME)
    await click('archive-cleanup-start')
    await flush()

    expect(state()).toBe('completed')
    expect(readText()).toContain('Live-store archival completed.')
    expect(readText()).toMatch(/timeline refresh.*failed|refresh.*timeline/iu)
    expect(readText()).not.toContain('timeline unavailable')
  })

  it('does not retain oversized renderer credential or confirmation values', async () => {
    render(createProps())
    await flush()
    setInput('archive-cleanup-secret', 'A'.repeat(1_025))
    setInput('archive-cleanup-confirmation', 'B'.repeat(1_025))
    await flush()

    expect(input('archive-cleanup-secret').value).toBe('')
    expect(input('archive-cleanup-confirmation').value).toBe('')
    expect(button('archive-cleanup-start').disabled).toBe(true)
  })

  it('requests sender-owned cancellation and never reflects operation error text', async () => {
    const completion = deferred<MissionCleanupResult>()
    const cancelOperation = vi.fn().mockResolvedValue(true)
    render(createProps({ startCleanup: () => completion.promise, cancelOperation }))
    await flush()
    setInput('archive-cleanup-secret', PASSPHRASE)
    setInput('archive-cleanup-confirmation', MISSION_NAME)
    await click('archive-cleanup-start')
    await click('archive-cleanup-cancel')
    expect(cancelOperation).toHaveBeenCalledWith(OPERATION_ID)
    expect(state()).toBe('cancellation-requested')

    completion.reject(Object.assign(new Error('/private/path secret detail'), {
      code: 'ARCHIVE_CLEANUP_CANCELLED',
    }))
    await flush()
    expect(state()).toBe('failure')
    expect(readText()).toMatch(/cancelled safely.*durable restart point/iu)
    expect(readText()).not.toContain('/private/path')
  })

  it('describes an interrupted multi-batch failure without falsely claiming the live store is intact', async () => {
    render(createProps({
      startCleanup: vi.fn().mockRejectedValue(Object.assign(
        new Error('untrusted local failure detail'),
        { code: 'ARCHIVE_CLEANUP_FAILED' },
      )),
    }))
    await flush()
    setInput('archive-cleanup-secret', PASSPHRASE)
    setInput('archive-cleanup-confirmation', MISSION_NAME)
    await click('archive-cleanup-start')
    await flush()

    expect(state()).toBe('failure')
    expect(readText()).toMatch(/some live rows.*already.*moved|already moved.*live rows/iu)
    expect(readText()).toMatch(/resume|durable cursor/iu)
    expect(readText()).not.toContain('The live mission and verified archive remain intact')
    expect(readText()).not.toContain('untrusted local failure detail')
  })

  it('offers a durable resume route for cleanup interrupted across restart', async () => {
    const resumeCleanup = vi.fn().mockResolvedValue({
      missionId: MISSION_ID,
      archiveId: ARCHIVE_ID,
      state: 'completed',
      storageState: 'archived',
      movedRows: 12,
    } satisfies MissionCleanupResult)
    const props = {
      ...createProps({
        loadState: vi.fn().mockResolvedValue({
          archive: archive(),
          eligibility: {
            eligible: false,
            startableWithCredential: false,
            blockers: ['cleanup_in_progress'],
            storageState: 'cleanup_in_progress',
          },
        }),
      }),
      resumeCleanup,
    } as MissionArchiveCleanupDialogProps & {
      readonly resumeCleanup: (input: {
        readonly missionId: string
        readonly archiveId: string
        readonly operationId: string
      }) => Promise<MissionCleanupResult>
    }
    render(props)
    await flush()

    expect(button('archive-cleanup-resume')).toBeTruthy()
    await click('archive-cleanup-resume')
    await flush()
    expect(resumeCleanup).toHaveBeenCalledWith({
      missionId: MISSION_ID,
      archiveId: ARCHIVE_ID,
      operationId: OPERATION_ID,
    })
    expect(state()).toBe('completed')
  })

  function render(props: MissionArchiveCleanupDialogProps): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root?.render(React.createElement(MissionArchiveCleanupDialog, props)))
  }
})

function createProps(
  overrides: Partial<MissionArchiveCleanupDialogProps> = {},
): MissionArchiveCleanupDialogProps {
  return {
    mission: {
      id: MISSION_ID,
      name: MISSION_NAME,
      status: 'finalized',
      start_time: '2026-08-29T08:00:00.000Z',
      pause_time: null,
      finish_time: '2026-08-29T09:00:00.000Z',
      paused_seconds: 0,
      notes: null,
      schema_version: 13,
      storage_state: 'live',
    },
    loadState: vi.fn().mockResolvedValue({
      archive: archive(),
      eligibility: {
        eligible: false,
        startableWithCredential: true,
        blockers: ['fresh_non_machine_unlock_required'],
        storageState: 'live',
      },
    }),
    startCleanup: vi.fn().mockResolvedValue({
      missionId: MISSION_ID,
      archiveId: ARCHIVE_ID,
      state: 'completed',
      storageState: 'archived',
      movedRows: 0,
    }),
    cancelOperation: vi.fn().mockResolvedValue(true),
    createOperationId: () => OPERATION_ID,
    onCompleted: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

function archive(): MissionArchiveInfo {
  return {
    id: ARCHIVE_ID,
    mission_id: MISSION_ID,
    protected_finalization_epoch: 9,
    archive_kind: 'finalized_recovery',
    container_version: 2,
    archive_path: '/safe/mission.sararch',
    ciphertext_sha256: 'a'.repeat(64),
    size_bytes: 1024,
    created_at: '2026-08-29T10:00:00.000Z',
    verified_at: '2026-08-29T10:01:00.000Z',
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
}

function progress(overrides: Partial<MissionArchiveProgress> = {}): MissionArchiveProgress {
  return {
    operationId: OPERATION_ID,
    missionId: MISSION_ID,
    kind: 'cleanup',
    sequence: 1,
    phase: 'cleanup',
    unit: 'rows',
    completed: 1,
    total: null,
    detail: 'Moved live rows: positions',
    ...overrides,
  }
}

function input(testId: string): HTMLInputElement {
  const element = document.querySelector(`[data-testid="${testId}"]`)
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input ${testId}`)
  return element
}

function button(testId: string): HTMLButtonElement {
  const element = document.querySelector(`[data-testid="${testId}"]`)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button ${testId}`)
  return element
}

function setInput(testId: string, value: string): void {
  act(() => {
    const element = input(testId)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setSelect(testId: string, value: string): void {
  act(() => {
    const element = document.querySelector(`[data-testid="${testId}"]`)
    if (!(element instanceof HTMLSelectElement)) throw new Error(`Missing select ${testId}`)
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    button(testId).click()
    await Promise.resolve()
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function readText(): string {
  return document.body.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
}

function state(): string | null {
  return document.querySelector('[data-testid="mission-archive-cleanup-dialog"]')
    ?.getAttribute('data-state') ?? null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}
