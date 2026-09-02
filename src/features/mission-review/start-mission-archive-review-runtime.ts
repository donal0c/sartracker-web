import type {
  ArchiveReviewBridge,
  ArchiveReviewProgress,
  ArchiveReviewPublicSession,
} from '../../infrastructure/archive-review/archive-review-types'
import type {
  Mission,
  MissionArchiveInfo,
  MissionArchiveVerificationInput,
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { sameMissionArchiveImmutableIdentity } from '../mission/mission-archive-identity'

export type MissionArchiveReviewSession = ArchiveReviewPublicSession
export type MissionArchiveReviewProgress = ArchiveReviewProgress

export type MissionArchiveReviewTimelineEntry = {
  readonly mission: Mission
  readonly archives: readonly MissionArchiveInfo[]
}

export type MissionArchiveReviewRuntimeState = {
  readonly timeline: readonly MissionArchiveReviewTimelineEntry[]
  readonly phase: 'idle' | 'opening' | 'open' | 'closing' | 'error'
  readonly activeOperationId: string | null
  readonly activeArchiveId: string | null
  readonly activeSession: MissionArchiveReviewSession | null
  readonly progress: MissionArchiveReviewProgress | null
  readonly recoveryRequired: 'none' | 'plaintext_cleanup' | 'audit_retry' | 'live_source_resume'
  readonly error: string | null
}

export type MissionArchiveReviewOpenInput =
  | {
      readonly archiveId: string
      readonly containerVersion: 1
    }
  | {
      readonly archiveId: string
      readonly containerVersion: 2
      readonly slotType: 'passphrase' | 'recovery'
      readonly secret: string
    }

export type StartMissionArchiveReviewRuntimeDependencies = {
  readonly missionStore: Pick<
    MissionStore,
    | 'listMissions'
    | 'listMissionArchives'
    | 'verifyMissionArchive'
    | 'cancelMissionArchiveOperation'
  >
  readonly archiveReview: ArchiveReviewBridge
  readonly switchMissionReviewSource: (input:
    | { readonly source: 'live' }
    | {
        readonly source: 'archive'
        readonly archiveSession: MissionArchiveReviewSession
      }
  ) => Promise<void>
  readonly applyRuntime: (runtime: MissionArchiveReviewRuntimeState) => void
  readonly randomUUID?: () => string
}

export type MissionArchiveReviewController = {
  readonly refreshTimeline: () => Promise<boolean>
  readonly verifyArchive: (
    input: MissionArchiveVerificationInput,
  ) => Promise<MissionArchiveInfo>
  readonly cancelArchiveVerification: (operationId: string) => Promise<boolean>
  readonly openArchive: (input: MissionArchiveReviewOpenInput) => Promise<void>
  readonly closeArchiveReview: () => Promise<void>
  readonly dispose: () => Promise<void>
}

const SAFE_OPEN_FAILURE = 'Archive Review failed safely before opening.'
const SAFE_CLOSE_FAILURE = 'Archive review plaintext cleanup failed safely.'
const SAFE_AUDIT_RETRY_FAILURE = 'Archive Review plaintext was removed; mutation-denial audit completion is pending.'
const SAFE_LIVE_RESUME_FAILURE = 'Live mission review failed to resume after archive cleanup.'
const INVALID_VERIFICATION_RESULT = 'ARCHIVE_VERIFICATION_RESULT_INVALID'
const VERIFICATION_STATUS_UNKNOWN = 'ARCHIVE_VERIFICATION_STATUS_UNKNOWN'
const VERIFICATION_RETRYABLE = 'ARCHIVE_VERIFICATION_RETRYABLE'
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

/** Rejects ASCII control characters without relying on a control-character regexp. */
function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
  })
}

/** Recognizes only the main process's stable non-reflective mutation-audit failure. */
function isMutationAuditRetryFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  if ('code' in error && error.code === 'ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED') return true
  return error instanceof Error
    && error.message.includes('(ARCHIVE_REVIEW_MUTATION_AUDIT_FAILED)')
}

