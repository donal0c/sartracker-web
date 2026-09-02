import { useEffect, useRef, useState } from 'react'

import { DialogOverlay } from '../../components/dialog-overlay'
import type {
  Mission,
  MissionArchiveInfo,
  MissionArchiveProgress,
  MissionCleanupBlocker,
  MissionCleanupEligibility,
  MissionCleanupResult,
  ResumeMissionCleanupInput,
  StartMissionCleanupInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { readMissionArchiveErrorCode } from './mission-archive-error'

const CLEANUP_TITLE_ID = 'mission-archive-cleanup-title'
const CLEANUP_DESCRIPTION_ID = 'mission-archive-cleanup-description'
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RESOLVED_DURING_START = new Set<MissionCleanupBlocker>([
  'fresh_non_machine_unlock_required',
])
const CLEANUP_SCOPE_WARNING = 'bulk evidence rows for this mission move out of the live database; the mission remains listed and reviewable from its verified encrypted archive; nothing is deleted from the archive; this is not an evidence-deletion feature.'
const MAX_RENDERER_INPUT_CODE_UNITS = 1_024

type CleanupDialogState =
  | 'loading'
  | 'ready'
  | 'running'
  | 'cancellation-requested'
  | 'completed'
  | 'failure'

export type MissionArchiveCleanupDialogProps = {
  readonly mission: Mission
  readonly loadState: (missionId: string) => Promise<{
    readonly archive: MissionArchiveInfo
    readonly eligibility: MissionCleanupEligibility
  }>
  readonly startCleanup: (input: StartMissionCleanupInput) => Promise<MissionCleanupResult>
  readonly resumeCleanup?: (input: ResumeMissionCleanupInput) => Promise<MissionCleanupResult>
  readonly cancelOperation: (operationId: string) => Promise<boolean>
  readonly subscribeProgress?: (
    listener: (progress: MissionArchiveProgress) => void,
  ) => () => void
  readonly createOperationId?: () => string
  readonly onCompleted: (result: MissionCleanupResult) => void | Promise<void>
  readonly onClose: () => void
}

/**
 * Gives the operator one explicit, fail-closed route for moving verified mission
 * rows out of the live database while retaining immutable archive custody.
 */
export function MissionArchiveCleanupDialog({
  mission,
  loadState,
  startCleanup,
  resumeCleanup,
  cancelOperation,
  subscribeProgress,
  createOperationId = () => globalThis.crypto.randomUUID(),
  onCompleted,
  onClose,
}: MissionArchiveCleanupDialogProps) {
  const [dialogState, setDialogState] = useState<CleanupDialogState>('loading')
  const [archive, setArchive] = useState<MissionArchiveInfo | null>(null)
  const [eligibility, setEligibility] = useState<MissionCleanupEligibility | null>(null)
  const [slotType, setSlotType] = useState<'passphrase' | 'recovery'>('passphrase')
  const [secret, setSecret] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [progress, setProgress] = useState<MissionArchiveProgress | null>(null)
  const [completedRows, setCompletedRows] = useState<number | null>(null)
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const [resumeAvailable, setResumeAvailable] = useState(false)
  const [postCommitWarning, setPostCommitWarning] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const operationIdRef = useRef<string | null>(null)
  const latestSequenceRef = useRef(0)
  const cancellationRequestedRef = useRef(false)
  const loadStateRef = useRef(loadState)
  const startCleanupRef = useRef(startCleanup)
  const resumeCleanupRef = useRef(resumeCleanup)
  const cancelOperationRef = useRef(cancelOperation)
  const onCompletedRef = useRef(onCompleted)

  useEffect(() => {
    loadStateRef.current = loadState
    startCleanupRef.current = startCleanup
    resumeCleanupRef.current = resumeCleanup
    cancelOperationRef.current = cancelOperation
    onCompletedRef.current = onCompleted
  }, [cancelOperation, loadState, onCompleted, resumeCleanup, startCleanup])

  const hardBlockers = eligibility?.blockers.filter(
    (blocker) => !RESOLVED_DURING_START.has(blocker),
  ) ?? []
  const secretValid = validateCredential(slotType, secret)
  const canStart = dialogState === 'ready'
    && archive !== null
    && eligibility?.startableWithCredential === true
    && hardBlockers.length === 0
    && secretValid
    && confirmation === mission.name

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    void loadStateRef.current(mission.id).then((result) => {
      if (cancelled || !mountedRef.current) return
      if (result.archive.mission_id !== mission.id) {
        throw new Error('Mission cleanup archive is not request-bound.')
      }
      setArchive(result.archive)
      setEligibility(result.eligibility)
      if (result.eligibility.storageState === 'archived'
        || result.eligibility.blockers.includes('cleanup_already_completed')) {
        setDialogState('completed')
      } else if (result.eligibility.storageState === 'cleanup_in_progress'
        || result.eligibility.blockers.includes('cleanup_in_progress')) {
        setResumeAvailable(true)
        setFailureMessage(
          'Cleanup was interrupted and remains blocked at its durable restart point. Resume it to complete live-store archival.',
        )
        setDialogState('failure')
      } else {
        setDialogState('ready')
      }
    }).catch(() => {
      if (cancelled || !mountedRef.current) return
      setFailureMessage(
        'Cleanup safety checks could not be loaded. No live mission data changed.',
      )
      setDialogState('failure')
    })
    return () => {
      cancelled = true
      mountedRef.current = false
      setSecret('')
      const operationId = operationIdRef.current
      operationIdRef.current = null
      if (operationId !== null) {
        void cancelOperationRef.current(operationId).catch(() => undefined)
      }
    }
  }, [mission.id])

  useEffect(() => {
    if (subscribeProgress === undefined) return undefined
    return subscribeProgress((nextProgress) => {
      const operationId = operationIdRef.current
      if (operationId === null
        || cancellationRequestedRef.current
        || nextProgress.operationId !== operationId
        || nextProgress.missionId !== mission.id
        || nextProgress.kind !== 'cleanup'
        || nextProgress.sequence <= latestSequenceRef.current) return
      latestSequenceRef.current = nextProgress.sequence
      setProgress(nextProgress)
    })
  }, [mission.id, subscribeProgress])

  /** Starts only after local confirmation, leaving every authoritative check in main/store. */
  async function handleStart(): Promise<void> {
    if (!canStart || archive === null) return
    const operationId = createOperationId()
    if (!UUID_V4.test(operationId)) {
      setFailureMessage('Cleanup could not start because its operation identity was invalid.')
      setDialogState('failure')
      return
    }
    const request: StartMissionCleanupInput = {
      missionId: mission.id,
      archiveId: archive.id,
      operationId,
      slotType,
      secret,
      confirmation,
    }
    operationIdRef.current = operationId
    latestSequenceRef.current = 0
    cancellationRequestedRef.current = false
    setProgress(null)
    setFailureMessage(null)
    setPostCommitWarning(null)
    setDialogState('running')
    const completion = startCleanupRef.current(request)
    setSecret('')
    try {
      const result = await completion
      if (!mountedRef.current) return
      operationIdRef.current = null
      if (result.missionId !== mission.id || result.archiveId !== archive.id
        || result.state !== 'completed' || result.storageState !== 'archived'
        || !Number.isSafeInteger(result.movedRows) || result.movedRows < 0) {
        setResumeAvailable(resumeCleanupRef.current !== undefined)
        setFailureMessage('Cleanup returned an invalid terminal result. Review remains blocked.')
        setDialogState('failure')
        return
      }
      setCompletedRows(result.movedRows)
      setDialogState('completed')
      try {
        const postCommit = onCompletedRef.current(result)
        if (postCommit !== undefined) {
          void Promise.resolve(postCommit).catch(() => {
            if (mountedRef.current) {
              setPostCommitWarning(
                'Cleanup completed, but the saved-mission timeline refresh failed. Use Refresh before relying on the displayed storage label.',
              )
            }
          })
        }
      } catch {
        // The durable archived result is terminal. A fallible renderer refresh
        // must never reverse it into a false cleanup failure.
        setPostCommitWarning(
          'Cleanup completed, but the saved-mission timeline refresh failed. Use Refresh before relying on the displayed storage label.',
        )
      }
    } catch (error) {
      if (!mountedRef.current) return
      operationIdRef.current = null
      const code = readMissionArchiveErrorCode(error)
      const cancelled = cancellationRequestedRef.current
        || code === 'ARCHIVE_CLEANUP_CANCELLED'
        || code === 'ARCHIVE_CANCELLED'
      cancellationRequestedRef.current = false
      setFailureMessage(cancelled
        ? 'Cleanup was cancelled safely at its last durable restart point. No archive bytes changed.'
        : cleanupFailureMessage(code))
      setResumeAvailable(resumeCleanupRef.current !== undefined)
      setDialogState('failure')
    }
  }

  /** Requests cancellation but keeps the dialog open until the physical operation settles. */
  async function handleCancel(): Promise<void> {
    const operationId = operationIdRef.current
    if (operationId === null) {
      setSecret('')
      onClose()
      return
    }
    if (cancellationRequestedRef.current) return
    cancellationRequestedRef.current = true
    setSecret('')
    setDialogState('cancellation-requested')
    try {
      await cancelOperationRef.current(operationId)
    } catch {
      // The active operation remains authoritative and will settle its own closed result.
    }
  }

  /** Resumes only the durable journal identified by the current mission/archive pair. */
  async function handleResume(): Promise<void> {
    if (!resumeAvailable || archive === null || resumeCleanupRef.current === undefined) return
    const operationId = createOperationId()
    if (!UUID_V4.test(operationId)) {
      setFailureMessage('Cleanup recovery could not start because its operation identity was invalid.')
      setDialogState('failure')
      return
    }
    operationIdRef.current = operationId
    latestSequenceRef.current = 0
    cancellationRequestedRef.current = false
    setProgress(null)
    setFailureMessage(null)
    setDialogState('running')
    try {
      const result = await resumeCleanupRef.current({
        missionId: mission.id,
        archiveId: archive.id,
        operationId,
      })
      if (!mountedRef.current) return
      operationIdRef.current = null
      if (result.missionId !== mission.id || result.archiveId !== archive.id
        || result.state !== 'completed' || result.storageState !== 'archived'
        || !Number.isSafeInteger(result.movedRows) || result.movedRows < 0) {
        setFailureMessage('Cleanup recovery returned an invalid terminal result. Review remains blocked.')
        setDialogState('failure')
        return
      }
      setCompletedRows(result.movedRows)
      setResumeAvailable(false)
      setDialogState('completed')
      try {
        const postCommit = onCompletedRef.current(result)
        if (postCommit !== undefined) {
          void Promise.resolve(postCommit).catch(() => {
            if (mountedRef.current) {
              setPostCommitWarning(
                'Cleanup completed, but the saved-mission timeline refresh failed. Use Refresh before relying on the displayed storage label.',
              )
            }
          })
        }
      } catch {
        setPostCommitWarning(
          'Cleanup completed, but the saved-mission timeline refresh failed. Use Refresh before relying on the displayed storage label.',
        )
      }
    } catch (error) {
      if (!mountedRef.current) return
      operationIdRef.current = null
      const code = readMissionArchiveErrorCode(error)
      const cancelled = cancellationRequestedRef.current
        || code === 'ARCHIVE_CLEANUP_CANCELLED'
        || code === 'ARCHIVE_CANCELLED'
      cancellationRequestedRef.current = false
      setFailureMessage(cancelled
        ? 'Cleanup recovery was cancelled safely at its durable restart point. The mission remains blocked.'
        : 'Cleanup recovery failed at its durable cursor. The verified archive remains intact; retry Resume cleanup after checking the safety checklist.')
      setDialogState('failure')
    }
  }

  return (
    <DialogOverlay
      describedBy={CLEANUP_DESCRIPTION_ID}
      labelledBy={CLEANUP_TITLE_ID}
      onClose={() => void handleCancel()}
      open
      overlayClassName="z-[60]"
      panelClassName="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto"
      testId="mission-archive-cleanup-overlay"
    >
      <div data-state={dialogState} data-testid="mission-archive-cleanup-dialog">
        <header className="border-b border-[var(--sar-line)] pb-4">
          <p className="sar-section-label text-amber-300">Verified archive storage</p>
          <h2 className="mt-2 text-xl font-semibold text-stone-50" id={CLEANUP_TITLE_ID}>
            Archive live mission rows
          </h2>
          <p
            className="mt-2 text-sm leading-relaxed text-stone-200"
            id={CLEANUP_DESCRIPTION_ID}
          >
            {CLEANUP_SCOPE_WARNING}
          </p>
        </header>

        {dialogState === 'loading' ? (
          <p className="mt-5 text-sm text-stone-300" role="status">Checking every cleanup precondition…</p>
        ) : null}

        {eligibility !== null ? (
          <section className="mt-5" aria-label="Cleanup safety checklist">
            <h3 className="text-sm font-semibold text-stone-100">Safety checklist</h3>
            <ul className="mt-2 space-y-2 text-xs text-stone-200">
              {cleanupChecklist(eligibility).map((check) => (
                <li className="sar-readout px-3 py-2" key={check.blocker}>
                  <span className={check.status === 'Passed'
                    ? 'text-emerald-300'
                    : check.status === 'Pending'
                      ? 'text-amber-200'
                      : 'text-rose-200'}>
                    {check.status === 'Passed' ? '✓' : check.status === 'Pending' ? '…' : '!'}{' '}
                    {check.status}: {check.label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {dialogState === 'ready' && eligibility?.startableWithCredential === true
          && hardBlockers.length === 0 ? (
          <div className="mt-5 space-y-4">
            <label className="block space-y-2">
              <span className="text-xs font-semibold text-stone-200">Fresh archive credential</span>
              <select
                className="sar-input w-full px-3 py-2 text-sm"
                data-testid="archive-cleanup-slot-type"
                onChange={(event) => {
                  setSlotType(event.target.value === 'recovery' ? 'recovery' : 'passphrase')
                  setSecret('')
                }}
                value={slotType}
              >
                <option value="passphrase">Archive passphrase</option>
                <option value="recovery">Archive recovery code</option>
              </select>
            </label>
            <label className="block space-y-2">
              <span className="text-xs text-stone-300">
                {slotType === 'passphrase' ? 'Passphrase' : 'Recovery code'}
              </span>
              <input
                autoComplete="off"
                className="sar-input w-full px-3 py-2 text-sm"
                data-testid="archive-cleanup-secret"
                aria-invalid={secret.length > 0 && !secretValid}
                maxLength={MAX_RENDERER_INPUT_CODE_UNITS}
                onChange={(event) => {
                  const next = boundedRendererInput(event.target.value)
                  if (next === null) {
                    event.target.value = secret
                    return
                  }
                  setSecret(next)
                }}
                type="password"
                value={secret}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs text-stone-300">
                Type the mission name exactly: <strong>{mission.name}</strong>
              </span>
              <input
                autoComplete="off"
                className="sar-input w-full px-3 py-2 text-sm"
                data-testid="archive-cleanup-confirmation"
                aria-invalid={confirmation.length > 0 && confirmation !== mission.name}
                maxLength={MAX_RENDERER_INPUT_CODE_UNITS}
                onChange={(event) => {
                  const next = boundedRendererInput(event.target.value)
                  if (next === null) {
                    event.target.value = confirmation
                    return
                  }
                  setConfirmation(next)
                }}
                value={confirmation}
              />
            </label>
            <button
              className="sar-action-primary w-full px-4 py-3 text-sm font-bold disabled:opacity-40"
              data-testid="archive-cleanup-start"
              disabled={!canStart}
              onClick={() => void handleStart()}
              type="button"
            >
              Confirm and archive live rows
            </button>
          </div>
        ) : null}

        {dialogState === 'ready' && hardBlockers.length > 0 ? (
          <p className="sar-inline-alert mt-5 p-3 text-xs text-amber-100" role="alert">
            Cleanup remains blocked. Resolve every blocked checklist item before entering a credential.
          </p>
        ) : null}

        {dialogState === 'running' || dialogState === 'cancellation-requested' ? (
          <div className="mt-5 space-y-3" aria-live="polite" role="status">
            <p className="text-sm font-semibold text-amber-200">
              {dialogState === 'cancellation-requested'
                ? 'Cancellation requested; waiting for the current durable batch to settle…'
                : 'Archiving bounded live-store batches…'}
            </p>
            {progress !== null ? (
              <div className="sar-readout p-3 text-xs text-stone-200">
                <p>{progress.detail}</p>
                <p className="mt-1 font-mono">{progress.completed} rows moved</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {dialogState === 'completed' ? (
          <div className="mt-5 border border-emerald-500/30 bg-emerald-950/30 p-4 text-sm text-emerald-100" role="status">
            <p className="font-semibold">Live-store archival completed.</p>
            <p className="mt-2 leading-relaxed">
              The mission remains listed on its timeline and available through read-only archive review.
            </p>
            {completedRows !== null ? <p className="mt-2 font-mono">{completedRows} rows moved.</p> : null}
          </div>
        ) : null}

        {dialogState === 'completed' && postCommitWarning !== null ? (
          <p className="sar-inline-alert mt-3 p-3 text-xs text-amber-100" role="alert">
            {postCommitWarning}
          </p>
        ) : null}

        {dialogState === 'failure' && failureMessage !== null ? (
          <p className="mt-5 border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200" role="alert">
            {failureMessage}
          </p>
        ) : null}

        {dialogState === 'failure' && resumeAvailable && resumeCleanup !== undefined ? (
          <button
            className="sar-action-primary mt-3 w-full px-4 py-3 text-sm font-bold"
            data-testid="archive-cleanup-resume"
            onClick={() => void handleResume()}
            type="button"
          >
            Resume cleanup
          </button>
        ) : null}

        {dialogState !== 'loading' ? (
          <div className="mt-5 flex gap-2">
            {(dialogState === 'running' || dialogState === 'cancellation-requested') ? (
              <button
                className="sar-button flex-1 px-3 py-2 text-sm disabled:opacity-40"
                data-testid="archive-cleanup-cancel"
                disabled={dialogState === 'cancellation-requested'}
                onClick={() => void handleCancel()}
                type="button"
              >
                {dialogState === 'cancellation-requested' ? 'Cancelling…' : 'Cancel safely'}
              </button>
            ) : (
              <button
                className="sar-button flex-1 px-3 py-2 text-sm"
                data-testid="archive-cleanup-close"
                onClick={() => void handleCancel()}
                type="button"
              >
                Close
              </button>
            )}
          </div>
        ) : null}
      </div>
    </DialogOverlay>
  )
}

/** Mirrors preload credential bounds so obviously invalid input never reaches the bridge. */
function validateCredential(slotType: 'passphrase' | 'recovery', value: string): boolean {
  if (value.length < 1 || new TextEncoder().encode(value).byteLength > 1_024
    || containsControlCharacters(value)) return false
  if (slotType === 'recovery') return RECOVERY_CODE.test(value)
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
    .filter((pattern) => pattern.test(value)).length
  return value.length >= 14 && classes >= 3
}

/** Rejects ASCII control characters without embedding them in a regular expression. */
function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
  })
}

/** Rejects oversized values before they can be retained in renderer component state. */
function boundedRendererInput(value: string): string | null {
  if (value.length > MAX_RENDERER_INPUT_CODE_UNITS) return null
  return new TextEncoder().encode(value).byteLength <= MAX_RENDERER_INPUT_CODE_UNITS
    ? value
    : null
}

type CleanupChecklistItem = {
  readonly blocker: MissionCleanupBlocker
  readonly status: 'Passed' | 'Pending' | 'Blocked'
  readonly label: string
}

/** Expands the closed blocker set into a stable, non-colour-only live checklist. */
function cleanupChecklist(eligibility: MissionCleanupEligibility): readonly CleanupChecklistItem[] {
  const definitions: readonly {
    readonly blocker: MissionCleanupBlocker
    readonly passed: string
    readonly blocked: string
  }[] = [
    { blocker: 'mission_not_finalized', passed: 'Mission is finalized', blocked: 'Mission is not finalized' },
    { blocker: 'current_archive_not_verified', passed: 'Current archive is exhaustively verified', blocked: 'Latest archive is not verified' },
    { blocker: 'verification_proof_invalid', passed: 'Exhaustive verification proof is valid', blocked: 'Exhaustive verification proof is invalid' },
    { blocker: 'current_finalization_epoch_mismatch', passed: 'Finalization epoch is current', blocked: 'Finalization epoch is not current' },
    { blocker: 'archive_custody_mismatch', passed: 'Exact archive custody identity matches', blocked: 'Archive file does not match its registered identity or could not be proven present' },
    { blocker: 'archive_custody_busy', passed: 'Archive custody has no active work', blocked: 'Archive work is active' },
    { blocker: 'finalization_fence_active', passed: 'No finalization fence is active', blocked: 'Finalization fence is active' },
    { blocker: 'evidence_health_not_clean', passed: 'Evidence health is clean', blocked: 'Evidence health is not clean' },
    { blocker: 'operational_state_unsettled', passed: 'Operational evidence work is settled', blocked: 'Operational evidence work is unsettled' },
    { blocker: 'archive_review_active', passed: 'No archive review session is active', blocked: 'Archive review is active' },
    { blocker: 'cleanup_in_progress', passed: 'No cleanup operation is already in progress', blocked: 'Cleanup is already in progress' },
    { blocker: 'cleanup_already_completed', passed: 'Live-store archival has not already completed', blocked: 'Live-store archival is already completed' },
    { blocker: 'fresh_non_machine_unlock_required', passed: 'Fresh passphrase or recovery credential is proven', blocked: 'Fresh passphrase or recovery code is required at start' },
  ]
  return definitions.map((definition) => {
    const present = eligibility.blockers.includes(definition.blocker)
    const pending = definition.blocker === 'fresh_non_machine_unlock_required' && present
    const completed = definition.blocker === 'cleanup_already_completed'
      && present && eligibility.storageState === 'archived'
    return {
      blocker: definition.blocker,
      status: completed ? 'Passed' : pending ? 'Pending' : present ? 'Blocked' : 'Passed',
      label: completed
        ? 'Live-store archival is already completed'
        : present ? definition.blocked : definition.passed,
    }
  })
}

/** Produces stable non-reflective failure text from a closed main-process code. */
function cleanupFailureMessage(code: string | null): string {
  if (code === 'ARCHIVE_CLEANUP_NOT_ELIGIBLE') {
    return 'Cleanup is no longer eligible. The live mission and archive remain unchanged; refresh the safety checklist before retrying.'
  }
  if (code === 'ARCHIVE_CLEANUP_WRONG_KEY') {
    return 'The archive credential was not accepted. The live mission and archive remain unchanged.'
  }
  return 'Cleanup stopped at its durable cursor. The verified archive remains intact; some live rows may already have moved, and cleanup must resume before ordinary live Review.'
}
