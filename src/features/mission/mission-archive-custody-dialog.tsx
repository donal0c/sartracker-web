import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import { DialogOverlay } from '../../components/dialog-overlay'
import type {
  FinalizeMissionResult,
  MissionArchiveCustodyInput,
  MissionArchiveProgress,
  MissionArchiveRecoveryIssuance,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { readMissionArchiveErrorCode } from './mission-archive-error'

const ARCHIVE_CUSTODY_TITLE_ID = 'mission-archive-custody-title'

export type MissionArchiveCustodyDialogState =
  | 'preparing'
  | 'issuing-code'
  | 'recovery-code-issued'
  | 'creating'
  | 'publishing'
  | 'sealing'
  | 'verifying'
  | 'cancellation-requested'
  | 'sealed-but-unverified'
  | 'failure'
  | 'verified'

export type MissionArchiveCustodyDialogProps = {
  /** Mission that will be finalized only after its encrypted archive is sealed. */
  readonly missionId: string
  /** Issues one sender-owned, one-attempt recovery code for this archive. */
  readonly issueRecoveryCode: (
    missionId: string,
  ) => Promise<MissionArchiveRecoveryIssuance>
  /** Runs the already mission-bound archive finalization. */
  readonly finalize: (custody: MissionArchiveCustodyInput) => Promise<FinalizeMissionResult>
  /** Invalidates an unused issuance or requests cancellation of active archive work. */
  readonly cancelOperation: (operationId: string) => Promise<boolean>
  /** Subscribes to the closed, non-secret archive progress projection. */
  readonly subscribeProgress?: (
    listener: (progress: MissionArchiveProgress) => void,
  ) => () => void
  /** Receives only a terminal, verified finalization result. */
  readonly onVerified: (result: FinalizeMissionResult) => void
  /** Closes the dialog once no issued or active operation remains. */
  readonly onClose: () => void
}

type OutstandingOperation = {
  readonly operationId: string
  readonly stage: 'issued' | 'active'
}

type FailureKind = 'cancelled' | 'expired' | 'operation' | 'issuance'

/**
 * Collects archive credentials, displays a per-archive recovery code once, and
 * truthfully reports the create, custody, and independent verification phases.
 */
export function MissionArchiveCustodyDialog({
  missionId,
  issueRecoveryCode,
  finalize,
  cancelOperation,
  subscribeProgress,
  onVerified,
  onClose,
}: MissionArchiveCustodyDialogProps) {
  const [dialogState, setDialogState] = useState<MissionArchiveCustodyDialogState>('preparing')
  const [passphrase, setPassphrase] = useState('')
  const [passphraseConfirmation, setPassphraseConfirmation] = useState('')
  const [issuance, setIssuance] = useState<MissionArchiveRecoveryIssuance | null>(null)
  const [recoveryCodeConfirmation, setRecoveryCodeConfirmation] = useState('')
  const [failureKind, setFailureKind] = useState<FailureKind | null>(null)
  const mountedRef = useRef(false)
  const operationRef = useRef<OutstandingOperation | null>(null)
  const expiryTimerRef = useRef<number | null>(null)
  const cancellationRequestedRef = useRef(false)
  const sealCompletedRef = useRef(false)
  const latestProgressSequenceRef = useRef({ create: 0, verify: 0 })
  const passphraseRef = useRef('')
  const passphraseConfirmationRef = useRef('')
  const recoveryCodeRef = useRef('')
  const recoveryCodeConfirmationRef = useRef('')
  const cancelOperationRef = useRef(cancelOperation)

  const passphraseError = validateArchivePassphrase(passphrase)
  const confirmationError = passphraseConfirmation.length > 0
    && passphraseConfirmation !== passphrase
    ? 'Passphrase confirmation must match exactly.'
    : null
  const canIssueRecoveryCode = dialogState === 'preparing'
    && passphraseError === null
    && passphraseConfirmation === passphrase
  const recoveryConfirmationError = recoveryCodeConfirmation.length > 0
    && issuance !== null
    && recoveryCodeConfirmation !== issuance.recoveryCode
    ? 'Type the recovery code exactly as shown.'
    : null
  const canFinalize = dialogState === 'recovery-code-issued'
    && issuance !== null
    && recoveryCodeConfirmation === issuance.recoveryCode

  /** Clears an outstanding expiry timer without widening its lifetime. */
  const clearExpiryTimer = useCallback((): void => {
    if (expiryTimerRef.current !== null) {
      window.clearTimeout(expiryTimerRef.current)
      expiryTimerRef.current = null
    }
  }, [])

  /** Removes all renderer-held custody strings from live component state and refs. */
  const scrubSecrets = useCallback((): void => {
    passphraseRef.current = ''
    passphraseConfirmationRef.current = ''
    recoveryCodeRef.current = ''
    recoveryCodeConfirmationRef.current = ''
    setPassphrase('')
    setPassphraseConfirmation('')
    setIssuance(null)
    setRecoveryCodeConfirmation('')
  }, [])

  useEffect(() => {
    passphraseRef.current = passphrase
  }, [passphrase])

  useEffect(() => {
    passphraseConfirmationRef.current = passphraseConfirmation
  }, [passphraseConfirmation])

  useEffect(() => {
    recoveryCodeRef.current = issuance?.recoveryCode ?? ''
  }, [issuance])

  useEffect(() => {
    recoveryCodeConfirmationRef.current = recoveryCodeConfirmation
  }, [recoveryCodeConfirmation])

  useEffect(() => {
    cancelOperationRef.current = cancelOperation
  }, [cancelOperation])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearExpiryTimer()
      passphraseRef.current = ''
      passphraseConfirmationRef.current = ''
      recoveryCodeRef.current = ''
      recoveryCodeConfirmationRef.current = ''
      const outstanding = operationRef.current
      operationRef.current = null
      if (outstanding !== null) {
        void cancelOperationRef.current(outstanding.operationId).catch(() => undefined)
      }
    }
  }, [clearExpiryTimer])

  useEffect(() => {
    if (subscribeProgress === undefined) return undefined
    return subscribeProgress((progress) => {
      if (progress.kind === 'cleanup') return
      const outstanding = operationRef.current
      if (outstanding?.stage !== 'active'
        || cancellationRequestedRef.current
        || progress.operationId !== outstanding.operationId
        || progress.missionId !== missionId
        || progress.sequence <= latestProgressSequenceRef.current[progress.kind]) {
        return
      }
      latestProgressSequenceRef.current[progress.kind] = progress.sequence

      if (progress.kind === 'verify') {
        setDialogState('verifying')
        return
      }
      if (progress.phase === 'publish') {
        setDialogState('publishing')
        return
      }
      if (progress.phase === 'seal') {
        const complete = progress.total !== null
          && progress.total > 0
          && progress.completed >= progress.total
        if (complete) {
          sealCompletedRef.current = true
          setDialogState('sealed-but-unverified')
        } else {
          setDialogState('sealing')
        }
        return
      }
      setDialogState('creating')
    })
  }, [missionId, subscribeProgress])

  useEffect(() => {
    clearExpiryTimer()
    if (issuance === null || operationRef.current?.stage !== 'issued') return undefined
    const expiresAtMs = Date.parse(issuance.expiresAt)
    const delayMs = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - Date.now()) : 0
    const boundedDelayMs = Math.min(delayMs, 2_147_483_647)
    expiryTimerRef.current = window.setTimeout(() => {
      const outstanding = operationRef.current
      if (outstanding?.operationId !== issuance.operationId
        || outstanding.stage !== 'issued') {
        return
      }
      operationRef.current = null
      scrubSecrets()
      setFailureKind('expired')
      setDialogState('failure')
      void cancelOperation(issuance.operationId).catch(() => undefined)
    }, boundedDelayMs)
    return clearExpiryTimer
  }, [cancelOperation, clearExpiryTimer, issuance, scrubSecrets])

  /** Requests one recovery code only after the local credential checks pass. */
  async function handleIssueRecoveryCode(): Promise<void> {
    if (!canIssueRecoveryCode) return
    setFailureKind(null)
    setDialogState('issuing-code')
    try {
      const nextIssuance = await issueRecoveryCode(missionId)
      if (!mountedRef.current) {
        void cancelOperation(nextIssuance.operationId).catch(() => undefined)
        return
      }
      if (!Number.isFinite(Date.parse(nextIssuance.expiresAt))
        || Date.parse(nextIssuance.expiresAt) <= Date.now()) {
        scrubSecrets()
        setFailureKind('expired')
        setDialogState('failure')
        void cancelOperation(nextIssuance.operationId).catch(() => undefined)
        return
      }
      operationRef.current = { operationId: nextIssuance.operationId, stage: 'issued' }
      setIssuance(nextIssuance)
      setRecoveryCodeConfirmation('')
      setDialogState('recovery-code-issued')
    } catch {
      if (!mountedRef.current) return
      scrubSecrets()
      setFailureKind('issuance')
      setDialogState('failure')
    }
  }

  /** Consumes the one-attempt issuance and starts mission-bound finalization. */
  async function handleFinalize(): Promise<void> {
    if (!canFinalize || issuance === null) return
    if (Date.parse(issuance.expiresAt) <= Date.now()) {
      const expiredOperationId = issuance.operationId
      operationRef.current = null
      clearExpiryTimer()
      scrubSecrets()
      setFailureKind('expired')
      setDialogState('failure')
      void cancelOperation(expiredOperationId).catch(() => undefined)
      return
    }

    clearExpiryTimer()
    const custody: MissionArchiveCustodyInput = {
      operationId: issuance.operationId,
      passphrase,
      recoveryCode: issuance.recoveryCode,
    }
    operationRef.current = { operationId: issuance.operationId, stage: 'active' }
    cancellationRequestedRef.current = false
    sealCompletedRef.current = false
    latestProgressSequenceRef.current = { create: 0, verify: 0 }
    setFailureKind(null)
    setDialogState('creating')

    try {
      const resultPromise = finalize(custody)
      scrubSecrets()
      const result = await resultPromise
      if (!mountedRef.current) return
      operationRef.current = null
      if (result.archive.status !== 'verified' || result.archive.verified_at === null) {
        sealCompletedRef.current = true
        setDialogState('sealed-but-unverified')
        return
      }
      setDialogState('verified')
      onVerified(result)
    } catch (error) {
      scrubSecrets()
      if (!mountedRef.current) return
      operationRef.current = null
      const errorCode = readMissionArchiveErrorCode(error)
      const cancelled = cancellationRequestedRef.current || errorCode === 'ARCHIVE_CANCELLED'
      cancellationRequestedRef.current = false
      if (sealCompletedRef.current || isArchiveVerificationFailureCode(errorCode)) {
        setDialogState('sealed-but-unverified')
        return
      }
      setFailureKind(cancelled ? 'cancelled' : 'operation')
      setDialogState('failure')
    }
  }

  /** Invalidates the current issuance or requests active worker cancellation. */
  async function handleCancel(): Promise<void> {
    const outstanding = operationRef.current
    if (outstanding === null) {
      clearExpiryTimer()
      scrubSecrets()
      onClose()
      return
    }
    clearExpiryTimer()
    scrubSecrets()
    cancellationRequestedRef.current = true
    setDialogState('cancellation-requested')
    try {
      await cancelOperation(outstanding.operationId)
    } catch {
      if (!mountedRef.current) return
      if (outstanding.stage === 'issued') {
        operationRef.current = null
        cancellationRequestedRef.current = false
        setFailureKind('operation')
        setDialogState('failure')
      }
      return
    }
    if (!mountedRef.current || outstanding.stage === 'active') return
    operationRef.current = null
    cancellationRequestedRef.current = false
    onClose()
  }

  /** Starts a wholly new issuance after a pre-seal terminal failure. */
  function handleRestart(): void {
    clearExpiryTimer()
    scrubSecrets()
    operationRef.current = null
    cancellationRequestedRef.current = false
    sealCompletedRef.current = false
    latestProgressSequenceRef.current = { create: 0, verify: 0 }
    setFailureKind(null)
    setDialogState('preparing')
  }

  return (
    <DialogOverlay
      labelledBy={ARCHIVE_CUSTODY_TITLE_ID}
      onClose={() => void handleCancel()}
      open
      panelClassName="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto"
      testId="mission-archive-custody-overlay"
    >
      <div data-state={dialogState} data-testid="mission-archive-custody-dialog">
        <header className="border-b border-[var(--sar-line)] pb-4">
          <p className="sar-section-label text-amber-300">Encrypted mission archive</p>
          <h2 className="mt-2 text-xl font-semibold text-stone-50" id={ARCHIVE_CUSTODY_TITLE_ID}>
            Archive and lock mission
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-stone-300">
            The live mission remains intact if archive creation or verification fails.
          </p>
        </header>

        {dialogState === 'preparing' || dialogState === 'issuing-code' ? (
          <div className="mt-5 space-y-4">
            <SecretField
              disabled={dialogState === 'issuing-code'}
              label="Archive passphrase"
              onChange={setPassphrase}
              testId="archive-passphrase"
              value={passphrase}
            />
            <SecretField
              disabled={dialogState === 'issuing-code'}
              label="Confirm archive passphrase"
              onChange={setPassphraseConfirmation}
              testId="archive-passphrase-confirmation"
              value={passphraseConfirmation}
            />
            {passphrase.length > 0 && passphraseError !== null ? (
              <InlineAlert message={passphraseError} />
            ) : null}
            {confirmationError !== null ? <InlineAlert message={confirmationError} /> : null}
            <p className="text-xs leading-relaxed text-stone-300">
              Use at least 14 characters and at least three character classes: lowercase,
              uppercase, numbers, and symbols.
            </p>
            <button
              className="sar-action-primary w-full px-4 py-3 text-sm font-bold disabled:opacity-40"
              data-testid="archive-issue-recovery-code"
              disabled={!canIssueRecoveryCode}
              onClick={() => void handleIssueRecoveryCode()}
              type="button"
            >
              {dialogState === 'issuing-code' ? 'Generating…' : 'Generate one-time recovery code'}
            </button>
          </div>
        ) : null}

        {dialogState === 'recovery-code-issued' && issuance !== null ? (
          <div className="mt-5 space-y-4">
            <div className="sar-inline-alert p-4">
              <p className="text-sm font-semibold text-amber-100">
                Record this code now. It is shown only for this archive attempt.
              </p>
              <output
                className="mt-3 block break-all font-mono text-base font-bold tracking-wide text-amber-200"
                data-testid="archive-recovery-code"
              >
                {issuance.recoveryCode}
              </output>
              <p className="mt-3 text-xs leading-relaxed text-stone-300">
                Store it according to your organisation&apos;s approved procedure. A lost code
                cannot be recovered by the application.
              </p>
            </div>
            <SecretField
              label="Type the recovery code exactly"
              onChange={setRecoveryCodeConfirmation}
              testId="archive-recovery-code-confirmation"
              value={recoveryCodeConfirmation}
            />
            {recoveryConfirmationError !== null ? (
              <InlineAlert message={recoveryConfirmationError} />
            ) : null}
            <p className="text-xs text-stone-300">
              This issuance expires at {formatExpiry(issuance.expiresAt)}.
            </p>
            <button
              className="sar-action-primary w-full px-4 py-3 text-sm font-bold disabled:opacity-40"
              data-testid="archive-finalize"
              disabled={!canFinalize}
              onClick={() => void handleFinalize()}
              type="button"
            >
              Create, seal, and verify archive
            </button>
          </div>
        ) : null}

        {isArchiveWorkState(dialogState) ? (
          <ArchiveWorkStatus state={dialogState} />
        ) : null}

        {dialogState === 'failure' ? (
          <div className="mt-5 border border-rose-400/30 bg-rose-400/10 p-4" role="alert">
            <p className="font-semibold text-rose-200">{failureHeading(failureKind)}</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-200">
              {failureMessage(failureKind)}
            </p>
            <button
              className="sar-button mt-4 w-full px-4 py-3 text-sm font-semibold"
              data-testid="archive-restart-custody"
              onClick={handleRestart}
              type="button"
            >
              Start again with a fresh recovery code
            </button>
          </div>
        ) : null}

        {dialogState === 'sealed-but-unverified' ? (
          <div className="mt-5 border border-amber-400/30 bg-amber-400/10 p-4" role="alert">
            <p className="font-semibold text-amber-100">Archive sealed but not yet verified</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-200">
              The encrypted archive is sealed, the mission is now locked read-only, and its live
              evidence remains intact. Close this dialog, open Saved Mission Archives, and retry
              exhaustive verification using this archive&apos;s original passphrase and original
              recovery code. Do not treat the archive as complete until verification succeeds.
            </p>
          </div>
        ) : null}

        {dialogState === 'verified' ? (
          <div className="mt-5 border border-emerald-400/30 bg-emerald-400/10 p-4" role="status">
            <p className="font-semibold text-emerald-200">Archive sealed and verified</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-200">
              Exhaustive archive verification completed. The mission is now available read-only.
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            className="sar-button px-4 py-2 text-sm font-semibold disabled:opacity-40"
            data-testid="archive-cancel"
            disabled={dialogState === 'cancellation-requested'}
            onClick={() => void handleCancel()}
            type="button"
          >
            {dialogState === 'verified' || dialogState === 'sealed-but-unverified'
              || dialogState === 'failure'
              ? 'Close'
              : canRequestArchiveCancellation(dialogState)
                ? 'Cancel archive operation'
                : 'Close'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  )
}

type SecretFieldProps = {
  readonly disabled?: boolean
  readonly label: string
  readonly onChange: (value: string) => void
  readonly testId: string
  readonly value: string
}

/** Renders one controlled, non-autofilled secret field. */
function SecretField({
  disabled = false,
  label,
  onChange,
  testId,
  value,
}: SecretFieldProps) {
  const inputId = `${testId}-input`
  return (
    <label className="block space-y-2" htmlFor={inputId}>
      <span className="text-xs font-semibold text-stone-200">{label}</span>
      <input
        autoComplete="new-password"
        className="sar-input w-full px-3 py-2 font-mono text-sm"
        data-testid={testId}
        disabled={disabled}
        id={inputId}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        type="password"
        value={value}
      />
    </label>
  )
}

/** Renders a validation message without echoing the rejected value. */
function InlineAlert({ message }: { readonly message: string }) {
  return <p className="text-xs text-rose-300" role="alert">{message}</p>
}

/** Renders the current non-terminal lifecycle phase. */
function ArchiveWorkStatus({ state }: { readonly state: MissionArchiveCustodyDialogState }) {
  return (
    <div aria-live="polite" className="sar-readout mt-5 p-4" role="status">
      <p className="text-sm font-semibold text-stone-100">{archiveWorkHeading(state)}</p>
      <p className="mt-2 text-xs leading-relaxed text-stone-300">
        Current positions and live mission work continue independently of archive processing.
      </p>
    </div>
  )
}

/** Matches the same credential floor enforced by the main-process boundary. */
function validateArchivePassphrase(value: string): string | null {
  if (value.length < 14 || containsControlCharacters(value)) {
    return 'Archive passphrase must contain at least 14 characters.'
  }
  const characterClasses = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(value)).length
  if (characterClasses < 3) {
    return 'Archive passphrase must combine at least three character classes.'
  }
  return null
}

/** Rejects ASCII controls without embedding them in a regular expression. */
function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

/** Identifies phases that must keep the dialog non-dismissible without cancellation. */
function isArchiveWorkState(state: MissionArchiveCustodyDialogState): boolean {
  return state === 'creating'
    || state === 'publishing'
    || state === 'sealing'
    || state === 'verifying'
    || state === 'cancellation-requested'
}

/** Identifies states whose close affordance must first invalidate archive work. */
function canRequestArchiveCancellation(state: MissionArchiveCustodyDialogState): boolean {
  return state === 'recovery-code-issued' || isArchiveWorkState(state)
}

/** Maps internal phase names to calm operator-facing status text. */
function archiveWorkHeading(state: MissionArchiveCustodyDialogState): string {
  switch (state) {
    case 'publishing': return 'Publishing encrypted archive…'
    case 'sealing': return 'Sealing archive custody record…'
    case 'verifying': return 'Restoring and verifying every archived item…'
    case 'cancellation-requested': return 'Cancellation requested; waiting for safe worker exit…'
    default: return 'Creating encrypted archive…'
  }
}

/** Returns a closed failure heading without reflecting backend text. */
function failureHeading(kind: FailureKind | null): string {
  if (kind === 'expired') return 'Recovery-code issuance expired'
  if (kind === 'cancelled') return 'Archive operation cancelled safely'
  if (kind === 'issuance') return 'Recovery code could not be issued'
  return 'Archive operation failed safely'
}

/** Returns one actionable closed failure message. */
function failureMessage(kind: FailureKind | null): string {
  if (kind === 'expired') {
    return 'The expired issuance was invalidated. Start again to generate a fresh recovery code.'
  }
  if (kind === 'cancelled') {
    return 'The live mission remains intact. Start again to issue a fresh recovery code.'
  }
  if (kind === 'issuance') {
    return 'No archive work started. Try again to issue a fresh recovery code.'
  }
  return 'The live mission remains intact. Start again to issue a fresh recovery code.'
}

/** Verification during finalization starts only after archive custody is sealed. */
function isArchiveVerificationFailureCode(code: string | null): boolean {
  return code !== null && code.startsWith('ARCHIVE_VERIFY_')
}

/** Formats a trusted issuance expiry for local operator display. */
function formatExpiry(timestamp: string): string {
  const value = new Date(timestamp)
  return Number.isNaN(value.getTime()) ? 'the stated deadline' : value.toLocaleString()
}