/** Recognizes only the main process's stable plaintext-cleanup failure. */
function isPlaintextCleanupFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  if ('code' in error && error.code === 'ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED') return true
  return error instanceof Error
    && error.message.includes('(ARCHIVE_REVIEW_PLAINTEXT_CLEANUP_FAILED)')
}

/** Publishes a detached immutable archive-review runtime snapshot. */
function publishState(
  applyRuntime: StartMissionArchiveReviewRuntimeDependencies['applyRuntime'],
  state: MissionArchiveReviewRuntimeState,
): void {
  applyRuntime(Object.freeze({
    ...state,
    timeline: Object.freeze(state.timeline.map((entry) => Object.freeze({
      mission: Object.freeze({ ...entry.mission }),
      archives: Object.freeze(entry.archives.map((archive) => Object.freeze({
        ...archive,
        slots: Object.freeze(archive.slots.map((slot) => Object.freeze({ ...slot }))),
      }))),
    }))),
  }))
}

/** Returns the selected timeline archive without trusting renderer identity claims. */
function findArchive(
  timeline: readonly MissionArchiveReviewTimelineEntry[],
  archiveId: string,
): MissionArchiveInfo | null {
  for (const entry of timeline) {
    const archive = entry.archives.find((candidate) => candidate.id === archiveId)
    if (archive !== undefined && archive.mission_id === entry.mission.id) return archive
  }
  return null
}

/** Determines whether one retained archive can open under the frozen C9 rules. */
export function archiveReviewAvailability(archive: MissionArchiveInfo): {
  readonly available: boolean
  readonly reason: string | null
} {
  if (archive.availability !== 'present') {
    return { available: false, reason: 'Archive file missing or unavailable.' }
  }
  if (archive.container_version === 1) {
    return ['sealed', 'superseded'].includes(archive.status)
      && archive.verified_at === null
      && archive.ciphertext_sha256 === null
      && archive.slots.length === 0
      ? { available: true, reason: null }
      : { available: false, reason: 'Legacy archive custody record is invalid.' }
  }
  if (archive.container_version !== 2) {
    return { available: false, reason: 'Newer archive format is not supported by this build.' }
  }
  const slotTypes = new Set(archive.slots.map((slot) => slot.slotType))
  if (!['verified', 'superseded'].includes(archive.status)
    || archive.verified_at === null
    || Number.isNaN(Date.parse(archive.verified_at))) {
    return { available: false, reason: 'Archive verification required before review.' }
  }
  if (!slotTypes.has('passphrase') && !slotTypes.has('recovery')) {
    return { available: false, reason: 'Passphrase or recovery credential is unavailable.' }
  }
  return { available: true, reason: null }
}

/** Determines whether one retained archive can retry the existing exhaustive verifier. */
export function archiveVerificationRetryAvailability(archive: MissionArchiveInfo): {
  readonly available: boolean
  readonly reason: string | null
} {
  if (archive.availability !== 'present') {
    return { available: false, reason: 'Archive file missing or unavailable.' }
  }
  if (archive.container_version !== 2) {
    return { available: false, reason: archive.container_version > 2
      ? 'Newer archive format is not supported by this build.'
      : 'Legacy archives do not use encrypted verification retry.' }
  }
  if (archive.status !== 'sealed' || archive.verified_at !== null) {
    return { available: false, reason: 'Only a sealed unverified archive can retry verification.' }
  }
  const slotTypes = new Set(archive.slots.map((slot) => slot.slotType))
  if (!slotTypes.has('passphrase') || !slotTypes.has('recovery')) {
    return {
      available: false,
      reason: 'Original passphrase and recovery credential slots are both required.',
    }
  }
  if (archive.ciphertext_sha256 === null
    || !/^[0-9a-f]{64}$/iu.test(archive.ciphertext_sha256)) {
    return { available: false, reason: 'Archive ciphertext identity is invalid.' }
  }
  return { available: true, reason: null }
}

