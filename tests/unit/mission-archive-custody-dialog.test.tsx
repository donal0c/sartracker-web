import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MissionArchiveCustodyDialog,
  type MissionArchiveCustodyDialogProps,
} from '../../src/features/mission/mission-archive-custody-dialog'
import type {
  FinalizeMissionResult,
  MissionArchiveProgress,
  MissionArchiveRecoveryIssuance,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const MISSION_ID = 'mission-custody-1'
const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const RECOVERY_CODE = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const PASSPHRASE = 'Calm archive 2026!'

describe('MissionArchiveCustodyDialog [DON-248]', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('masks both passphrase fields, enforces the credential floor, and offers no copy, role, or evidence-deletion action', async () => {
    const props = createProps()
    render(props)

    expect(getInput('archive-passphrase').type).toBe('password')
    expect(getInput('archive-passphrase-confirmation').type).toBe('password')
    expect(getButton('archive-issue-recovery-code').disabled).toBe(true)

    setInput('archive-passphrase', 'short')
    setInput('archive-passphrase-confirmation', 'short')
    expect(readDialogText()).toMatch(/at least 14 characters/iu)
    expect(getButton('archive-issue-recovery-code').disabled).toBe(true)

    setInput('archive-passphrase', 'alllowercaseletters')
    setInput('archive-passphrase-confirmation', 'alllowercaseletters')
    expect(readDialogText()).toMatch(/three character classes/iu)
    expect(getButton('archive-issue-recovery-code').disabled).toBe(true)

    setInput('archive-passphrase', PASSPHRASE)
    setInput('archive-passphrase-confirmation', `${PASSPHRASE}?`)
    expect(readDialogText()).toMatch(/confirmation must match/iu)
    expect(getButton('archive-issue-recovery-code').disabled).toBe(true)

    setInput('archive-passphrase-confirmation', PASSPHRASE)
    expect(getButton('archive-issue-recovery-code').disabled).toBe(false)
    expect(readDialogText()).not.toMatch(/\b(copy|clipboard|delete evidence|custodian|team leader)\b/iu)
    expect([...document.querySelectorAll('button')].map((button) => button.textContent))
      .not.toContain('Copy')
  })

  it('shows one issued recovery code once, requires exact type-back, and clears every secret before finalization settles', async () => {
    const finalization = deferred<FinalizeMissionResult>()
    const props = createProps({ finalize: vi.fn(() => finalization.promise) })
    render(props)
    enterValidPassphrase()

    await clickAndFlush('archive-issue-recovery-code')
    expect(props.issueRecoveryCode).toHaveBeenCalledWith(MISSION_ID)
    expect(getElement('archive-recovery-code').textContent).toContain(RECOVERY_CODE)
    expect(getInput('archive-recovery-code-confirmation').type).toBe('password')
    expect(getButton('archive-finalize').disabled).toBe(true)

    setInput('archive-recovery-code-confirmation', RECOVERY_CODE.replace('0', '1'))
    expect(readDialogText()).toMatch(/type the recovery code exactly/iu)
    expect(getButton('archive-finalize').disabled).toBe(true)

    setInput('archive-recovery-code-confirmation', RECOVERY_CODE)
    expect(getButton('archive-finalize').disabled).toBe(false)
    await clickAndFlush('archive-finalize')

    expect(props.finalize).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })
    expect(document.querySelector('[data-testid="archive-recovery-code"]')).toBeNull()
    expect(document.querySelector('[data-testid="archive-passphrase"]')).toBeNull()
    expect(readDialogText()).not.toContain(PASSPHRASE)
    expect(readDialogText()).not.toContain(RECOVERY_CODE)

    finalization.resolve(finalizeResult())
    await flush()
    expect(getElement('mission-archive-custody-dialog').dataset.state).toBe('verified')
    expect(props.onVerified).toHaveBeenCalledWith(finalizeResult())
  })

  it('ignores foreign and stale progress while presenting every custody phase truthfully', async () => {
    const finalization = deferred<FinalizeMissionResult>()
    const listeners = new Set<(progress: MissionArchiveProgress) => void>()
    const unsubscribe = vi.fn()
    const props = createProps({
      finalize: vi.fn(() => finalization.promise),
      subscribeProgress: vi.fn((listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          unsubscribe()
        }
      }),
    })
    render(props)
    enterValidPassphrase()
    await issueAndConfirmRecoveryCode()
    await clickAndFlush('archive-finalize')
    expect(state()).toBe('creating')

    pushProgress(listeners, { operationId: SECOND_OPERATION_ID, sequence: 1, phase: 'publish' })
    pushProgress(listeners, { missionId: 'foreign-mission', sequence: 1, phase: 'publish' })
    expect(state()).toBe('creating')

    pushProgress(listeners, { sequence: 1, phase: 'preflight' })
    expect(state()).toBe('creating')
    pushProgress(listeners, { sequence: 1, phase: 'publish' })
    expect(state()).toBe('creating')
    pushProgress(listeners, { sequence: 2, phase: 'publish' })
    expect(state()).toBe('publishing')
    pushProgress(listeners, { sequence: 3, phase: 'seal', completed: 0, total: 1 })
    expect(state()).toBe('sealing')
    pushProgress(listeners, { sequence: 4, phase: 'seal', completed: 1, total: 1 })
    expect(state()).toBe('sealed-but-unverified')
    pushProgress(listeners, { kind: 'verify', sequence: 1, phase: 'proof' })
    expect(state()).toBe('verifying')

    finalization.resolve(finalizeResult())
    await flush()
    expect(state()).toBe('verified')
    expect(props.onVerified).toHaveBeenCalledOnce()

    await act(async () => root?.unmount())
    root = null
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('turns a post-seal verification failure into a sealed-but-unverified result without offering another finalization', async () => {
    const props = createProps({
      issueRecoveryCode: vi.fn().mockResolvedValueOnce(issuance()),
      finalize: vi.fn().mockRejectedValue(new Error(
        'Error invoking remote method: Mission archive operation failed safely '
        + '(ARCHIVE_VERIFY_AUTHENTICATION_FAILED).',
      )),
    })
    render(props)
    enterValidPassphrase()
    await issueAndConfirmRecoveryCode()
    await clickAndFlush('archive-finalize')

    expect(state()).toBe('sealed-but-unverified')
    expect(readDialogText()).toMatch(/sealed.*not yet verified/iu)
    expect(readDialogText()).not.toContain('untrusted detail')
    expect(document.querySelector('[data-testid="archive-finalize"]')).toBeNull()
    expect(document.querySelector('[data-testid="archive-restart-custody"]')).toBeNull()
    expect(getButton('archive-cancel').textContent).toMatch(/close/iu)
  })

  it('consumes a failed confirmation attempt, hides backend detail, and cannot reuse its code', async () => {
    const props = createProps({
      finalize: vi.fn().mockRejectedValue(Object.assign(new Error('secret-bearing backend error'), {
        code: 'ARCHIVE_CREATE_FAILED',
      })),
    })
    render(props)
    enterValidPassphrase()
    await issueAndConfirmRecoveryCode()
    await clickAndFlush('archive-finalize')

    expect(state()).toBe('failure')
    expect(readDialogText()).toMatch(/failed safely/iu)
    expect(readDialogText()).not.toContain('secret-bearing backend error')
    expect(readDialogText()).not.toContain(RECOVERY_CODE)
    expect(document.querySelector('[data-testid="archive-finalize"]')).toBeNull()
    expect(getButton('archive-restart-custody')).not.toBeNull()
  })

  it('expires and invalidates an unused issuance, then requires a fresh recovery code', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T20:00:00.000Z'))
    const props = createProps({
      issueRecoveryCode: vi.fn().mockResolvedValue(issuance({
        expiresAt: '2026-08-29T20:00:01.000Z',
      })),
    })
    render(props)
    enterValidPassphrase()
    await clickAndFlush('archive-issue-recovery-code')

    await act(async () => vi.advanceTimersByTimeAsync(1_001))
    expect(props.cancelOperation).toHaveBeenCalledWith(OPERATION_ID)
    expect(state()).toBe('failure')
    expect(readDialogText()).toMatch(/expired.*fresh recovery code/iu)
    expect(readDialogText()).not.toContain(RECOVERY_CODE)
  })

  it('invalidates unused and active operations on cancel and keeps active cancellation visibly pending', async () => {
    const unusedProps = createProps()
    render(unusedProps)
    enterValidPassphrase()
    await clickAndFlush('archive-issue-recovery-code')
    await clickAndFlush('archive-cancel')
    expect(unusedProps.cancelOperation).toHaveBeenCalledWith(OPERATION_ID)
    expect(unusedProps.onClose).toHaveBeenCalledOnce()
    expect(readDialogText()).not.toContain(RECOVERY_CODE)

    await act(async () => root?.unmount())
    root = null
    host?.remove()
    host = null

    const finalization = deferred<FinalizeMissionResult>()
    const activeProps = createProps({ finalize: vi.fn(() => finalization.promise) })
    render(activeProps)
    enterValidPassphrase()
    await issueAndConfirmRecoveryCode()
    await clickAndFlush('archive-finalize')
    await clickAndFlush('archive-cancel')
    expect(state()).toBe('cancellation-requested')
    expect(activeProps.cancelOperation).toHaveBeenCalledWith(OPERATION_ID)
    expect(activeProps.onClose).not.toHaveBeenCalled()

    finalization.reject(Object.assign(new Error('cancelled'), { code: 'ARCHIVE_CANCELLED' }))
    await flush()
    expect(state()).toBe('failure')
    expect(readDialogText()).toMatch(/cancelled safely/iu)
  })

  it('invalidates an outstanding issuance and removes progress listeners on unmount', async () => {
    const unsubscribe = vi.fn()
    const props = createProps({ subscribeProgress: () => unsubscribe })
    render(props)
    enterValidPassphrase()
    await clickAndFlush('archive-issue-recovery-code')

    await act(async () => root?.unmount())
    root = null
    await flush()
    expect(props.cancelOperation).toHaveBeenCalledWith(OPERATION_ID)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not cancel active custody when a normal parent render replaces callback identities', async () => {
    const finalization = deferred<FinalizeMissionResult>()
    const firstCancel = vi.fn().mockResolvedValue(true)
    const props = createProps({
      cancelOperation: firstCancel,
      finalize: vi.fn(() => finalization.promise),
    })
    render(props)
    enterValidPassphrase()
    await issueAndConfirmRecoveryCode()
    await clickAndFlush('archive-finalize')

    const replacementCancel = vi.fn().mockResolvedValue(true)
    await act(async () => {
      root?.render(React.createElement(MissionArchiveCustodyDialog, {
        ...props,
        cancelOperation: replacementCancel,
      }))
    })

    expect(firstCancel).not.toHaveBeenCalled()
    expect(replacementCancel).not.toHaveBeenCalled()
    expect(state()).toBe('creating')

    finalization.resolve(finalizeResult())
    await flush()
    expect(state()).toBe('verified')
  })

  function render(props: MissionArchiveCustodyDialogProps): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(React.createElement(MissionArchiveCustodyDialog, props))
    })
  }
})

