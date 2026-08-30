import type {
  ArchiveReviewBridge,
  ArchiveReviewOpenInput,
  ArchiveReviewProgress,
  ArchiveReviewPublicSession,
} from '../../infrastructure/archive-review/archive-review-types'
import type { ElectronArchiveReviewSource } from '../../infrastructure/archive-review/electron-archive-review-source'
import type { BrowserHarnessLayerCatalogStore } from './browser-harness-layer-catalog-store'
import type { BrowserHarnessStore } from './browser-harness-store'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export type BrowserArchiveReviewHarness = {
  readonly archiveReview: ArchiveReviewBridge
  readonly createSource: (session: ArchiveReviewPublicSession) => ElectronArchiveReviewSource
  readonly dispose: () => void
}

export type CreateBrowserArchiveReviewHarnessOptions = {
  readonly missionStore: BrowserHarnessStore
  readonly layerCatalogStore: BrowserHarnessLayerCatalogStore
  readonly randomUUID?: () => string
  readonly now?: () => Date
}

/** Creates one stable browser-validation-only archive-review failure. */
function createFailure(message = 'Archive Review failed safely in browser validation mode.'): Error {
  return new Error(message)
}

/** Detects ASCII control characters in one renderer-visible identifier. */
function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
  })
}

/** Requires an exact record before browser validation handles an archive request. */
function requireExactRecord(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw createFailure()
  }
}

/** Requires one bounded non-control identifier. */
function normalizeIdentifier(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1
    || new TextEncoder().encode(value).byteLength > 200
    || containsControlCharacters(value)) {
    throw createFailure()
  }
  return value
}