/** Validates the one non-machine credential without retaining it in state. */
function validateCredential(slotType: 'passphrase' | 'recovery', secret: unknown): string {
  const byteLength = typeof secret === 'string' ? new TextEncoder().encode(secret).byteLength : 0
  if (typeof secret !== 'string'
    || byteLength < 1
    || byteLength > 1_024
    || containsControlCharacters(secret)) {
    throw new Error('Archive review credential is invalid.')
  }
  if (slotType === 'recovery' && !RECOVERY_CODE.test(secret)) {
    throw new Error('Archive review recovery credential is invalid.')
  }
  if (slotType === 'passphrase') {
    const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u]
      .filter((pattern) => pattern.test(secret)).length
    if (secret.length < 14 || classes < 3) {
      throw new Error('Archive review passphrase credential is invalid.')
    }
  }
  return secret
}

/** Requires an open result to preserve the selected archive's exact identity. */
function validateOpenedSession(
  session: MissionArchiveReviewSession & { readonly operationId?: string },
  archive: MissionArchiveInfo,
  operationId: string,
): MissionArchiveReviewSession {
  if (session.operationId !== operationId
    || session.archiveId !== archive.id
    || session.missionId !== archive.mission_id
    || session.containerVersion !== archive.container_version
    || session.immutable !== true
    || session.plaintextResidual !== 'permission_restricted_session_open'
    || (session.containerVersion === 1
      && (session.encrypted !== false
        || session.verified !== false
        || session.ciphertextSha256 !== null))
    || (session.containerVersion === 2
      && (session.encrypted !== true
        || session.verified !== true
        || session.ciphertextSha256 !== archive.ciphertext_sha256))) {
    throw new Error(SAFE_OPEN_FAILURE)
  }
  return Object.freeze({
    sessionId: session.sessionId,
    archiveId: session.archiveId,
    missionId: session.missionId,
    containerVersion: session.containerVersion,
    encrypted: session.encrypted,
    verified: session.verified,
    immutable: true,
    ciphertextSha256: session.ciphertextSha256,
    previousArchiveId: session.previousArchiveId,
    openedAt: session.openedAt,
    plaintextResidual: 'permission_restricted_session_open',
  })
}

