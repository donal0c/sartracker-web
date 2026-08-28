import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'

const require = createRequire(import.meta.url)
type StorageOperation = { readonly id: string; readonly type: 'backup'; readonly requestedAtMs: number }
type StorageDiagnosticsPort = {
  readonly createOperation: (type: 'backup') => StorageOperation
  readonly requested: (
    operation: StorageOperation,
    input: { readonly queueDepth: number; readonly trigger?: string },
  ) => Promise<void>
  readonly started: (operation: StorageOperation) => Promise<void>
  readonly phase: (
    operation: StorageOperation,
    stage: 'copied' | 'sanity_check_started' | 'sanity_checked' | 'renamed',
  ) => Promise<void>
  readonly completed: (operation: StorageOperation) => Promise<void>
  readonly failed: (operation: StorageOperation, input: { readonly stage: string; readonly errorName: string }) => Promise<void>
  readonly startMission: (input: { readonly startedAt: string }) => Promise<void>
  readonly recordTrackingBatch: (input: {
    readonly durationMs: number
    readonly deviceCount: number
    readonly changedDeviceEventCount: number
    readonly observedAt: string
  }) => Promise<void>
  readonly recordInsertedPositions: (input: {
    readonly durationMs: number
    readonly insertedPositionCount: number
    readonly positionTelemetryEventCount: number
    readonly skippedAmbiguousLegacyAdoptionCount: number
  }) => Promise<void>
}
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require('../../electron/mission-store.cjs') as {
  readonly CURRENT_SCHEMA_VERSION: number
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly readAdminRoster?: () => Promise<readonly string[]>
    readonly backupFaultInjection?: {
      readonly afterTemporaryBackup?: boolean
      readonly corruptTemporarySnapshotBeforeSanityCheck?: boolean
    }
    readonly archiveFaultInjection?: {
      readonly corruptSnapshotBeforeZip?: boolean
    }
    readonly finalizeMissionFaultInjection?: {
      readonly afterArchiveSucceededEvent?: boolean
    }
    readonly readArchiveFile?: (archivePath: string) => Promise<Buffer>
    readonly ingestEvidenceFaultInjection?: {
      readonly failStage?: boolean
      readonly failProjection?: boolean
      readonly failRemovalAfterProjection?: boolean
    }
    readonly storageDiagnostics?: StorageDiagnosticsPort
    readonly coverageLedgerFaultInjection?: { readonly afterWrite?: boolean }
    readonly runBreadcrumbQueryInWorker?: (input: {
      readonly databasePath: string
      readonly missionId: string
      readonly perDeviceLimit: number
      readonly signal?: AbortSignal
    }) => Promise<{
      readonly positions: readonly never[]
      readonly deviceTotals: readonly never[]
      readonly deviceSelections: readonly never[]
      readonly droppedPositionCount: number
    }>
    readonly runMissionReviewReadQueryInWorker?: (input: {
      readonly databasePath: string
      readonly query: {
        readonly missionId: string
        readonly includeTelemetry: boolean
        readonly auditLimit: number
      }
      readonly signal?: AbortSignal
    }) => Promise<{
      readonly auditEvents: readonly {
        readonly event_type: string
        readonly timestamp: string
      }[]
      readonly breadcrumbCount: number
    }>
    readonly runOutingFixSummaryInWorker?: (input: {
      readonly databasePath: string
      readonly query: { readonly missionId: string }
      readonly signal?: AbortSignal
    }) => Promise<{
      readonly outings: readonly { readonly outing_id: string; readonly accepted_fix_count: number }[]
      readonly unassigned_accepted_fix_count: number
      readonly total_accepted_fix_count: number
    }>
  }) => ElectronMissionStore
}
const Database = require('better-sqlite3')

type ElectronMissionStore = {
  readonly close: () => void
  readonly info: () => Promise<{
    readonly schema_version: number
    readonly synchronous_mode: number
    readonly database_path: string
    readonly backup_path: string
  }>
  readonly syncBackup: (trigger?: string) => Promise<string>
  readonly createMission: (input: { readonly name: string; readonly start_time?: string }) => Promise<{ readonly id: string; readonly status: string }>
  readonly getMission: (missionId: string) => Promise<{
    readonly id: string
    readonly status: string
    readonly pause_time: string | null
    readonly paused_seconds: number
  }>
  readonly getActiveMission: () => Promise<{ readonly id: string; readonly status: string } | null>
  readonly listMissions: () => Promise<readonly { readonly id: string; readonly status: string }[]>
  readonly listMissionIdsAwaitingEvidenceClosure: () => Promise<readonly string[]>
  readonly listRendererEvidenceScopesAwaitingClosure: () => Promise<readonly {
    readonly mission_id: string
    readonly scope_reason: string
  }[]>
  readonly pauseMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly resumeMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly finishMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly createOuting: (input: {
    readonly mission_id: string
    readonly label: string
  }) => Promise<{ readonly id: string; readonly label: string }>
  readonly renameOuting: (input: {
    readonly mission_id: string
    readonly outing_id: string
    readonly label: string
  }) => Promise<{ readonly id: string; readonly label: string }>
  readonly listOutings: (missionId: string) => Promise<readonly {
    readonly id: string
    readonly label: string
  }[]>
  readonly listMissionEvents: (missionId: string) => Promise<readonly {
    readonly event_type: string
    readonly timestamp: string
    readonly details_json: string | null
  }[]>
  readonly listAuditEvents: (
    missionId: string,
    options?: { readonly includeTelemetry?: boolean; readonly limit?: number },
  ) => Promise<readonly { readonly event_type: string; readonly timestamp: string }[]>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: string
    readonly last_seen?: string | null
  }) => Promise<{ readonly device_id: string; readonly last_seen: string | null }>
  readonly upsertDevicesBulk: (input: {
    readonly mission_id: string
    readonly devices: readonly {
      readonly device_id: string
      readonly name: string
      readonly color: string
      readonly status: string
      readonly last_seen?: string | null
    }[]
  }) => Promise<readonly { readonly device_id: string }[]>
  readonly addPosition: (input: {
    readonly source_position_id?: string
    readonly mission_id: string
    readonly device_id: string
    readonly lat: number
    readonly lon: number
    readonly timestamp?: string
    readonly timestamp_source?: 'fix'
  }) => Promise<{
    readonly id: string
    readonly source_position_id: string | null
    readonly device_id: string
    readonly timestamp_source: 'fix' | null
  }>
  readonly addPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly {
      readonly source_position_id?: string
      readonly device_id: string
      readonly lat: number
      readonly lon: number
      readonly altitude?: number | null
      readonly speed?: number | null
      readonly battery?: number | null
      readonly accuracy?: number | null
      readonly source?: string | null
      readonly timestamp?: string | null
      readonly timestamp_source?: 'fix'
      readonly data_origin?: 'live' | 'cache'
    }[]
  }) => Promise<readonly {
    readonly id: string
    readonly source_position_id: string | null
    readonly device_id: string
    readonly timestamp: string
  }[]>
  readonly persistTrackingPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly {
      readonly source_position_id?: string
      readonly device_id: string
      readonly lat: number
      readonly lon: number
      readonly timestamp?: string | null
      readonly timestamp_source?: 'fix'
    }[]
    readonly checkpoints: readonly {
      readonly device_id: string
      readonly history_from: string
      readonly reconciled_until: string
    }[]
  }) => Promise<{
    readonly changedPositionCount: number
    readonly insertedPositionCount: number
    readonly skippedAmbiguousLegacyAdoptionCount: number
  }>
  readonly persistTrackingHistoryBatch: (input: {
    readonly mission_id: string
    readonly positions: readonly {
      readonly source_position_id?: string
      readonly device_id: string
      readonly lat: number
      readonly lon: number
      readonly timestamp: string
      readonly timestamp_source?: 'fix'
    }[]
    readonly checkpoints: readonly {
      readonly device_id: string
      readonly history_from: string
      readonly reconciled_until: string
    }[]
  }) => Promise<unknown>
  readonly listTrackingHistoryCheckpoints: (missionId: string) => Promise<readonly {
    readonly mission_id: string
    readonly device_id: string
    readonly history_from: string
    readonly reconciled_until: string
  }[]>
  readonly listPositions: (
    missionId: string,
    deviceId?: string,
  ) => Promise<readonly {
    readonly id: string
    readonly source_position_id: string | null
    readonly device_id: string
    readonly timestamp: string
    readonly data_origin: string
    readonly timestamp_source: 'fix' | null
  }[]>
  readonly listRecentPositions: (
    missionId: string,
    perDeviceLimit: number,
  ) => Promise<readonly { readonly device_id: string; readonly timestamp: string }[]>
  readonly listBreadcrumbPositions: (
    missionId: string,
    perDeviceLimit: number,
    requestId?: string,
  ) => Promise<{
    readonly positions: readonly {
      readonly id: string
      readonly source_position_id: string | null
      readonly device_id: string
      readonly lat: number
      readonly lon: number
      readonly timestamp: string
      readonly data_origin: 'live' | 'cache'
    }[]
    readonly deviceTotals: readonly {
      readonly device_id: string
      readonly total: number
    }[]
    readonly droppedPositionCount: number
  }>
  readonly cancelBreadcrumbQuery: (requestId: string) => Promise<boolean>
  readonly readMissionReview: (
    query: {
      readonly missionId: string
      readonly includeTelemetry: boolean
      readonly auditLimit: number
    },
    requestId?: string,
  ) => Promise<{
    readonly auditEvents: readonly {
      readonly event_type: string
      readonly timestamp: string
    }[]
    readonly breadcrumbCount: number
  }>
  readonly cancelMissionReviewRead: (requestId: string) => Promise<boolean>
  readonly readOutingFixSummary: (
    query: { readonly missionId: string },
    requestId?: string,
  ) => Promise<{
    readonly outings: readonly { readonly outing_id: string; readonly accepted_fix_count: number }[]
    readonly unassigned_accepted_fix_count: number
    readonly total_accepted_fix_count: number
  }>
  readonly countPositions: (missionId: string, deviceId?: string) => Promise<number>
  readonly latestPositions: (missionId: string) => Promise<readonly { readonly device_id: string; readonly lat: number }[]>
  readonly listIngestAnomalies: (missionId: string, options?: {
    readonly limit?: number
    readonly offset?: number
  }) => Promise<readonly {
    readonly kind: 'rejected' | 'conflict'
    readonly device_id: string | null
    readonly source_position_id: string | null
    readonly reason_class: string
    readonly canonical_payload_json: string
  }[]>
  readonly recordIngestRejections: (input: {
    readonly mission_id: string
    readonly rejections: readonly RejectionEnvelope[]
  }) => Promise<{
    readonly acknowledgedDeliveryIds: readonly string[]
    readonly health: { readonly state: 'healthy' | 'degraded' | 'critical'; readonly pendingCount: number }
  }>
  readonly recordIngestEvidenceLoss: (input: {
    readonly mission_id: string
    readonly reason:
      | 'mission_persistence_failed'
      | 'renderer_pending_capacity_exhausted'
      | 'renderer_pending_evidence_lost'
  }) => Promise<{
    readonly state: 'healthy' | 'degraded' | 'critical'
    readonly reason: string | null
    readonly pendingCount: number
  }>
  readonly stageRendererEvidenceUncertainty: (input: {
    readonly mission_id: string
    readonly incident_id: string
    readonly scope_reason: string
  }) => Promise<{
    readonly state: 'healthy' | 'degraded' | 'critical'
    readonly reason: string | null
  }>
  readonly resolveRendererEvidenceUncertainty: (input: {
    readonly mission_id: string
    readonly incident_id: string
    readonly outcome: 'drained' | 'lost'
  }) => Promise<{
    readonly state: 'healthy' | 'degraded' | 'critical'
    readonly reason: string | null
  }>
  readonly stageRendererEvidenceIncident: (input: {
    readonly incident_id: string
    readonly scopes: readonly {
      readonly mission_id: string
      readonly scope_reason: string
    }[]
  }) => Promise<{ readonly staged_scope_count: number }>
  readonly resolveRendererEvidenceIncidents: (input: {
    readonly incident_id?: string
    readonly outcome: 'drained' | 'lost'
  }) => Promise<{
    readonly resolved_scopes: readonly {
      readonly mission_id: string
      readonly scope_reason: string
    }[]
  }>
  readonly getIngestEvidenceHealth: (missionId?: string) => Promise<{
    readonly state: 'healthy' | 'degraded' | 'critical'
    readonly reason: string | null
    readonly pendingCount: number
    readonly corruptCount: number
    readonly acknowledgedLoss?: {
      readonly adminName: string
      readonly reason: string
      readonly acknowledgedAt: string
    }
  }>
  readonly acknowledgeIngestEvidenceLoss: (input: {
    readonly mission_id: string
    readonly admin_name: string
    readonly reason: string
  }) => Promise<{
    readonly state: 'healthy' | 'degraded' | 'critical'
    readonly reason: string | null
    readonly acknowledgedLoss?: {
      readonly adminName: string
      readonly reason: string
      readonly acknowledgedAt: string
    }
  }>
  readonly upsertMarker: (input: {
    readonly id?: string
    readonly mission_id: string
    readonly type: string
    readonly name: string
    readonly lat: number
    readonly lon: number
    readonly irish_grid_e: number
    readonly irish_grid_n: number
    readonly display_order: number
    readonly label_size?: number
  }) => Promise<{ readonly id: string }>
  readonly deleteMarker: (markerId: string) => Promise<boolean>
  readonly listMarkers: (missionId: string) => Promise<readonly { readonly id: string; readonly label_size?: number | null }[]>
  readonly getDrawing: (drawingId: string) => Promise<{
    readonly id: string
    readonly mission_id: string
    readonly name: string
    readonly created_at: string
    readonly updated_at: string
  }>
  readonly listDrawings: (missionId: string) => Promise<readonly { readonly id: string }[]>
  readonly listHelicopters: (missionId: string) => Promise<readonly { readonly id: string }[]>
  readonly listGpxImports: (missionId: string) => Promise<readonly {
    readonly id: string
    readonly mission_id: string
    readonly display_name: string
    readonly imported_at: string
    readonly updated_at: string
  }[]>
  readonly upsertDrawing: (input: {
    readonly id?: string
    readonly mission_id: string
    readonly type: string
    readonly name: string
    readonly display_order: number
    readonly geometry_json: string
  }) => Promise<{ readonly id: string }>
  readonly deleteDrawing: (drawingId: string) => Promise<boolean>
  readonly upsertHelicopter: (input: {
    readonly mission_id: string
    readonly slot_key: string
    readonly call_sign: string
    readonly lat: number
    readonly lon: number
  }) => Promise<{ readonly id: string }>
  readonly deleteHelicopter: (helicopterId: string) => Promise<boolean>
  readonly upsertGpxImport: (input: {
    readonly id?: string
    readonly mission_id: string
    readonly source_path: string
    readonly file_name: string
    readonly display_name: string
    readonly geometry_json: string
  }) => Promise<{ readonly id: string }>
  readonly deleteGpxImport: (importId: string) => Promise<boolean>
  readonly finalizeMission: (
    missionId: string,
  ) => Promise<{ readonly mission: { readonly status: string }; readonly archive: { readonly archive_path: string; readonly created_at: string } }>
  readonly unlockFinalizedMission: (input: {
    readonly mission_id: string
    readonly admin_name: string
    readonly reason: string
  }) => Promise<{ readonly status: string }>
  readonly createMissionArchive: (
    missionId: string,
  ) => Promise<{ readonly mission_id: string; readonly archive_path: string; readonly created_at: string }>
  readonly getMarker: (markerId: string) => Promise<{
    readonly id: string
    readonly mission_id: string
    readonly name: string
    readonly created_at: string
    readonly updated_at: string
  }>
  readonly listLayerCatalogMetadata: (
    missionId: string,
  ) => Promise<readonly { readonly missionId: string; readonly nodeId: string; readonly isVisible: boolean }[]>
  readonly upsertLayerCatalogMetadata: (input: {
    readonly missionId: string
    readonly nodeId: string
    readonly parentNodeId: string | null
    readonly nodeKind: 'group' | 'layer' | 'feature_item'
    readonly isVisible?: boolean
  }) => Promise<{ readonly missionId: string; readonly nodeId: string; readonly isVisible: boolean }>
  readonly clearLayerCatalogMetadata: (missionId: string) => Promise<void>
}

