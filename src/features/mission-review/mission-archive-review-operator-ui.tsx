import { useMemo, useState } from 'react'

import type { MissionArchiveInfo } from '../../infrastructure/mission-store/tauri-mission-store'
import {
  archiveReviewAvailability,
  archiveVerificationRetryAvailability,
  type MissionArchiveReviewOpenInput,
  type MissionArchiveReviewProgress,
  type MissionArchiveReviewSession,
  type MissionArchiveReviewTimelineEntry,
} from './start-mission-archive-review-runtime'

export type MissionArchiveReviewControlProps = {
  readonly timeline: readonly MissionArchiveReviewTimelineEntry[]
  readonly phase: 'idle' | 'opening' | 'open' | 'closing' | 'error'
  readonly activeSession: MissionArchiveReviewSession | null
  readonly progress: MissionArchiveReviewProgress | null
  readonly recoveryRequired: 'none' | 'plaintext_cleanup' | 'audit_retry' | 'live_source_resume'
  readonly error: string | null
  readonly onOpenArchive: (input: MissionArchiveReviewOpenInput) => Promise<void>
  readonly onCloseArchiveReview: () => Promise<void>
  readonly onRequestVerification: (archive: MissionArchiveInfo) => void
  readonly onRequestCleanup: (mission: MissionArchiveReviewTimelineEntry['mission']) => void
  readonly onRestoreForCorrection: (input: {
    readonly admin_name: string
    readonly reason: string
  }) => Promise<void>
}

export type MissionArchiveReviewBannerProps = {
  readonly session: MissionArchiveReviewSession | null
  readonly closing: boolean
  readonly error: string | null
  readonly recoveryRequired: 'none' | 'plaintext_cleanup' | 'audit_retry' | 'live_source_resume'
  readonly onCloseArchiveReview: () => Promise<void>
}

/** Returns one path-free operator label for retained archive custody. */
function archiveLabel(archive: MissionArchiveInfo): string {
  if (archive.container_version === 1) return 'Legacy unencrypted'
  if (archive.status === 'superseded') return 'Verified supplemental predecessor'
  return archive.status === 'verified' ? 'Verified encrypted archive' : 'Verification required'
}

