import type { PersistTrackingHistoryBatchInput } from '../../infrastructure/mission-store/tauri-mission-store'
import { normalizeTrackingIsoTimestamp } from '../tracking/tracking-timestamp'

/** Session-only transport receipts, never a claim of retained complete history. */
export type BrowserHistoryReceipt = {
  readonly mission_id: string
  readonly device_id: string
  readonly requested_from?: string
  readonly requested_until?: string
  readonly last_acknowledged_chunk?: {
    readonly history_from: string
    readonly reconciled_from?: string
    readonly reconciled_until: string
  }
}

/** Normalizes receipt times before they can enter browser storage. */
function timestamp(value: string): string {
  return normalizeTrackingIsoTimestamp(value, 'Browser history receipt time')
}

/** Records bounded per-device transport metadata without manufacturing a restart frontier. */
export function recordBrowserHistoryReceipts(
  previous: readonly BrowserHistoryReceipt[],
  input: PersistTrackingHistoryBatchInput,
): readonly BrowserHistoryReceipt[] {
  const receipts = [...previous]
  /** Replaces one mission-device receipt in the uncommitted candidate. */
  const update = (deviceId: string, change: (existing: BrowserHistoryReceipt) => BrowserHistoryReceipt) => {
    if (!deviceId.trim()) throw new Error('Browser history receipt requires a device id.')
    const index = receipts.findIndex((receipt) => receipt.mission_id === input.mission_id && receipt.device_id === deviceId)
    const existing = receipts[index] ?? { mission_id: input.mission_id, device_id: deviceId }
    const next = change(existing)
    if (index < 0) receipts.push(next)
    else receipts[index] = next
  }
  for (const request of input.requests ?? []) {
    const from = timestamp(request.history_from)
    const until = timestamp(request.requested_until)
    if (from > until) throw new Error('Browser history request ends before it starts.')
    update(request.device_id, (existing) => ({ ...existing,
      requested_from: existing.requested_from === undefined || from < existing.requested_from ? from : existing.requested_from,
      requested_until: existing.requested_until === undefined || until > existing.requested_until ? until : existing.requested_until,
    }))
  }
  for (const checkpoint of input.checkpoints) {
    const from = timestamp(checkpoint.history_from)
    const until = timestamp(checkpoint.reconciled_until)
    const intervalFrom = checkpoint.reconciled_from === undefined ? undefined : timestamp(checkpoint.reconciled_from)
    if (from > until || (intervalFrom !== undefined && (intervalFrom < from || intervalFrom > until))) {
      throw new Error('Browser history chunk has an invalid interval.')
    }
    update(checkpoint.device_id, (existing) => ({ ...existing, last_acknowledged_chunk: {
      history_from: from, reconciled_until: until,
      ...(intervalFrom === undefined ? {} : { reconciled_from: intervalFrom }),
    } }))
  }
  return receipts
}