type RejectionEnvelope = {
  readonly deliveryId: string
  readonly anomalyKey: string
  readonly deviceId: string | null
  readonly sourcePositionId: string | null
  readonly reasonClass: string
  readonly receivedAt: string
  readonly canonicalEvidence: Readonly<Record<string, unknown>>
}

describe('electron mission store', () => {
  let userDataPath: string | null = null
  let store: ElectronMissionStore | null = null

  afterEach(async () => {
    vi.useRealTimers()
    store?.close()
    store = null
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('creates WAL-backed mission storage under userData and survives store restart', async () => {
    store = await createStore()

    const mission = await store.createMission({
      name: 'Electron Mission',
      start_time: '2026-05-19T12:00:00.000Z',
    })
    await store.pauseMission(mission.id)
    store.close()

    store = createElectronMissionStore({ userDataPath: userDataPath! })
    const info = await store.info()
    const activeMission = await store.getActiveMission()

    expect(info).toMatchObject({
      schema_version: CURRENT_SCHEMA_VERSION,
      database_path: path.join(userDataPath!, 'mission-store.sqlite'),
      backup_path: path.join(userDataPath!, 'mission-store.backup.sqlite'),
    })
    expect(activeMission).toMatchObject({ id: mission.id, status: 'paused' })
    await expect(store.listMissions()).resolves.toHaveLength(1)
  })

  it('uses FULL synchronous mode for the WAL database so committed mission writes are durable [DON-232]', async () => {
    store = await createStore()

    const info = await store.info()
    const db = new Database(info.database_path, { readonly: true })
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(info.synchronous_mode).toBe(2)
    } finally {
      db.close()
    }
  })

  it('round-trips authoritative fixTime provenance through SQLite and restart [DON-267] [SAR-QA-021]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Fix provenance mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-fix',
      name: 'Tracker Fix',
      color: '#00AAFF',
      status: 'online',
    })
    await expect(store.addPosition({
      mission_id: mission.id,
      source_position_id: 'fix-1',
      device_id: 'tracker-fix',
      lat: 52,
      lon: -9,
      timestamp: '2026-08-22T15:10:17.000Z',
      timestamp_source: 'fix',
    })).resolves.toMatchObject({ timestamp_source: 'fix' })

    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.listPositions(mission.id)).resolves.toEqual([
      expect.objectContaining({
        source_position_id: 'fix-1',
        timestamp: '2026-08-22T15:10:17.000Z',
        timestamp_source: 'fix',
      }),
    ])

    const info = await store.info()
    const db = new Database(info.database_path, { readonly: true })
    try {
      expect(db.prepare(
        'SELECT timestamp_source FROM positions WHERE source_position_id = ?',
      ).get('fix-1')).toEqual({ timestamp_source: 'fix' })
    } finally {
      db.close()
    }
  })

  it('lists active, paused, and finished missions that still need renderer evidence closure', async () => {
    store = await createStore()
    const finished = await store.createMission({ name: 'Finished Evidence Scope' })
    await store.finishMission(finished.id)
    const active = await store.createMission({ name: 'Active Evidence Scope' })

    await expect(store.listMissionIdsAwaitingEvidenceClosure()).resolves.toEqual([
      active.id,
      finished.id,
    ])

    await store.finishMission(active.id)
    await store.finalizeMission(finished.id)
    await expect(store.listMissionIdsAwaitingEvidenceClosure()).resolves.toEqual([
      active.id,
    ])
  })

  it('names why each mission can own renderer evidence during teardown [DON-276]', async () => {
    store = await createStore()
    const finished = await store.createMission({ name: 'Finished Renderer Scope' })
    await store.finishMission(finished.id)
    const active = await store.createMission({ name: 'Active Renderer Scope' })

    await expect(store.listRendererEvidenceScopesAwaitingClosure()).resolves.toEqual([
      { mission_id: active.id, scope_reason: 'active_mission' },
      { mission_id: finished.id, scope_reason: 'finished_unfinalized_mission' },
    ])

    await store.pauseMission(active.id)
    await expect(store.listRendererEvidenceScopesAwaitingClosure()).resolves.toEqual([
      { mission_id: active.id, scope_reason: 'paused_recoverable_mission' },
      { mission_id: finished.id, scope_reason: 'finished_unfinalized_mission' },
    ])
  })

  it('stages and cleanly resolves one exact multi-mission renderer incident [DON-276]', async () => {
    store = await createStore()
    const finished = await store.createMission({ name: 'Finished Incident Scope' })
    await store.finishMission(finished.id)
    const active = await store.createMission({ name: 'Active Incident Scope' })

    await expect(store.stageRendererEvidenceIncident({
      incident_id: 'incident-multi-mission',
      scopes: [
        { mission_id: active.id, scope_reason: 'active_mission' },
        { mission_id: finished.id, scope_reason: 'finished_unfinalized_mission' },
      ],
    })).resolves.toEqual({ staged_scope_count: 2 })
    await expect(store.getIngestEvidenceHealth(active.id)).resolves.toMatchObject({
      state: 'degraded', reason: 'renderer_evidence_pending',
    })
    await expect(store.getIngestEvidenceHealth(finished.id)).resolves.toMatchObject({
      state: 'degraded', reason: 'renderer_evidence_pending',
    })

    await expect(store.resolveRendererEvidenceIncidents({
      incident_id: 'incident-multi-mission',
      outcome: 'drained',
    })).resolves.toEqual({
      resolved_scopes: expect.arrayContaining([
        { mission_id: active.id, scope_reason: 'active_mission' },
        { mission_id: finished.id, scope_reason: 'finished_unfinalized_mission' },
      ]),
    })
    await expect(store.getIngestEvidenceHealth(active.id)).resolves.toMatchObject({
      state: 'healthy', reason: null,
    })
    await expect(store.getIngestEvidenceHealth(finished.id)).resolves.toMatchObject({
      state: 'healthy', reason: null,
    })
  })

  it('revalidates renderer incident scopes after a queued finalization completes [DON-276]', async () => {
    let releaseBackupStart: (() => void) | undefined
    const backupStarted = new Promise<void>((resolve) => {
      releaseBackupStart = resolve
    })
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(() => ({
        id: 'finalization-backup',
        type: 'backup',
        requestedAtMs: Date.now(),
      })),
      requested: vi.fn(),
      started: vi.fn(() => backupStarted),
      phase: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
      startMission: vi.fn(),
      recordTrackingBatch: vi.fn(),
      recordInsertedPositions: vi.fn(),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({ name: 'Finalization Stage Race' })
    await store.finishMission(mission.id)

    const finalization = store.finalizeMission(mission.id)
    await vi.waitFor(() => expect(storageDiagnostics.started).toHaveBeenCalledOnce())
    const stage = store.stageRendererEvidenceIncident({
      incident_id: 'incident-after-finalization',
      scopes: [{
        mission_id: mission.id,
        scope_reason: 'finished_unfinalized_mission',
      }],
    })

    releaseBackupStart?.()
    await expect(finalization).resolves.toMatchObject({ mission: { status: 'finalized' } })
    await expect(stage).rejects.toThrow(/scope reason does not match mission state/iu)
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'healthy', reason: null,
    })

    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'healthy', reason: null,
    })
  })

  it('rejects an explicitly blank renderer incident identity instead of sweeping all [DON-276]', async () => {
    store = await createStore()

    await expect(store.resolveRendererEvidenceIncidents({
      incident_id: '   ',
      outcome: 'drained',
    })).rejects.toThrow(/incident identity/iu)
  })

  it('refuses to open a database from a newer schema instead of downgrading metadata [DON-232]', async () => {
    store = await createStore()
    const info = await store.info()
    store.close()
    store = null

    const db = new Database(info.database_path)
    try {
      db.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'")
        .run(String(CURRENT_SCHEMA_VERSION + 1))
    } finally {
      db.close()
    }

    expect(() => createElectronMissionStore({ userDataPath: userDataPath! })).toThrow(
      /newer mission store schema/i,
    )
  })

  it('migrates a schema-6 store to the durable tracking-history checkpoint schema', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(12)
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-checkpoint-migration-'))
    const databasePath = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = new Database(databasePath)
    try {
      legacyDb.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata (key, value) VALUES ('schema_version', '6');
      `)
    } finally {
      legacyDb.close()
    }

    store = createElectronMissionStore({ userDataPath })
    await expect(store.info()).resolves.toMatchObject({ schema_version: 12 })

    const migratedDb = new Database(databasePath, { readonly: true })
    try {
      expect(
        migratedDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracking_history_checkpoints'",
          )
          .get(),
      ).toEqual({ name: 'tracking_history_checkpoints' })
      expect(
        migratedDb
          .prepare("SELECT value FROM metadata WHERE key = 'schema_version'")
          .get(),
      ).toEqual({ value: '12' })
    } finally {
      migratedDb.close()
    }
  })

  it('migrates schema 7 to v8 without inventing provenance for legacy fixes [DON-268]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-v8-migration-'))
    const databasePath = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = new Database(databasePath)
    try {
      legacyDb.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata (key, value) VALUES ('schema_version', '7');
        CREATE TABLE positions (
          id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          source_position_id TEXT,
          name TEXT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          altitude REAL,
          speed REAL,
          battery REAL,
          accuracy REAL,
          source TEXT,
          timestamp TEXT NOT NULL,
          data_origin TEXT NOT NULL DEFAULT 'live'
        );
        INSERT INTO positions (
          id, mission_id, device_id, source_position_id, lat, lon, timestamp, data_origin
        ) VALUES (
          'legacy-row', 'legacy-mission', 'tracker-1', 'source-1',
          52.0599, -9.5045, '2026-08-22T10:00:00.000Z', 'live'
        );
      `)
    } finally {
      legacyDb.close()
    }

    store = createElectronMissionStore({ userDataPath })
    await expect(store.info()).resolves.toMatchObject({ schema_version: 12 })

    const migratedDb = new Database(databasePath, { readonly: true })
    try {
      expect(
        migratedDb.prepare(
          'SELECT received_at, content_hash, source_kind FROM positions WHERE id = ?',
        ).get('legacy-row'),
      ).toEqual({ received_at: null, content_hash: null, source_kind: null })
      expect(
        migratedDb.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ingest_anomalies'",
        ).get(),
      ).toEqual({ name: 'ingest_anomalies' })
    } finally {
      migratedDb.close()
    }
  })

  it('migrates v9 to empty additive coverage tables without rewriting positions [DON-276]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-v10-coverage-migration-'))
    const databasePath = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = new Database(databasePath)
    try {
      legacyDb.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata (key, value) VALUES ('schema_version', '9');
        CREATE TABLE positions (
          id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          source_position_id TEXT,
          name TEXT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          altitude REAL,
          speed REAL,
          battery REAL,
          accuracy REAL,
          source TEXT,
          timestamp TEXT NOT NULL,
          data_origin TEXT NOT NULL DEFAULT 'live',
          received_at TEXT,
          content_hash TEXT,
          source_kind TEXT
        );
        CREATE INDEX idx_positions_mission_device_timestamp
          ON positions(mission_id, device_id, timestamp);
        INSERT INTO positions (
          id, mission_id, device_id, source_position_id, lat, lon, timestamp
        ) VALUES (
          'preserved-position', 'mission-1', 'device-1', 'source-1',
          52.0599, -9.5045, '2026-08-24T10:00:00.000Z'
        );
      `)
    } finally {
      legacyDb.close()
    }

    store = createElectronMissionStore({ userDataPath })
    await expect(store.info()).resolves.toMatchObject({ schema_version: 12 })

    const migratedDb = new Database(databasePath, { readonly: true })
    try {
      expect(
        migratedDb.prepare(`SELECT name FROM sqlite_master
          WHERE type = 'table' AND name LIKE 'coverage_%' ORDER BY name`).all(),
      ).toEqual([
        { name: 'coverage_chunks' },
        { name: 'coverage_invalidations' },
        { name: 'coverage_missions' },
      ])
      expect(migratedDb.prepare('SELECT COUNT(*) AS count FROM coverage_chunks').get()).toEqual({ count: 0 })
      expect(migratedDb.prepare('SELECT COUNT(*) AS count FROM coverage_invalidations').get()).toEqual({ count: 0 })
      expect(migratedDb.prepare('SELECT COUNT(*) AS count FROM coverage_missions').get()).toEqual({ count: 0 })
      expect(migratedDb.prepare('SELECT id, source_position_id FROM positions').all()).toEqual([
        { id: 'preserved-position', source_position_id: 'source-1' },
      ])
    } finally {
      migratedDb.close()
    }
  })

  it('updates coverage revisions only for newly accepted position truth [DON-276]', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Coverage revision mission',
      start_time: '2026-08-24T08:00:00.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'device-1',
      name: 'Device 1',
      color: '#fff',
      status: 'online',
    })
    const position = {
      source_position_id: 'source-1',
      device_id: 'device-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-08-24T10:00:00.000Z',
    }

    await store.addPositionsBulk({ mission_id: mission.id, positions: [position] })
    await store.addPositionsBulk({ mission_id: mission.id, positions: [position] })

    const database = new Database((await store.info()).database_path, { readonly: true })
    try {
      expect(database.prepare(`SELECT device_id, period_kind, period_id,
        content_rev, built_rev FROM coverage_chunks`).all()).toEqual([{
        device_id: 'device-1', period_kind: 'unassigned', period_id: '',
        content_rev: 1, built_rev: null,
      }])
      expect(database.prepare('SELECT change_seq FROM coverage_missions WHERE mission_id = ?').get(mission.id))
        .toEqual({ change_seq: 1 })
    } finally {
      database.close()
    }
  })

  it('rolls an accepted position back when coverage bookkeeping fails [DON-276]', async () => {
    store = await createStore({ coverageLedgerFaultInjection: { afterWrite: true } })
    const mission = await store.createMission({ name: 'Coverage rollback mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'device-1',
      name: 'Device 1',
      color: '#fff',
      status: 'online',
    })

    await expect(store.addPosition({
      mission_id: mission.id,
      device_id: 'device-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-08-24T10:00:00.000Z',
    })).rejects.toThrow(/Injected coverage ledger failure/)

    await expect(store.listPositions(mission.id)).resolves.toEqual([])
    const database = new Database((await store.info()).database_path, { readonly: true })
    try {
      expect(database.prepare('SELECT * FROM coverage_chunks').all()).toEqual([])
      expect(database.prepare('SELECT * FROM coverage_missions').all()).toEqual([])
    } finally {
      database.close()
    }
  })

  it('grandfathers every v8 mission device including finalized missions without rewriting evidence [DON-271]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-v9-participant-migration-'))
    const databasePath = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = new Database(databasePath)
    try {
      legacyDb.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata (key, value) VALUES ('schema_version', '8');
        CREATE TABLE missions (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL,
          start_time TEXT NOT NULL, pause_time TEXT, finish_time TEXT,
          paused_seconds INTEGER NOT NULL DEFAULT 0, notes TEXT,
          schema_version INTEGER NOT NULL
        );
        INSERT INTO missions VALUES (
          'finalized-mission', 'Legacy Finalized', 'finalized',
          '2026-08-01T06:00:00.000Z', NULL, '2026-08-01T18:00:00.000Z',
          0, NULL, 8
        );
        CREATE TABLE devices (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, device_id TEXT NOT NULL,
          name TEXT NOT NULL, color TEXT NOT NULL, last_seen TEXT, status TEXT NOT NULL,
          UNIQUE (mission_id, device_id)
        );
        INSERT INTO devices VALUES
          ('device-row-1', 'finalized-mission', '11', 'Alpha', '#fff', NULL, 'offline'),
          ('device-row-2', 'finalized-mission', '12', 'Bravo', '#fff', NULL, 'offline');
      `)
    } finally {
      legacyDb.close()
    }

    store = createElectronMissionStore({ userDataPath })
    const migratedDb = new Database(databasePath, { readonly: true })
    try {
      expect(migratedDb.prepare(`SELECT traccar_device_id, provenance, effective_from,
          added_by, removed_at FROM mission_participants ORDER BY traccar_device_id`).all())
        .toEqual([
          {
            traccar_device_id: '11', provenance: 'grandfathered',
            effective_from: '2026-08-01T06:00:00.000Z', added_by: null, removed_at: null,
          },
          {
            traccar_device_id: '12', provenance: 'grandfathered',
            effective_from: '2026-08-01T06:00:00.000Z', added_by: null, removed_at: null,
          },
        ])
      expect(migratedDb.prepare('SELECT COUNT(*) AS count FROM outings').get()).toEqual({ count: 0 })
      expect(migratedDb.prepare('SELECT COUNT(*) AS count FROM devices').get()).toEqual({ count: 2 })
      expect(migratedDb.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get())
        .toEqual({ value: '12' })
      expect(migratedDb.prepare(`SELECT name FROM sqlite_master
          WHERE type = 'index' AND name IN (
            'idx_mission_participants_active_device',
            'idx_mission_participants_active_group',
            'idx_positions_mission_timestamp'
          ) ORDER BY name`).all()).toEqual([
        { name: 'idx_mission_participants_active_device' },
        { name: 'idx_mission_participants_active_group' },
      ])
      const fixSummaryPlan = migratedDb.prepare(`EXPLAIN QUERY PLAN
        SELECT outing.id AS outing_id, COUNT(position.id) AS accepted_fix_count
        FROM outings AS outing
        LEFT JOIN positions AS position
          ON position.mission_id = outing.mission_id
         AND position.timestamp >= outing.started_at
         AND (outing.ended_at IS NULL OR position.timestamp < outing.ended_at)
        WHERE outing.mission_id = ?
        GROUP BY outing.id, outing.started_at`).all('finalized-mission') as {
          readonly detail: string
        }[]
      expect(fixSummaryPlan.some((step) =>
        step.detail.includes('idx_positions_mission_timestamp'))).toBe(false)
    } finally {
      migratedDb.close()
    }

    store.close()
    store = createElectronMissionStore({ userDataPath })
    const reopenedDb = new Database(databasePath, { readonly: true })
    try {
      expect(reopenedDb.prepare('SELECT COUNT(*) AS count FROM mission_participants').get())
        .toEqual({ count: 2 })
    } finally {
      reopenedDb.close()
    }
  })

  it('migrates existing position rows without inventing upstream source identities [DON-260]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-migration-'))
    const databasePath = path.join(userDataPath, 'mission-store.sqlite')
    const legacyDb = new Database(databasePath)
    try {
      legacyDb.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata (key, value) VALUES ('schema_version', '4');
        CREATE TABLE positions (
          id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          name TEXT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          altitude REAL,
          speed REAL,
          battery REAL,
          accuracy REAL,
          source TEXT,
          timestamp TEXT NOT NULL,
          data_origin TEXT NOT NULL DEFAULT 'live'
        );
        INSERT INTO positions (
          id, mission_id, device_id, lat, lon, timestamp, data_origin
        ) VALUES (
          'local-legacy-row', 'legacy-mission', 'tracker-1',
          52.0599, -9.5045, '2026-07-27T10:00:00.000Z', 'live'
        );
      `)
    } finally {
      legacyDb.close()
    }

    store = createElectronMissionStore({ userDataPath })
    await expect(store.info()).resolves.toMatchObject({
      schema_version: CURRENT_SCHEMA_VERSION,
    })

    const migratedDb = new Database(databasePath, { readonly: true })
    try {
      expect(
        migratedDb
          .prepare(
            'SELECT id, source_position_id FROM positions WHERE id = ?',
          )
          .get('local-legacy-row'),
      ).toEqual({
        id: 'local-legacy-row',
        source_position_id: null,
      })
      expect(
        migratedDb
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_positions_mission_source_position_id'",
          )
          .get(),
      ).toEqual({ name: 'idx_positions_mission_source_position_id' })
    } finally {
      migratedDb.close()
    }
  })

  it('records tracking devices, positions, backup events, and mission lifecycle events', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Tracking Mission' })

    await expect(
      store.upsertDevice({
        mission_id: mission.id,
        device_id: 'tracker-1',
        name: 'Tracker One',
        color: '#00AAFF',
        status: 'unknown',
      }),
    ).resolves.toMatchObject({ device_id: 'tracker-1' })
    await expect(
      store.addPosition({
        mission_id: mission.id,
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: '2026-05-19T12:01:00.000Z',
      }),
    ).resolves.toMatchObject({ device_id: 'tracker-1' })

    await expect(store.latestPositions(mission.id)).resolves.toMatchObject([
      { device_id: 'tracker-1', lat: 52.0599 },
    ])
    await expect(store.syncBackup()).resolves.toBe(
      path.join(userDataPath!, 'mission-store.backup.sqlite'),
    )
    await store.pauseMission(mission.id)
    await expect(store.resumeMission(mission.id)).resolves.toMatchObject({
      status: 'active',
    })
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })

    const events = await store.listMissionEvents(mission.id)
    expect(events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        'mission_created',
        // First contact for this device emits device_created (DON-164).
        'device_created',
        'mission_backup_synced',
        'mission_paused',
        'mission_resumed',
        'mission_finished',
      ]),
    )
    expect(events.map((event) => event.event_type)).not.toContain('position_recorded')
  })

  it('loads only a bounded recent breadcrumb window per device on restart [DON-246]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Bounded Restart Mission' })
    for (const deviceId of ['tracker-1', 'tracker-2']) {
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: deviceId,
        name: deviceId,
        color: '#00AAFF',
        status: 'online',
      })
      for (let minute = 0; minute < 4; minute += 1) {
        await store.addPosition({
          mission_id: mission.id,
          device_id: deviceId,
          lat: 52 + minute * 0.001,
          lon: -9 - minute * 0.001,
          timestamp: `2026-05-19T12:0${minute}:00.000Z`,
        })
      }
    }

    const recent = await store.listRecentPositions(mission.id, 2)

    expect(recent).toHaveLength(4)
    expect(recent.map((position) => `${position.device_id}:${position.timestamp}`)).toEqual([
      'tracker-1:2026-05-19T12:02:00.000Z',
      'tracker-2:2026-05-19T12:02:00.000Z',
      'tracker-1:2026-05-19T12:03:00.000Z',
      'tracker-2:2026-05-19T12:03:00.000Z',
    ])
    await expect(store.listRecentPositions(mission.id, 0)).rejects.toThrow(/positive integer/i)
  })

  it('selects the same whole-route breadcrumb identities after restart [DON-260]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Deterministic Restart Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })
    const baseMs = Date.UTC(2026, 6, 28, 0, 0, 0)
    const inputs = Array.from({ length: 12_000 }, (_, index) => ({
      source_position_id: String(index + 1),
      device_id: 'tracker-1',
      lat: 52 + index / 1_000_000,
      lon: -9.7 - index / 1_000_000,
      timestamp: new Date(baseMs + index * 1_000).toISOString(),
      timestamp_source: 'fix' as const,
      data_origin: 'live' as const,
    }))
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: inputs,
    })

    const restarted = await store.listBreadcrumbPositions(mission.id, 5_000)
    const live = createBreadcrumbAccumulator().append(
      inputs.map((position) => ({
        id: position.source_position_id,
        device_id: position.device_id,
        lat: position.lat,
        lon: position.lon,
        altitude: null,
        speed: null,
        battery: null,
        accuracy: null,
        source: null,
        timestamp: position.timestamp,
        data_origin: position.data_origin,
        cache_age_seconds: null,
        device_cache_stale: false,
      })),
    )

    expect(restarted.positions.map((position) => position.source_position_id)).toEqual(
      live.positions.map((position) => position.id),
    )
    expect(restarted.deviceTotals).toEqual([
      { device_id: 'tracker-1', total: 12_000 },
    ])
    expect(restarted.droppedPositionCount).toBe(0)
  })

  it('cancels the main-process breadcrumb worker identified by the renderer request', async () => {
    let workerSignal: AbortSignal | undefined
    let rejectTerminatedWorker: (error: Error) => void = () => undefined
    const runBreadcrumbQueryInWorker = vi.fn().mockImplementationOnce(
      (input: { readonly signal?: AbortSignal }) => {
        workerSignal = input.signal
        return new Promise((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => {
            rejectTerminatedWorker = reject
          }, { once: true })
        })
      },
    ).mockResolvedValueOnce({
      positions: [],
      deviceTotals: [],
      deviceSelections: [],
      droppedPositionCount: 0,
    })
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-store-'))
    store = createElectronMissionStore({
      userDataPath,
      runBreadcrumbQueryInWorker,
    })

    const query = store.listBreadcrumbPositions(
      'mission-a',
      5_000,
      'renderer-a:request-a',
    )
    await vi.waitFor(() => expect(runBreadcrumbQueryInWorker).toHaveBeenCalledOnce())

    let cancellationSettled = false
    const cancellation = store.cancelBreadcrumbQuery('renderer-a:request-a').then(
      (result) => {
        cancellationSettled = true
        return result
      },
    )
    const replacementQuery = store.listBreadcrumbPositions(
      'mission-b',
      5_000,
      'renderer-b:request-a',
    )
    const queryRejection = expect(query).rejects.toMatchObject({ name: 'AbortError' })

    expect(workerSignal?.aborted).toBe(true)
    expect(cancellationSettled).toBe(false)
    expect(runBreadcrumbQueryInWorker).toHaveBeenCalledTimes(1)

    const error = new Error('worker terminated')
    error.name = 'AbortError'
    rejectTerminatedWorker(error)
    await expect(cancellation).resolves.toBe(true)
    await queryRejection
    await expect(replacementQuery).resolves.toEqual(
      expect.objectContaining({ positions: [] }),
    )
    expect(runBreadcrumbQueryInWorker).toHaveBeenCalledTimes(2)
    await expect(
      store.cancelBreadcrumbQuery('renderer-a:request-a'),
    ).resolves.toBe(false)
  })

  it('keeps current-position persistence available while Mission Review reads in a worker [DON-251]', async () => {
    let resolveReview: ((value: {
      readonly auditEvents: readonly never[]
      readonly breadcrumbCount: number
    }) => void) | undefined
    const runMissionReviewReadQueryInWorker = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveReview = resolve
      }),
    )
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-store-'))
    store = createElectronMissionStore({
      userDataPath,
      runMissionReviewReadQueryInWorker,
    })
    const mission = await store.createMission({ name: 'Live Review Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'team-1',
      name: 'Team One',
      color: '#00AAFF',
      status: 'online',
    })

    const review = store.readMissionReview(
      { missionId: mission.id, includeTelemetry: false, auditLimit: 501 },
      'renderer-a:mission-review:request-1',
    )
    await vi.waitFor(() =>
      expect(runMissionReviewReadQueryInWorker).toHaveBeenCalledOnce(),
    )

    await expect(store.addPosition({
      mission_id: mission.id,
      device_id: 'team-1',
      source_position_id: 'live-fix-1',
      lat: 52.05,
      lon: -9.5,
      timestamp: '2026-08-22T19:00:00.000Z',
    })).resolves.toMatchObject({ source_position_id: 'live-fix-1' })
    resolveReview?.({ auditEvents: [], breadcrumbCount: 0 })

    await expect(review).resolves.toEqual({ auditEvents: [], breadcrumbCount: 0 })
    await expect(store.countPositions(mission.id)).resolves.toBe(1)
  })

  it('cancels an obsolete Mission Review worker by renderer request ID [DON-251]', async () => {
    const runMissionReviewReadQueryInWorker = vi.fn().mockImplementation(
      (input: { readonly signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal?.addEventListener('abort', () => {
            const error = new Error('Mission Review query was cancelled.')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        }),
    )
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-store-'))
    store = createElectronMissionStore({
      userDataPath,
      runMissionReviewReadQueryInWorker,
    })
    const requestId = 'renderer-a:mission-review:request-1'
    const review = store.readMissionReview(
      { missionId: 'mission-1', includeTelemetry: false, auditLimit: 501 },
      requestId,
    )
    await vi.waitFor(() =>
      expect(runMissionReviewReadQueryInWorker).toHaveBeenCalledOnce(),
    )

    const rejection = expect(review).rejects.toMatchObject({ name: 'AbortError' })
    await expect(store.cancelMissionReviewRead(requestId)).resolves.toBe(true)
    await rejection
    await expect(store.cancelMissionReviewRead(requestId)).resolves.toBe(false)
  })

  it('serializes Mission Review workers so obsolete reads cannot accumulate [DON-251]', async () => {
    const completions: Array<() => void> = []
    const runMissionReviewReadQueryInWorker = vi.fn(() => new Promise<{
      readonly auditEvents: readonly never[]
      readonly breadcrumbCount: number
    }>((resolve) => {
      completions.push(() => resolve({ auditEvents: [], breadcrumbCount: 0 }))
    }))
    store = await createStore({ runMissionReviewReadQueryInWorker })
    const first = store.readMissionReview({
      missionId: 'mission-1',
      includeTelemetry: false,
      auditLimit: 5,
    }, 'review-first')
    const second = store.readMissionReview({
      missionId: 'mission-2',
      includeTelemetry: false,
      auditLimit: 5,
    }, 'review-second')

    await vi.waitFor(() => expect(runMissionReviewReadQueryInWorker).toHaveBeenCalledTimes(1))
    completions[0]?.()
    await vi.waitFor(() => expect(runMissionReviewReadQueryInWorker).toHaveBeenCalledTimes(2))
    completions[1]?.()
    await Promise.all([first, second])
  })

  it('does not start the next outing summary until the previous physical worker exits [DON-270]', async () => {
    const resultResolvers: Array<(value: {
      readonly outings: readonly never[]
      readonly unassigned_accepted_fix_count: number
      readonly total_accepted_fix_count: number
    }) => void> = []
    const exitResolvers: Array<() => void> = []
    const runOutingFixSummaryInWorker = vi.fn(() => {
      const workerExited = new Promise<void>((resolve) => exitResolvers.push(resolve))
      const operation = new Promise<{
        readonly outings: readonly never[]
        readonly unassigned_accepted_fix_count: number
        readonly total_accepted_fix_count: number
      }>((resolve) => resultResolvers.push(resolve))
      Object.defineProperty(operation, 'workerExited', { value: workerExited })
      return operation
    })
    store = await createStore({ runOutingFixSummaryInWorker })

    const first = store.readOutingFixSummary({ missionId: 'mission-1' }, 'outing-first')
    const second = store.readOutingFixSummary({ missionId: 'mission-2' }, 'outing-second')
    await vi.waitFor(() => expect(runOutingFixSummaryInWorker).toHaveBeenCalledTimes(1))
    resultResolvers[0]?.({
      outings: [], unassigned_accepted_fix_count: 0, total_accepted_fix_count: 0,
    })
    await first

    expect(runOutingFixSummaryInWorker).toHaveBeenCalledTimes(1)
    exitResolvers[0]?.()
    await vi.waitFor(() => expect(runOutingFixSummaryInWorker).toHaveBeenCalledTimes(2))
    resultResolvers[1]?.({
      outings: [], unassigned_accepted_fix_count: 0, total_accepted_fix_count: 0,
    })
    exitResolvers[1]?.()
    await second
  })

  it('keeps info constant-size and excludes anomaly-ledger aggregation [DON-251]', async () => {
    store = await createStore({ ingestEvidenceFaultInjection: { failStage: true } })
    const mission = await store.createMission({ name: 'Info Isolation Mission' })
    await store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [createRejectionEnvelope('info-isolation')],
    })

    await expect(store.info()).resolves.not.toHaveProperty('ingest_evidence_health')
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical',
    })
  })

  it('matches the established audit/count oracle through the Review worker [DON-251]', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Review Oracle Mission',
      start_time: '2026-08-22T18:00:00.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'team-1',
      name: 'Team One',
      color: '#00AAFF',
      status: 'online',
    })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: Array.from({ length: 25 }, (_unused, index) => ({
        source_position_id: `oracle-fix-${index}`,
        device_id: 'team-1',
        lat: 52.05 + index / 100_000,
        lon: -9.5,
        timestamp: new Date(Date.UTC(2026, 7, 22, 18, 1, index)).toISOString(),
      })),
    })
    const info = await store.info()
    const writer = new Database(info.database_path)
    const insertEvent = writer.prepare(`
      INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, ?, '2026-08-22T19:00:00.000Z', NULL)
    `)
    insertEvent.run('oracle-tie-first', mission.id, 'marker_created')
    insertEvent.run('oracle-telemetry', mission.id, 'position_recorded')
    insertEvent.run('oracle-tie-last', mission.id, 'drawing_created')
    writer.close()

    for (const includeTelemetry of [false, true]) {
      const expectedAudit = await store.listAuditEvents(mission.id, {
        includeTelemetry,
        limit: 2,
      })
      const expectedCount = await store.countPositions(mission.id)

      await expect(store.readMissionReview({
        missionId: mission.id,
        includeTelemetry,
        auditLimit: 2,
      }, `oracle-${includeTelemetry}`)).resolves.toEqual({
        auditEvents: expectedAudit,
        breadcrumbCount: expectedCount,
      })
    }
  })

  it('acknowledges a large tracking batch without returning or materializing changed rows', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Tracking Ack Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })
    const positions = Array.from({ length: 25_000 }, (_, index) => ({
      source_position_id: `source-${index}`,
      device_id: 'tracker-1',
      lat: 52 + index / 10_000_000,
      lon: -9.7 - index / 10_000_000,
      timestamp: new Date(Date.UTC(2026, 7, 9, 0, 0, index)).toISOString(),
      timestamp_source: 'fix' as const,
    }))

    const result = await store.persistTrackingPositionsBulk({
      mission_id: mission.id,
      positions,
      checkpoints: [],
    })

    expect(result).toEqual({
      changedPositionCount: 25_000,
      insertedPositionCount: 25_000,
      skippedAmbiguousLegacyAdoptionCount: 0,
    })
    expect(JSON.stringify(result).length).toBeLessThan(200)
    await expect(store.countPositions(mission.id)).resolves.toBe(25_000)

    const correction = {
      ...positions[0]!,
      lat: positions[0]!.lat + 0.01,
    }
    await expect(store.persistTrackingPositionsBulk({
      mission_id: mission.id,
      positions: [correction],
      checkpoints: [{
        device_id: 'tracker-1',
        history_from: '2026-08-09T00:00:00.000Z',
        reconciled_until: '2026-08-09T02:00:00.000Z',
      }],
    })).resolves.toEqual({
      changedPositionCount: 0,
      insertedPositionCount: 0,
      skippedAmbiguousLegacyAdoptionCount: 0,
    })
    await expect(store.listIngestAnomalies(mission.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'conflict',
        source_position_id: 'source-0',
      }),
    ])
    await expect(store.listTrackingHistoryCheckpoints(mission.id)).resolves.toEqual([
      {
        mission_id: mission.id,
        device_id: 'tracker-1',
        history_from: '2026-08-09T00:00:00.000Z',
        reconciled_until: '2026-08-09T02:00:00.000Z',
      },
    ])
  })

  it('accumulates paused seconds when a mission resumes [DON-231]', async () => {
    vi.useFakeTimers()
    store = await createStore()
    const mission = await store.createMission({
      name: 'Paused Time Mission',
      start_time: '2026-07-06T12:00:00.000Z',
    })

    vi.setSystemTime(new Date('2026-07-06T12:10:00.000Z'))
    await store.pauseMission(mission.id)
    vi.setSystemTime(new Date('2026-07-06T12:40:00.000Z'))
    await store.resumeMission(mission.id)

    const resumed = await store.getMission(mission.id)
    expect(resumed).toMatchObject({
      status: 'active',
      pause_time: null,
      paused_seconds: 1_800,
    })

    vi.setSystemTime(new Date('2026-07-06T13:00:00.000Z'))
    await store.finishMission(mission.id)

    const finished = await store.getMission(mission.id)
    expect(finished).toMatchObject({
      status: 'finished',
      pause_time: null,
      paused_seconds: 1_800,
    })
  })

  it('folds the current pause into paused seconds when finishing a paused mission [DON-231]', async () => {
    vi.useFakeTimers()
    store = await createStore()
    const mission = await store.createMission({
      name: 'Paused Finish Mission',
      start_time: '2026-07-06T12:00:00.000Z',
    })

    vi.setSystemTime(new Date('2026-07-06T12:05:00.000Z'))
    await store.pauseMission(mission.id)
    vi.setSystemTime(new Date('2026-07-06T12:20:00.000Z'))
    await store.finishMission(mission.id)

    const finished = await store.getMission(mission.id)
    expect(finished).toMatchObject({
      status: 'finished',
      pause_time: null,
      paused_seconds: 900,
    })
  })

  it('bulk records tracking positions in one mission-store operation while preserving mission truth [DON-200]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Bulk Tracking Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    const positions = Array.from({ length: 2_500 }, (_, index) => ({
      mission_id: mission.id,
      device_id: 'tracker-1',
      lat: 52.0599 + index / 1_000_000,
      lon: -9.5045 - index / 1_000_000,
      altitude: index % 3 === 0 ? 120 + index : null,
      speed: index % 5 === 0 ? 2.5 : null,
      battery: index % 7 === 0 ? 87 : null,
      accuracy: index % 11 === 0 ? 4 : null,
      source: 'traccar',
      timestamp: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
      data_origin: index % 2 === 0 ? 'live' as const : 'cache' as const,
    }))

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions,
      }),
    ).resolves.toHaveLength(positions.length)

    await expect(store.countPositions(mission.id)).resolves.toBe(positions.length)
    const persisted = await store.listPositions(mission.id)
    expect(persisted).toHaveLength(positions.length)
    expect(persisted[0]).toMatchObject({
      device_id: 'tracker-1',
      timestamp: positions[0]!.timestamp,
      data_origin: 'live',
    })
    expect(persisted.at(-1)).toMatchObject({
      device_id: 'tracker-1',
      timestamp: positions.at(-1)!.timestamp,
      data_origin: 'cache',
    })

    const telemetry = await store.listAuditEvents(mission.id, {
      includeTelemetry: true,
      limit: 5_000,
    })
    expect(telemetry.filter((event) => event.event_type === 'position_recorded')).toHaveLength(0)
    const auditEvents = await store.listAuditEvents(mission.id)
    expect(auditEvents.map((event) => event.event_type)).not.toContain('position_recorded')
  })

  it('bulk records same-second distinct Traccar positions when upstream ids differ [DON-233]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Same Second Tracking Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [
          {
            source_position_id: 'traccar-9001',
            device_id: 'tracker-1',
            lat: 52.0599,
            lon: -9.5045,
            timestamp: '2026-06-13T12:00:05.000Z',
          },
          {
            source_position_id: 'traccar-9002',
            device_id: 'tracker-1',
            lat: 52.0601,
            lon: -9.5047,
            timestamp: '2026-06-13T12:00:05.000Z',
          },
        ],
      }),
    ).resolves.toHaveLength(2)

    await expect(store.countPositions(mission.id)).resolves.toBe(2)
    await expect(store.listPositions(mission.id)).resolves.toEqual([
      expect.objectContaining({ source_position_id: 'traccar-9001' }),
      expect.objectContaining({ source_position_id: 'traccar-9002' }),
    ])
  })

  it('persists Traccar source identity separately from the local row id [DON-260]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Source Identity Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })

    const inserted = await store.addPosition({
      mission_id: mission.id,
      device_id: 'tracker-1',
      source_position_id: '987654321',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-07-28T10:00:00.000Z',
    })

    expect(inserted.id).not.toBe('987654321')
    expect(inserted.source_position_id).toBe('987654321')
    await expect(store.listPositions(mission.id)).resolves.toEqual([
      expect.objectContaining({
        id: inserted.id,
        source_position_id: '987654321',
      }),
    ])
  })

  it('rejects invalid persisted fix timestamps before they can corrupt breadcrumb ordering [DON-260]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Timestamp Validation Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })

    await expect(
      store.addPosition({
        mission_id: mission.id,
        device_id: 'tracker-1',
        source_position_id: '1',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: 'not-a-timestamp',
      }),
    ).rejects.toThrow(/timestamp/i)
    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [
          {
            device_id: 'tracker-1',
            source_position_id: '2',
            lat: 52.0599,
            lon: -9.5045,
            timestamp: '2026-07-28',
          },
        ],
      }),
    ).rejects.toThrow(/timestamp/i)
    await expect(
      store.addPosition({
        mission_id: mission.id,
        device_id: 'tracker-1',
        source_position_id: '3',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: '2026-02-30T10:00:00Z',
      }),
    ).rejects.toThrow(/timestamp/i)
    await expect(store.countPositions(mission.id)).resolves.toBe(0)
  })

  it('keeps the first accepted source fix immutable and records one durable conflict [DON-268]', async () => {
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(),
      requested: vi.fn(),
      started: vi.fn(),
      phase: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
      startMission: vi.fn(),
      recordTrackingBatch: vi.fn(),
      recordInsertedPositions: vi.fn().mockResolvedValue(undefined),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({ name: 'Source Identity Conflict Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    const position = {
      source_position_id: 'source-1',
      device_id: 'tracker-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-07-28T10:00:00.000Z',
    }

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [position],
      }),
    ).resolves.toHaveLength(1)
    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [position],
      }),
    ).resolves.toHaveLength(0)
    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [{ ...position, lat: 52.5 }],
      }),
    ).resolves.toHaveLength(0)
    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [{ ...position, lat: 52.5 }],
      }),
    ).resolves.toHaveLength(0)
    await expect(store.countPositions(mission.id)).resolves.toBe(1)
    await expect(store.listPositions(mission.id)).resolves.toEqual([
      expect.objectContaining({
        source_position_id: 'source-1',
        lat: 52.0599,
        received_at: expect.any(String),
        content_hash: expect.stringMatching(/^v1:[a-f0-9]{64}$/u),
        source_kind: 'traccar',
      }),
    ])
    const correctionEvents = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'position_corrected',
    )
    expect(correctionEvents).toHaveLength(0)
    await expect(store.listIngestAnomalies(mission.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'conflict',
        device_id: 'tracker-1',
        source_position_id: 'source-1',
        reason_class: 'source_identity_content_conflict',
        canonical_payload_json: expect.any(String),
        occurrence_count: 2,
      }),
    ])
    const [conflict] = await store.listIngestAnomalies(mission.id)
    expect(JSON.parse(conflict!.canonical_payload_json)).toEqual(
      expect.objectContaining({
        source_position_id: 'source-1',
        device_id: 'tracker-1',
        lat: 52.5,
        timestamp: '2026-07-28T10:00:00.000Z',
      }),
    )
    expect(
      vi
        .mocked(storageDiagnostics.recordInsertedPositions)
        .mock.calls.map(([entry]) => entry.insertedPositionCount),
    ).toEqual([1, 0, 0, 0])
  })

  it('isolates source-device reassignment as a conflict without aborting the batch [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Source Identity Device Ownership Mission',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-2',
      name: 'Tracker Two',
      color: '#FFAA00',
      status: 'online',
    })
    const original = {
      mission_id: mission.id,
      source_position_id: 'source-1',
      device_id: 'tracker-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-07-28T10:00:00.000Z',
    }
    await store.addPosition(original)

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [
          {
            ...original,
            device_id: 'tracker-2',
            lat: 53.3498,
            lon: -6.2603,
          },
          {
            source_position_id: 'source-2',
            device_id: 'tracker-2',
            lat: 53.3,
            lon: -6.2,
            timestamp: '2026-07-28T09:00:00.000Z',
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ source_position_id: 'source-2' }),
    ])
    await expect(store.listPositions(mission.id)).resolves.toEqual([
      expect.objectContaining({
        source_position_id: 'source-2',
        device_id: 'tracker-2',
      }),
      expect.objectContaining({
        source_position_id: 'source-1',
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
      }),
    ])
    await expect(store.listIngestAnomalies(mission.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'conflict',
        source_position_id: 'source-1',
        reason_class: 'source_identity_content_conflict',
      }),
    ])
  })

  it('does not refresh the incoming device for a source identity owned by another device [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Source Ownership Contact Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-2',
      name: 'Tracker Two',
      color: '#FFAA00',
      status: 'offline',
    })
    await store.addPosition({
      mission_id: mission.id,
      source_position_id: 'source-owned-by-one',
      device_id: 'tracker-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-08-22T10:00:00.000Z',
    })

    await expect(store.addPosition({
      mission_id: mission.id,
      source_position_id: 'source-owned-by-one',
      device_id: 'tracker-2',
      lat: 53.3498,
      lon: -6.2603,
      timestamp: '2026-08-22T10:30:00.000Z',
    })).rejects.toThrow(/source.*owned.*tracker-1/iu)

    await expect(store.getDevice(mission.id, 'tracker-2')).resolves.toMatchObject({
      status: 'offline',
      last_seen: null,
    })
    await expect(store.listIngestAnomalies(mission.id)).resolves.toHaveLength(1)
  })

  it('canonicalizes equivalent source timestamps and refreshes contact on conflict [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Canonical Timestamp Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })
    const original = {
      source_position_id: 'source-time',
      device_id: 'tracker-1',
      lat: 52.1,
      lon: -9.1,
      timestamp: '2026-08-22T10:00:00Z',
    }
    await store.addPositionsBulk({ mission_id: mission.id, positions: [original] })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [{ ...original, timestamp: '2026-08-22T11:00:00+01:00' }],
    })
    await expect(store.listIngestAnomalies(mission.id)).resolves.toHaveLength(0)

    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [{
        ...original,
        lat: 52.2,
        timestamp: '2026-08-22T10:30:00.000Z',
      }],
    })

    await expect(store.getDevice(mission.id, 'tracker-1')).resolves.toMatchObject({
      last_seen: '2026-08-22T10:30:00.000Z',
      status: 'online',
    })
    await expect(store.listIngestAnomalies(mission.id)).resolves.toHaveLength(1)
  })

  it('projects renderer rejections through an acked idempotent durable outbox [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Rejected Evidence Mission' })
    const rejection = createRejectionEnvelope('delivery-1')

    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [rejection],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: ['delivery-1'],
      health: { state: 'healthy', pendingCount: 0 },
    })
    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [rejection, { ...rejection, deliveryId: 'delivery-2' }],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: ['delivery-1', 'delivery-2'],
      health: { state: 'healthy', pendingCount: 0 },
    })
    await expect(store.listIngestAnomalies(mission.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'rejected',
        source_position_id: '123',
        reason_class: 'invalid_coordinates',
        occurrence_count: 2,
      }),
    ])
  })

  it('keeps rejection delivery and anomaly identity scoped to each mission [DON-268]', async () => {
    store = await createStore()
    const missionA = await store.createMission({ name: 'Mission A' })
    const rejection = createRejectionEnvelope('same-transport-id')
    await store.recordIngestRejections({ mission_id: missionA.id, rejections: [rejection] })
    await store.finishMission(missionA.id)
    const missionB = await store.createMission({ name: 'Mission B' })

    await expect(store.recordIngestRejections({
      mission_id: missionB.id,
      rejections: [rejection],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: ['same-transport-id'],
      health: { state: 'healthy' },
    })
    await expect(store.listIngestAnomalies(missionA.id)).resolves.toHaveLength(1)
    await expect(store.listIngestAnomalies(missionB.id)).resolves.toHaveLength(1)
  })

  it('pages distinct conflicts without deleting unique evidence [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Conflict Paging Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })
    const original = {
      source_position_id: 'storm-source',
      device_id: 'tracker-1',
      lat: 52,
      lon: -9.5,
      timestamp: '2026-08-22T10:00:00.000Z',
    }
    await store.addPositionsBulk({ mission_id: mission.id, positions: [original] })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: Array.from({ length: 205 }, (_unused, index) => ({
        ...original,
        lat: 52 + (index + 1) / 100_000,
      })),
    })

    await expect(store.listIngestAnomalies(mission.id)).resolves.toHaveLength(200)
    await expect(store.listIngestAnomalies(mission.id, {
      limit: 10,
      offset: 200,
    })).resolves.toHaveLength(5)
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      conflictCount: 205,
    })
  })

  it('keeps clean position writes live while rejection projection is degraded, then replays on restart [DON-268]', async () => {
    store = await createStore({
      ingestEvidenceFaultInjection: { failProjection: true },
    })
    const mission = await store.createMission({ name: 'Degraded Evidence Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })

    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [createRejectionEnvelope('delivery-replay')],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: ['delivery-replay'],
      health: { state: 'degraded', pendingCount: 1 },
    })
    await expect(store.addPosition({
      mission_id: mission.id,
      source_position_id: 'clean-source',
      device_id: 'tracker-1',
      lat: 52.1,
      lon: -9.1,
      timestamp: '2026-08-22T10:10:00.000Z',
    })).resolves.toMatchObject({ source_position_id: 'clean-source' })

    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect.poll(async () => (await store!.getIngestEvidenceHealth()).state).toBe('healthy')
    await expect(store.listIngestAnomalies(mission.id)).resolves.toEqual([
      expect.objectContaining({ kind: 'rejected', source_position_id: '123' }),
    ])
    await expect(store.countPositions(mission.id)).resolves.toBe(1)
  })

  it('replays pending projection in the same process after SQLite recovers [DON-268]', async () => {
    const faultInjection = { failProjection: true }
    store = await createStore({ ingestEvidenceFaultInjection: faultInjection })
    const mission = await store.createMission({ name: 'Same-process Replay Mission' })

    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [createRejectionEnvelope('delivery-pending')],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: ['delivery-pending'],
      health: { state: 'degraded', pendingCount: 1 },
    })

    faultInjection.failProjection = false
    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [{
        ...createRejectionEnvelope('delivery-new'),
        anomalyKey: 'source:456:reason:invalid_coordinates:content:fedcba9876543210',
        sourcePositionId: '456',
      }],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: ['delivery-new'],
      health: { state: 'healthy', pendingCount: 0 },
    })
    await expect(store.listIngestAnomalies(mission.id)).resolves.toHaveLength(2)
  })

  it('keeps finalized missions read-only when late rejection evidence arrives [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Late Rejection Mission' })
    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)

    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [createRejectionEnvelope('delivery-after-finalize')],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: ['delivery-after-finalize'],
      health: {
        state: 'critical',
        reason: 'late_evidence_after_finalization',
        pendingCount: 1,
      },
    })
    await expect(store.listIngestAnomalies(mission.id)).resolves.toHaveLength(0)
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
  })

  it('acknowledges an already-projected rejection retry after finalization without mutation [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Finalized Idempotent Retry Mission' })
    const rejection = createRejectionEnvelope('delivery-before-finalize')
    await store.recordIngestRejections({ mission_id: mission.id, rejections: [rejection] })
    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)

    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [rejection],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: ['delivery-before-finalize'],
      health: { state: 'healthy', pendingCount: 0 },
    })
    await expect(store.listIngestAnomalies(mission.id)).resolves.toEqual([
      expect.objectContaining({ occurrence_count: 1 }),
    ])
  })

  it('persists invalid rejection-envelope degradation across restart [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Invalid Envelope Mission' })

    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [{ ...createRejectionEnvelope('delivery-invalid'), reasonClass: '' }],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: [],
      health: { state: 'critical', reason: 'outbox_invalid_envelope' },
    })
    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical',
      reason: 'outbox_invalid_envelope',
    })
  })

  it('durably blocks completeness after renderer evidence capacity is exhausted [DON-268]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Renderer Capacity Mission' })

    await expect(store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'renderer_pending_capacity_exhausted',
    })).resolves.toMatchObject({
      state: 'critical',
      reason: 'renderer_pending_capacity_exhausted',
    })
    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical',
      reason: 'renderer_pending_capacity_exhausted',
    })
    await store.finishMission(mission.id)
    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/evidence health/iu)
  })

  it('durably blocks completeness after renderer teardown loses pending evidence [DON-276]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Renderer Teardown Mission' })

    await expect(store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'renderer_pending_evidence_lost',
    })).resolves.toMatchObject({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
    })
    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
    })
    await store.finishMission(mission.id)
    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/evidence health/iu)
  })

  it('durably blocks completeness after an accepted mission write fails [DON-276]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Mission Persistence Failure' })

    await expect(store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'mission_persistence_failed',
    })).resolves.toMatchObject({
      state: 'critical',
      reason: 'mission_persistence_failed',
    })
    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical',
      reason: 'mission_persistence_failed',
    })
    await store.finishMission(mission.id)
    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/evidence health/iu)
  })

  it('allows an authorized admin to close a mission with permanently visible acknowledged evidence loss [DON-276]', async () => {
    store = await createStore({
      readAdminRoster: async () => ['Duty Admin'],
    })
    const mission = await store.createMission({ name: 'Acknowledged Evidence Gap' })
    await store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'renderer_pending_evidence_lost',
    })
    await store.finishMission(mission.id)

    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/evidence health/iu)
    await expect(store.acknowledgeIngestEvidenceLoss({
      mission_id: mission.id,
      admin_name: 'Duty Admin',
      reason: 'Runtime failed during the 22:14 tracking poll; incident log retained.',
    })).resolves.toMatchObject({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
      acknowledgedLoss: {
        adminName: 'Duty Admin',
        reason: 'Runtime failed during the 22:14 tracking poll; incident log retained.',
      },
    })

    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.finalizeMission(mission.id)).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
      acknowledgedLoss: { adminName: 'Duty Admin' },
    })
    const events = await store.listMissionEvents(mission.id)
    const acknowledged = events.find(
      (event) => event.event_type === 'mission_evidence_loss_acknowledged',
    )
    expect(JSON.parse(acknowledged?.details_json ?? '{}')).toMatchObject({
      admin_name: 'Duty Admin',
      reason: 'Runtime failed during the 22:14 tracking poll; incident log retained.',
    })
  })

  it('records denied evidence-loss acknowledgement and keeps finalization blocked [DON-276]', async () => {
    store = await createStore({
      readAdminRoster: async () => ['Duty Admin'],
    })
    const mission = await store.createMission({ name: 'Denied Evidence Gap' })
    await store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'renderer_pending_evidence_lost',
    })
    await store.finishMission(mission.id)

    await expect(store.acknowledgeIngestEvidenceLoss({
      mission_id: mission.id,
      admin_name: 'Unknown Operator',
      reason: 'Attempted closure.',
    })).rejects.toThrow(/not authorized/iu)
    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/evidence health/iu)
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type)).toContain(
      'mission_evidence_loss_acknowledgement_denied',
    )
  })

  it('invalidates acknowledgement when a later evidence-loss occurrence is recorded [DON-276]', async () => {
    store = await createStore({
      readAdminRoster: async () => ['Duty Admin'],
    })
    const mission = await store.createMission({ name: 'Repeated Evidence Gap' })
    await store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'renderer_pending_evidence_lost',
    })
    await store.finishMission(mission.id)
    await store.acknowledgeIngestEvidenceLoss({
      mission_id: mission.id,
      admin_name: 'Duty Admin',
      reason: 'First runtime loss reviewed.',
    })

    await store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'renderer_pending_evidence_lost',
    })

    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/evidence health/iu)
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.not.toHaveProperty(
      'acknowledgedLoss',
    )
  })

  it('does not block a clean mission with another mission evidence-loss marker [DON-268]', async () => {
    store = await createStore()
    const affected = await store.createMission({ name: 'Affected Evidence Mission' })
    await store.recordIngestEvidenceLoss({
      mission_id: affected.id,
      reason: 'renderer_pending_capacity_exhausted',
    })
    await store.finishMission(affected.id)
    const clean = await store.createMission({ name: 'Clean Evidence Mission' })
    await store.finishMission(clean.id)

    await expect(store.finalizeMission(clean.id)).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    await expect(store.finalizeMission(affected.id)).rejects.toThrow(/evidence health/iu)
  })

  it('reports the no-writable-storage boundary and blocks archive completeness claims [DON-268]', async () => {
    store = await createStore({
      ingestEvidenceFaultInjection: { failStage: true },
    })
    const mission = await store.createMission({ name: 'Unwritable Evidence Mission' })

    await expect(store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [createRejectionEnvelope('delivery-unwritable')],
    })).resolves.toMatchObject({
      acknowledgedDeliveryIds: [],
      health: { state: 'critical', pendingCount: 0 },
    })
    await store.finishMission(mission.id)
    await expect(store.createMissionArchive(mission.id)).rejects.toThrow(
      /evidence health.*blocks archive/iu,
    )
    await expect(store.finalizeMission(mission.id)).rejects.toThrow(
      /evidence health.*blocks finalization/iu,
    )
    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical',
      reason: 'outbox_storage_unavailable',
    })
  })

  it('never lets an older historical insert or correction move device last-seen backwards [DON-260]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Historical Correction Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
      last_seen: '2026-07-28T12:00:00.000Z',
    })

    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [
        {
          source_position_id: 'source-old',
          device_id: 'tracker-1',
          lat: 52.0599,
          lon: -9.5045,
          timestamp: '2026-07-28T10:00:00.000Z',
        },
      ],
    })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [
        {
          source_position_id: 'source-old',
          device_id: 'tracker-1',
          lat: 52.0601,
          lon: -9.5045,
          timestamp: '2026-07-28T10:00:00.000Z',
        },
      ],
    })

    await expect(store.listDevices(mission.id)).resolves.toEqual([
      expect.objectContaining({
        device_id: 'tracker-1',
        last_seen: '2026-07-28T12:00:00.000Z',
      }),
    ])
  })

  it('durably checkpoints an empty reconciled history chunk across restart', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Empty History Checkpoint Mission',
      start_time: '2026-08-08T00:00:00.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })

    await store.persistTrackingHistoryBatch({
      mission_id: mission.id,
      positions: [],
      checkpoints: [{
        device_id: 'tracker-1',
        history_from: '2026-08-08T00:00:00.000Z',
        reconciled_until: '2026-08-08T02:00:00.000Z',
      }],
    })
    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })

    await expect(store.listTrackingHistoryCheckpoints(mission.id)).resolves.toEqual([
      {
        mission_id: mission.id,
        device_id: 'tracker-1',
        history_from: '2026-08-08T00:00:00.000Z',
        reconciled_until: '2026-08-08T02:00:00.000Z',
      },
    ])
  })

  it('widens a history checkpoint only after the new prefix reaches the stored origin', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Expanded Participation History Mission',
      start_time: '2026-08-08T08:00:00.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })
    await store.persistTrackingHistoryBatch({
      mission_id: mission.id,
      positions: [],
      checkpoints: [{
        device_id: 'tracker-1',
        history_from: '2026-08-08T12:00:00.000Z',
        reconciled_until: '2026-08-08T14:00:00.000Z',
      }],
    })

    await store.persistTrackingHistoryBatch({
      mission_id: mission.id,
      positions: [],
      checkpoints: [{
        device_id: 'tracker-1',
        history_from: '2026-08-08T08:00:00.000Z',
        reconciled_until: '2026-08-08T10:00:00.000Z',
      }],
    })
    await expect(store.listTrackingHistoryCheckpoints(mission.id)).resolves.toEqual([
      expect.objectContaining({
        history_from: '2026-08-08T12:00:00.000Z',
        reconciled_until: '2026-08-08T14:00:00.000Z',
      }),
    ])

    await store.persistTrackingHistoryBatch({
      mission_id: mission.id,
      positions: [],
      checkpoints: [{
        device_id: 'tracker-1',
        history_from: '2026-08-08T08:00:00.000Z',
        reconciled_until: '2026-08-08T12:00:00.000Z',
      }],
    })
    await expect(store.listTrackingHistoryCheckpoints(mission.id)).resolves.toEqual([
      expect.objectContaining({
        history_from: '2026-08-08T08:00:00.000Z',
        reconciled_until: '2026-08-08T14:00:00.000Z',
      }),
    ])
  })

  it('atomically rolls back positions when a later checkpoint validation fails', async () => {
    store = await createStore()
    const mission = await store.createMission({
      name: 'Atomic History Checkpoint Mission',
      start_time: '2026-08-08T00:00:00.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'online',
    })

    await expect(store.persistTrackingHistoryBatch({
      mission_id: mission.id,
      positions: [{
        source_position_id: 'source-1',
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: '2026-08-08T01:00:00.000Z',
        timestamp_source: 'fix',
      }],
      checkpoints: [{
        device_id: 'tracker-1',
        history_from: '2026-08-08T02:00:00.000Z',
        reconciled_until: '2026-08-08T00:00:00.000Z',
      }],
    })).rejects.toThrow(/checkpoint.*before.*history start/iu)

    await expect(store.listPositions(mission.id)).resolves.toEqual([])
    await expect(store.listTrackingHistoryCheckpoints(mission.id)).resolves.toEqual([])
  })

  it('attaches a recovered source identity to one exact legacy fix instead of duplicating it [DON-260]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Legacy Identity Upgrade' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    const legacyFix = {
      device_id: 'tracker-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-07-28T10:00:00.000Z',
    }
    const legacyRow = await store.addPosition({
      mission_id: mission.id,
      ...legacyFix,
    })

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [
          {
            ...legacyFix,
            source_position_id: 'traccar-position-1',
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: legacyRow.id,
        source_position_id: 'traccar-position-1',
      }),
    ])
    await expect(store.countPositions(mission.id)).resolves.toBe(1)
  })

  it('isolates an ambiguous legacy identity adoption without aborting the tracking batch [DON-260]', async () => {
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(),
      requested: vi.fn(),
      started: vi.fn(),
      phase: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
      startMission: vi.fn(),
      recordTrackingBatch: vi.fn(),
      recordInsertedPositions: vi.fn().mockResolvedValue(undefined),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({ name: 'Ambiguous Legacy Identity' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    const ambiguousLegacyFix = {
      device_id: 'tracker-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-07-28T10:00:00.000Z',
    }
    await store.addPosition({ mission_id: mission.id, ...ambiguousLegacyFix })
    await store.addPosition({ mission_id: mission.id, ...ambiguousLegacyFix })

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [
          {
            ...ambiguousLegacyFix,
            source_position_id: 'ambiguous-source',
          },
          {
            device_id: 'tracker-1',
            source_position_id: 'unambiguous-source',
            lat: 52.06,
            lon: -9.505,
            timestamp: '2026-07-28T10:01:00.000Z',
          },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        source_position_id: 'unambiguous-source',
      }),
    ])
    await expect(store.countPositions(mission.id)).resolves.toBe(3)
    await expect(store.listPositions(mission.id)).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_position_id: 'ambiguous-source' }),
      ]),
    )
    expect(storageDiagnostics.recordInsertedPositions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        insertedPositionCount: 1,
        skippedAmbiguousLegacyAdoptionCount: 1,
      }),
    )
  })

  it('checks all exact legacy fields before limiting ambiguous identity candidates [DON-260]', async () => {
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(),
      requested: vi.fn(),
      started: vi.fn(),
      phase: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
      startMission: vi.fn(),
      recordTrackingBatch: vi.fn(),
      recordInsertedPositions: vi.fn().mockResolvedValue(undefined),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({ name: 'Legacy Candidate Ordering' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    const sharedCoordinates = {
      device_id: 'tracker-1',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-07-28T10:00:00.000Z',
    }
    await store.addPosition({
      mission_id: mission.id,
      ...sharedCoordinates,
      name: 'Earlier non-matching fix one',
    })
    await store.addPosition({
      mission_id: mission.id,
      ...sharedCoordinates,
      name: 'Earlier non-matching fix two',
    })
    await store.addPosition({ mission_id: mission.id, ...sharedCoordinates })
    await store.addPosition({ mission_id: mission.id, ...sharedCoordinates })

    await expect(
      store.addPositionsBulk({
        mission_id: mission.id,
        positions: [
          {
            ...sharedCoordinates,
            source_position_id: 'ambiguous-later-source',
          },
        ],
      }),
    ).resolves.toEqual([])
    await expect(store.countPositions(mission.id)).resolves.toBe(4)
    await expect(store.listPositions(mission.id)).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_position_id: 'ambiguous-later-source' }),
      ]),
    )
    expect(storageDiagnostics.recordInsertedPositions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        insertedPositionCount: 0,
        skippedAmbiguousLegacyAdoptionCount: 1,
      }),
    )
  })

  it('counts positions without loading position rows for Mission Review [DON-202]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Review Count Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-2',
      name: 'Tracker Two',
      color: '#00BB66',
      status: 'unknown',
    })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [
        {
          device_id: 'tracker-1',
          lat: 52.0599,
          lon: -9.5045,
          timestamp: '2026-05-19T12:01:00.000Z',
        },
        {
          device_id: 'tracker-1',
          lat: 52.06,
          lon: -9.505,
          timestamp: '2026-05-19T12:02:00.000Z',
        },
        {
          device_id: 'tracker-2',
          lat: 52.07,
          lon: -9.506,
          timestamp: '2026-05-19T12:03:00.000Z',
        },
      ],
    })

    await expect(store.countPositions(mission.id)).resolves.toBe(3)
    await expect(store.countPositions(mission.id, 'tracker-1')).resolves.toBe(2)
    await expect(store.countPositions(mission.id, 'tracker-2')).resolves.toBe(1)
  })

  it('excludes telemetry events and bounds the result for the review audit log', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Audit Mission' })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })

    // Generate a burst of positions. Current Electron stores position truth without
    // duplicating every fix into mission_events.
    for (let index = 0; index < 50; index += 1) {
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'tracker-1',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: `2026-05-19T12:${String(index).padStart(2, '0')}:00.000Z`,
      })
    }

    const auditEvents = await store.listAuditEvents(mission.id)
    const auditTypes = auditEvents.map((event) => event.event_type)
    expect(auditTypes).toContain('mission_created')
    // device upsert + GPS fixes are telemetry heartbeats and must be filtered out.
    expect(auditTypes).not.toContain('position_recorded')
    expect(auditTypes).not.toContain('device_updated')

    await store.syncBackup('interval')
    const auditTypesAfterBackup = (await store.listAuditEvents(mission.id)).map(
      (event) => event.event_type,
    )
    expect(auditTypesAfterBackup).not.toContain('mission_backup_synced')

    // Legacy/current telemetry can still be opted back in, but respects the bound.
    const withTelemetry = await store.listAuditEvents(mission.id, {
      includeTelemetry: true,
      limit: 10,
    })
    expect(withTelemetry.length).toBeLessThanOrEqual(10)
    expect(withTelemetry.map((event) => event.event_type)).toContain('mission_backup_synced')
    expect(withTelemetry.map((event) => event.event_type)).not.toContain('position_recorded')
    for (let index = 1; index < withTelemetry.length; index += 1) {
      expect(
        Date.parse(withTelemetry[index - 1]!.timestamp) >=
          Date.parse(withTelemetry[index]!.timestamp),
      ).toBe(true)
    }
  })

  it('keeps the rolling backup mirror atomic when backup is interrupted [DON-232]', async () => {
    store = await createStore({
      backupFaultInjection: {
        afterTemporaryBackup: true,
      },
    })
    const mission = await store.createMission({ name: 'Interrupted Backup Mission' })

    await expect(store.syncBackup()).rejects.toThrow(/Injected backup interruption/)
    await expect(access(path.join(userDataPath!, 'mission-store.backup.sqlite'))).rejects.toThrow()
    const files = await readdir(userDataPath!)
    expect(files.some((fileName) => fileName.includes('mission-store.backup.sqlite.tmp'))).toBe(false)

    const eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes).not.toContain('mission_backup_synced')
  })

  it('rejects a rolling snapshot whose fixed SQLite header sanity check fails [DON-240]', async () => {
    store = await createStore({
      backupFaultInjection: {
        corruptTemporarySnapshotBeforeSanityCheck: true,
      },
    })
    const mission = await store.createMission({ name: 'Corrupt Rolling Snapshot Mission' })

    await expect(store.syncBackup('interval')).rejects.toThrow(/SQLite header signature/)
    await expect(access(path.join(userDataPath!, 'mission-store.backup.sqlite'))).rejects.toThrow()
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type)).not.toContain(
      'mission_backup_synced',
    )
  })

  it('rejects an archive whose embedded SQLite snapshot fails integrity validation [DON-232]', async () => {
    store = await createStore({
      archiveFaultInjection: {
        corruptSnapshotBeforeZip: true,
      },
    })
    const mission = await store.createMission({ name: 'Corrupt Snapshot Archive Mission' })
    await store.finishMission(mission.id)

    await expect(store.createMissionArchive(mission.id)).rejects.toThrow(/SQLite snapshot/i)
    const archiveDirectory = path.join(userDataPath!, 'archives')
    const archiveFiles = await readdir(archiveDirectory).catch(() => [])
    expect(archiveFiles.filter((fileName) => fileName.endsWith('.zip'))).toEqual([])
  })

  it('persists layer catalog metadata in the same userData SQLite database', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Layer Mission' })

    await expect(
      store.upsertLayerCatalogMetadata({
        missionId: mission.id,
        nodeId: 'group:tracking',
        parentNodeId: null,
        nodeKind: 'group',
        isVisible: false,
      }),
    ).resolves.toMatchObject({
      missionId: mission.id,
      nodeId: 'group:tracking',
      isVisible: false,
    })

    await expect(store.listLayerCatalogMetadata(mission.id)).resolves.toMatchObject([
      {
        missionId: mission.id,
        nodeId: 'group:tracking',
        isVisible: false,
      },
    ])

    await store.clearLayerCatalogMetadata(mission.id)
    await expect(store.listLayerCatalogMetadata(mission.id)).resolves.toEqual([])

    const eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes.filter((eventType) => eventType === 'layer_catalog_metadata_updated')).toHaveLength(1)
    expect(eventTypes).toContain('layer_catalog_repaired')
  })

  // --- DON-163 / DON-164: audit-event parity with Rust + harness ---

  const SAMPLE_MARKER = {
    type: 'ipp_lkp',
    name: 'IPP',
    lat: 52.0599,
    lon: -9.5045,
    irish_grid_e: 480000,
    irish_grid_n: 580000,
    display_order: 0,
    label_size: 14,
  } as const
  const SAMPLE_DRAWING = {
    type: 'search_area',
    name: 'Sector A',
    display_order: 0,
    geometry_json: '{"type":"Polygon","coordinates":[]}',
  } as const
  const SAMPLE_HELICOPTER = {
    slot_key: 'slot_1',
    call_sign: 'Rescue 115',
    lat: 52.06,
    lon: -9.5,
  } as const
  const SAMPLE_GPX = {
    source_path: '/tmp/track.gpx',
    file_name: 'track.gpx',
    display_name: 'Ridge Track',
    geometry_json: '{"type":"LineString","coordinates":[]}',
  } as const

  it('emits device events only for first contact or a real operator-visible change [DON-245]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Device Mission' })

    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
      last_seen: '2026-07-10T12:00:05.000Z',
    })
    const lastSeenOnly = await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
      last_seen: '2026-07-10T12:00:10.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One Renamed',
      color: '#00AAFF',
      status: 'online',
    })

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(types.filter((type) => type === 'device_created')).toHaveLength(1)
    expect(types.filter((type) => type === 'device_updated')).toHaveLength(1)
    expect(lastSeenOnly.last_seen).toBe('2026-07-10T12:00:10.000Z')

    // device_created is NOT telemetry, so it surfaces in the default review feed; the
    // subsequent device_updated is telemetry and must be filtered out.
    const auditTypes = (await store.listAuditEvents(mission.id)).map((event) => event.event_type)
    expect(auditTypes).toContain('device_created')
    expect(auditTypes).not.toContain('device_updated')
  })

  it('bulk upserts persist last_seen but emit updates only for real changes [DON-245]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Bulk Device Mission' })

    // Pre-existing device so the batch exercises both the created and updated event paths.
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-1',
      name: 'Tracker One',
      color: '#00AAFF',
      status: 'unknown',
    })

    const result = await store.upsertDevicesBulk({
      mission_id: mission.id,
      devices: [
        { device_id: 'tracker-1', name: 'Tracker One Renamed', color: '#00AAFF', status: 'online' },
        { device_id: 'tracker-2', name: 'Tracker Two', color: '#FF8800', status: 'online' },
        { device_id: 'tracker-3', name: 'Tracker Three', color: '#22CC66', status: 'unknown' },
      ],
    })

    expect(result.map((device) => device.device_id)).toEqual(['tracker-1', 'tracker-2', 'tracker-3'])

    const devices = await store.listDevices(mission.id)
    expect(devices).toHaveLength(3)

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    // tracker-1 already existed (1 created earlier) → this batch: 1 update + 2 creates.
    expect(types.filter((type) => type === 'device_created')).toHaveLength(3)
    expect(types.filter((type) => type === 'device_updated')).toHaveLength(1)

    await store.upsertDevicesBulk({
      mission_id: mission.id,
      devices: [
        {
          device_id: 'tracker-1',
          name: 'Tracker One Renamed',
          color: '#00AAFF',
          status: 'online',
          last_seen: '2026-07-10T12:05:00.000Z',
        },
        {
          device_id: 'tracker-2',
          name: 'Tracker Two',
          color: '#FF8800',
          status: 'online',
          last_seen: '2026-07-10T12:05:00.000Z',
        },
        {
          device_id: 'tracker-3',
          name: 'Tracker Three',
          color: '#22CC66',
          status: 'unknown',
          last_seen: '2026-07-10T12:05:00.000Z',
        },
      ],
    })

    const typesAfterUnchangedPoll = (await store.listMissionEvents(mission.id)).map(
      (event) => event.event_type,
    )
    expect(typesAfterUnchangedPoll.filter((type) => type === 'device_updated')).toHaveLength(1)
    const trackerTwo = (await store.listDevices(mission.id)).find(
      (device: { readonly device_id: string }) => device.device_id === 'tracker-2',
    )
    expect(trackerTwo).toMatchObject({ last_seen: '2026-07-10T12:05:00.000Z' })
  })

  it('flushes backup diagnostic phases and aggregate tracking metrics without operational identity [DON-244]', async () => {
    const operation = { id: 'backup-operation', type: 'backup' as const, requestedAtMs: 10 }
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(() => operation),
      requested: vi.fn().mockResolvedValue(undefined),
      started: vi.fn().mockResolvedValue(undefined),
      phase: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
      startMission: vi.fn().mockResolvedValue(undefined),
      recordTrackingBatch: vi.fn().mockResolvedValue(undefined),
      recordInsertedPositions: vi.fn().mockResolvedValue(undefined),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({
      name: 'Private Mission Name',
      start_time: '2026-07-10T12:00:00.000Z',
    })
    await store.upsertDevicesBulk({
      mission_id: mission.id,
      devices: [
        { device_id: 'private-device', name: 'Private Device', color: '#00AAFF', status: 'online' },
      ],
    })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [
        {
          device_id: 'private-device',
          lat: 52.0,
          lon: -9.5,
          timestamp: '2026-07-10T12:00:30.000Z',
        },
      ],
    })
    await store.syncBackup('interval')

    expect(storageDiagnostics.startMission).toHaveBeenCalledWith({
      startedAt: '2026-07-10T12:00:00.000Z',
    })
    expect(storageDiagnostics.recordTrackingBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceCount: 1,
        changedDeviceEventCount: 0,
      }),
    )
    expect(storageDiagnostics.recordTrackingBatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ missionId: expect.anything(), deviceId: expect.anything() }),
    )
    expect(storageDiagnostics.recordInsertedPositions).toHaveBeenCalledWith(
      expect.objectContaining({
        insertedPositionCount: 1,
        positionTelemetryEventCount: 0,
      }),
    )
    expect(storageDiagnostics.requested).toHaveBeenCalledWith(operation, {
      queueDepth: 1,
      trigger: 'interval',
    })
    expect(storageDiagnostics.started).toHaveBeenCalledWith(operation)
    expect(vi.mocked(storageDiagnostics.phase).mock.calls.map((call) => call[1])).toEqual([
      'copied',
      'sanity_check_started',
      'sanity_checked',
      'renamed',
    ])
    expect(storageDiagnostics.completed).toHaveBeenCalledWith(operation)
    expect(storageDiagnostics.failed).not.toHaveBeenCalled()
  })

  it('keeps mission backup fail-open when diagnostics cannot create an operation token [DON-244]', async () => {
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(() => {
        throw new Error('diagnostics unavailable')
      }),
      requested: vi.fn(),
      started: vi.fn(),
      phase: vi.fn(),
      completed: vi.fn(),
      failed: vi.fn(),
      startMission: vi.fn(),
      recordTrackingBatch: vi.fn(),
      recordInsertedPositions: vi.fn(),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({ name: 'Diagnostics Failure Mission' })

    await expect(store.syncBackup('interval')).resolves.toBe(
      path.join(userDataPath!, 'mission-store.backup.sqlite'),
    )
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type)).toContain(
      'mission_backup_synced',
    )
  })

  it('emits create/update/delete audit events for markers, drawings, helicopters, and GPX imports (DON-163)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Audit Trail Mission' })

    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    await store.upsertMarker({ id: marker.id, mission_id: mission.id, ...SAMPLE_MARKER, name: 'IPP edited' })
    await store.deleteMarker(marker.id)

    const drawing = await store.upsertDrawing({ mission_id: mission.id, ...SAMPLE_DRAWING })
    await store.upsertDrawing({ id: drawing.id, mission_id: mission.id, ...SAMPLE_DRAWING, name: 'Sector A edited' })
    await store.deleteDrawing(drawing.id)

    const helicopter = await store.upsertHelicopter({ mission_id: mission.id, ...SAMPLE_HELICOPTER })
    await store.upsertHelicopter({ mission_id: mission.id, ...SAMPLE_HELICOPTER, call_sign: 'Rescue 116' })
    await store.deleteHelicopter(helicopter.id)

    const gpx = await store.upsertGpxImport({ mission_id: mission.id, ...SAMPLE_GPX })
    await store.updateGpxImportPresentation({
      id: gpx.id, mission_id: mission.id, display_name: 'Ridge Track edited',
    })
    await store.deleteGpxImport(gpx.id)

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(types).toEqual(
      expect.arrayContaining([
        'marker_created',
        'marker_updated',
        'marker_deleted',
        'drawing_created',
        'drawing_updated',
        'drawing_deleted',
        'helicopter_created',
        'helicopter_updated',
        'helicopter_deleted',
        'gpx_import_created',
        'gpx_import_presentation_updated',
        'gpx_import_deleted',
      ]),
    )

    // These are all non-telemetry, so they surface in the default review feed.
    const auditTypes = (await store.listAuditEvents(mission.id, { limit: 5000 })).map(
      (event) => event.event_type,
    )
    expect(auditTypes).toContain('marker_deleted')
    expect(auditTypes).toContain('drawing_created')
    expect(auditTypes).toContain('helicopter_updated')
    expect(auditTypes).toContain('gpx_import_deleted')
  })

  it('keeps marker, drawing, and GPX creation timestamps immutable across edits [DON-231]', async () => {
    vi.useFakeTimers()
    store = await createStore()
    const mission = await store.createMission({ name: 'Immutable Timestamp Mission' })

    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'))
    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    const drawing = await store.upsertDrawing({ mission_id: mission.id, ...SAMPLE_DRAWING })
    const gpx = await store.upsertGpxImport({ mission_id: mission.id, ...SAMPLE_GPX })

    const createdMarker = await store.getMarker(marker.id)
    const createdDrawing = await store.getDrawing(drawing.id)
    const createdGpx = (await store.listGpxImports(mission.id)).find((row) => row.id === gpx.id)
    expect(createdGpx).toBeDefined()

    vi.setSystemTime(new Date('2026-07-06T13:00:00.000Z'))
    await store.upsertMarker({
      id: marker.id,
      mission_id: mission.id,
      ...SAMPLE_MARKER,
      name: 'IPP edited',
    })
    await store.upsertDrawing({
      id: drawing.id,
      mission_id: mission.id,
      ...SAMPLE_DRAWING,
      name: 'Sector A edited',
    })
    await store.updateGpxImportPresentation({
      id: gpx.id,
      mission_id: mission.id,
      display_name: 'Ridge Track edited',
    })

    const editedMarker = await store.getMarker(marker.id)
    const editedDrawing = await store.getDrawing(drawing.id)
    const editedGpx = (await store.listGpxImports(mission.id)).find((row) => row.id === gpx.id)
    expect(editedGpx).toBeDefined()

    expect(editedMarker).toMatchObject({
      mission_id: mission.id,
      name: 'IPP edited',
      created_at: createdMarker.created_at,
      updated_at: '2026-07-06T13:00:00.000Z',
    })
    expect(editedDrawing).toMatchObject({
      mission_id: mission.id,
      name: 'Sector A edited',
      created_at: createdDrawing.created_at,
      updated_at: '2026-07-06T13:00:00.000Z',
    })
    expect(editedGpx).toMatchObject({
      mission_id: mission.id,
      display_name: 'Ridge Track edited',
      imported_at: createdGpx!.imported_at,
      updated_at: '2026-07-06T13:00:00.000Z',
    })
  })

  it('writes the audit event atomically with the row so neither lands alone (DON-163)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Atomic Mission' })
    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })

    const beforeDelete = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'marker_deleted',
    )
    expect(beforeDelete).toHaveLength(0)

    await store.deleteMarker(marker.id)
    const afterDelete = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'marker_deleted',
    )
    expect(afterDelete).toHaveLength(1)
  })

  it('does not emit a delete event when the row does not exist (DON-163)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'No-op Delete Mission' })

    await expect(store.deleteMarker('does-not-exist')).resolves.toBe(false)
    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(types).not.toContain('marker_deleted')
  })

  // --- DON-161: writable guard on deletes ---

  it('refuses to delete records from a finished mission and preserves them (DON-161)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Locked Mission' })

    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    const drawing = await store.upsertDrawing({ mission_id: mission.id, ...SAMPLE_DRAWING })
    const helicopter = await store.upsertHelicopter({ mission_id: mission.id, ...SAMPLE_HELICOPTER })
    const gpx = await store.upsertGpxImport({ mission_id: mission.id, ...SAMPLE_GPX })

    await store.finishMission(mission.id)

    await expect(store.deleteMarker(marker.id)).rejects.toThrow(/finished mission/)
    await expect(store.deleteDrawing(drawing.id)).rejects.toThrow(/finished mission/)
    await expect(store.deleteHelicopter(helicopter.id)).rejects.toThrow(/finished mission/)
    await expect(store.deleteGpxImport(gpx.id)).rejects.toThrow(/finished mission/)

    // The locked records must survive the refused deletes.
    await expect(store.listMarkers(mission.id)).resolves.toHaveLength(1)
    await expect(store.listDrawings(mission.id)).resolves.toHaveLength(1)
    await expect(store.listHelicopters(mission.id)).resolves.toHaveLength(1)
    await expect(store.listGpxImports(mission.id)).resolves.toHaveLength(1)
  })

  it('refuses to delete records from a finalized mission (DON-161)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Finalized Mission' })
    const marker = await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })

    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)

    await expect(store.deleteMarker(marker.id)).rejects.toThrow(/finalized mission|finished mission/)
    await expect(store.listMarkers(mission.id)).resolves.toHaveLength(1)
  })

  // --- DON-162: real per-mission archive + finalize event sequence ---

  it('writes a real, standalone per-mission archive zip on finalize (DON-162)', async () => {
    const { readZipArchive } = require('../../electron/zip-archive.cjs') as {
      readonly readZipArchive: (buffer: Buffer) => ReadonlyMap<string, Buffer>
    }

    store = await createStore()
    const mission = await store.createMission({ name: 'Archive Mission' })
    await store.upsertMarker({ mission_id: mission.id, ...SAMPLE_MARKER })
    await store.finishMission(mission.id)

    const result = await store.finalizeMission(mission.id)
    const archivePath = result.archive.archive_path

    // The archive must be a real, standalone file — NOT the shared rolling backup.
    expect(archivePath).not.toBe(path.join(userDataPath!, 'mission-store.backup.sqlite'))
    expect(path.dirname(archivePath)).toBe(path.join(userDataPath!, 'archives'))
    const { access } = await import('node:fs/promises')
    await expect(access(archivePath)).resolves.toBeUndefined()

    const { readFile } = await import('node:fs/promises')
    const entries = readZipArchive(await readFile(archivePath))
    expect([...entries.keys()]).toEqual(
      expect.arrayContaining(['manifest.json', 'mission.json', 'mission-store.sqlite']),
    )
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8'))
    expect(manifest.mission_id).toBe(mission.id)
    const archivedMission = JSON.parse(entries.get('mission.json')!.toString('utf8'))
    expect(archivedMission.id).toBe(mission.id)
    expect(entries.get('mission-store.sqlite')!.length).toBeGreaterThan(0)
  })

  it('fences finished-mission bookkeeping while the final archive snapshot is being sealed [DON-278]', async () => {
    const { readZipArchive } = require('../../electron/zip-archive.cjs') as {
      readonly readZipArchive: (buffer: Buffer) => ReadonlyMap<string, Buffer>
    }
    let releaseCopied = () => undefined
    let signalCopied = () => undefined
    const copied = new Promise<void>((resolve) => { signalCopied = resolve })
    const holdCopied = new Promise<void>((resolve) => { releaseCopied = resolve })
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(() => ({
        id: 'finalization-fence-backup', type: 'backup', requestedAtMs: Date.now(),
      })),
      requested: vi.fn().mockResolvedValue(undefined),
      started: vi.fn().mockResolvedValue(undefined),
      phase: vi.fn(async (_operation, stage) => {
        if (stage === 'copied') {
          signalCopied()
          await holdCopied
        }
      }),
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
      startMission: vi.fn().mockResolvedValue(undefined),
      recordTrackingBatch: vi.fn().mockResolvedValue(undefined),
      recordInsertedPositions: vi.fn().mockResolvedValue(undefined),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({ name: 'Finalization Fence Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Before' })
    await store.finishMission(mission.id)

    const finalization = store.finalizeMission(mission.id)
    await copied
    await expect(store.renameOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      label: 'After',
    })).rejects.toThrow(/finalization is in progress/iu)
    releaseCopied()
    const result = await finalization

    expect(await store.listOutings(mission.id)).toEqual([
      expect.objectContaining({ id: outing.id, label: 'Before' }),
    ])
    const archiveEntries = readZipArchive(await (await import('node:fs/promises')).readFile(
      result.archive.archive_path,
    ))
    const archivedDatabasePath = path.join(userDataPath!, 'archived-finalization-fence.sqlite')
    await writeFile(archivedDatabasePath, archiveEntries.get('mission-store.sqlite')!)
    const archivedDatabase = new Database(archivedDatabasePath, { readonly: true })
    expect(archivedDatabase.prepare('SELECT label FROM outings WHERE id = ?').get(outing.id))
      .toMatchObject({ label: 'Before' })
    archivedDatabase.close()
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
  })

  it('fences finished-mission corrections while a direct archive snapshot is being sealed [DON-274]', async () => {
    const { readZipArchive } = require('../../electron/zip-archive.cjs') as {
      readonly readZipArchive: (buffer: Buffer) => ReadonlyMap<string, Buffer>
    }
    let releaseCopied = () => undefined
    let signalCopied = () => undefined
    const copied = new Promise<void>((resolve) => { signalCopied = resolve })
    const holdCopied = new Promise<void>((resolve) => { releaseCopied = resolve })
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(() => ({
        id: 'direct-archive-fence-backup', type: 'backup', requestedAtMs: Date.now(),
      })),
      requested: vi.fn().mockResolvedValue(undefined),
      started: vi.fn().mockResolvedValue(undefined),
      phase: vi.fn(async (_operation, stage) => {
        if (stage === 'copied') {
          signalCopied()
          await holdCopied
        }
      }),
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
      startMission: vi.fn().mockResolvedValue(undefined),
      recordTrackingBatch: vi.fn().mockResolvedValue(undefined),
      recordInsertedPositions: vi.fn().mockResolvedValue(undefined),
    }
    store = await createStore({ storageDiagnostics })
    const mission = await store.createMission({ name: 'Direct Archive Fence Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Before' })
    await store.finishMission(mission.id)

    const archivePromise = store.createMissionArchive(mission.id)
    await copied
    await expect(store.renameOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      label: 'After',
    })).rejects.toThrow(/finalization is in progress/iu)
    releaseCopied()
    const archive = await archivePromise

    expect(await store.listOutings(mission.id)).toEqual([
      expect.objectContaining({ id: outing.id, label: 'Before' }),
    ])
    const archiveEntries = readZipArchive(await (await import('node:fs/promises')).readFile(
      archive.archive_path,
    ))
    const archivedDatabasePath = path.join(userDataPath!, 'archived-direct-fence.sqlite')
    await writeFile(archivedDatabasePath, archiveEntries.get('mission-store.sqlite')!)
    const archivedDatabase = new Database(archivedDatabasePath, { readonly: true })
    expect(archivedDatabase.prepare('SELECT label FROM outings WHERE id = ?').get(outing.id))
      .toMatchObject({ label: 'Before' })
    archivedDatabase.close()
    await expect(store.renameOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      label: 'After archive',
    })).resolves.toMatchObject({ label: 'After archive' })
  })

  it('does not overwrite an earlier mission archive when a later mission finalizes (DON-162)', async () => {
    const { readFile } = await import('node:fs/promises')
    store = await createStore()

    const first = await store.createMission({ name: 'First Mission' })
    await store.finishMission(first.id)
    const firstArchive = (await store.finalizeMission(first.id)).archive.archive_path
    const firstBytes = await readFile(firstArchive)

    const second = await store.createMission({ name: 'Second Mission' })
    await store.finishMission(second.id)
    const secondArchive = (await store.finalizeMission(second.id)).archive.archive_path

    expect(secondArchive).not.toBe(firstArchive)
    // The first archive must still exist, unmodified, after the second finalize.
    await expect(readFile(firstArchive)).resolves.toEqual(firstBytes)
  })

  it('emits the full finalize event sequence matching Rust (DON-162)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Finalize Sequence Mission' })
    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)

    const types = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    const finalizeSlice = types.filter((type) =>
      [
        'mission_finished',
        'mission_finalize_requested',
        'mission_archive_succeeded',
        'mission_finalized',
      ].includes(type),
    )
    expect(finalizeSlice).toEqual([
      'mission_finished',
      'mission_finalize_requested',
      'mission_archive_succeeded',
      'mission_finalized',
    ])
  })

  it('recovers idempotently when finalization is interrupted after archive success [DON-209]', async () => {
    store = await createStore({
      finalizeMissionFaultInjection: {
        afterArchiveSucceededEvent: true,
      },
    })
    const mission = await store.createMission({ name: 'Interrupted Finalize Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Before retry' })
    await store.finishMission(mission.id)

    await expect(store.finalizeMission(mission.id)).rejects.toThrow(
      /Injected finalize interruption after archive success/,
    )
    expect((await store.listMissions()).find((entry) => entry.id === mission.id)?.status).toBe(
      'finished',
    )
    let eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes.filter((eventType) => eventType === 'mission_archive_succeeded')).toHaveLength(1)
    expect(eventTypes).not.toContain('mission_finalized')
    await expect(store.renameOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      label: 'Stale after archive',
    })).rejects.toThrow(/finalization is in progress/iu)

    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })

    const retry = await store.finalizeMission(mission.id)

    expect(retry.mission.status).toBe('finalized')
    eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes.filter((eventType) => eventType === 'mission_archive_succeeded')).toHaveLength(1)
    expect(eventTypes.filter((eventType) => eventType === 'mission_finalized')).toHaveLength(1)
  })

  it('revalidates a recoverable finalization archive before sealing the mission [DON-278]', async () => {
    const { readZipArchive } = require('../../electron/zip-archive.cjs') as {
      readonly readZipArchive: (buffer: Buffer) => ReadonlyMap<string, Buffer>
    }
    const { readFile } = await import('node:fs/promises')
    store = await createStore({
      finalizeMissionFaultInjection: {
        afterArchiveSucceededEvent: true,
      },
    })
    const mission = await store.createMission({ name: 'Corrupted Recoverable Archive Mission' })
    await store.finishMission(mission.id)

    await expect(store.finalizeMission(mission.id)).rejects.toThrow(
      /Injected finalize interruption after archive success/,
    )
    const succeededEvent = (await store.listMissionEvents(mission.id)).find(
      (event) => event.event_type === 'mission_archive_succeeded',
    )
    const corruptedArchivePath = JSON.parse(succeededEvent?.details_json ?? '{}').archive_path as string
    await writeFile(corruptedArchivePath, 'truncated archive')
    store.close()
    store = createElectronMissionStore({ userDataPath: userDataPath! })

    const retry = await store.finalizeMission(mission.id)

    expect(retry.mission.status).toBe('finalized')
    const recoveredEntries = readZipArchive(await readFile(retry.archive.archive_path))
    expect(recoveredEntries.get('mission-store.sqlite')?.length).toBeGreaterThan(0)
  })

  it('fences authorized and denied unlock writes while a direct archive is being sealed [DON-278]', async () => {
    let releaseCopied = () => undefined
    let signalCopied = () => undefined
    const copied = new Promise<void>((resolve) => { signalCopied = resolve })
    const holdCopied = new Promise<void>((resolve) => { releaseCopied = resolve })
    const storageDiagnostics: StorageDiagnosticsPort = {
      createOperation: vi.fn(() => ({
        id: 'direct-archive-unlock-fence', type: 'backup', requestedAtMs: Date.now(),
      })),
      requested: vi.fn().mockResolvedValue(undefined),
      started: vi.fn().mockResolvedValue(undefined),
      phase: vi.fn(async (_operation, stage) => {
        if (stage === 'copied') {
          signalCopied()
          await holdCopied
        }
      }),
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
      startMission: vi.fn().mockResolvedValue(undefined),
      recordTrackingBatch: vi.fn().mockResolvedValue(undefined),
      recordInsertedPositions: vi.fn().mockResolvedValue(undefined),
    }
    store = await createStore({ readAdminRoster: async () => ['Duty Admin'] })
    const mission = await store.createMission({ name: 'Direct Archive Unlock Fence Mission' })
    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)
    store.close()
    store = createElectronMissionStore({
      userDataPath: userDataPath!,
      storageDiagnostics,
      readAdminRoster: async () => ['Duty Admin'],
    })
    const beforeDenied = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'mission_unlock_denied',
    ).length

    const archivePromise = store.createMissionArchive(mission.id)
    await copied
    await expect(store.unlockFinalizedMission({
      mission_id: mission.id,
      admin_name: 'Not An Admin',
      reason: 'Must not append outside the archive snapshot.',
    })).rejects.toThrow(/finalization is in progress/iu)
    await expect(store.unlockFinalizedMission({
      mission_id: mission.id,
      admin_name: 'Duty Admin',
      reason: 'Must not change status outside the archive snapshot.',
    })).rejects.toThrow(/finalization is in progress/iu)
    expect((await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'mission_unlock_denied',
    )).toHaveLength(beforeDenied)
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
    releaseCopied()
    await expect(archivePromise).resolves.toMatchObject({ mission_id: mission.id })
  })

  it('releases the bookkeeping fence when archive creation fails before success [DON-278]', async () => {
    store = await createStore({
      archiveFaultInjection: { corruptSnapshotBeforeZip: true },
    })
    const mission = await store.createMission({ name: 'Failed Finalize Fence Mission' })
    const outing = await store.createOuting({ mission_id: mission.id, label: 'Before failure' })
    await store.finishMission(mission.id)

    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/SQLite snapshot/iu)
    await expect(store.renameOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      label: 'Correction after failure',
    })).resolves.toMatchObject({ label: 'Correction after failure' })
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
  })

  it('rejects a stale evidence-loss acknowledgement after finalization wins the async race [DON-278]', async () => {
    let releaseRoster = () => undefined
    let signalRosterRead = () => undefined
    const rosterRead = new Promise<void>((resolve) => { signalRosterRead = resolve })
    const roster = new Promise<readonly string[]>((resolve) => {
      releaseRoster = () => resolve([])
    })
    store = await createStore({
      readAdminRoster: async () => {
        signalRosterRead()
        return roster
      },
    })
    const mission = await store.createMission({ name: 'Acknowledgement Finalize Race' })
    await store.finishMission(mission.id)

    const acknowledgement = store.acknowledgeIngestEvidenceLoss({
      mission_id: mission.id,
      admin_name: 'Stale Admin',
      reason: 'Must not write after the archive snapshot.',
    })
    await rosterRead
    await expect(store.finalizeMission(mission.id)).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    releaseRoster()

    await expect(acknowledgement).rejects.toThrow(/unavailable after finalization/iu)
    const eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes).not.toContain('mission_evidence_loss_acknowledgement_denied')
    expect(eventTypes).not.toContain('mission_evidence_loss_acknowledged')
  })

  it('serializes concurrent finalize requests so a mission finalizes once with one archive [DON-232]', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Concurrent Finalize Mission' })
    await store.finishMission(mission.id)

    await expect(Promise.all([
      store.finalizeMission(mission.id),
      store.finalizeMission(mission.id),
    ])).resolves.toHaveLength(2)

    const eventTypes = (await store.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(eventTypes.filter((eventType) => eventType === 'mission_archive_succeeded')).toHaveLength(1)
    expect(eventTypes.filter((eventType) => eventType === 'mission_finalized')).toHaveLength(1)
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
  })

  it('rejects an idempotent finalize result when an authorized unlock wins archive validation [DON-278]', async () => {
    store = await createStore({ readAdminRoster: async () => ['Duty Admin'] })
    const mission = await store.createMission({ name: 'Idempotent Finalize Unlock Race' })
    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)
    store.close()

    let releaseArchiveRead = () => undefined
    let signalArchiveRead = () => undefined
    const archiveRead = new Promise<void>((resolve) => { signalArchiveRead = resolve })
    const holdArchiveRead = new Promise<void>((resolve) => { releaseArchiveRead = resolve })
    store = createElectronMissionStore({
      userDataPath: userDataPath!,
      readAdminRoster: async () => ['Duty Admin'],
      readArchiveFile: async (archivePath: string) => {
        signalArchiveRead()
        await holdArchiveRead
        return readFile(archivePath)
      },
    })

    const idempotentFinalize = store.finalizeMission(mission.id)
    await expect(Promise.race([
      archiveRead.then(() => 'reading'),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ])).resolves.toBe('reading')
    await expect(store.unlockFinalizedMission({
      mission_id: mission.id,
      admin_name: 'Duty Admin',
      reason: 'Correction while stale archive validation is pending.',
    })).resolves.toMatchObject({ status: 'finished' })
    releaseArchiveRead()

    await expect(idempotentFinalize).rejects.toThrow(/finalization changed/iu)
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
  })

  it('creates a fresh archive when a mission is unlocked and finalized again [DON-232]', async () => {
    store = await createStore({
      readAdminRoster: async () => ['Duty Admin'],
    })
    const mission = await store.createMission({
      name: 'Refinalize Mission',
      start_time: '2026-07-06T12:00:00.000Z',
    })
    await store.finishMission(mission.id)

    const firstFinalize = await store.finalizeMission(mission.id)

    await expect(
      store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Correction requested during review.',
      }),
    ).resolves.toMatchObject({ status: 'finished' })

    await new Promise((resolve) => setTimeout(resolve, 5))
    const secondFinalize = await store.finalizeMission(mission.id)

    expect(secondFinalize.archive.archive_path).not.toBe(firstFinalize.archive.archive_path)
    const archiveSucceededEvents = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'mission_archive_succeeded',
    )
    expect(archiveSucceededEvents).toHaveLength(2)
    expect(
      archiveSucceededEvents.map((event) => JSON.parse(event.details_json ?? '{}').archive_path),
    ).toEqual([firstFinalize.archive.archive_path, secondFinalize.archive.archive_path])
  })

  it('rejects a stale admin unlock after another unlock and re-finalization [DON-278]', async () => {
    let releaseFirstRoster = () => undefined
    let releaseSecondRoster = () => undefined
    let rosterReads = 0
    let signalBothReads = () => undefined
    const bothReads = new Promise<void>((resolve) => { signalBothReads = resolve })
    const firstRoster = new Promise<readonly string[]>((resolve) => {
      releaseFirstRoster = () => resolve(['Duty Admin'])
    })
    const secondRoster = new Promise<readonly string[]>((resolve) => {
      releaseSecondRoster = () => resolve(['Duty Admin'])
    })
    store = await createStore({
      readAdminRoster: async () => {
        rosterReads += 1
        if (rosterReads === 2) signalBothReads()
        return rosterReads === 1 ? firstRoster : secondRoster
      },
    })
    const mission = await store.createMission({ name: 'Concurrent Unlock Mission' })
    await store.finishMission(mission.id)
    await store.finalizeMission(mission.id)

    const unlocks = [
      store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'First correction request.',
      }),
      store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Second correction request.',
      }),
    ]
    await bothReads
    releaseFirstRoster()
    await expect(unlocks[0]).resolves.toMatchObject({ status: 'finished' })
    await expect(store.finalizeMission(mission.id)).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    releaseSecondRoster()

    await expect(unlocks[1]).rejects.toThrow(/finalization changed|only finalized/iu)
    const unlockEvents = (await store.listMissionEvents(mission.id)).filter(
      (event) => event.event_type === 'mission_unlocked',
    )
    expect(unlockEvents).toHaveLength(1)
    await expect(store.getMission(mission.id)).resolves.toMatchObject({ status: 'finalized' })
  })

  it('createMissionArchive builds an archive for a finished mission (DON-162 / DON-34)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Direct Archive Mission' })
    await store.finishMission(mission.id)

    const archive = await store.createMissionArchive(mission.id)
    expect(archive.mission_id).toBe(mission.id)
    expect(path.dirname(archive.archive_path)).toBe(path.join(userDataPath!, 'archives'))
    const { access } = await import('node:fs/promises')
    await expect(access(archive.archive_path)).resolves.toBeUndefined()
  })

  it('createMissionArchive refuses missions that are not finished or finalized (DON-162)', async () => {
    store = await createStore()
    const mission = await store.createMission({ name: 'Active Archive Mission' })
    await expect(store.createMissionArchive(mission.id)).rejects.toThrow(
      /finished or finalized/,
    )
  })

  async function createStore(options: {
    readonly readAdminRoster?: () => Promise<readonly string[]>
    readonly backupFaultInjection?: {
      readonly afterTemporaryBackup?: boolean
      readonly corruptTemporarySnapshotBeforeSanityCheck?: boolean
    }
    readonly archiveFaultInjection?: {
      readonly corruptSnapshotBeforeZip?: boolean
    }
    readonly finalizeMissionFaultInjection?: {
      readonly afterArchiveSucceededEvent?: boolean
    }
    readonly readArchiveFile?: (archivePath: string) => Promise<Buffer>
    readonly ingestEvidenceFaultInjection?: {
      readonly failStage?: boolean
      readonly failProjection?: boolean
      readonly failRemovalAfterProjection?: boolean
    }
    readonly storageDiagnostics?: StorageDiagnosticsPort
    readonly coverageLedgerFaultInjection?: { readonly afterWrite?: boolean }
    readonly runOutingFixSummaryInWorker?: (input: {
      readonly databasePath: string
      readonly query: { readonly missionId: string }
      readonly signal?: AbortSignal
    }) => Promise<{
      readonly outings: readonly { readonly outing_id: string; readonly accepted_fix_count: number }[]
      readonly unassigned_accepted_fix_count: number
      readonly total_accepted_fix_count: number
    }>
  } = {}): Promise<ElectronMissionStore> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-mission-'))
    return createElectronMissionStore({ userDataPath, ...options })
  }

  function createRejectionEnvelope(deliveryId: string): RejectionEnvelope {
    return {
      deliveryId,
      anomalyKey: 'source:123',
      deviceId: 'tracker-1',
      sourcePositionId: '123',
      reasonClass: 'invalid_coordinates',
      receivedAt: '2026-08-22T10:00:00.000Z',
      canonicalEvidence: {
        content_fingerprint: '0123456789abcdef',
        source_position_id: '123',
        device_id: 'tracker-1',
        latitude: 200,
      },
    }
  }
})
