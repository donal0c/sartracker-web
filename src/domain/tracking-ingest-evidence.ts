export type IngestEvidenceHealth = {
  readonly state: 'healthy' | 'degraded' | 'critical'
  readonly reason: string | null
  readonly pendingCount: number
  readonly corruptCount: number
  readonly conflictCount: number
  readonly rejectedCount: number
  readonly affectedDeviceCount: number
  readonly conflictDeviceIds: readonly string[]
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
