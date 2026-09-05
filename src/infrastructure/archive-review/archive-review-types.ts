export type ArchiveReviewPublicSession = {
  readonly sessionId: string
  readonly archiveId: string
  readonly missionId: string
  readonly containerVersion: 1 | 2
  readonly encrypted: boolean
  readonly verified: boolean
  readonly immutable: true
  readonly ciphertextSha256: string | null
  readonly previousArchiveId: string | null
  readonly openedAt: string
  readonly plaintextResidual: 'permission_restricted_session_open'
}

export type ArchiveReviewOpenInput =
  | {
      readonly operationId: string
      readonly archiveId: string
      readonly containerVersion: 1
    }
  | {
      readonly operationId: string
      readonly archiveId: string
      readonly containerVersion: 2
      readonly slotType: 'passphrase' | 'recovery'
      readonly secret: string
    }

export type ArchiveReviewReadMethod =
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
  | 'listLayerCatalogMetadata'
  | 'listArchiveAttachmentPage'
  | 'openAttachment'
  | 'recordMutationDenied'

export type ArchiveReviewProgress = {
  readonly operationId: string
  readonly archiveId: string
  readonly containerVersion: 1 | 2
  readonly sequence: number
  readonly phase: string
  readonly unit: 'bytes' | 'files' | 'phases' | 'rows' | 'tables'
  readonly completed: number
  readonly total: number | null
  readonly detail: string
}

export type ArchiveReviewBridge = {
  readonly open: (input: ArchiveReviewOpenInput) => Promise<
    ArchiveReviewPublicSession & { readonly operationId: string }
  >
  readonly close: (input: { readonly sessionId: string }) => Promise<boolean>
  readonly cancel: (input: { readonly operationId: string }) => Promise<boolean>
  readonly read: <Result>(input: {
    readonly sessionId: string
    readonly requestId: string
    readonly method: ArchiveReviewReadMethod
    readonly input: Readonly<Record<string, unknown>>
  }) => Promise<Result>
  readonly onProgress: (listener: (progress: ArchiveReviewProgress) => void) => () => void
}
