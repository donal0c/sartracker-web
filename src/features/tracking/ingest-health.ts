export type CurrentPositionRejectionReason =
  | 'invalid_coordinates'
  | 'invalid_identity'
  | 'invalid_numeric_field'
  | 'invalid_timestamp'
  | 'invalid_validity'
  | 'invalid_text_field'
  | 'unknown'

export type CurrentPositionRejection = {
  readonly deviceId: string | null
  readonly reason: CurrentPositionRejectionReason
  readonly rowIndex: number
}

export type DeviceIngestHealth = {
  readonly count: number
  readonly lastReason: CurrentPositionRejectionReason
}

export type CurrentPositionIngestHealthSummary = {
  readonly totalRejected: number
  readonly affectedDeviceCount: number
  readonly unidentifiedRejected: number
  readonly byDevice: Readonly<Record<string, DeviceIngestHealth>>
}

export const EMPTY_CURRENT_POSITION_INGEST_HEALTH: CurrentPositionIngestHealthSummary = {
  totalRejected: 0,
  affectedDeviceCount: 0,
  unidentifiedRejected: 0,
  byDevice: {},
}

/**
 * Aggregates one poll's structured normalization rejections for operator display.
 */
export function summarizeCurrentPositionRejections(
  rejections: readonly CurrentPositionRejection[],
): CurrentPositionIngestHealthSummary {
  if (rejections.length === 0) {
    return EMPTY_CURRENT_POSITION_INGEST_HEALTH
  }

  const byDevice: Record<string, DeviceIngestHealth> = {}
  let unidentifiedRejected = 0
  for (const rejection of rejections) {
    if (rejection.deviceId === null) {
      unidentifiedRejected += 1
      continue
    }
    const previous = byDevice[rejection.deviceId]
    byDevice[rejection.deviceId] = {
      count: (previous?.count ?? 0) + 1,
      lastReason: rejection.reason,
    }
  }

  return {
    totalRejected: rejections.length,
    affectedDeviceCount: Object.keys(byDevice).length,
    unidentifiedRejected,
    byDevice,
  }
}

/**
 * Converts a normalized rejection reason into concise operator-facing wording.
 */
export function formatCurrentPositionRejectionReason(
  reason: CurrentPositionRejectionReason,
): string {
  switch (reason) {
    case 'invalid_coordinates':
      return 'invalid coordinates'
    case 'invalid_identity':
      return 'invalid device or position identity'
    case 'invalid_numeric_field':
      return 'invalid numeric data'
    case 'invalid_timestamp':
      return 'invalid fix timestamp'
    case 'invalid_validity':
      return 'invalid fix validity'
    case 'invalid_text_field':
      return 'invalid text data'
    case 'unknown':
      return 'unrecognized position data'
  }
}
