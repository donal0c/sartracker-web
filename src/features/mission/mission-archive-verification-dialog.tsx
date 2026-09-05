import { useEffect, useRef, useState } from 'react'

import { DialogOverlay } from '../../components/dialog-overlay'
import type {
  MissionArchiveInfo,
  MissionArchiveProgress,
  MissionArchiveVerificationInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { readMissionArchiveErrorCode } from './mission-archive-error'
import { sameMissionArchiveImmutableIdentity } from './mission-archive-identity'

const VERIFICATION_TITLE_ID = 'mission-archive-verification-title'
const VERIFICATION_DESCRIPTION_ID = 'mission-archive-verification-description'
const MAX_RENDERER_INPUT_CODE_UNITS = 1_024
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

type VerificationDialogState =
  | 'ready'
  | 'verifying'
  | 'cancellation-requested'
  | 'refreshing-timeline'
  | 'verified'
  | 'failure'

type VerificationFailure =
  | 'cancelled'
  | 'invalid-result'
  | 'status-unknown'
  | 'operation'
  | 'operation-id'

export type MissionArchiveVerificationDialogProps = {
  readonly archive: MissionArchiveInfo
  readonly verify: (input: MissionArchiveVerificationInput) => Promise<MissionArchiveInfo>
  readonly cancelOperation: (operationId: string) => Promise<boolean>
  readonly subscribeProgress?: (
    listener: (progress: MissionArchiveProgress) => void,
  ) => () => void
  readonly createOperationId?: () => string
  readonly onVerified: (archive: MissionArchiveInfo) => void | Promise<void>
  readonly onClose: (requiresTimelineRefresh: boolean) => void | Promise<void>
}

/**
 * Re-runs exhaustive verification for existing sealed bytes with both original
 * non-machine credentials. It never creates or replaces archive bytes.
 */
export function MissionArchiveVerificationDialog({
  archive,
  verify,
  cancelOperation,
  subscribeProgress,
  createOperationId = () => globalThis.crypto.randomUUID(),
  onVerified,
  onClose,
}: MissionArchiveVerificationDialogProps) {
  const [dialogState, setDialogState] = useState<VerificationDialogState>('ready')
  const [passphrase, setPassphrase] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [progress, setProgress] = useState<MissionArchiveProgress | null>(null)
  const [failure, setFailure] = useState<VerificationFailure | null>(null)
  const [postCommitWarning, setPostCommitWarning] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const operationIdRef = useRef<string | null>(null)
  const startInProgressRef = useRef(false)
  const cancellationRequestedRef = useRef(false)
  const closeInProgressRef = useRef(false)
  const latestProgressSequenceRef = useRef(0)
  const verifyRef = useRef(verify)
  const cancelOperationRef = useRef(cancelOperation)
  const onVerifiedRef = useRef(onVerified)

  useEffect(() => {
    verifyRef.current = verify
    cancelOperationRef.current = cancelOperation
    onVerifiedRef.current = onVerified
  }, [cancelOperation, onVerified, verify])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      startInProgressRef.current = false
      const operationId = operationIdRef.current
      operationIdRef.current = null
      if (operationId !== null) {
        void cancelOperationRef.current(operationId).catch(() => undefined)
      }
    }
  }, [])

  useEffect(() => {
    if (subscribeProgress === undefined) return undefined
    return subscribeProgress((nextProgress) => {
      const operationId = operationIdRef.current
      if (operationId === null
        || cancellationRequestedRef.current
        || nextProgress.operationId !== operationId
        || nextProgress.missionId !== archive.mission_id
        || nextProgress.kind !== 'verify'
        || nextProgress.sequence <= latestProgressSequenceRef.current) return
      latestProgressSequenceRef.current = nextProgress.sequence
      setProgress(nextProgress)
    })
  }, [archive.mission_id, subscribeProgress])

  const credentialsValid = validatePassphrase(passphrase)
    && validateRecoveryCode(recoveryCode)
  const canStart = dialogState === 'ready' && credentialsValid

  /** Starts one independently cancellable verification attempt. */
  async function handleStart(): Promise<void> {
    if (!canStart || startInProgressRef.current || operationIdRef.current !== null) return
    startInProgressRef.current = true
    let operationId: string
    try {
      operationId = createOperationId()
    } catch {
      startInProgressRef.current = false
      scrubSecrets()
      setFailure('operation-id')
      setDialogState('failure')
      return
    }
    if (!UUID_V4.test(operationId)) {
      startInProgressRef.current = false
      scrubSecrets()
      setFailure('operation-id')
      setDialogState('failure')
      return
    }
    const request: MissionArchiveVerificationInput = {
      archiveId: archive.id,
      operationId,
      passphrase,
      recoveryCode,
    }
    operationIdRef.current = operationId
    cancellationRequestedRef.current = false
    latestProgressSequenceRef.current = 0
    setProgress(null)
    setFailure(null)
    setPostCommitWarning(null)
    setDialogState('verifying')

    let completion: Promise<MissionArchiveInfo>
    try {
      completion = verifyRef.current(request)
    } catch {
      completion = Promise.reject(new Error('Archive verification invocation failed.'))
    }
    scrubSecrets()
    try {
      const verified = await completion
      operationIdRef.current = null
      startInProgressRef.current = false
      cancellationRequestedRef.current = false
      if (!mountedRef.current) return
      if (!validTerminalArchive(verified, archive)) {
        setFailure('invalid-result')
        setDialogState('failure')
        return
      }
      setDialogState('verified')
      try {
        const postCommit = onVerifiedRef.current(verified)
        if (postCommit !== undefined) {
          void Promise.resolve(postCommit).catch(() => {
            if (mountedRef.current) {
              setPostCommitWarning(
                'Verification completed, but the saved-mission timeline refresh failed. Use Refresh before relying on the displayed archive label.',
              )
            }
          })
        }
      } catch {
        setPostCommitWarning(
          'Verification completed, but the saved-mission timeline refresh failed. Use Refresh before relying on the displayed archive label.',
        )
      }
    } catch (error) {
      operationIdRef.current = null
      startInProgressRef.current = false
      if (!mountedRef.current) return
      const code = readMissionArchiveErrorCode(error)
      const cancelled = cancellationRequestedRef.current
        && code === 'ARCHIVE_VERIFICATION_RETRYABLE'
      cancellationRequestedRef.current = false
      setFailure(code === 'ARCHIVE_VERIFICATION_RESULT_INVALID'
        ? 'invalid-result'
        : code === 'ARCHIVE_VERIFICATION_STATUS_UNKNOWN'
          ? 'status-unknown'
          : code === 'ARCHIVE_VERIFICATION_RETRYABLE'
            ? cancelled ? 'cancelled' : 'operation'
            : 'status-unknown')
      setDialogState('failure')
    }
  }

  /** Requests physical cancellation and leaves the dialog until the worker settles. */
  async function handleClose(): Promise<void> {
    const operationId = operationIdRef.current
    if (operationId === null) {
      if (closeInProgressRef.current) return
      closeInProgressRef.current = true
      scrubSecrets()
      const requiresTimelineRefresh = failure === 'invalid-result'
        || failure === 'status-unknown'
      if (requiresTimelineRefresh) setDialogState('refreshing-timeline')
      try {
        await onClose(requiresTimelineRefresh)
      } catch {
        if (!mountedRef.current) return
        closeInProgressRef.current = false
        setFailure('status-unknown')
        setDialogState('failure')
      }
      return
    }
    if (cancellationRequestedRef.current) return
    cancellationRequestedRef.current = true
    scrubSecrets()
    setDialogState('cancellation-requested')
    try {
      await cancelOperationRef.current(operationId)
    } catch {
      // The owned operation remains visible and settles through its terminal promise.
    }
  }

  /** Returns to a credential-empty retry surface after a terminal failure. */
  function handleRetry(): void {
    startInProgressRef.current = false
    scrubSecrets()
    setProgress(null)
    setFailure(null)
    setPostCommitWarning(null)
    setDialogState('ready')
  }

  /** Removes renderer-held credential strings from controlled state. */
  function scrubSecrets(): void {
    setPassphrase('')
    setRecoveryCode('')
  }

  return (
    <DialogOverlay
      describedBy={VERIFICATION_DESCRIPTION_ID}
      labelledBy={VERIFICATION_TITLE_ID}
      onClose={() => void handleClose()}
      open
      overlayClassName="z-[60]"
      panelClassName="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto"
      testId="mission-archive-verification-overlay"
    >
      <div data-state={dialogState} data-testid="mission-archive-verification-dialog">
        <header className="border-b border-[var(--sar-line)] pb-4">
          <p className="sar-section-label text-amber-300">Sealed encrypted archive</p>
          <h2 className="mt-2 text-xl font-semibold text-stone-50" id={VERIFICATION_TITLE_ID}>
            Retry archive verification
          </h2>
          <p
            className="mt-2 text-sm leading-relaxed text-stone-200"
            id={VERIFICATION_DESCRIPTION_ID}
          >
            This retry began from an archive listed as sealed but not verified. Enter its original
            passphrase and original recovery code to restore and compare every required item.
            Verification can update the saved status; existing archive bytes do not change.
          </p>
        </header>

        {dialogState === 'ready' ? (
          <div className="mt-5 space-y-4">
            <CredentialField
              label="Original archive passphrase"
              onChange={setPassphrase}
              testId="archive-verification-passphrase"
              valid={passphrase.length === 0 || validatePassphrase(passphrase)}
              value={passphrase}
            />
            <CredentialField
              label="Original archive recovery code"
              onChange={setRecoveryCode}
              testId="archive-verification-recovery-code"
              valid={recoveryCode.length === 0 || validateRecoveryCode(recoveryCode)}
              value={recoveryCode}
            />
            <p className="text-xs leading-relaxed text-stone-300">
              Both credentials must belong to this same archive. Verification restores into
              permission-restricted scratch space and sweeps it automatically.
            </p>
            <button
              className="sar-action-primary w-full px-4 py-3 text-sm font-bold disabled:opacity-40"
              data-testid="archive-verification-start"
              disabled={!canStart}
              onClick={() => void handleStart()}
              type="button"
            >
              Restore and verify archive
            </button>
          </div>
        ) : null}

        {dialogState === 'verifying'
          || dialogState === 'cancellation-requested'
          || dialogState === 'refreshing-timeline' ? (
          <div className="sar-readout mt-5 p-4" aria-live="polite" role="status">
            <p className="text-sm font-semibold text-amber-100">
              {dialogState === 'refreshing-timeline'
                ? 'Refreshing authoritative archive status before closing…'
                : dialogState === 'cancellation-requested'
                ? 'Cancellation requested; waiting for safe worker exit…'
                : 'Restoring and verifying every archived item…'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-stone-300">
              Current positions and live mission work continue independently.
            </p>
            {progress === null ? null : (
              <p className="mt-2 text-xs text-stone-200">{progress.detail}</p>
            )}
          </div>
        ) : null}

        {dialogState === 'verified' ? (
          <div className="mt-5 border border-emerald-400/30 bg-emerald-400/10 p-4" role="status">
            <p className="font-semibold text-emerald-200">
              Exhaustive archive verification completed
            </p>
            <p className="mt-2 text-sm leading-relaxed text-stone-200">
              The sealed archive is now available for read-only mission review.
            </p>
          </div>
        ) : null}

        {dialogState === 'verified' && postCommitWarning !== null ? (
          <p className="sar-inline-alert mt-3 p-3 text-xs text-amber-100" role="alert">
            {postCommitWarning}
          </p>
        ) : null}

        {dialogState === 'failure' ? (
          <div className="mt-5 border border-rose-400/30 bg-rose-400/10 p-4" role="alert">
            <p className="font-semibold text-rose-200">{failureHeading(failure)}</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-200">
              {failureMessage(failure)}
            </p>
            {failure === 'invalid-result' || failure === 'status-unknown' ? null : (
              <button
                className="sar-button mt-4 w-full px-4 py-3 text-sm font-semibold"
                data-testid="archive-verification-retry"
                onClick={handleRetry}
                type="button"
              >
                Re-enter both credentials and retry
              </button>
            )}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            className="sar-button px-4 py-2 text-sm font-semibold disabled:opacity-40"
            data-testid={dialogState === 'verifying'
              ? 'archive-verification-cancel'
              : 'archive-verification-close'}
            disabled={dialogState === 'cancellation-requested'
              || dialogState === 'refreshing-timeline'}
            onClick={() => void handleClose()}
            type="button"
          >
            {dialogState === 'verifying'
              ? 'Cancel verification safely'
              : dialogState === 'cancellation-requested'
                ? 'Cancelling…'
                : dialogState === 'refreshing-timeline'
                  ? 'Refreshing…'
                : failure === 'invalid-result' || failure === 'status-unknown'
                  ? 'Refresh timeline and close'
                : 'Close'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  )
}

type CredentialFieldProps = {
  readonly label: string
  readonly onChange: (value: string) => void
  readonly testId: string
  readonly valid: boolean
  readonly value: string
}

/** Holds one bounded secret without echoing it into operator-visible text. */
function CredentialField(props: CredentialFieldProps) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold text-stone-200">{props.label}</span>
      <input
        aria-invalid={!props.valid}
        autoComplete="off"
        className="sar-input w-full px-3 py-2 font-mono text-sm"
        data-testid={props.testId}
        maxLength={MAX_RENDERER_INPUT_CODE_UNITS}
        onChange={(event) => {
          const next = boundedCredentialInput(event.target.value)
          if (next === null) {
            event.target.value = props.value
            return
          }
          props.onChange(next)
        }}
        spellCheck={false}
        type="password"
        value={props.value}
      />
    </label>
  )
}

/** Mirrors the existing main/preload passphrase floor before IPC. */
function validatePassphrase(value: string): boolean {
  if (!boundedCredential(value) || value.length < 14) return false
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(value)).length
  return classes >= 3
}

