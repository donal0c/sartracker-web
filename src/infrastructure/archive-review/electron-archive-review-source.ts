import type { LayerCatalogStore } from '../layer-catalog-store/tauri-layer-catalog-store'
import type {
  MissionStore,
  MissionStoreInfo,
} from '../mission-store/tauri-mission-store'
import type {
  ArchiveReviewBridge,
  ArchiveReviewPublicSession,
  ArchiveReviewReadMethod,
} from './archive-review-types'

type ArchiveReviewMissionStoreMethod =
  | 'info'
  | 'listMissions'
  | 'readMissionReview'
  | 'cancelMissionReviewRead'
  | 'readMissionReplay'
  | 'readMissionReplayTrackChunk'
  | 'readMissionReplayObjectChunk'
  | 'readMissionReplayFilterPage'
  | 'cancelMissionReplay'
  | 'listMarkers'
  | 'listDevices'
  | 'listDrawings'
  | 'listHelicopters'
  | 'listGpxImports'
  | 'listGpxImportPage'
  | 'listSearchOperationPage'
  | 'listOutings'

type RequiredStoreMethods = {
  readonly [Method in ArchiveReviewMissionStoreMethod]-?: NonNullable<MissionStore[Method]>
}

export type ArchiveReviewAttachmentInput = {
  readonly missionId: string
  readonly attachmentPath: string
  readonly referenceKind: string
  readonly referenceId: string
}

export type ArchiveReviewAttachmentReference = {
  readonly attachmentPath: string
  readonly referenceKind: string
  readonly referenceId: string
}

export type ArchiveReviewAttachmentPage = {
  readonly entries: readonly ArchiveReviewAttachmentReference[]
  readonly nextCursor: string | null
  readonly totalCount: number
}

export type ElectronArchiveReviewSource = RequiredStoreMethods & {
  readonly listLayerCatalogMetadata: LayerCatalogStore['listMetadata']
  readonly listArchiveAttachmentPage: (input: {
    readonly missionId: string
    readonly cursor: string | null
    readonly limit: number
  }) => Promise<ArchiveReviewAttachmentPage>
  readonly openAttachment: (input: ArchiveReviewAttachmentInput) => Promise<boolean>
}

type OwnedReadMap = Map<string, string>

