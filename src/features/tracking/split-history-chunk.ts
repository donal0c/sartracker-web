import type {
  TrackingHistoryChunkPersistenceInput,
  TrackingHistoryChunkPersistenceResult,
} from './polling-manager'

/**
 * The most fixes written to the mission store in one call. A call is one
 * synchronous SQLite transaction on the Electron main thread; at ~150-300 µs
 * per fix, 256 keeps it well under the 200 ms responsiveness limit [DON-313].
 */
export const HISTORY_PIECE_ROW_BUDGET = 256

/**
 * Cuts one history chunk into time-ordered pieces of at most the row budget.
 * Fixes sharing a timestamp are never separated, so a piece's own last
 * timestamp is a truthful inclusive reconciled-until cursor. Policy: a group
 * of one device's fixes at the same instant larger than the budget stays in
 * one piece, because splitting it would let a cursor claim fixes not yet
 * stored; truth wins over the bound, and real trackers do not report hundreds
 * of fixes at one instant. Later pieces
 * claim the interval from the previous cursor, which the store accepts only
 * when it is contiguous with what is already stored; the last piece ends at
 * the chunk's own cursor. A chunk that fits is returned unchanged.
 */
export function splitHistoryChunk(
  chunk: TrackingHistoryChunkPersistenceInput,
  budget: number = HISTORY_PIECE_ROW_BUDGET,
): readonly TrackingHistoryChunkPersistenceInput[] {
  if (chunk.positions.length <= budget || !isWellFormedChunk(chunk)) return [chunk]
  const positions = [...chunk.positions]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))

  const groups: (typeof positions)[] = []
  let current: typeof positions = []
  for (const position of positions) {
    const previous = current.at(-1)
    const sameInstant = previous !== undefined
      && Date.parse(previous.timestamp) === Date.parse(position.timestamp)
    if (current.length >= budget && !sameInstant) {
      groups.push(current)
      current = []
    }
    current.push(position)
  }
  if (current.length > 0) groups.push(current)

  return groups.map((group, index) => {
    const isLast = index === groups.length - 1
    const reconciledUntil = isLast ? chunk.reconciledUntil : group.at(-1)!.timestamp
    const previousCursor = index === 0 ? undefined : groups[index - 1]!.at(-1)!.timestamp
    const reconciledFrom = index === 0 ? chunk.reconciledFrom : previousCursor
    const piece: TrackingHistoryChunkPersistenceInput = {
      phase: chunk.phase,
      expectedMissionId: chunk.expectedMissionId,
      deviceId: chunk.deviceId,
      historyFrom: chunk.historyFrom,
      reconciledUntil,
      positions: group,
      ...(reconciledFrom === undefined ? {} : { reconciledFrom }),
    }
    return piece
  })
}

/**
 * Persists a chunk piece by piece, yielding between pieces. Stops at the first
 * failed piece and rejects, so the caller retries the whole chunk; pieces
 * already stored keep checkpoints that claim only what they hold.
 */
/**
 * Splitting derives piece cursors from fix times, which is truthful only when
 * every fix lies inside the chunk's own window and the window is not inverted.
 * Anything else stays whole, so the store validates and rejects it atomically
 * exactly as before (DON-254) [DON-313].
 */
function isWellFormedChunk(chunk: TrackingHistoryChunkPersistenceInput): boolean {
  const windowStart = Date.parse(chunk.reconciledFrom ?? chunk.historyFrom)
  const windowEnd = Date.parse(chunk.reconciledUntil)
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd < windowStart) return false
  if (Date.parse(chunk.historyFrom) > windowStart) return false
  return chunk.positions.every((position) => {
    const at = Date.parse(position.timestamp)
    return Number.isFinite(at) && at >= windowStart && at <= windowEnd
  })
}

const failuresAfterStoredChange = new WeakSet<object>()

/**
 * True when a failed chunk had already stored new fixes in an earlier piece.
 * Its retry may then report nothing changed, so the caller must still refresh
 * the trail from the store (DON-305 late uploads) [DON-313].
 */
export function historyFailureChangedStore(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && failuresAfterStoredChange.has(reason)
}

export async function persistHistoryChunkInPieces(
  chunk: TrackingHistoryChunkPersistenceInput,
  persistPiece: (piece: TrackingHistoryChunkPersistenceInput) => Promise<TrackingHistoryChunkPersistenceResult | void>,
  yieldBetweenPieces: () => Promise<void>,
): Promise<TrackingHistoryChunkPersistenceResult> {
  let changed = false
  for (const [index, piece] of splitHistoryChunk(chunk).entries()) {
    try {
      if (index > 0) await yieldBetweenPieces()
      const result = await persistPiece(piece)
      changed ||= result?.changed === true
    } catch (reason) {
      if (changed && typeof reason === 'object' && reason !== null) failuresAfterStoredChange.add(reason)
      throw reason
    }
  }
  return { changed }
}