/** Mirrors the one-code recovery format before IPC. */
function validateRecoveryCode(value: string): boolean {
  return boundedCredential(value) && RECOVERY_CODE.test(value)
}

/** Applies the preload byte/control bound to one renderer-held credential. */
function boundedCredential(value: string): boolean {
  if (value.length < 1 || value.length > MAX_RENDERER_INPUT_CODE_UNITS
    || new TextEncoder().encode(value).byteLength > MAX_RENDERER_INPUT_CODE_UNITS) return false
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
  })
}

/** Refuses oversized values before React state retains them. */
function boundedCredentialInput(value: string): string | null {
  return value.length <= MAX_RENDERER_INPUT_CODE_UNITS
    && new TextEncoder().encode(value).byteLength <= MAX_RENDERER_INPUT_CODE_UNITS
    ? value
    : null
}

/** Confirms the exact existing archive became verified without changing identity. */
function validTerminalArchive(result: MissionArchiveInfo, sealed: MissionArchiveInfo): boolean {
  return sameMissionArchiveImmutableIdentity(result, sealed)
    && result.container_version === 2
    && result.status === 'verified'
    && result.verified_at !== null
    && !Number.isNaN(Date.parse(result.verified_at))
    && result.ciphertext_sha256 === sealed.ciphertext_sha256
    && result.availability === 'present'
}

/** Returns one closed heading without reflecting backend failure text. */
function failureHeading(failure: VerificationFailure | null): string {
  if (failure === 'cancelled') return 'Archive verification cancelled safely'
  if (failure === 'invalid-result') return 'Archive verification returned an invalid terminal result'
  if (failure === 'status-unknown') return 'Archive verification status needs refresh'
  if (failure === 'operation-id') return 'Archive verification could not start'
  return 'Archive verification failed safely'
}

/** Keeps sealed-vs-verified truth explicit after every failed retry. */
function failureMessage(failure: VerificationFailure | null): string {
  if (failure === 'cancelled') {
    return 'The archive remains sealed and the live mission remains intact. Re-enter both original credentials when ready.'
  }
  if (failure === 'invalid-result') {
    return 'Verification status is not trusted in this view. Choose Refresh timeline and close before retrying.'
  }
  if (failure === 'status-unknown') {
    return 'Sealed-versus-verified status could not be established. Choose Refresh timeline and close before retrying.'
  }
  if (failure === 'operation-id') {
    return 'No verification work started. The archive remains sealed and the live mission remains intact.'
  }
  return 'The archive remains sealed and the live mission remains intact. Re-enter both original credentials and retry.'
}