/** Starts the archive timeline and its single sender-owned plaintext session. */
export async function startMissionArchiveReviewRuntime(
  dependencies: StartMissionArchiveReviewRuntimeDependencies,
): Promise<MissionArchiveReviewController> {
  const randomUUID = dependencies.randomUUID ?? (() => globalThis.crypto.randomUUID())
  let state: MissionArchiveReviewRuntimeState = {
    timeline: [],
    phase: 'idle',
    activeOperationId: null,
    activeArchiveId: null,
    activeSession: null,
    progress: null,
    recoveryRequired: 'none',
    error: null,
  }
  let disposed = false
  let disposing = false
  let timelineGeneration = 0
  let latestProgressSequence = 0
  let operationGeneration = 0
  let openingTerminal: Promise<void> | null = null
  let closePromise: Promise<void> | null = null
  let pendingAuditSessionId: string | null = null
  let activeVerificationOperationId: string | null = null
  let verificationTerminal: Promise<MissionArchiveInfo> | null = null

  const apply = (patch: Partial<MissionArchiveReviewRuntimeState>): void => {
    state = { ...state, ...patch }
    publishState(dependencies.applyRuntime, state)
  }

  const unsubscribeProgress = dependencies.archiveReview.onProgress((progress) => {
    if (disposed
      || state.activeOperationId === null
      || progress.operationId !== state.activeOperationId
      || progress.archiveId !== state.activeArchiveId
      || progress.sequence <= latestProgressSequence) return
    latestProgressSequence = progress.sequence
    apply({ progress: Object.freeze({ ...progress }) })
  })

  const refreshTimeline = async (): Promise<boolean> => {
    if (disposed || disposing) throw new Error('Archive review runtime is closed.')
    const generation = ++timelineGeneration
    const missions = await dependencies.missionStore.listMissions()
    if (disposed || disposing || generation !== timelineGeneration) return false
    const archives: (readonly MissionArchiveInfo[])[] = []
    for (const mission of missions) {
      if (disposed || disposing || generation !== timelineGeneration) return false
      archives.push(await dependencies.missionStore.listMissionArchives(mission.id))
    }
    if (disposed || disposing || generation !== timelineGeneration) return false
    apply({
      timeline: Object.freeze(missions.map((mission, index) => Object.freeze({
        mission,
        archives: Object.freeze([...(archives[index] ?? [])]),
      }))),
    })
    return true
  }

  /** Re-runs exhaustive verification without changing sealed archive bytes. */
  const verifyArchive = async (
    input: MissionArchiveVerificationInput,
  ): Promise<MissionArchiveInfo> => {
    if (disposed || disposing) throw new Error('Archive review runtime is closed.')
    if (activeVerificationOperationId !== null || verificationTerminal !== null) {
      throw new Error('Archive verification already has active work.')
    }
    if (state.activeOperationId !== null
      || state.activeSession !== null
      || state.recoveryRequired !== 'none'
      || openingTerminal !== null
      || closePromise !== null) {
      throw new Error('Archive Review has active work; archive verification cannot start.')
    }
    const keys = Object.keys(input as object).sort().join(',')
    if (keys !== 'archiveId,operationId,passphrase,recoveryCode') {
      throw new Error('Archive verification request is invalid.')
    }
    if (!UUID_V4.test(input.operationId)) {
      throw new Error('Archive verification operation identity is invalid.')
    }
    const archive = findArchive(state.timeline, input.archiveId)
    if (archive === null || archiveVerificationRetryAvailability(archive).available !== true) {
      throw new Error('Archive verification requires an available sealed supported archive.')
    }
    try {
      validateCredential('passphrase', input.passphrase)
    } catch {
      throw new Error('Archive verification passphrase credential is invalid.')
    }
    try {
      validateCredential('recovery', input.recoveryCode)
    } catch {
      throw new Error('Archive verification recovery credential is invalid.')
    }

    activeVerificationOperationId = input.operationId
    let attempt: Promise<MissionArchiveInfo>
    try {
      attempt = Promise.resolve(dependencies.missionStore.verifyMissionArchive(input))
    } catch (error) {
      attempt = Promise.reject(error)
    }
    verificationTerminal = attempt
    try {
      const result = await attempt
      const verified = validateVerificationResult(result, archive)
      if (!disposed && !disposing) {
        timelineGeneration += 1
        apply({
          timeline: replaceTimelineArchive(state.timeline, verified),
          error: null,
        })
      }
      return verified
    } catch {
      let reconciled: MissionArchiveInfo | null = null
      try {
        const published = await refreshTimeline()
        if (!published) throw archiveVerificationStatusUnknown()
        reconciled = findArchive(state.timeline, archive.id)
      } catch {
        throw archiveVerificationStatusUnknown()
      }
      if (reconciled !== null && reconciled.status === 'verified') {
        try {
          return validateVerificationResult(reconciled, archive)
        } catch {
          throw archiveVerificationStatusUnknown()
        }
      }
      if (reconciled !== null
        && sameMissionArchiveImmutableIdentity(reconciled, archive)
        && archiveVerificationRetryAvailability(reconciled).available) {
        throw Object.assign(
          new Error('Archive verification failed safely. Authoritative status remains sealed.'),
          { code: VERIFICATION_RETRYABLE },
        )
      }
      throw archiveVerificationStatusUnknown()
    } finally {
      if (activeVerificationOperationId === input.operationId) {
        activeVerificationOperationId = null
      }
      if (verificationTerminal === attempt) verificationTerminal = null
    }
  }

  /** Cancels only the exact verification operation owned by this runtime. */
  const cancelArchiveVerification = async (operationId: string): Promise<boolean> => {
    if (!UUID_V4.test(operationId)) {
      throw new Error('Archive verification operation identity is invalid.')
    }
    if (activeVerificationOperationId !== operationId) return false
    return dependencies.missionStore.cancelMissionArchiveOperation(operationId)
  }

  const closeArchiveReview = async (): Promise<void> => {
    if (disposed) return
    if (closePromise !== null) return closePromise
    const attempt = (async (): Promise<void> => {
      if (state.recoveryRequired === 'audit_retry') {
        const sessionId = pendingAuditSessionId
        if (sessionId === null) throw new Error(SAFE_CLOSE_FAILURE)
        apply({ phase: 'closing', progress: null, error: null })
        try {
          const closed = await dependencies.archiveReview.close({ sessionId })
          if (closed !== true) throw new Error(SAFE_CLOSE_FAILURE)
        } catch (error) {
          apply({
            phase: 'error', activeSession: null, recoveryRequired: 'audit_retry',
            error: isMutationAuditRetryFailure(error)
              ? SAFE_AUDIT_RETRY_FAILURE
              : SAFE_CLOSE_FAILURE,
          })
          throw new Error(SAFE_AUDIT_RETRY_FAILURE)
        }
        pendingAuditSessionId = null
        apply({
          activeSession: null, activeOperationId: null, progress: null,
          recoveryRequired: 'live_source_resume', error: null,
        })
        try {
          await dependencies.switchMissionReviewSource({ source: 'live' })
        } catch {
          apply({
            phase: 'error', activeSession: null, activeOperationId: null,
            activeArchiveId: null, progress: null,
            recoveryRequired: 'live_source_resume', error: SAFE_LIVE_RESUME_FAILURE,
          })
          throw new Error(SAFE_CLOSE_FAILURE)
        }
        apply({
          phase: 'idle', activeSession: null, activeOperationId: null,
          activeArchiveId: null, progress: null, recoveryRequired: 'none', error: null,
        })
        return
      }
      if (state.recoveryRequired === 'live_source_resume') {
        apply({ phase: 'closing', progress: null, error: null })
        try {
          await dependencies.switchMissionReviewSource({ source: 'live' })
        } catch {
          apply({
            phase: 'error', recoveryRequired: 'live_source_resume',
            error: SAFE_LIVE_RESUME_FAILURE,
          })
          throw new Error(SAFE_CLOSE_FAILURE)
        }
        apply({
          phase: 'idle', activeOperationId: null, activeArchiveId: null,
          activeSession: null, progress: null, recoveryRequired: 'none', error: null,
        })
        return
      }
      const pendingOpening = openingTerminal
      if (pendingOpening !== null) {
        const operationId = state.activeOperationId
        operationGeneration += 1
        apply({ phase: 'closing', progress: null, error: null })
        if (operationId !== null) {
          await dependencies.archiveReview.cancel({ operationId }).catch(() => false)
        }
        await pendingOpening
        if (state.activeSession !== null || state.recoveryRequired !== 'none') {
          throw new Error(SAFE_CLOSE_FAILURE)
        }
        apply({
          phase: 'idle', activeOperationId: null, activeArchiveId: null,
          progress: null, recoveryRequired: 'none', error: null,
        })
        return
      }
      if (state.activeSession === null) {
        if (state.activeOperationId !== null) {
          const operationId = state.activeOperationId
          operationGeneration += 1
          apply({ phase: 'closing', progress: null, error: null })
          try {
            await dependencies.archiveReview.cancel({ operationId })
          } catch {
            apply({
              phase: 'error', activeOperationId: operationId,
              recoveryRequired: 'plaintext_cleanup', error: SAFE_CLOSE_FAILURE,
            })
            throw new Error(SAFE_CLOSE_FAILURE)
          }
          const terminal = openingTerminal
          if (terminal !== null) await terminal
          if (state.activeSession !== null) {
            throw new Error(SAFE_CLOSE_FAILURE)
          }
          apply({
            phase: 'idle', activeOperationId: null, activeArchiveId: null,
            progress: null, recoveryRequired: 'none', error: null,
          })
        }
        return
      }
      const session = state.activeSession
      apply({ phase: 'closing', progress: null, error: null })
      try {
        const closed = await dependencies.archiveReview.close({ sessionId: session.sessionId })
        if (closed !== true) throw new Error(SAFE_CLOSE_FAILURE)
      } catch (error) {
        if (isMutationAuditRetryFailure(error)) {
          pendingAuditSessionId = session.sessionId
          apply({
            phase: 'error', activeSession: null,
            recoveryRequired: 'audit_retry', error: SAFE_AUDIT_RETRY_FAILURE,
          })
          throw new Error(SAFE_AUDIT_RETRY_FAILURE)
        }
        apply({
          phase: 'error', activeSession: session,
          recoveryRequired: 'plaintext_cleanup', error: SAFE_CLOSE_FAILURE,
        })
        throw new Error(SAFE_CLOSE_FAILURE)
      }
      apply({
        activeSession: null, activeOperationId: null, activeArchiveId: null,
        progress: null, recoveryRequired: 'live_source_resume', error: null,
      })
      try {
        await dependencies.switchMissionReviewSource({ source: 'live' })
      } catch {
        apply({
          phase: 'error', activeSession: null, activeOperationId: null,
          activeArchiveId: null, progress: null,
          recoveryRequired: 'live_source_resume', error: SAFE_LIVE_RESUME_FAILURE,
        })
        throw new Error(SAFE_CLOSE_FAILURE)
      }
      apply({
        phase: 'idle', activeSession: null, activeOperationId: null,
        activeArchiveId: null, progress: null, recoveryRequired: 'none', error: null,
      })
    })()
    closePromise = attempt
    try {
      await attempt
    } finally {
      if (closePromise === attempt) closePromise = null
    }
  }

  const openArchive = async (input: MissionArchiveReviewOpenInput): Promise<void> => {
    if (disposed || state.activeOperationId !== null || state.activeSession !== null
      || state.recoveryRequired !== 'none'
      || activeVerificationOperationId !== null
      || verificationTerminal !== null) {
      throw new Error('Archive review already has active work.')
    }
    const keys = Object.keys(input as object).sort().join(',')
    const validKeys = input.containerVersion === 1
      ? 'archiveId,containerVersion'
      : 'archiveId,containerVersion,secret,slotType'
    if (keys !== validKeys) {
      throw new Error(input.containerVersion === 1
        ? 'Legacy archive review does not accept a credential.'
        : 'Archive review request is invalid.')
    }
    if (input.containerVersion === 2
      && !['passphrase', 'recovery'].includes(input.slotType)) {
      throw new Error('Archive review credential must use passphrase or recovery.')
    }
    const archive = findArchive(state.timeline, input.archiveId)
    const availability = archive === null ? null : archiveReviewAvailability(archive)
    if (archive === null
      || archive.container_version !== input.containerVersion
      || availability?.available !== true) {
      throw new Error('Archive review requires an available verified supported archive.')
    }
    if (input.containerVersion === 2
      && !archive.slots.some((slot) => slot.slotType === input.slotType)) {
      throw new Error('Archive review requested credential slot is unavailable.')
    }
    if (input.containerVersion === 2) validateCredential(input.slotType, input.secret)
    const operationId = randomUUID()
    const generation = ++operationGeneration
    let resolveOpeningTerminal!: () => void
    const terminal = new Promise<void>((resolve) => {
      resolveOpeningTerminal = resolve
    })
    openingTerminal = terminal
    latestProgressSequence = 0
    apply({
      phase: 'opening', activeOperationId: operationId, activeArchiveId: archive.id,
      activeSession: null, progress: null, recoveryRequired: 'none', error: null,
    })
    let terminalFailureRetained = false
    try {
      const session = input.containerVersion === 1
        ? await dependencies.archiveReview.open({
            operationId,
            archiveId: archive.id,
            containerVersion: 1,
          })
        : await dependencies.archiveReview.open({
            operationId,
            archiveId: archive.id,
            containerVersion: 2,
            slotType: input.slotType,
            secret: input.secret,
          })
      let validated: MissionArchiveReviewSession
      try {
        validated = validateOpenedSession(session, archive, operationId)
      } catch {
        const cleanupSession: MissionArchiveReviewSession = Object.freeze({
          sessionId: session.sessionId,
          archiveId: session.archiveId,
          missionId: session.missionId,
          containerVersion: session.containerVersion,
          encrypted: session.encrypted,
          verified: session.verified,
          immutable: session.immutable,
          ciphertextSha256: session.ciphertextSha256,
          previousArchiveId: session.previousArchiveId,
          openedAt: session.openedAt,
          plaintextResidual: session.plaintextResidual,
        })
        try {
          const closed = await dependencies.archiveReview.close({
            sessionId: cleanupSession.sessionId,
          })
          if (closed !== true) throw new Error(SAFE_CLOSE_FAILURE)
        } catch {
          terminalFailureRetained = true
          apply({
            phase: 'error', activeOperationId: null, activeArchiveId: archive.id,
            activeSession: cleanupSession, progress: null,
            recoveryRequired: 'plaintext_cleanup', error: SAFE_CLOSE_FAILURE,
          })
          throw new Error(SAFE_CLOSE_FAILURE)
        }
        throw new Error(SAFE_OPEN_FAILURE)
      }
      if (disposed || generation !== operationGeneration) {
        try {
          const closed = await dependencies.archiveReview.close({ sessionId: validated.sessionId })
          if (closed !== true) throw new Error(SAFE_CLOSE_FAILURE)
        } catch {
          terminalFailureRetained = true
          apply({
            phase: 'error', activeOperationId: null, activeArchiveId: archive.id,
            activeSession: validated, progress: null,
            recoveryRequired: 'plaintext_cleanup', error: SAFE_CLOSE_FAILURE,
          })
          throw new Error(SAFE_CLOSE_FAILURE)
        }
        throw new Error(SAFE_OPEN_FAILURE)
      }
      apply({
        phase: 'opening', activeOperationId: null, activeArchiveId: archive.id,
        activeSession: validated, progress: null, recoveryRequired: 'none', error: null,
      })
      try {
        await dependencies.switchMissionReviewSource({
          source: 'archive',
          archiveSession: validated,
        })
      } catch {
        try {
          const closed = await dependencies.archiveReview.close({ sessionId: validated.sessionId })
          if (closed !== true) throw new Error(SAFE_CLOSE_FAILURE)
        } catch {
          terminalFailureRetained = true
          apply({
            phase: 'error', activeOperationId: null, activeArchiveId: archive.id,
            activeSession: validated, progress: null,
            recoveryRequired: 'plaintext_cleanup', error: SAFE_CLOSE_FAILURE,
          })
          throw new Error(SAFE_CLOSE_FAILURE)
        }
        apply({ activeSession: null, activeArchiveId: null })
        throw new Error(SAFE_OPEN_FAILURE)
      }
      if (disposed || generation !== operationGeneration) {
        try {
          const closed = await dependencies.archiveReview.close({ sessionId: validated.sessionId })
          if (closed !== true) throw new Error(SAFE_CLOSE_FAILURE)
        } catch {
          terminalFailureRetained = true
          apply({
            phase: 'error', activeOperationId: null, activeArchiveId: archive.id,
            activeSession: validated, progress: null,
            recoveryRequired: 'plaintext_cleanup', error: SAFE_CLOSE_FAILURE,
          })
          throw new Error(SAFE_CLOSE_FAILURE)
        }
        apply({ activeSession: null })
        try {
          await dependencies.switchMissionReviewSource({ source: 'live' })
        } catch {
          terminalFailureRetained = true
          apply({
            phase: 'error', activeOperationId: null, activeArchiveId: null,
            activeSession: null, progress: null,
            recoveryRequired: 'live_source_resume', error: SAFE_LIVE_RESUME_FAILURE,
          })
          throw new Error(SAFE_CLOSE_FAILURE)
        }
        apply({ activeArchiveId: null })
        throw new Error(SAFE_OPEN_FAILURE)
      }
      apply({
        phase: 'open', activeOperationId: null, activeArchiveId: archive.id,
        activeSession: validated, progress: null, recoveryRequired: 'none', error: null,
      })
    } catch (openError) {
      if (terminalFailureRetained || state.activeSession !== null) {
        throw new Error(SAFE_CLOSE_FAILURE)
      }
      try {
        const cleanupConfirmed = await dependencies.archiveReview.cancel({ operationId })
        if (isPlaintextCleanupFailure(openError) && cleanupConfirmed !== true) {
          throw new Error(SAFE_CLOSE_FAILURE)
        }
      } catch {
        terminalFailureRetained = true
        apply({
          phase: 'error', activeOperationId: operationId, activeArchiveId: archive.id,
          activeSession: null, progress: null,
          recoveryRequired: 'plaintext_cleanup', error: SAFE_CLOSE_FAILURE,
        })
        throw new Error(SAFE_CLOSE_FAILURE)
      }
      if (!disposed && generation === operationGeneration) {
        apply({
          phase: 'error', activeOperationId: null, activeArchiveId: null,
          activeSession: null, progress: null,
          recoveryRequired: 'none', error: SAFE_OPEN_FAILURE,
        })
      }
      throw new Error(SAFE_OPEN_FAILURE)
    } finally {
      resolveOpeningTerminal()
      if (openingTerminal === terminal) openingTerminal = null
    }
  }

  const dispose = async (): Promise<void> => {
    if (disposed || disposing) return
    disposing = true
    const pendingVerificationOperationId = activeVerificationOperationId
    const pendingVerification = verificationTerminal
    if (pendingVerificationOperationId !== null) {
      await dependencies.missionStore.cancelMissionArchiveOperation(
        pendingVerificationOperationId,
      ).catch(() => false)
    }
    if (pendingVerification !== null) {
      await pendingVerification.catch(() => undefined)
    }
    timelineGeneration += 1
    try {
      await closeArchiveReview()
    } catch (error) {
      disposing = false
      throw error
    }
    disposed = true
    disposing = false
    unsubscribeProgress()
    state = {
      ...state,
      phase: 'idle', activeOperationId: null, activeArchiveId: null,
      activeSession: null, progress: null, recoveryRequired: 'none', error: null,
    }
    publishState(dependencies.applyRuntime, state)
  }

  try {
    await refreshTimeline()
  } catch {
    unsubscribeProgress()
    disposed = true
    throw new Error('Archive review timeline failed safely.')
  }

  return Object.freeze({
    refreshTimeline,
    verifyArchive,
    cancelArchiveVerification,
    openArchive,
    closeArchiveReview,
    dispose,
  })
}

