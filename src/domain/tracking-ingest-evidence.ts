export type IngestEvidenceLossReason =
  | 'mission_persistence_failed'
  | 'renderer_pending_capacity_exhausted'
  | 'renderer_pending_evidence_lost'

export type AcknowledgedIngestEvidenceLoss = {
  readonly adminName: string
  readonly reason: string
  readonly acknowledgedAt: string
}

export type AcknowledgeIngestEvidenceLossInput = {
  readonly mission_id: string
  readonly admin_name: string
  readonly reason: string
}

export type IngestEvidenceHealth = {
  readonly state: 'healthy' | 'degraded' | 'critical'
  readonly reason: string | null
  readonly pendingCount: number
  readonly corruptCount: number
  readonly conflictCount: number
  readonly rejectedCount: number
  readonly affectedDeviceCount: number
  readonly conflictDeviceIds: readonly string[]
  readonly acknowledgedLoss?: AcknowledgedIngestEvidenceLoss
}

export const EMPTY_INGEST_EVIDENCE_HEALTH: IngestEvidenceHealth = {
  state: 'healthy',
  reason: null,
  pendingCount: 0,
  corruptCount: 0,
  conflictCount: 0,
  rejectedCount: 0,
  affectedDeviceCount: 0,
  conflictDeviceIds: [],
}
