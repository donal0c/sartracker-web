import type {
  TrackingHistoryChunkPersistenceInput,
  TrackingHistoryChunkPersistenceResult,
  TrackingHistoryRefusals,
} from './polling-manager'
import type { NormalizedTrackingPosition } from './tracking-types'
import { HISTORY_PIECE_ROW_BUDGET, persistHistoryChunkInPieces } from './split-history-chunk'

/**
 * Bounds the fixes written in one mission-store call, which is one synchronous
 * transaction on the Electron main thread. An oversized chunk is written in
 * bounded pieces instead [DON-313].
 */
export const HISTORY_CHUNK_GROUP_ROW_BUDGET = HISTORY_PIECE_ROW_BUDGET

type ChunkEntry = {
  readonly input: TrackingHistoryChunkPersistenceInput
  readonly index: number
}

type PersistHistoryChunkGroupsOptions = {
  readonly inputs: readonly TrackingHistoryChunkPersistenceInput[]
  readonly persistGroup: (
    inputs: readonly TrackingHistoryChunkPersistenceInput[],
  ) => Promise<TrackingHistoryRefusals | void>
  readonly persistChunk?: (input: TrackingHistoryChunkPersistenceInput) => Promise<TrackingHistoryChunkPersistenceResult>
  /**
   * Called once per acknowledged chunk. `refusedPositions` holds the
   * observations the store refused in the write that carried it (for a group
   * write, every refused observation of the group, matched by identity).
   */
  readonly onAcknowledged: (
    input: TrackingHistoryChunkPersistenceInput,
    index: number,
    result: TrackingHistoryChunkPersistenceResult | null,
    refusedPositions: readonly NormalizedTrackingPosition[],
  ) => void
  readonly yieldBetweenGroups: () => Promise<void>
}

/**
 * Persists complete chunks in separately admitted groups under the caller's wave
 * observation. Failed groups alone fall back to individual chunks; each result
 * retains its original index so only acknowledged checkpoints advance.
 */
export async function persistHistoryChunkGroups(
  options: PersistHistoryChunkGroupsOptions,
): Promise<readonly PromiseSettledResult<void>[]> {
  const groups = groupCompleteChunks(options.inputs)
  const results: PromiseSettledResult<void>[] = []

  /** Keeps publication failure separate from a failed durable transaction. */
  function acknowledge(
    entry: ChunkEntry,
    result: TrackingHistoryChunkPersistenceResult | null,
    refusedPositions: readonly NormalizedTrackingPosition[] = result?.refusedPositions ?? [],
  ): PromiseSettledResult<void> {
    try {
      options.onAcknowledged(entry.input, entry.index, result, refusedPositions)
      return { status: 'fulfilled', value: undefined }
    } catch (reason) {
      return { status: 'rejected', reason }
    }
  }

  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex > 0) await options.yieldBetweenGroups()
    const oversized = group.length === 1 && group[0]!.input.positions.length > HISTORY_CHUNK_GROUP_ROW_BUDGET
    if (oversized) {
      const entry = group[0]!
      try {
        const result = await persistHistoryChunkInPieces(
          entry.input,
          async (piece) => options.persistChunk !== undefined
            ? options.persistChunk(piece)
            : options.persistGroup([piece]),
          options.yieldBetweenGroups,
        )
        results[entry.index] = acknowledge(entry, result)
      } catch (reason) {
        results[entry.index] = { status: 'rejected', reason }
      }
      continue
    }
    let groupFailure: { readonly reason: unknown } | undefined
    let groupRefusals: readonly NormalizedTrackingPosition[] = []
    try {
      groupRefusals = (await options.persistGroup(group.map(({ input }) => input)))?.refusedPositions ?? []
    } catch (reason) {
      groupFailure = { reason }
    }
    if (groupFailure === undefined) {
      for (const entry of group) results[entry.index] = acknowledge(entry, null, groupRefusals)
      continue
    }
    if (group.length === 1 && options.persistChunk === undefined) {
      results[group[0]!.index] = { status: 'rejected', reason: groupFailure.reason }
      continue
    }
    await Promise.all(group.map(async (entry) => {
      let result: TrackingHistoryChunkPersistenceResult | null = null
      let refusals: readonly NormalizedTrackingPosition[] = []
      try {
        if (options.persistChunk !== undefined) {
          result = await options.persistChunk(entry.input)
          refusals = result.refusedPositions ?? []
        } else {
          refusals = (await options.persistGroup([entry.input]))?.refusedPositions ?? []
        }
      } catch (reason) {
        results[entry.index] = { status: 'rejected', reason }
        return
      }
      results[entry.index] = acknowledge(entry, result, refusals)
    }))
  }
  return results
}

/** Preserves input order, empty checkpoints and indivisible oversized chunks. */
function groupCompleteChunks(
  inputs: readonly TrackingHistoryChunkPersistenceInput[],
): readonly (readonly ChunkEntry[])[] {
  const groups: ChunkEntry[][] = []
  let group: ChunkEntry[] = []
  let rows = 0
  for (const [index, input] of inputs.entries()) {
    const inputRows = input.positions.length
    if (group.length > 0 && rows + inputRows > HISTORY_CHUNK_GROUP_ROW_BUDGET) {
      groups.push(group)
      group = []
      rows = 0
    }
    group.push({ input, index })
    rows += inputRows
    if (inputRows > HISTORY_CHUNK_GROUP_ROW_BUDGET) {
      groups.push(group)
      group = []
      rows = 0
    }
  }
  if (group.length > 0) groups.push(group)
  return groups
}