/** Creates the UI-only archive-review bridge and fixed read facade for browser proof. */
export function createBrowserArchiveReviewHarness(
  options: CreateBrowserArchiveReviewHarnessOptions,
): BrowserArchiveReviewHarness {
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const listeners = new Set<(progress: ArchiveReviewProgress) => void>()
  let activeSession: ArchiveReviewPublicSession | null = null
  let activeGeneration = 0
  let opening: { readonly operationId: string; cancelled: boolean } | null = null
  let disposed = false

  /** Publishes path- and secret-free browser validation progress. */
  function publishProgress(
    input: ArchiveReviewOpenInput,
    sequence: number,
    phase: string,
    detail: string,
  ): void {
    const progress: ArchiveReviewProgress = Object.freeze({
      operationId: input.operationId,
      archiveId: input.archiveId,
      containerVersion: input.containerVersion,
      sequence,
      phase,
      unit: 'phases',
      completed: sequence,
      total: 2,
      detail,
    })
    for (const listener of listeners) listener(progress)
  }

  const archiveReview: ArchiveReviewBridge = Object.freeze({
    open: async (input) => {
      if (disposed || activeSession !== null || opening !== null) {
        throw createFailure('Archive Review session is already open in browser validation mode.')
      }
      const expectedKeys = input.containerVersion === 2
        ? ['operationId', 'archiveId', 'containerVersion', 'slotType', 'secret']
        : ['operationId', 'archiveId', 'containerVersion']
      requireExactRecord(input, expectedKeys)
      if (!UUID_V4.test(input.operationId)
        || input.containerVersion !== 2
        || !['passphrase', 'recovery'].includes(input.slotType)) {
        throw createFailure()
      }
      normalizeIdentifier(input.archiveId)
      const pending = { operationId: input.operationId, cancelled: false }
      opening = pending
      publishProgress(input, 1, 'restore', 'Preparing synthetic browser review fixture.')
      try {
        const archive = await options.missionStore.validateMissionArchiveReviewCredential({
          archiveId: input.archiveId,
          slotType: input.slotType,
          secret: input.secret,
        })
        if (pending.cancelled || disposed) throw createFailure()
        const sessionId = randomUUID()
        if (!UUID_V4.test(sessionId)) throw createFailure()
        const openedAt = now().toISOString()
        if (Number.isNaN(Date.parse(openedAt))) throw createFailure()
        const session: ArchiveReviewPublicSession = Object.freeze({
          sessionId,
          archiveId: archive.id,
          missionId: archive.mission_id,
          containerVersion: 2,
          encrypted: true,
          verified: true,
          immutable: true,
          ciphertextSha256: archive.ciphertext_sha256,
          previousArchiveId: archive.previous_archive_id,
          openedAt,
          plaintextResidual: 'permission_restricted_session_open',
        })
        activeGeneration += 1
        activeSession = session
        publishProgress(input, 2, 'open', 'Synthetic browser review fixture is ready.')
        return Object.freeze({ operationId: input.operationId, ...session })
      } catch {
        throw createFailure()
      } finally {
        if (opening === pending) opening = null
      }
    },
    close: async (input) => {
      requireExactRecord(input, ['sessionId'])
      if (!UUID_V4.test(String(input.sessionId))
        || activeSession === null
        || input.sessionId !== activeSession.sessionId) return false
      activeSession = null
      return true
    },
    cancel: async (input) => {
      requireExactRecord(input, ['operationId'])
      if (!UUID_V4.test(String(input.operationId))
        || opening === null
        || opening.operationId !== input.operationId) return false
      opening.cancelled = true
      return true
    },
    read: async () => {
      throw createFailure('Browser archive review reads require the fixed read-only facade.')
    },
    onProgress: (listener) => {
      if (typeof listener !== 'function') throw createFailure()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })

  /** Creates a capability-minimal source fixed to the currently open browser session. */
  function createSource(session: ArchiveReviewPublicSession): ElectronArchiveReviewSource {
    if (activeSession === null
      || session.sessionId !== activeSession.sessionId
      || session.archiveId !== activeSession.archiveId
      || session.missionId !== activeSession.missionId) {
      throw createFailure('Archive review session is closed.')
    }
    const generation = activeGeneration

    function assertOpen(): void {
      if (disposed || activeSession === null || activeGeneration !== generation
        || activeSession.sessionId !== session.sessionId) {
        throw createFailure('Archive review session is closed.')
      }
    }

    function assertMission(missionId: string): void {
      assertOpen()
      if (missionId !== session.missionId) {
        throw createFailure('Archive review is fixed to one mission.')
      }
    }

    const source: ElectronArchiveReviewSource = Object.freeze({
      info: async () => {
        assertOpen()
        return {
          schema_version: 13,
          database_path: 'Archive review session (path hidden)',
          backup_path: 'Archive review session (read-only)',
        }
      },
      listMissions: async () => {
        assertOpen()
        return (await options.missionStore.listMissions())
          .filter((mission) => mission.id === session.missionId)
      },
      readMissionReview: async (input) => {
        assertMission(input.missionId)
        return await options.missionStore.readMissionReview(input)
      },
      cancelMissionReviewRead: async (requestId) => {
        assertOpen()
        return await options.missionStore.cancelMissionReviewRead(requestId)
      },
      readMissionReplay: async (input, requestId) => {
        assertMission(input.missionId)
        return await options.missionStore.readMissionReplay(input, requestId)
      },
      readMissionReplayTrackChunk: async (input, requestId) => {
        assertMission(input.missionId)
        return await options.missionStore.readMissionReplayTrackChunk(input, requestId)
      },
      readMissionReplayObjectChunk: async (input, requestId) => {
        assertMission(input.missionId)
        return await options.missionStore.readMissionReplayObjectChunk(input, requestId)
      },
      readMissionReplayFilterPage: async (input, requestId) => {
        assertMission(input.missionId)
        return await options.missionStore.readMissionReplayFilterPage(input, requestId)
      },
      cancelMissionReplay: async (requestId) => {
        assertOpen()
        return await options.missionStore.cancelMissionReplay(requestId)
      },
      listMarkers: async (missionId) => {
        assertMission(missionId)
        return await options.missionStore.listMarkers(missionId)
      },
      listDevices: async (missionId) => {
        assertMission(missionId)
        return await options.missionStore.listDevices(missionId)
      },
      listDrawings: async (missionId) => {
        assertMission(missionId)
        return await options.missionStore.listDrawings(missionId)
      },
      listHelicopters: async (missionId) => {
        assertMission(missionId)
        return await options.missionStore.listHelicopters(missionId)
      },
      listGpxImports: async (missionId) => {
        assertMission(missionId)
        return await options.missionStore.listGpxImports(missionId)
      },
      listGpxImportPage: async (input) => {
        assertMission(input.missionId)
        return await options.missionStore.listGpxImportPage(input)
      },
      listSearchOperationPage: async (input) => {
        assertMission(input.missionId)
        return await options.missionStore.listSearchOperationPage(input)
      },
      listOutings: async (missionId) => {
        assertMission(missionId)
        return await options.missionStore.listOutings(missionId)
      },
      listLayerCatalogMetadata: async (missionId) => {
        assertMission(missionId)
        return await options.layerCatalogStore.listMetadata(missionId)
      },
      listArchiveAttachmentPage: async (input) => {
        assertMission(input.missionId)
        return Object.freeze({
          entries: Object.freeze([]),
          nextCursor: null,
          totalCount: 0,
        })
      },
      openAttachment: async (input) => {
        assertMission(input.missionId)
        throw createFailure('Archived attachment opening is unavailable in browser validation mode.')
      },
    })
    return source
  }

  return Object.freeze({
    archiveReview,
    createSource,
    dispose: () => {
      disposed = true
      if (opening !== null) opening.cancelled = true
      activeSession = null
      listeners.clear()
    },
  })
}
