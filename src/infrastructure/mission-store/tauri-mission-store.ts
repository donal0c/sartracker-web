import { invoke } from '@tauri-apps/api/core'
import type {
  AcknowledgeIngestEvidenceLossInput,
  IngestEvidenceHealth,
  IngestEvidenceLossReason,
} from '../../domain/tracking-ingest-evidence'

export type { IngestEvidenceHealth } from '../../domain/tracking-ingest-evidence'

export type MissionStatus = 'active' | 'paused' | 'finished' | 'finalized'

export type Mission = {
  readonly id: string
  readonly name: string
  readonly status: MissionStatus
  readonly start_time: string
  readonly pause_time: string | null
  readonly finish_time: string | null
  readonly paused_seconds: number
  readonly notes: string | null
  readonly schema_version: number
}

export type Outing = {
  readonly id: string
  readonly mission_id: string
  readonly label: string
  readonly started_at: string
  readonly ended_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

export type CreateOutingInput = {
  readonly mission_id: string
  readonly label: string
  readonly started_at?: string
}

export type EndOutingInput = {
  readonly mission_id: string
  readonly outing_id: string
  readonly ended_at?: string
}

export type RenameOutingInput = {
  readonly mission_id: string
  readonly outing_id: string
  readonly label: string
}

export type EditOutingBoundariesInput = {
  readonly mission_id: string
  readonly outing_id: string
  readonly started_at?: string
  readonly ended_at?: string | null
}

export type OutingFixSummary = {
  readonly outings: readonly {
    readonly outing_id: string
    readonly accepted_fix_count: number
  }[]
  readonly unassigned_accepted_fix_count: number
  readonly total_accepted_fix_count: number
}

export type CoveragePeriodKind = 'outing' | 'unassigned'

export type CoverageChunkKey = {
  readonly device_id: string
  readonly period_kind: CoveragePeriodKind
  readonly period_id: string
}

export type CoverageManifestChunk = {
  readonly key: CoverageChunkKey
  readonly contentRev: number
  readonly builtRev: number | null
  readonly fixCount: number | null
  readonly exactCount: number
  readonly fixDigest: string | null
  readonly exactDigest?: string
  readonly exactMinTs?: string | null
  readonly exactMaxTs?: string | null
}

export type CoverageManifest = {
  readonly changeSeq: number
  readonly enumerated: boolean
  readonly pendingInvalidation: boolean
  readonly backfillIncomplete: boolean
  readonly diagnostics?: CoverageStorageDiagnostics
  readonly outings: readonly {
    readonly id: string
    readonly label: string
    readonly started_at: string
    readonly ended_at: string | null
  }[]
  readonly chunks: readonly CoverageManifestChunk[]
}

export type CoverageStorageDiagnostics = {
  readonly queueDepth: number
  readonly oldestQueuedAt: string | null
  readonly pendingChunkCount: number
  readonly staleChunkCount: number
  readonly freshChunkCount: number
  readonly pendingInvalidationCount: number
  readonly lastEnumerationDurationMs: number | null
  readonly lastBuildDurationMs: number | null
}

export type CoverageChunkCursor = {
  readonly timestamp: string
  readonly id: string
}

export type CoverageChunkPage = {
  readonly contentRev: number
  readonly positions: readonly Position[]
  readonly nextCursor: CoverageChunkCursor | null
}

export type CoverageClaim = {
  readonly changeSeq: number
  readonly databaseReady: boolean
  readonly blockers: readonly string[]
  readonly chunkRevisions: readonly {
    readonly key: CoverageChunkKey
    readonly contentRev: number
  }[]
}

export type CoverageTileCatalog = {
  /** Mission-scoped renderer identity; revisions can legitimately repeat across missions. */
  readonly missionId: string
  /** Opaque native-worker stage awaiting renderer acceptance. */
  readonly activationId?: string
  /** Recovery catalogs must replace structurally present sources before attestation. */
  readonly requiresFreshRendererSources?: boolean
  /** Intermediate recovery catalogs keep prior periods visible until final replacement. */
  readonly retainPriorPeriods?: boolean
  readonly periods: readonly {
    readonly periodKey: string
    readonly revisionDigest: string
  }[]
  readonly delivered: readonly {
    readonly key: CoverageChunkKey
    readonly contentRev: number
  }[]
  /** Browser-validation payload only; native Electron catalogs never include it. */
  readonly browserHarnessGeoJson?: {
    readonly type: 'FeatureCollection'
    readonly features: readonly {
      readonly type: 'Feature'
      readonly id: string
      readonly geometry: {
        readonly type: 'Point' | 'LineString'
        readonly coordinates: readonly number[] | readonly (readonly number[])[]
      }
      readonly properties: Readonly<Record<string, string | number>>
    }[]
  }
}

export type ParticipantProvenance = 'explicit' | 'grandfathered' | 'legacy_auto'

export type MissionParticipant = {
  readonly id: string
  readonly mission_id: string
  readonly kind: 'device' | 'group'
  readonly traccar_device_id: string | null
  readonly mission_team_id: string | null
  readonly traccar_group_id: string | null
  readonly team_name: string | null
  readonly provenance: ParticipantProvenance
  readonly effective_from: string
  readonly added_at: string
  readonly added_by: string | null
  readonly removed_at: string | null
  readonly removed_by: string | null
  readonly backfill_window_to?: string | null
  readonly backfill_reconciled_until?: string | null
  readonly backfill_completed?: number | null
  readonly backfill_member_count?: number | null
  readonly backfill_completed_count?: number | null
}

export type GroupMembershipEvent = {
  readonly id: string
  /** Durable append order used when multiple observations share one timestamp. */
  readonly sequence: number
  readonly mission_id: string
  readonly mission_team_id: string
  readonly traccar_device_id: string
  readonly change: 'member' | 'left'
  readonly observed_at: string
}

export type ParticipantBackfillCheckpoint = {
  readonly mission_id: string
  readonly traccar_device_id: string
  readonly window_from: string
  readonly window_to: string
  readonly reconciled_until: string
  readonly completed: number
  readonly updated_at: string
}

export type DeviceStatus = 'online' | 'offline' | 'unknown'

export type Device = {
  readonly id: string
  readonly mission_id: string
  readonly device_id: string
  readonly name: string
  readonly color: string
  readonly last_seen: string | null
  readonly status: DeviceStatus
  readonly group_id: string | null
  readonly unique_id: string | null
}

export type Position = {
  readonly id: string
  readonly mission_id: string
  readonly device_id: string
  readonly source_position_id: string | null
  readonly name: string | null
  readonly lat: number
  readonly lon: number
  readonly altitude: number | null
  readonly speed: number | null
  readonly battery: number | null
  readonly accuracy: number | null
  readonly source: string | null
  readonly timestamp: string
  readonly data_origin: 'live' | 'cache'
  readonly received_at?: string | null
  readonly content_hash?: string | null
  readonly source_kind?: 'traccar' | null
  readonly timestamp_source?: 'fix' | null
}

export type IngestAnomaly = {
  readonly id: string
  readonly mission_id: string
  readonly kind: 'rejected' | 'conflict'
  readonly device_id: string | null
  readonly source_position_id: string | null
  readonly reason_class: string
  readonly received_at: string
  readonly created_at: string
  readonly first_seen_at: string
  readonly last_seen_at: string
  readonly occurrence_count: number
}

export type ListIngestAnomaliesOptions = {
  readonly limit?: number
  readonly offset?: number
}

export type IngestRejectionEnvelope = {
  readonly deliveryId: string
  readonly anomalyKey: string
  readonly deviceId: string | null
  readonly sourcePositionId: string | null
  readonly reasonClass: string
  readonly receivedAt: string
  readonly canonicalEvidence: Readonly<Record<string, unknown>>
}

export type ExactBreadcrumbDotPosition = Pick<
  Position,
  | 'id'
  | 'source_position_id'
  | 'device_id'
  | 'lat'
  | 'lon'
  | 'timestamp'
  | 'data_origin'
>

export type ExactBreadcrumbDotPageQuery = {
  readonly missionId: string
  readonly activeDeviceIds: readonly string[]
  readonly limit: number
  readonly cursor?: string | null
  readonly direction: 'earlier' | 'later' | 'latest'
}

export type ExactBreadcrumbDotPage = {
  readonly positions: readonly ExactBreadcrumbDotPosition[]
  readonly totalPositionCount: number
  readonly pagePositionCount: number
  readonly fromTimestamp: string | null
  readonly toTimestamp: string | null
  readonly hasEarlier: boolean
  readonly hasLater: boolean
  readonly earlierCursor: string | null
  readonly laterCursor: string | null
}

export type MarkerType = 'ipp_lkp' | 'clue' | 'hazard' | 'casualty'

export type Marker = {
  readonly id: string
  readonly mission_id: string
  readonly type: MarkerType
  readonly name: string
  readonly description: string | null
  readonly lat: number
  readonly lon: number
  readonly irish_grid_e: number
  readonly irish_grid_n: number
  readonly created_at: string
  readonly updated_at: string
  readonly display_order: number
  readonly subject_category: string | null
  readonly clue_type: string | null
  readonly confidence: number | null
  readonly found_by: string | null
  readonly hazard_type: string | null
  readonly severity: string | null
  readonly condition: string | null
  readonly treatment: string | null
  readonly evacuation_priority: string | null
  readonly label_size?: number | null
  readonly updated_by: string | null
  readonly coordinator_ids: string | null
  readonly attachment_path: string | null
}

export type DrawingType =
  | 'line'
  | 'search_area'
  | 'range_ring'
  | 'bearing_line'
  | 'search_sector'
  | 'text_label'

export type Drawing = {
  readonly id: string
  readonly mission_id: string
  readonly type: DrawingType
  readonly name: string
  readonly description: string | null
  readonly color: string | null
  readonly width: number | null
  readonly distance_m: number | null
  readonly temporary_measure: boolean | null
  readonly label: string | null
  readonly display_order: number
  readonly geometry_json: string
  readonly metadata_json: string | null
  readonly created_at: string
  readonly updated_at: string
}

export type GpxTrackImport = {
  readonly id: string
  readonly mission_id: string
  readonly source_path: string
  readonly file_name: string
  readonly display_name: string
  readonly geometry_json: string
  readonly metadata_json: string | null
  readonly content_sha256?: string | null
  readonly source_bytes_base64?: string | null
  readonly timing_class?: 'fully_dated' | 'partially_dated' | 'undated'
  readonly outing_id?: string | null
  readonly revision_sequence?: number
  readonly retired_at?: string | null
  readonly retired_by?: string | null
  readonly imported_at: string
  readonly updated_at: string
}

export type GpxImportIssue = {
  readonly batch_id: string
  readonly file_name: string
  readonly reason: string
  readonly recorded_at: string
}

export type GpxImportIssuePage = {
  readonly entries: readonly GpxImportIssue[]
  readonly nextCursor: string | null
}

export type GpxImportPage = {
  readonly entries: readonly GpxTrackImport[]
  readonly nextCursor: string | null
}

export type HelicopterSlotKey = 'slot_1' | 'slot_2' | 'slot_3' | 'slot_4'

export type Helicopter = {
  readonly id: string
  readonly mission_id: string
  readonly slot_key: HelicopterSlotKey
  readonly call_sign: string
  readonly hex_id: string | null
  readonly lat: number
  readonly lon: number
  readonly altitude: number | null
  readonly speed: number | null
  readonly heading: number | null
  readonly last_update: string
  readonly created_at: string
  readonly updated_at: string
}

export type UpsertHelicopterInput = {
  readonly id?: string | null
  readonly mission_id: string
  readonly slot_key: HelicopterSlotKey
  readonly call_sign: string
  readonly hex_id?: string | null
  readonly lat: number
  readonly lon: number
  readonly altitude?: number | null
  readonly speed?: number | null
  readonly heading?: number | null
  readonly last_update?: string | null
}

export type UpsertGpxTrackImportInput = {
  readonly id?: string | null
  readonly mission_id: string
  readonly source_path: string
  readonly file_name: string
  readonly display_name: string
  readonly geometry_json: string
  readonly metadata_json?: string | null
  readonly content_sha256?: string | null
  readonly source_bytes_base64?: string | null
  readonly timing_class?: 'fully_dated' | 'partially_dated' | 'undated'
  readonly outing_id?: string | null
  readonly points?: readonly {
    readonly segment_index: number
    readonly point_index: number
    readonly track_name: string | null
    readonly lat: number
    readonly lon: number
    readonly elevation: number | null
    readonly timestamp: string | null
  }[]
  readonly rejections?: readonly {
    readonly kind: 'point' | 'segment'
    readonly segment_index: number
    readonly point_index: number | null
    readonly reason: string
    readonly source_value: string | null
  }[]
}

export type SearchArea = {
  readonly id: string
  readonly mission_id: string
  readonly name: string
  readonly status: 'active' | 'retired'
  readonly geometry_json: string
  readonly legacy_drawing_id: string | null
  readonly version_sequence: number
  readonly updated_by: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly retired_at: string | null
}

export type SearchAssignment = {
  readonly id: string
  readonly mission_id: string
  readonly search_area_id: string
  readonly outing_id: string
  readonly team_id: string
  readonly participant_ids_json: string
  readonly notes: string | null
  readonly version_sequence: number
  readonly updated_by: string | null
  readonly created_at: string
  readonly updated_at: string
  readonly retired_at: string | null
}

export type SearchPassOutcome = 'full' | 'partial' | 'aborted'

export type SearchPass = {
  readonly id: string
  readonly mission_id: string
  readonly search_area_id: string
  readonly assignment_id: string
  readonly started_at: string
  readonly ended_at: string | null
  readonly outcome: SearchPassOutcome
  readonly notes: string | null
  readonly coordinator_name: string
  readonly advisory_coverage_json: string | null
  readonly version_sequence: number
  readonly created_at: string
  readonly updated_at: string
  readonly participant_ids?: readonly string[]
  readonly clue_ids?: readonly string[]
  readonly track_evidence_ids?: readonly string[]
}

export type MissionReplayTrackRecord = {
  readonly evidence_id: string
  readonly source_type: 'traccar_fix' | 'gpx_point'
  readonly track_id: string
  readonly effective_at: string
  readonly recorded_at: string
  readonly lat: number
  readonly lon: number
  readonly elevation: number | null
  readonly accuracy: number | null
  readonly time_authority: 'fixTime' | 'gpx_source_time'
  readonly completeness: 'complete' | 'legacy_baseline'
}

export type MissionReplayReadInput = {
  readonly missionId: string
  readonly selectedTime: string
  readonly trackLimit: number
  readonly timezone?: string
  readonly cursor?: string | null
  readonly objectLimit?: number
  readonly objectCursor?: string | null
  readonly replayGeneration?: number
  /** Display-only Traccar-device filter; never changes reconstructed mission state. */
  readonly deviceIds?: readonly string[]
  /** Display-only GPX-outing filter; never changes reconstructed mission state. */
  readonly outingIds?: readonly string[]
}

export type MissionReplayReadResult = {
  readonly missionId: string
  readonly selectedTime: string
  readonly replayGeneration?: number
  readonly timezone: string
  readonly objects: readonly {
    readonly object_type: string
    readonly object_id: string
    readonly version_sequence: number
    readonly operation: string
    readonly effective_at: string
    readonly recorded_at: string
    readonly completeness: 'complete' | 'legacy_baseline'
    readonly state: Readonly<Record<string, unknown>>
  }[]
  readonly totalObjectCount: number
  readonly objectTypeCounts: Readonly<Record<string, number>>
  readonly objectCursor: string
  readonly nextObjectCursor: string | null
  readonly missionLifecycle?: {
    readonly id: string
    readonly event_type: string
    readonly timestamp: string
    readonly details_json: string | null
  } | null
  readonly participants?: readonly MissionParticipant[]
  readonly groupMembership?: readonly GroupMembershipEvent[]
  readonly tracks: readonly MissionReplayTrackRecord[]
  readonly trackCursor: string
  readonly previousCursor: string | null
  readonly totalTrackCount: number
  readonly staticGpxPointCount: number
  readonly availableDeviceIds: readonly string[]
  readonly availableOutingIds: readonly string[]
  readonly deviceFilterIds: readonly string[]
  readonly outingFilterIds: readonly string[]
  readonly staticGpxEvidence: readonly {
    readonly import_id: string
    readonly revision_sequence: number
    readonly source_path: string
    readonly file_name: string
    readonly display_name: string
    readonly content_sha256: string | null
    readonly timing_class: 'fully_dated' | 'partially_dated' | 'undated'
    readonly outing_id: string | null
    readonly completeness: 'complete' | 'legacy_baseline'
    readonly recorded_at: string
    readonly static_point_count: number
    readonly rejection_count: number
  }[]
  readonly nextCursor: string | null
  readonly progress: number
  readonly limitations: readonly {
    readonly code: string
    readonly message: string
    readonly count?: number
    readonly boundaryTime?: string
  }[]
}

export type MissionReplayTrackChunkResult = Pick<
  MissionReplayReadResult,
  | 'missionId'
  | 'selectedTime'
  | 'tracks'
  | 'trackCursor'
  | 'previousCursor'
  | 'totalTrackCount'
  | 'nextCursor'
  | 'progress'
>

export type MissionReplayObjectChunkResult = Pick<
  MissionReplayReadResult,
  | 'missionId'
  | 'selectedTime'
  | 'objects'
  | 'totalObjectCount'
  | 'objectCursor'
  | 'nextObjectCursor'
  | 'progress'
>

export type MissionStoreInfo = {
  readonly schema_version: number
  readonly database_path: string
  readonly backup_path: string
  readonly ingest_evidence_health?: IngestEvidenceHealth
}

export type MissionArchiveInfo = {
  readonly mission_id: string
  readonly archive_path: string
  readonly created_at: string
}

export type FinalizeMissionResult = {
  readonly mission: Mission
  readonly archive: MissionArchiveInfo
}

export type UnlockFinalizedMissionInput = {
  readonly mission_id: string
  readonly admin_name: string
  readonly reason: string
}

export type MissionEvent = {
  readonly id: string
  readonly mission_id: string
  readonly event_type: string
  readonly timestamp: string
  readonly details_json: string | null
}

/**
 * Options for the bounded review audit-event query. Defaults exclude high-volume
 * tracking telemetry and cap the result so the UI never receives an unbounded set.
 */
export type ListAuditEventsOptions = {
  readonly includeTelemetry?: boolean
  readonly limit?: number
}

/** One bounded, snapshot-consistent read used by the docked Mission Review workspace. */
export type MissionReviewReadQuery = {
  readonly missionId: string
  readonly includeTelemetry: boolean
  readonly auditLimit: number
}

export type MissionReviewReadResult = {
  readonly auditEvents: readonly MissionEvent[]
  readonly breadcrumbCount: number
}

export type CreateMissionInput = {
  readonly name: string
  readonly start_time?: string
  readonly notes?: string | null
}

export type UpsertDeviceInput = {
  readonly mission_id: string
  readonly device_id: string
  readonly name: string
  readonly color: string
  readonly status: DeviceStatus
  readonly last_seen?: string | null
  readonly group_id?: string | null
  readonly unique_id?: string | null
  readonly participant_provenance?: 'legacy_auto'
}

export type SelectMissionParticipantsInput = {
  readonly mission_id: string
  readonly groups: readonly {
    readonly traccar_group_id: string
    readonly name: string
    readonly member_device_ids: readonly string[]
  }[]
  readonly devices: readonly { readonly traccar_device_id: string }[]
  readonly selected_by: string
}

export type AddMissionParticipantInput = {
  readonly mission_id: string
  readonly kind: 'device' | 'group'
  readonly ref: string | {
    readonly traccar_group_id: string
    readonly name: string
    readonly member_device_ids?: readonly string[]
  }
  readonly effective_from?: string
  readonly confirmed_by: string
}

export type AddPositionInput = {
  readonly mission_id: string
  readonly device_id: string
  readonly source_position_id?: string | null
  readonly name?: string | null
  readonly lat: number
  readonly lon: number
  readonly altitude?: number | null
  readonly speed?: number | null
  readonly battery?: number | null
  readonly accuracy?: number | null
  readonly source?: string | null
  readonly timestamp?: string | null
  readonly timestamp_source?: 'fix' | null
  readonly data_origin?: 'live' | 'cache' | null
}

export type TrackingHistoryCheckpoint = {
  readonly mission_id: string
  readonly device_id: string
  readonly history_from: string
  readonly reconciled_until: string
}

export type PersistTrackingHistoryBatchInput = {
  readonly mission_id: string
  readonly positions: readonly Omit<AddPositionInput, 'mission_id'>[]
  readonly checkpoints: readonly Omit<TrackingHistoryCheckpoint, 'mission_id'>[]
}

export type PersistTrackingPositionsBulkInput = PersistTrackingHistoryBatchInput

export type TrackingPositionsPersistenceAck = {
  readonly changedPositionCount: number
  readonly insertedPositionCount: number
  readonly skippedAmbiguousLegacyAdoptionCount: number
}

export type UpsertMarkerInput = {
  readonly id?: string | null
  readonly mission_id: string
  readonly type: MarkerType
  readonly name: string
  readonly description?: string | null
  readonly lat: number
  readonly lon: number
  readonly irish_grid_e: number
  readonly irish_grid_n: number
  readonly display_order: number
  readonly subject_category?: string | null
  readonly clue_type?: string | null
  readonly confidence?: number | null
  readonly found_by?: string | null
  readonly hazard_type?: string | null
  readonly severity?: string | null
  readonly condition?: string | null
  readonly treatment?: string | null
  readonly evacuation_priority?: string | null
  readonly label_size?: number | null
  readonly updated_by?: string | null
  readonly coordinator_ids?: string | null
  readonly attachment_path?: string | null
}

export type UpsertDrawingInput = {
  readonly id?: string | null
  readonly mission_id: string
  readonly type: DrawingType
  readonly name: string
  readonly description?: string | null
  readonly color?: string | null
  readonly width?: number | null
  readonly distance_m?: number | null
  readonly temporary_measure?: boolean | null
  readonly label?: string | null
  readonly display_order: number
  readonly geometry_json: string
  readonly metadata_json?: string | null
}

export type MissionStore = {
  readonly info: () => Promise<MissionStoreInfo>
  readonly syncBackup: (trigger?: string) => Promise<string>
  readonly createMissionArchive: (missionId: string) => Promise<MissionArchiveInfo>
  readonly createMission: (input: CreateMissionInput) => Promise<Mission>
  readonly createOuting?: (input: CreateOutingInput) => Promise<Outing>
  readonly endOuting?: (input: EndOutingInput) => Promise<Outing>
  readonly renameOuting?: (input: RenameOutingInput) => Promise<Outing>
  readonly editOutingBoundaries?: (input: EditOutingBoundariesInput) => Promise<Outing>
  readonly listOutings?: (missionId: string) => Promise<readonly Outing[]>
  readonly readOutingFixSummary?: (
    input: { readonly missionId: string },
    requestId?: string,
  ) => Promise<OutingFixSummary>
  readonly cancelOutingFixSummary?: (requestId: string) => Promise<boolean>
  readonly selectMissionParticipants?: (
    input: SelectMissionParticipantsInput,
  ) => Promise<readonly MissionParticipant[]>
  readonly addMissionParticipant?: (
    input: AddMissionParticipantInput,
  ) => Promise<MissionParticipant>
  readonly removeMissionParticipant?: (input: {
    readonly mission_id: string
    readonly participant_id: string
    readonly removed_by: string
    readonly reason?: string
  }) => Promise<MissionParticipant>
  readonly listMissionParticipants?: (
    missionId: string,
  ) => Promise<readonly MissionParticipant[]>
  readonly recordGroupMembershipEvents?: (input: {
    readonly mission_id: string
    readonly events: readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[]
  }) => Promise<readonly GroupMembershipEvent[]>
  readonly listGroupMembershipEvents?: (
    missionId: string,
    teamId?: string,
  ) => Promise<readonly GroupMembershipEvent[]>
  readonly upsertParticipantBackfillCheckpoint?: (
    input: Omit<ParticipantBackfillCheckpoint, 'completed' | 'updated_at'> & {
      readonly completed: boolean
    },
  ) => Promise<ParticipantBackfillCheckpoint>
  readonly listParticipantBackfillCheckpoints?: (
    missionId: string,
  ) => Promise<readonly ParticipantBackfillCheckpoint[]>
  readonly upsertDevice: (input: UpsertDeviceInput) => Promise<Device>
  readonly upsertDevicesBulk?: (input: {
    readonly mission_id: string
    readonly devices: readonly Omit<UpsertDeviceInput, 'mission_id'>[]
    readonly participant_provenance?: 'legacy_auto'
  }) => Promise<readonly Device[]>
  readonly getDevice: (missionId: string, deviceId: string) => Promise<Device>
  readonly listDevices: (missionId: string) => Promise<readonly Device[]>
  readonly addPosition: (input: AddPositionInput) => Promise<Position>
  readonly addPositionsBulk?: (input: {
    readonly mission_id: string
    readonly positions: readonly Omit<AddPositionInput, 'mission_id'>[]
  }) => Promise<readonly Position[]>
  readonly persistTrackingHistoryBatch?: (
    input: PersistTrackingHistoryBatchInput,
  ) => Promise<readonly Position[]>
  readonly persistTrackingPositionsBulk?: (
    input: PersistTrackingPositionsBulkInput,
  ) => Promise<TrackingPositionsPersistenceAck>
  readonly listPositions: (
    missionId: string,
    deviceId?: string,
  ) => Promise<readonly Position[]>
  readonly listRecentPositions?: (
    missionId: string,
    perDeviceLimit: number,
  ) => Promise<readonly Position[]>
  readonly listBreadcrumbPositions?: (
    missionId: string,
    perDeviceLimit: number,
    requestId?: string,
  ) => Promise<{
    readonly positions: readonly Position[]
    readonly deviceTotals: readonly {
      readonly device_id: string
      readonly total: number
    }[]
    readonly deviceSelections?: readonly {
      readonly device_id: string
      readonly geometryErrorBoundMetres: number | null
      readonly targetGeometryErrorSatisfied: boolean
      readonly timeBucketWidthMs?: number | null
      readonly spatialBucketWidthDegrees?: number | null
    }[]
    readonly droppedPositionCount?: number
  }>
  readonly cancelBreadcrumbQuery?: (requestId: string) => Promise<boolean>
  readonly listExactBreadcrumbDotPage?: (
    input: ExactBreadcrumbDotPageQuery,
    requestId?: string,
  ) => Promise<ExactBreadcrumbDotPage>
  readonly cancelExactBreadcrumbDotQuery?: (requestId: string) => Promise<boolean>
  readonly readCoverageManifest?: (
    missionId: string,
    requestId?: string,
  ) => Promise<CoverageManifest>
  readonly readCoverageChunk?: (
    input: {
      readonly missionId: string
      readonly key: CoverageChunkKey
      readonly expectedContentRev: number
      readonly cursor?: CoverageChunkCursor
      readonly limit?: number
    },
    requestId?: string,
  ) => Promise<CoverageChunkPage>
  readonly readCoverageClaim?: (
    input: {
      readonly missionId: string
      readonly selectedKeys: readonly CoverageChunkKey[]
    },
    requestId?: string,
  ) => Promise<CoverageClaim>
  readonly cancelCoverageQuery?: (requestId: string) => Promise<boolean>
  readonly syncCoverageTileCatalog?: (
    input: {
      readonly missionId: string
      readonly chunks: readonly {
        readonly key: CoverageChunkKey
        readonly contentRev: number
      }[]
    },
    requestId?: string,
  ) => Promise<CoverageTileCatalog>
  readonly activateCoverageTileCatalog?: (input: {
    readonly activationId: string
  }) => Promise<boolean>
  readonly finalizeCoverageTileCatalog?: (input: {
    readonly activationId: string
  }) => Promise<boolean>
  readonly discardCoverageTileCatalog?: (input: {
    readonly activationId: string
  }) => Promise<boolean>
  readonly readCoverageTile?: (
    input: {
      readonly missionId: string
      readonly periodKey: string
      readonly revisionDigest: string
      readonly z: number
      readonly x: number
      readonly y: number
    },
    requestId?: string,
  ) => Promise<Uint8Array | null>
  readonly cancelCoverageTileRead?: (requestId: string) => Promise<boolean>
  readonly listTrackingHistoryCheckpoints?: (
    missionId: string,
  ) => Promise<readonly TrackingHistoryCheckpoint[]>
  readonly countPositions: (missionId: string, deviceId?: string) => Promise<number>
  readonly latestPositions: (missionId: string) => Promise<readonly Position[]>
  readonly listMissionEvents: (missionId: string) => Promise<readonly MissionEvent[]>
  readonly listAuditEvents: (
    missionId: string,
    options?: ListAuditEventsOptions,
  ) => Promise<readonly MissionEvent[]>
  readonly readMissionReview: (
    query: MissionReviewReadQuery,
    requestId?: string,
  ) => Promise<MissionReviewReadResult>
  readonly cancelMissionReviewRead?: (requestId: string) => Promise<boolean>
  readonly readMissionReplay?: (
    input: MissionReplayReadInput,
    requestId?: string,
  ) => Promise<MissionReplayReadResult>
  readonly readMissionReplayTrackChunk?: (
    input: MissionReplayReadInput,
    requestId?: string,
  ) => Promise<MissionReplayTrackChunkResult>
  readonly readMissionReplayObjectChunk?: (
    input: MissionReplayReadInput,
    requestId?: string,
  ) => Promise<MissionReplayObjectChunkResult>
  readonly cancelMissionReplay?: (requestId: string) => Promise<boolean>
  readonly listIngestAnomalies?: (
    missionId: string,
    options?: ListIngestAnomaliesOptions,
  ) => Promise<readonly IngestAnomaly[]>
  readonly recordIngestRejections?: (input: {
    readonly mission_id: string
    readonly rejections: readonly IngestRejectionEnvelope[]
  }) => Promise<{
    readonly acknowledgedDeliveryIds: readonly string[]
    readonly health: IngestEvidenceHealth
  }>
  readonly recordIngestEvidenceLoss?: (input: {
    readonly mission_id: string
    readonly reason: IngestEvidenceLossReason
  }) => Promise<IngestEvidenceHealth>
  readonly acknowledgeIngestEvidenceLoss: (
    input: AcknowledgeIngestEvidenceLossInput,
  ) => Promise<IngestEvidenceHealth>
  readonly getIngestEvidenceHealth?: (missionId?: string) => Promise<IngestEvidenceHealth>
  readonly upsertMarker: (input: UpsertMarkerInput) => Promise<Marker>
  readonly getMarker: (markerId: string) => Promise<Marker>
  readonly listMarkers: (missionId: string) => Promise<readonly Marker[]>
  readonly deleteMarker: (markerId: string) => Promise<boolean>
  readonly upsertDrawing: (input: UpsertDrawingInput) => Promise<Drawing>
  readonly getDrawing: (drawingId: string) => Promise<Drawing>
  readonly listDrawings: (missionId: string) => Promise<readonly Drawing[]>
  readonly deleteDrawing: (drawingId: string) => Promise<boolean>
  readonly upsertHelicopter: (input: UpsertHelicopterInput) => Promise<Helicopter>
  readonly listHelicopters: (missionId: string) => Promise<readonly Helicopter[]>
  readonly deleteHelicopter: (helicopterId: string) => Promise<boolean>
  readonly upsertGpxImport: (input: UpsertGpxTrackImportInput) => Promise<GpxTrackImport>
  readonly listGpxImports: (missionId: string) => Promise<readonly GpxTrackImport[]>
  readonly listGpxImportPage?: (input: {
    readonly missionId: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<GpxImportPage>
  readonly listGpxImportIssues?: (input: {
    readonly missionId: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<GpxImportIssuePage>
  readonly updateGpxImportPresentation?: (input: {
    readonly id: string
    readonly mission_id: string
    readonly display_name?: string
    readonly metadata_json?: string | null
  }) => Promise<GpxTrackImport>
  readonly deleteGpxImport: (importId: string) => Promise<boolean>
  readonly listGpxImportRevisions?: (importId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listGpxImportRevisionPage?: (input: {
    readonly importId: string
    readonly cursor?: string
    readonly limit?: number
  }) => Promise<{
    readonly entries: readonly Readonly<Record<string, unknown>>[]
    readonly nextCursor: string | null
  }>
  readonly assignGpxImportToOuting?: (input: {
    readonly import_id: string
    readonly outing_id: string
    readonly assigned_by?: string | null
  }) => Promise<GpxTrackImport>
  readonly importGpxEvidencePaths?: (input: {
    readonly missionId: string
    readonly paths: readonly string[]
  }) => Promise<{
    readonly imports: readonly { readonly id: string }[]
    readonly failures: readonly { readonly sourcePath: string; readonly reason: string }[]
    readonly dispatchDurationMs: number
  }>
  readonly upsertSearchArea?: (input: Readonly<Record<string, unknown>>) => Promise<SearchArea>
  readonly listSearchAreas?: (missionId: string) => Promise<readonly SearchArea[]>
  readonly retireSearchArea?: (areaId: string, actor?: string | null) => Promise<boolean>
  readonly upsertSearchAssignment?: (input: Readonly<Record<string, unknown>>) => Promise<SearchAssignment>
  readonly listSearchAssignments?: (missionId: string) => Promise<readonly SearchAssignment[]>
  readonly upsertSearchPass?: (input: Readonly<Record<string, unknown>>) => Promise<SearchPass>
  readonly listSearchPasses?: (missionId: string) => Promise<readonly SearchPass[]>
  readonly getMission: (missionId: string) => Promise<Mission>
  readonly listMissions: () => Promise<readonly Mission[]>
  readonly getActiveMission: () => Promise<Mission | null>
  readonly getRecoverableMission: () => Promise<Mission | null>
  readonly pauseMission: (missionId: string) => Promise<Mission>
  readonly resumeMission: (missionId: string) => Promise<Mission>
  readonly finishMission: (missionId: string) => Promise<Mission>
  readonly finalizeMission: (missionId: string) => Promise<FinalizeMissionResult>
  readonly unlockFinalizedMission: (input: UnlockFinalizedMissionInput) => Promise<Mission>
}

export function createTauriMissionStore(): MissionStore {
  return {
    info: () => invoke<MissionStoreInfo>('mission_store_info'),
    syncBackup: () => invoke<string>('sync_mission_store_backup'),
    createMissionArchive: (missionId) =>
      invoke<MissionArchiveInfo>('create_mission_archive', { missionId }),
    createMission: (input) => invoke<Mission>('create_mission', { input }),
    upsertDevice: (input) => invoke<Device>('upsert_device', { input }),
    getDevice: (missionId, deviceId) => invoke<Device>('get_device', { missionId, deviceId }),
    listDevices: (missionId) => invoke<readonly Device[]>('list_devices', { missionId }),
    addPosition: (input) => invoke<Position>('add_position', { input }),
    listPositions: (missionId, deviceId) =>
      invoke<readonly Position[]>('list_positions', { missionId, deviceId }),
    countPositions: async (missionId, deviceId) =>
      (await invoke<readonly Position[]>('list_positions', { missionId, deviceId })).length,
    latestPositions: (missionId) =>
      invoke<readonly Position[]>('latest_positions', { missionId }),
    listMissionEvents: (missionId) =>
      invoke<readonly MissionEvent[]>('list_mission_events', { missionId }),
    listAuditEvents: (missionId, options) =>
      invoke<readonly MissionEvent[]>('list_audit_events', {
        missionId,
        includeTelemetry: options?.includeTelemetry ?? false,
        limit: options?.limit ?? null,
      }),
    readMissionReview: async (query) => {
      const [auditEvents, positions] = await Promise.all([
        invoke<readonly MissionEvent[]>('list_audit_events', {
          missionId: query.missionId,
          includeTelemetry: query.includeTelemetry,
          limit: query.auditLimit,
        }),
        invoke<readonly Position[]>('list_positions', {
          missionId: query.missionId,
          deviceId: undefined,
        }),
      ])
      return { auditEvents, breadcrumbCount: positions.length }
    },
    cancelMissionReviewRead: async () => false,
    acknowledgeIngestEvidenceLoss: async () => {
      throw new Error(
        'Evidence-loss acknowledgement is available only through the Electron mission store.',
      )
    },
    upsertMarker: (input) => invoke<Marker>('upsert_marker', { input }),
    getMarker: (markerId) => invoke<Marker>('get_marker', { markerId }),
    listMarkers: (missionId) => invoke<readonly Marker[]>('list_markers', { missionId }),
    deleteMarker: (markerId) => invoke<boolean>('delete_marker', { markerId }),
    upsertDrawing: (input) => invoke<Drawing>('upsert_drawing', { input }),
    getDrawing: (drawingId) => invoke<Drawing>('get_drawing', { drawingId }),
    listDrawings: (missionId) => invoke<readonly Drawing[]>('list_drawings', { missionId }),
    deleteDrawing: (drawingId) => invoke<boolean>('delete_drawing', { drawingId }),
    upsertHelicopter: (input) => invoke<Helicopter>('upsert_helicopter', { input }),
    listHelicopters: (missionId) =>
      invoke<readonly Helicopter[]>('list_helicopters', { missionId }),
    deleteHelicopter: (helicopterId) =>
      invoke<boolean>('delete_helicopter', { helicopterId }),
    upsertGpxImport: (input) => invoke<GpxTrackImport>('upsert_gpx_import', { input }),
    listGpxImports: (missionId) =>
      invoke<readonly GpxTrackImport[]>('list_gpx_imports', { missionId }),
    deleteGpxImport: (importId) => invoke<boolean>('delete_gpx_import', { importId }),
    getMission: (missionId) => invoke<Mission>('get_mission', { missionId }),
    listMissions: () => invoke<readonly Mission[]>('list_missions'),
    getActiveMission: () => invoke<Mission | null>('get_active_mission'),
    getRecoverableMission: () => invoke<Mission | null>('get_recoverable_mission'),
    pauseMission: (missionId) => invoke<Mission>('pause_mission', { missionId }),
    resumeMission: (missionId) => invoke<Mission>('resume_mission', { missionId }),
    finishMission: (missionId) => invoke<Mission>('finish_mission', { missionId }),
    finalizeMission: (missionId) =>
      invoke<FinalizeMissionResult>('finalize_mission', { missionId }),
    unlockFinalizedMission: (input) =>
      invoke<Mission>('unlock_finalized_mission', { input }),
  }
}
