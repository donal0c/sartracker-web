// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MissionArchiveVerificationDialog } from '../../src/features/mission/mission-archive-verification-dialog'
import type {
  MissionArchiveInfo,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

const OPERATION_ID = '44c0b79d-f4ad-45db-ac2d-1360c9adf8fd'
const SECOND_OPERATION_ID = 'ce8ffed1-02ee-41d2-8610-f6c566f74d3a'
const PASSPHRASE = 'Verify-Archive-Passphrase-2026!'
const RECOVERY_CODE = '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'
const ARCHIVE = archive()

describe('sealed mission archive verification retry dialog [DON-252 / BCP-15]', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('requires both original credentials, masks and bounds them, then scrubs them before exhaustive verification settles', async () => {
    const terminal = deferred<MissionArchiveInfo>()
    const verify = vi.fn(() => terminal.promise)
    const onVerified = vi.fn()
    render({ verify, onVerified })

    expect(text()).toMatch(/retry began.*sealed.*not.*verified/iu)
    expect(text()).toMatch(/original passphrase.*original recovery code/iu)
    expect(input('archive-verification-passphrase').type).toBe('password')
    expect(input('archive-verification-recovery-code').type).toBe('password')
    expect(button('archive-verification-start').disabled).toBe(true)

    setInput('archive-verification-passphrase', PASSPHRASE)
    setInput('archive-verification-recovery-code', RECOVERY_CODE)
    expect(text()).not.toContain(PASSPHRASE)
    expect(text()).not.toContain(RECOVERY_CODE)
    expect(button('archive-verification-start').disabled).toBe(false)

    await act(async () => {
      button('archive-verification-start').click()
      await Promise.resolve()
    })
    expect(verify).toHaveBeenCalledWith({
      archiveId: ARCHIVE.id,
      operationId: OPERATION_ID,
      passphrase: PASSPHRASE,
      recoveryCode: RECOVERY_CODE,
    })
    expect(query('archive-verification-passphrase')).toBeNull()
    expect(query('archive-verification-recovery-code')).toBeNull()
    expect(text()).not.toContain(PASSPHRASE)
    expect(text()).not.toContain(RECOVERY_CODE)
    expect(text()).toMatch(/restoring and verifying every archived item/iu)

    terminal.resolve({
      ...ARCHIVE,
      status: 'verified',
      verified_at: '2026-08-30T17:00:00.000Z',
      last_non_machine_unwrap_at: '2026-08-30T17:00:00.000Z',
    })
    await act(async () => {
      await terminal.promise
      await Promise.resolve()
    })
    expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({
      id: ARCHIVE.id,
      status: 'verified',
    }))
    expect(text()).toMatch(/exhaustive archive verification completed/iu)
    expect(description()).toMatch(/retry began/iu)
    expect(description()).not.toMatch(/^this archive is sealed/iu)
  })

  it('keeps a failed archive sealed, hides backend detail, and retries with a fresh operation identity', async () => {
    const reflected = Object.assign(
      new Error(`wrong credentials ${PASSPHRASE} ${RECOVERY_CODE}`),
      { code: 'ARCHIVE_VERIFICATION_RETRYABLE' },
    )
    const verify = vi.fn()
      .mockRejectedValueOnce(reflected)
      .mockResolvedValueOnce({
        ...ARCHIVE,
        status: 'verified',
        verified_at: '2026-08-30T17:00:00.000Z',
      })
    const operationIds = [OPERATION_ID, SECOND_OPERATION_ID]
    render({ verify, createOperationId: () => operationIds.shift() ?? SECOND_OPERATION_ID })

    setInput('archive-verification-passphrase', PASSPHRASE)
    setInput('archive-verification-recovery-code', RECOVERY_CODE)
    await clickAndFlush('archive-verification-start')

    expect(text()).toMatch(/verification failed safely/iu)
    expect(text()).toMatch(/archive remains sealed.*live mission remains intact/iu)
    expect(text()).not.toContain(reflected.message)
    expect(text()).not.toContain(PASSPHRASE)
    expect(text()).not.toContain(RECOVERY_CODE)

    click('archive-verification-retry')
    expect(input('archive-verification-passphrase').value).toBe('')
    expect(input('archive-verification-recovery-code').value).toBe('')
    setInput('archive-verification-passphrase', PASSPHRASE)
    setInput('archive-verification-recovery-code', RECOVERY_CODE)
    await clickAndFlush('archive-verification-start')

    expect(verify).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operationId: SECOND_OPERATION_ID,
    }))
  })

  it('rejects oversized renderer input before verification and cancels the exact active operation on close', async () => {
    const terminal = deferred<MissionArchiveInfo>()
    const verify = vi.fn(() => terminal.promise)
    const cancelOperation = vi.fn().mockResolvedValue(true)
    render({ verify, cancelOperation })

    setInput('archive-verification-passphrase', 'A'.repeat(1_025))
    expect(input('archive-verification-passphrase').value).toBe('')
    expect(verify).not.toHaveBeenCalled()

    setInput('archive-verification-passphrase', PASSPHRASE)
    setInput('archive-verification-recovery-code', RECOVERY_CODE)
    await act(async () => {
      button('archive-verification-start').click()
      await Promise.resolve()
      button('archive-verification-cancel').click()
      await Promise.resolve()
    })
    expect(cancelOperation).toHaveBeenCalledWith(OPERATION_ID)
    expect(text()).toMatch(/cancellation requested/iu)

    terminal.reject(Object.assign(
      new Error('authoritative archive status remains sealed'),
      { code: 'ARCHIVE_VERIFICATION_RETRYABLE' },
    ))
    await act(async () => {
      await terminal.promise.catch(() => undefined)
      await Promise.resolve()
    })
    expect(text()).toMatch(/cancelled safely/iu)
  })

  it('single-flights same-turn start attempts and retains cancellation ownership of the first operation', async () => {
    const terminal = deferred<MissionArchiveInfo>()
    const verify = vi.fn(() => terminal.promise)
    const cancelOperation = vi.fn().mockResolvedValue(true)
    const operationIds = [OPERATION_ID, SECOND_OPERATION_ID]
    render({
      verify,
      cancelOperation,
      createOperationId: () => operationIds.shift() ?? SECOND_OPERATION_ID,
    })

    setInput('archive-verification-passphrase', PASSPHRASE)
    setInput('archive-verification-recovery-code', RECOVERY_CODE)
    const start = button('archive-verification-start')
    await act(async () => {
      start.click()
      start.click()
      await Promise.resolve()
    })

    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ operationId: OPERATION_ID }))
    await act(async () => {
      button('archive-verification-cancel').click()
      await Promise.resolve()
    })
    expect(cancelOperation).toHaveBeenCalledWith(OPERATION_ID)
    expect(cancelOperation).not.toHaveBeenCalledWith(SECOND_OPERATION_ID)

    terminal.reject(Object.assign(
      new Error('authoritative archive status remains sealed'),
      { code: 'ARCHIVE_VERIFICATION_RETRYABLE' },
    ))
    await act(async () => {
      await terminal.promise.catch(() => undefined)
      await Promise.resolve()
    })
  })

  it('does not turn cancellation into a sealed claim when reconciliation cannot establish status', async () => {
    const terminal = deferred<MissionArchiveInfo>()
    const cancelOperation = vi.fn().mockResolvedValue(true)
    render({ verify: vi.fn(() => terminal.promise), cancelOperation })

    setInput('archive-verification-passphrase', PASSPHRASE)
    setInput('archive-verification-recovery-code', RECOVERY_CODE)
    await act(async () => {
      button('archive-verification-start').click()
      await Promise.resolve()
      button('archive-verification-cancel').click()
      await Promise.resolve()
    })

    terminal.reject(Object.assign(
      new Error('timeline refresh failed'),
      { code: 'ARCHIVE_VERIFICATION_STATUS_UNKNOWN' },
    ))
    await act(async () => {
      await terminal.promise.catch(() => undefined)
      await Promise.resolve()
    })

    expect(text()).toMatch(/status needs refresh/iu)
    expect(text()).toMatch(/could not be established.*refresh timeline and close/iu)
    expect(text()).not.toMatch(/archive remains sealed/iu)
    expect(query('archive-verification-retry')).toBeNull()
  })

  it('accepts only request-bound verified terminal identity', async () => {
    const verify = vi.fn().mockResolvedValue({
      ...ARCHIVE,
      status: 'verified',
      verified_at: '2026-08-30T17:00:00.000Z',
      previous_archive_id: 'forged-predecessor',
      revision_count: 99,
    })
    const onVerified = vi.fn()
    render({ verify, onVerified })

    setInput('archive-verification-passphrase', PASSPHRASE)
    setInput('archive-verification-recovery-code', RECOVERY_CODE)
    await clickAndFlush('archive-verification-start')

    expect(onVerified).not.toHaveBeenCalled()
    expect(text()).toMatch(/invalid terminal result/iu)
    expect(text()).toMatch(/refresh timeline and close before retrying/iu)
    expect(text()).not.toContain('forged-predecessor')
    expect(query('archive-verification-retry')).toBeNull()
  })

  it('requires a timeline refresh when the controller cannot trust terminal state', async () => {
    const closeAttempt = deferred<void>()
    const onClose = vi.fn(() => closeAttempt.promise)
    const verify = vi.fn().mockRejectedValue(Object.assign(
      new Error('Archive verification returned an invalid terminal result.'),
      { code: 'ARCHIVE_VERIFICATION_RESULT_INVALID' },
    ))
    render({ verify, onClose })

    setInput('archive-verification-passphrase', PASSPHRASE)
    setInput('archive-verification-recovery-code', RECOVERY_CODE)
    await clickAndFlush('archive-verification-start')

    expect(text()).toMatch(/invalid terminal result/iu)
    expect(text()).toMatch(/refresh timeline and close before retrying/iu)
    expect(text()).not.toMatch(/archive remains sealed and the live mission remains intact/iu)
    expect(description()).toMatch(/retry began/iu)
    expect(description()).not.toMatch(/^this archive is sealed/iu)
    expect(query('archive-verification-retry')).toBeNull()

    await act(async () => {
      button('archive-verification-close').click()
      button('archive-verification-close').click()
      await Promise.resolve()
    })
    expect(onClose).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)

    closeAttempt.reject(new Error('timeline unavailable'))
    await act(async () => {
      await closeAttempt.promise.catch(() => undefined)
      await Promise.resolve()
    })
    expect(query('mission-archive-verification-dialog')).not.toBeNull()
    expect(text()).toMatch(/status needs refresh/iu)
  })

  function render(overrides: Partial<Parameters<typeof MissionArchiveVerificationDialog>[0]> = {}): void {
    act(() => root.render(createElement(MissionArchiveVerificationDialog, {
      archive: ARCHIVE,
      verify: vi.fn().mockResolvedValue({
        ...ARCHIVE,
        status: 'verified',
        verified_at: '2026-08-30T17:00:00.000Z',
      }),
      cancelOperation: vi.fn().mockResolvedValue(true),
      createOperationId: () => OPERATION_ID,
      onVerified: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    })))
  }

  function text(): string {
    return host.textContent ?? ''
  }

  function description(): string {
    return document.getElementById('mission-archive-verification-description')?.textContent ?? ''
  }

  function query(testId: string): HTMLElement | null {
    return host.querySelector(`[data-testid="${testId}"]`)
  }

  function button(testId: string): HTMLButtonElement {
    const element = query(testId)
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button ${testId}`)
    return element
  }

  function input(testId: string): HTMLInputElement {
    const element = query(testId)
    if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input ${testId}`)
    return element
  }

  function click(testId: string): void {
    act(() => button(testId).click())
  }

  async function clickAndFlush(testId: string): Promise<void> {
    await act(async () => {
      button(testId).click()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function setInput(testId: string, value: string): void {
    const element = input(testId)
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
})

/** Creates one sealed v2 registry projection eligible only for verification retry. */
function archive(): MissionArchiveInfo {
  return {
    id: 'archive-v2-sealed',
    mission_id: 'mission-finalized',
    protected_finalization_epoch: 7,
    archive_kind: 'finalized',
    container_version: 2,
    archive_path: '/private/archive-custody/archive-v2-sealed.sararch',
    ciphertext_sha256: 'a'.repeat(64),
    size_bytes: 4_096,
    created_at: '2026-08-30T16:00:00.000Z',
    verified_at: null,
    previous_archive_id: null,
    previous_archive_sha256: null,
    revision_sequence: 1,
    revision_count: 1,
    supplement_authority: null,
    supplement_reason: null,
    supplement_created_at: null,
    status: 'sealed',
    availability: 'present',
    availability_reason: null,
    slots: [
      { slotId: 'passphrase-slot', slotType: 'passphrase' },
      { slotId: 'recovery-slot', slotType: 'recovery' },
    ],
    last_non_machine_unwrap_at: null,
  }
}

/** Returns a caller-controlled promise for active-operation assertions. */
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}