/** Creates the renderer's fixed-session, capability-minimal archive read facade. */
export function createElectronArchiveReviewSource(
  session: ArchiveReviewPublicSession,
  options: {
    readonly onMutationDenied?: (attemptedMethod: string) => void
  } = {},
): ElectronArchiveReviewSource {
  const bridge = window.sartrackerElectron?.archiveReview
  if (bridge === undefined) {
    throw new Error('Electron archive review bridge is not available.')
  }
  const archiveReviewBridge: ArchiveReviewBridge = bridge
  if (session.immutable !== true || session.plaintextResidual !== 'permission_restricted_session_open'
    || typeof session.missionId !== 'string' || session.missionId.length < 1) {
    throw new Error('Archive review session is invalid.')
  }
  const reviewReads: OwnedReadMap = new Map()
  const replayReads: OwnedReadMap = new Map()

  /** Rejects mission substitution before any renderer-owned value reaches IPC. */
  function assertFixedMission(missionId: string): void {
    if (missionId !== session.missionId) {
      throw new Error('Archive review is fixed to one restored mission.')
    }
  }

  /** Invokes one path-free, session-owned read with a fresh IPC request identity. */
  function invoke<Result>(
    method: ArchiveReviewReadMethod,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Result> {
    return archiveReviewBridge.read<Result>({
      sessionId: session.sessionId,
      requestId: globalThis.crypto.randomUUID(),
      method,
      input,
    })
  }

  /** Owns cancellation identity independently of the runtime's logical request ID. */
  async function invokeOwned<Result>(
    active: OwnedReadMap,
    logicalRequestId: string | undefined,
    method: ArchiveReviewReadMethod,
    input: Readonly<Record<string, unknown>>,
  ): Promise<Result> {
    const logicalId = logicalRequestId ?? globalThis.crypto.randomUUID()
    if (logicalId.length < 1 || logicalId.length > 200) {
      throw new Error('Archive review request identity is invalid.')
    }
    if (active.has(logicalId)) {
      throw new Error('Archive review request is already active.')
    }
    const ownedId = globalThis.crypto.randomUUID()
    active.set(logicalId, ownedId)
    try {
      return await archiveReviewBridge.read<Result>({
        sessionId: session.sessionId,
        requestId: ownedId,
        method,
        input,
      })
    } finally {
      if (active.get(logicalId) === ownedId) active.delete(logicalId)
    }
  }

  /** Cancels one exact in-flight read without crossing Review and Replay ownership. */
  async function cancelOwned(
    active: OwnedReadMap,
    logicalRequestId: string,
    method: 'cancelMissionReviewRead' | 'cancelMissionReplay',
  ): Promise<boolean> {
    const ownedId = active.get(logicalRequestId)
    if (ownedId === undefined) return false
    active.delete(logicalRequestId)
    return await invoke<boolean>(method, { requestId: ownedId })
  }

  const source: ElectronArchiveReviewSource = {
    info: async () => {
      await invoke<unknown>('info', {})
      const info: MissionStoreInfo = {
        schema_version: 13,
        database_path: 'Archive review session (path hidden)',
        backup_path: 'Archive review session (read-only)',
      }
      return info
    },
    listMissions: () => invoke('listMissions', {}),
    readMissionReview: (input, requestId) => {
      assertFixedMission(input.missionId)
      return invokeOwned(reviewReads, requestId, 'readMissionReview', input)
    },
    cancelMissionReviewRead: (requestId) =>
      cancelOwned(reviewReads, requestId, 'cancelMissionReviewRead'),
    readMissionReplay: (input, requestId) => {
      assertFixedMission(input.missionId)
      return invokeOwned(replayReads, requestId, 'readMissionReplay', input)
    },
    readMissionReplayTrackChunk: (input, requestId) => {
      assertFixedMission(input.missionId)
      return invokeOwned(replayReads, requestId, 'readMissionReplayTrackChunk', input)
    },
    readMissionReplayObjectChunk: (input, requestId) => {
      assertFixedMission(input.missionId)
      return invokeOwned(replayReads, requestId, 'readMissionReplayObjectChunk', input)
    },
    readMissionReplayFilterPage: (input, requestId) => {
      assertFixedMission(input.missionId)
      return invokeOwned(replayReads, requestId, 'readMissionReplayFilterPage', input)
    },
    cancelMissionReplay: (requestId) => cancelOwned(replayReads, requestId, 'cancelMissionReplay'),
    listMarkers: (missionId) => {
      assertFixedMission(missionId)
      return invoke('listMarkers', { missionId })
    },
    listDevices: (missionId) => {
      assertFixedMission(missionId)
      return invoke('listDevices', { missionId })
    },
    listDrawings: (missionId) => {
      assertFixedMission(missionId)
      return invoke('listDrawings', { missionId })
    },
    listHelicopters: (missionId) => {
      assertFixedMission(missionId)
      return invoke('listHelicopters', { missionId })
    },
    listGpxImports: (missionId) => {
      assertFixedMission(missionId)
      return invoke('listGpxImports', { missionId })
    },
    listGpxImportPage: (input) => {
      assertFixedMission(input.missionId)
      return invoke('listGpxImportPage', input)
    },
    listSearchOperationPage: (input) => {
      assertFixedMission(input.missionId)
      return invoke('listSearchOperationPage', input)
    },
    listOutings: (missionId) => {
      assertFixedMission(missionId)
      return invoke('listOutings', { missionId })
    },
    listLayerCatalogMetadata: (missionId) => {
      assertFixedMission(missionId)
      return invoke('listLayerCatalogMetadata', { missionId })
    },
    listArchiveAttachmentPage: (input) => {
      assertFixedMission(input.missionId)
      return invoke('listArchiveAttachmentPage', input)
    },
    openAttachment: (input) => {
      assertFixedMission(input.missionId)
      return invoke('openAttachment', input)
    },
  }
  const onMutationDenied = options.onMutationDenied ?? ((attemptedMethod: string) => {
    try {
      void archiveReviewBridge.read<boolean>({
        sessionId: session.sessionId,
        requestId: globalThis.crypto.randomUUID(),
        method: 'recordMutationDenied',
        input: { attemptedMethod },
      }).catch(() => undefined)
    } catch {
      throw new Error('Archive review mutation denial audit failed safely.')
    }
  })
  return new Proxy(Object.freeze(source), {
    get(target, property, receiver) {
      if (typeof property !== 'string' || Object.prototype.hasOwnProperty.call(target, property)) {
        return Reflect.get(target, property, receiver)
      }
      onMutationDenied(property.slice(0, 100))
      throw new Error('Archive review is read-only and does not expose mutation capabilities.')
    },
    set(_target, property) {
      onMutationDenied(`set:${String(property)}`.slice(0, 100))
      throw new Error('Archive review is read-only and does not expose mutation capabilities.')
    },
    defineProperty(_target, property) {
      onMutationDenied(`define:${String(property)}`.slice(0, 100))
      throw new Error('Archive review is read-only and does not expose mutation capabilities.')
    },
    deleteProperty(_target, property) {
      onMutationDenied(`delete:${String(property)}`.slice(0, 100))
      throw new Error('Archive review is read-only and does not expose mutation capabilities.')
    },
  })
}