/** Accepts only the request-bound verified registry identity returned by main. */
function validateVerificationResult(
  result: MissionArchiveInfo,
  sealed: MissionArchiveInfo,
): MissionArchiveInfo {
  if (!sameMissionArchiveImmutableIdentity(result, sealed)
    || result.container_version !== 2
    || result.status !== 'verified'
    || result.verified_at === null
    || Number.isNaN(Date.parse(result.verified_at))
    || result.ciphertext_sha256 !== sealed.ciphertext_sha256
    || result.availability !== 'present') {
    throw Object.assign(
      new Error('Archive verification returned an invalid terminal result.'),
      { code: INVALID_VERIFICATION_RESULT },
    )
  }
  return Object.freeze({
    ...result,
    slots: Object.freeze(result.slots.map((slot) => Object.freeze({ ...slot }))),
  })
}

/** Returns one closed error when sealed-vs-verified truth needs reconciliation. */
function archiveVerificationStatusUnknown(): Error & { readonly code: string } {
  return Object.assign(
    new Error(
      'Archive verification status could not be established. Refresh the saved-mission timeline before retrying.',
    ),
    { code: VERIFICATION_STATUS_UNKNOWN },
  )
}


/** Replaces one archive projection without retaining any credential-bearing request. */
function replaceTimelineArchive(
  timeline: readonly MissionArchiveReviewTimelineEntry[],
  verified: MissionArchiveInfo,
): readonly MissionArchiveReviewTimelineEntry[] {
  return Object.freeze(timeline.map((entry) => entry.mission.id !== verified.mission_id
    ? entry
    : Object.freeze({
        mission: entry.mission,
        archives: Object.freeze(entry.archives.map((archive) =>
          archive.id === verified.id ? verified : archive)),
      })))
}
