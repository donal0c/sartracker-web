import type {
  AcknowledgeIngestEvidenceLossInput,
  IngestEvidenceHealth,
  IngestEvidenceLossReason,
} from '../../domain/tracking-ingest-evidence'

export type BrowserEvidenceLossState = {
  readonly reason: IngestEvidenceLossReason
  readonly generation: number
  readonly acknowledgement?: {
    readonly generation: number
    readonly adminName: string
    readonly reason: string
    readonly acknowledgedAt: string
  }
}

export type BrowserEvidenceLossByMission = Readonly<
  Record<string, BrowserEvidenceLossState>
>

/** Records a new loss occurrence and invalidates any earlier acknowledgement. */
export function recordBrowserEvidenceLoss(
  current: BrowserEvidenceLossByMission,
  missionId: string,
  reason: IngestEvidenceLossReason,
): BrowserEvidenceLossByMission {
  return {
    ...current,
    [missionId]: {
      reason,
      generation: (current[missionId]?.generation ?? 0) + 1,
    },
  }
}

/** Attaches an admin audit identity to the current exact loss occurrence. */
export function acknowledgeBrowserEvidenceLoss(
  current: BrowserEvidenceLossByMission,
  input: AcknowledgeIngestEvidenceLossInput,
  acknowledgedAt: string,
): BrowserEvidenceLossByMission {
  const evidenceLoss = current[input.mission_id]
  if (evidenceLoss === undefined) {
    throw new Error('No isolated mission evidence loss is available to acknowledge.')
  }
  return {
    ...current,
    [input.mission_id]: {
      ...evidenceLoss,
      acknowledgement: {
        generation: evidenceLoss.generation,
        adminName: input.admin_name,
        reason: input.reason,
        acknowledgedAt,
      },
    },
  }
}

/** Returns true until the current loss generation has an exact acknowledgement. */
export function hasUnacknowledgedBrowserEvidenceLoss(
  current: BrowserEvidenceLossByMission,
  missionId: string,
): boolean {
  const evidenceLoss = current[missionId]
  return evidenceLoss !== undefined &&
    evidenceLoss.acknowledgement?.generation !== evidenceLoss.generation
}

/** Maps browser-only evidence state into the production health shape. */
export function readBrowserEvidenceHealth(
  current: BrowserEvidenceLossByMission,
  missionId?: string,
): IngestEvidenceHealth {
  const evidenceLoss = missionId === undefined
    ? Object.values(current)[0]
    : current[missionId]
  if (evidenceLoss === undefined) {
    return {
      state: 'healthy',
      reason: null,
      pendingCount: 0,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 0,
      affectedDeviceCount: 0,
      conflictDeviceIds: [],
    }
  }
  const acknowledgement = evidenceLoss.acknowledgement?.generation === evidenceLoss.generation
    ? evidenceLoss.acknowledgement
    : undefined
  return {
    state: 'critical',
    reason: evidenceLoss.reason,
    pendingCount: 0,
    corruptCount: 0,
    conflictCount: 0,
    rejectedCount: 0,
    affectedDeviceCount: 0,
    conflictDeviceIds: [],
    ...(acknowledgement === undefined
      ? {}
      : {
          acknowledgedLoss: {
            adminName: acknowledgement.adminName,
            reason: acknowledgement.reason,
            acknowledgedAt: acknowledgement.acknowledgedAt,
          },
        }),
  }
}

/** Retains only bounded, recognized loss state from browser session storage. */
export function readBrowserEvidenceLossState(input: unknown): BrowserEvidenceLossByMission {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return {}
  const result: Record<string, BrowserEvidenceLossState> = {}
  for (const [missionId, value] of Object.entries(input)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    const candidate = value as Partial<BrowserEvidenceLossState>
    if (
      !['renderer_pending_evidence_lost', 'renderer_pending_capacity_exhausted']
        .includes(candidate.reason ?? '') ||
      !Number.isSafeInteger(candidate.generation) ||
      Number(candidate.generation) < 1
    ) continue
    result[missionId] = candidate as BrowserEvidenceLossState
  }
  return result
}
