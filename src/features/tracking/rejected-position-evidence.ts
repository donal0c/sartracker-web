export const REJECTED_POSITION_EVIDENCE_MAX_BYTES_HYPOTHESIS = 8 * 1024

const MAX_RETAINED_TEXT_CHARACTERS_HYPOTHESIS = 512

type RetainedEvidenceValue = string | number | boolean | null | {
  readonly omitted: 'oversize_text' | 'structured_value' | 'unsupported_value'
  readonly length?: number
  readonly valueType?: string
}

export type RejectedPositionCanonicalEvidence = Readonly<{
  content_fingerprint: string
  source_position_id: string | null
  device_id: string | null
  latitude?: RetainedEvidenceValue
  longitude?: RetainedEvidenceValue
  altitude?: RetainedEvidenceValue
  speed?: RetainedEvidenceValue
  accuracy?: RetainedEvidenceValue
  fix_time?: RetainedEvidenceValue
  device_time?: RetainedEvidenceValue
  server_time?: RetainedEvidenceValue
  valid?: RetainedEvidenceValue
  protocol?: RetainedEvidenceValue
}>

export type RejectedPositionEvidence = {
  readonly anomalyKey: string
  readonly sourcePositionId: string | null
  readonly canonicalEvidence: RejectedPositionCanonicalEvidence
}

/**
 * Creates a bounded, deterministic description of a rejected parsed row. The
 * full parsed value contributes only to a transient fingerprint; raw content
 * is never retained by this module.
 */
export function createRejectedPositionEvidence(row: unknown): RejectedPositionEvidence {
  const contentFingerprint = fingerprint(stableSerialize(row))
  const record = isRecord(row) ? row : {}
  const sourcePositionId = readPositiveIdentity(record.id)
  const deviceId = readPositiveIdentity(record.deviceId)
  const canonicalEvidence: RejectedPositionCanonicalEvidence = {
    content_fingerprint: contentFingerprint,
    source_position_id: sourcePositionId,
    device_id: deviceId,
    ...retainIfPresent(record, 'latitude', 'latitude'),
    ...retainIfPresent(record, 'longitude', 'longitude'),
    ...retainIfPresent(record, 'altitude', 'altitude'),
    ...retainIfPresent(record, 'speed', 'speed'),
    ...retainIfPresent(record, 'accuracy', 'accuracy'),
    ...retainIfPresent(record, 'fixTime', 'fix_time'),
    ...retainIfPresent(record, 'deviceTime', 'device_time'),
    ...retainIfPresent(record, 'serverTime', 'server_time'),
    ...retainIfPresent(record, 'valid', 'valid'),
    ...retainIfPresent(record, 'protocol', 'protocol'),
  }

  return {
    anomalyKey:
      sourcePositionId === null
        ? `content:${contentFingerprint}`
        : `source:${sourcePositionId}`,
    sourcePositionId,
    canonicalEvidence,
  }
}

/** Creates the stable transport identity used to avoid per-poll receipt rows. */
export function createRejectedPositionDeliveryId(anomalyKey: string): string {
  return `rejection:${fingerprint(anomalyKey)}`
}

/** Reads the same positive integer identity accepted by Traccar normalization. */
function readPositiveIdentity(value: unknown): string | null {
  const parsed =
    typeof value === 'number' || typeof value === 'string'
      ? Number(value)
      : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null
}

/** Retains one allow-listed scalar without allowing hostile text growth. */
function retainIfPresent(
  record: Readonly<Record<string, unknown>>,
  inputKey: string,
  outputKey: string,
): Readonly<Record<string, RetainedEvidenceValue>> {
  if (!(inputKey in record)) {
    return {}
  }
  return { [outputKey]: retainValue(record[inputKey]) }
}

/** Converts a parsed value into a bounded canonical evidence value. */
function retainValue(value: unknown): RetainedEvidenceValue {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return value.length <= MAX_RETAINED_TEXT_CHARACTERS_HYPOTHESIS
      ? value
      : { omitted: 'oversize_text', length: value.length }
  }
  if (typeof value === 'object') {
    return { omitted: 'structured_value', valueType: Array.isArray(value) ? 'array' : 'object' }
  }
  return { omitted: 'unsupported_value', valueType: typeof value }
}

/** Returns true only for non-array object records. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Serializes parsed JSON deterministically so key order is not evidence. */
function stableSerialize(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : `"number:${String(value)}"`
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(`unsupported:${typeof value}`)
}

/** Computes a deterministic 64-bit FNV-1a fingerprint over transient text. */
function fingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n
  const bytes = new TextEncoder().encode(value)
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}