/** Formats one canonical archive timestamp without exposing a host path or locale secret. */
function archiveTimestampLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleString('en-IE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** Renders the persistent read-only and plaintext-residual warning. */
export function MissionArchiveReviewBanner(props: MissionArchiveReviewBannerProps) {
  const [closing, setClosing] = useState(false)
  const [safeError, setSafeError] = useState<string | null>(null)
  const busy = closing || props.closing
  const liveResumePending = props.recoveryRequired === 'live_source_resume'
  const auditRetryPending = props.recoveryRequired === 'audit_retry'
  const cleanupBlocked = props.recoveryRequired === 'plaintext_cleanup'
    || (safeError !== null && !liveResumePending && !auditRetryPending)
  const identity = props.session === null
    ? null
    : props.session.containerVersion === 1
      ? 'Legacy unencrypted'
      : `Verified archive · SHA-256 ${props.session.ciphertextSha256?.slice(0, 12) ?? 'unavailable'}`

  return (
    <section
      className="border-b border-amber-300/50 bg-amber-300/10 px-6 py-3 text-amber-50"
      data-testid="mission-review-archive-banner"
      role="status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">
            {liveResumePending || auditRetryPending
              ? 'Archive Review closed'
              : props.session === null
                ? 'Archive Review cleanup required'
                : 'Archived mission - read-only'}
          </p>
          {identity === null ? null : (
            <p className="mt-1 text-xs font-semibold text-amber-100">{identity}</p>
          )}
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-amber-100/90">
            {liveResumePending
              ? 'Temporary plaintext was removed. Live Mission Review did not resume; retry the live view.'
              : auditRetryPending
                ? 'Temporary plaintext was removed. The mutation-denial audit is pending durable completion; retry the audit.'
              : props.session === null
                ? 'Permission-restricted temporary plaintext may remain from the interrupted open. Retry Close Archive Review to remove it.'
                : 'A permission-restricted temporary plaintext review session exists while this archive is open. Close Archive Review to remove it.'}
          </p>
          {cleanupBlocked ? (
            <p className="mt-2 text-xs font-semibold text-rose-200" role="alert">
              Archive Review plaintext cleanup failed safely. Retry Close Archive Review.
            </p>
          ) : liveResumePending ? (
            <p className="mt-2 text-xs font-semibold text-rose-200" role="alert">
              {props.error ?? 'Live Mission Review failed to resume after archive cleanup.'}
            </p>
          ) : auditRetryPending ? (
            <p className="mt-2 text-xs font-semibold text-rose-200" role="alert">
              Archive Review plaintext was removed; mutation-denial audit completion is pending.
            </p>
          ) : null}
        </div>
        <button
          className="rounded-lg border border-amber-200/60 bg-stone-950/60 px-3 py-2 text-xs font-bold text-amber-50 disabled:opacity-50"
          data-testid="mission-review-close-archive"
          disabled={busy}
          onClick={() => {
            setClosing(true)
            setSafeError(null)
            void props.onCloseArchiveReview()
              .catch(() => setSafeError(auditRetryPending
                ? 'Archive Review mutation-denial audit completion is still pending.'
                : 'Archive Review plaintext cleanup failed safely.'))
              .finally(() => setClosing(false))
          }}
          type="button"
        >
          {busy
            ? 'Closing Archive Review…'
            : liveResumePending
              ? 'Retry Live Review'
              : auditRetryPending
                ? 'Retry Audit Completion'
              : cleanupBlocked
              ? 'Retry Close Archive Review'
              : 'Close Archive Review'}
        </button>
      </div>
    </section>
  )
}

/** Renders the indefinitely retained mission/archive timeline and credential gate. */
export function MissionArchiveReviewControl(props: MissionArchiveReviewControlProps) {
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null)
  const [slotType, setSlotType] = useState<'passphrase' | 'recovery'>('passphrase')
  const [secret, setSecret] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [correctionDraft, setCorrectionDraft] = useState({
    key: null as string | null,
    admin: '',
    reason: '',
  })
  const [restoring, setRestoring] = useState(false)
  const [safeError, setSafeError] = useState<string | null>(null)
  const correctionSessionKey = props.activeSession === null
    ? null
    : `${props.activeSession.sessionId}\0${props.activeSession.archiveId}\0${props.activeSession.missionId}`
  const correctionAdmin = correctionDraft.key === correctionSessionKey ? correctionDraft.admin : ''
  const correctionReason = correctionDraft.key === correctionSessionKey ? correctionDraft.reason : ''
  const sessionSafeError = correctionDraft.key === correctionSessionKey ? safeError : null

  const selectedArchive = useMemo(() => {
    for (const entry of props.timeline) {
      const archive = entry.archives.find((candidate) => candidate.id === selectedArchiveId)
      if (archive !== undefined) return archive
    }
    return null
  }, [props.timeline, selectedArchiveId])

  const correctionArchive = useMemo(() => {
    if (props.activeSession === null) return null
    for (const entry of props.timeline) {
      const archive = entry.archives.find((candidate) =>
        candidate.id === props.activeSession?.archiveId
        && candidate.mission_id === props.activeSession?.missionId)
      if (archive !== undefined) return archive
    }
    return null
  }, [props.activeSession, props.timeline])
  const correctionAvailable = props.activeSession?.containerVersion === 2
    && props.activeSession.verified === true
    && correctionArchive?.container_version === 2
    && correctionArchive.status === 'verified'
    && archiveReviewAvailability(correctionArchive).available === true

  if (props.activeSession !== null) {
    return (
      <section className="rounded-xl border border-stone-700 bg-stone-950/50 p-4">
        <p className="text-sm font-bold text-stone-100">Archive Review session is open.</p>
        <p className="mt-1 text-xs text-stone-400">The selected mission is fixed and read-only.</p>
        {correctionAvailable ? (
          <>
            <p className="mt-2 text-xs leading-relaxed text-amber-100/80">
              Need to correct the mission? Restore the verified snapshot into a new live revision.
              Earlier archive bytes remain unchanged and the action is recorded.
            </p>
            <label className="mt-3 block text-[11px] font-bold uppercase tracking-wider text-stone-400">
              Authorizing admin
              <input
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm font-normal normal-case tracking-normal text-stone-100"
                data-testid="archive-review-correction-admin"
                onChange={(event) => setCorrectionDraft({
                  key: correctionSessionKey,
                  admin: event.target.value,
                  reason: correctionReason,
                })}
                value={correctionAdmin}
              />
            </label>
            <label className="mt-3 block text-[11px] font-bold uppercase tracking-wider text-stone-400">
              Correction reason
              <input
                className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm font-normal normal-case tracking-normal text-stone-100"
                data-testid="archive-review-correction-reason"
                onChange={(event) => setCorrectionDraft({
                  key: correctionSessionKey,
                  admin: correctionAdmin,
                  reason: event.target.value,
                })}
                value={correctionReason}
              />
            </label>
            <button
              className="mt-3 rounded-lg border border-rose-300/60 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-100 disabled:opacity-50"
              data-testid="archive-review-restore-correction"
              disabled={props.phase === 'closing' || restoring
                || correctionAdmin.trim() === '' || correctionReason.trim() === ''}
              onClick={() => {
                setRestoring(true)
                setSafeError(null)
                void props.onRestoreForCorrection({
                  admin_name: correctionAdmin.trim(),
                  reason: correctionReason.trim(),
                }).catch(() => setSafeError('Archive correction restore failed safely.'))
                  .finally(() => setRestoring(false))
              }}
              type="button"
            >
              {restoring ? 'Restoring for correction…' : 'Restore for correction'}
            </button>
          </>
        ) : null}
        <button
          className="mt-3 rounded-lg border border-amber-300/60 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-50"
          data-testid="archive-review-close"
          disabled={props.phase === 'closing'}
          onClick={() => {
            setSecret('')
            void props.onCloseArchiveReview().catch(() => setSafeError(
              'Archive Review plaintext cleanup failed safely.',
            ))
          }}
          type="button"
        >
          {props.phase === 'closing' ? 'Closing…' : 'Close Archive Review'}
        </button>
        {sessionSafeError !== null ? (
          <p className="mt-3 text-xs font-semibold text-rose-200" role="alert">{sessionSafeError}</p>
        ) : null}
      </section>
    )
  }

  const busy = submitting || props.phase === 'opening' || props.phase === 'closing'
    || props.recoveryRequired !== 'none'

  return (
    <section
      className="rounded-2xl border border-stone-800 bg-stone-900/30 p-4"
      data-testid="mission-archive-review-control"
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
        Saved Mission Archives
      </p>
      <p className="mt-2 text-xs leading-relaxed text-stone-400">
        Saved missions and every chained archive are retained indefinitely for read-only review.
      </p>
      <div className="mt-4 space-y-4">
        {props.timeline.map((entry) => (
          <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-3" key={entry.mission.id}>
            <p className="font-semibold text-stone-100">{entry.mission.name}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">
              {entry.mission.status} · {entry.archives.length} retained archive{entry.archives.length === 1 ? '' : 's'}
            </p>
            <p
              className="mt-1 text-[10px] font-bold uppercase tracking-wider text-stone-400"
              data-testid={`archive-storage-state-${entry.mission.id}`}
            >
              Storage: {entry.mission.storage_state ?? 'unknown - cleanup unavailable'}
            </p>
            {entry.mission.status === 'finalized'
              && (entry.mission.storage_state === 'live'
                || entry.mission.storage_state === 'cleanup_in_progress')
              && entry.archives.some((archive) => (
                archive.container_version === 2 && archive.status === 'verified'
              )) ? (
                <button
                  className="mt-3 rounded-lg border border-amber-300/50 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100"
                  data-testid={entry.mission.storage_state === 'cleanup_in_progress'
                    ? `archive-cleanup-resume-open-${entry.mission.id}`
                    : `archive-cleanup-open-${entry.mission.id}`}
                  disabled={busy}
                  onClick={() => props.onRequestCleanup(entry.mission)}
                  type="button"
                >
                  {entry.mission.storage_state === 'cleanup_in_progress'
                    ? 'Resume Archive Cleanup'
                    : 'Archive Live Rows'}
                </button>
              ) : null}
            <div className="mt-3 space-y-2">
              {entry.archives.map((archive) => {
                const availability = archiveReviewAvailability(archive)
                const verificationRetry = archiveVerificationRetryAvailability(archive)
                const selected = archive.id === selectedArchiveId
                return (
                  <div className="rounded-lg border border-stone-800 p-2" key={archive.id}>
                    <button
                      aria-pressed={selected}
                      className="w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid={`archive-review-select-${archive.id}`}
                      disabled={!availability.available || busy}
                      onClick={() => {
                        setSelectedArchiveId(archive.id)
                        setSlotType('passphrase')
                        setSecret('')
                        setSafeError(null)
                      }}
                      type="button"
                    >
                      <span className="block text-xs font-bold text-stone-100">
                        {archiveLabel(archive)}
                      </span>
                      <span className="mt-1 block text-[11px] text-stone-500">
                        {archiveTimestampLabel(archive.created_at)}
                      </span>
                    </button>
                    {archive.revision_count > 1 ? (
                      <div
                        className="mt-2 space-y-1 border-l-2 border-amber-300/30 pl-2 text-[11px] text-stone-300"
                        data-testid={`archive-revision-${archive.id}`}
                      >
                        <p className="font-bold text-amber-100">
                          {archive.revision_sequence === 1
                            ? `Original revision 1 of ${archive.revision_count}`
                            : `Supplement ${archive.revision_sequence} of ${archive.revision_count}`}
                        </p>
                        {archive.previous_archive_sha256 === null ? null : (
                          <p>
                            Supersedes archive · SHA-256 {archive.previous_archive_sha256.slice(0, 12)}
                          </p>
                        )}
                        {archive.supplement_reason === null ? null : (
                          <p>Reason: {archive.supplement_reason}</p>
                        )}
                        {archive.supplement_authority === null
                          || archive.supplement_created_at === null ? null : (
                            <p>
                              Authorized by {archive.supplement_authority} ·{' '}
                              {archiveTimestampLabel(archive.supplement_created_at)}
                            </p>
                          )}
                      </div>
                    ) : null}
                    {availability.reason !== null ? (
                      <p className="mt-1 text-[11px] font-semibold text-amber-200">
                        {availability.reason}
                      </p>
                    ) : null}
                    {verificationRetry.available ? (
                      <button
                        className="mt-2 rounded-lg border border-amber-300/60 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-50"
                        data-testid={`archive-verify-retry-${archive.id}`}
                        disabled={busy}
                        onClick={() => {
                          setSelectedArchiveId(null)
                          setSecret('')
                          setSafeError(null)
                          props.onRequestVerification(archive)
                        }}
                        type="button"
                      >
                        Retry exhaustive verification
                      </button>
                    ) : null}
                  </div>
                )
              })}
              {entry.archives.length === 0 ? (
                <p className="text-xs text-stone-500">No retained archive is registered.</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {selectedArchive !== null ? (
        <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-300/5 p-3">
          <p className="text-xs font-bold text-amber-100">{archiveLabel(selectedArchive)}</p>
          {selectedArchive.container_version === 2 ? (
            <>
              <fieldset className="mt-3 flex flex-wrap gap-4">
                <legend className="sr-only">Archive review credential</legend>
                <label className="flex items-center gap-2 text-xs text-stone-200">
                  <input
                    checked={slotType === 'passphrase'}
                    data-testid="archive-review-slot-passphrase"
                    name="archive-review-slot"
                    onChange={() => { setSlotType('passphrase'); setSecret('') }}
                    type="radio"
                  />
                  Passphrase
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-200">
                  <input
                    checked={slotType === 'recovery'}
                    data-testid="archive-review-slot-recovery"
                    name="archive-review-slot"
                    onChange={() => { setSlotType('recovery'); setSecret('') }}
                    type="radio"
                  />
                  Recovery code
                </label>
              </fieldset>
              <input
                autoComplete="off"
                className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                data-testid="archive-review-secret"
                onChange={(event) => setSecret(event.target.value)}
                type="password"
                value={secret}
              />
            </>
          ) : null}
          <button
            className="mt-3 rounded-lg border border-amber-300/60 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100 disabled:opacity-50"
            data-testid="archive-review-open"
            disabled={busy || (selectedArchive.container_version === 2 && secret.length === 0)}
            onClick={() => {
              const request: MissionArchiveReviewOpenInput = selectedArchive.container_version === 1
                ? { archiveId: selectedArchive.id, containerVersion: 1 }
                : {
                    archiveId: selectedArchive.id,
                    containerVersion: 2,
                    slotType,
                    secret,
                  }
              setSubmitting(true)
              setSafeError(null)
              void props.onOpenArchive(request)
                .catch(() => setSafeError('Archive Review could not be opened safely.'))
                .finally(() => {
                  setSecret('')
                  setSubmitting(false)
                })
            }}
            type="button"
          >
            {busy ? 'Opening Archive Review…' : 'Open Read-only Archive'}
          </button>
        </div>
      ) : null}

      {props.progress !== null ? (
        <p className="mt-3 text-xs text-stone-300" role="status">
          Preparing archive review: {props.progress.detail}
        </p>
      ) : null}
      {props.error !== null || safeError !== null ? (
        <p className="mt-3 text-xs font-semibold text-rose-200" role="alert">
          {safeError ?? props.error ?? 'Archive Review failed safely.'}
        </p>
      ) : null}
    </section>
  )
}