function createProps(
  overrides: Partial<MissionArchiveCustodyDialogProps> = {},
): MissionArchiveCustodyDialogProps {
  return {
    missionId: MISSION_ID,
    issueRecoveryCode: vi.fn().mockResolvedValue(issuance()),
    finalize: vi.fn().mockResolvedValue(finalizeResult()),
    cancelOperation: vi.fn().mockResolvedValue(true),
    onVerified: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

function issuance(
  overrides: Partial<MissionArchiveRecoveryIssuance> = {},
): MissionArchiveRecoveryIssuance {
  return {
    operationId: OPERATION_ID,
    recoveryCode: RECOVERY_CODE,
    expiresAt: '2099-08-29T20:10:00.000Z',
    ...overrides,
  }
}

function finalizeResult(): FinalizeMissionResult {
  return {
    mission: {
      id: MISSION_ID,
      name: 'Custody dialog mission',
      status: 'finalized',
      start_time: '2026-08-29T18:00:00.000Z',
      pause_time: null,
      finish_time: '2026-08-29T19:00:00.000Z',
      paused_seconds: 0,
      notes: null,
      schema_version: 13,
    },
    archive: {
      id: '33333333-3333-4333-8333-333333333333',
      mission_id: MISSION_ID,
      protected_finalization_epoch: null,
      archive_kind: 'finalized',
      container_version: 2,
      archive_path: '/safe/archive.sararch',
      ciphertext_sha256: 'a'.repeat(64),
      size_bytes: 1_024,
      created_at: '2026-08-29T20:00:00.000Z',
      verified_at: '2026-08-29T20:01:00.000Z',
      previous_archive_id: null,
      status: 'verified',
      availability: 'present',
      availability_reason: null,
      slots: [
        { slotId: 'passphrase-v1', slotType: 'passphrase' },
        { slotId: 'recovery-v1', slotType: 'recovery' },
      ],
      last_non_machine_unwrap_at: null,
    },
  }
}

function enterValidPassphrase(): void {
  setInput('archive-passphrase', PASSPHRASE)
  setInput('archive-passphrase-confirmation', PASSPHRASE)
}

async function issueAndConfirmRecoveryCode(): Promise<void> {
  await clickAndFlush('archive-issue-recovery-code')
  setInput('archive-recovery-code-confirmation', RECOVERY_CODE)
}

function pushProgress(
  listeners: ReadonlySet<(progress: MissionArchiveProgress) => void>,
  overrides: Partial<MissionArchiveProgress>,
): void {
  const progress: MissionArchiveProgress = {
    operationId: OPERATION_ID,
    missionId: MISSION_ID,
    kind: 'create',
    sequence: 1,
    phase: 'preflight',
    unit: 'phases',
    completed: 1,
    total: 1,
    detail: 'bounded-progress',
    ...overrides,
  }
  act(() => listeners.forEach((listener) => listener(progress)))
}

function state(): string | undefined {
  return getElement('mission-archive-custody-dialog').dataset.state
}

function readDialogText(): string {
  return getElement('mission-archive-custody-dialog').textContent ?? ''
}

function getElement(testId: string): HTMLElement {
  const element = document.querySelector(`[data-testid="${testId}"]`)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${testId} to be an element.`)
  }
  return element
}

function getInput(testId: string): HTMLInputElement {
  const element = getElement(testId)
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected ${testId} to be an input.`)
  }
  return element
}

function getButton(testId: string): HTMLButtonElement {
  const element = getElement(testId)
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${testId} to be a button.`)
  }
  return element
}

function setInput(testId: string, value: string): void {
  const input = getInput(testId)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function clickAndFlush(testId: string): Promise<void> {
  await act(async () => {
    getButton(testId).click()
    await Promise.resolve()
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
} {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (reason: unknown) => void
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    }),
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}
