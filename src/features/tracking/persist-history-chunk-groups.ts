import type {
  TrackingHistoryChunkPersistenceInput,
  TrackingHistoryChunkPersistenceResult,
} from './polling-manager'

/** Bounds grouped rows while retaining any oversized individual chunk whole. */
export const HISTORY_CHUNK_GROUP_ROW_BUDGET = 1024

type ChunkEntry = {
  readonly input: TrackingHistoryChunkPersistenceInput
  readonly index: number
}

type PersistHistoryChunkGroupsOptions = {
  readonly inputs: readonly TrackingHistoryChunkPersistenceInput[]
  readonly persistGroup: (inputs: readonly TrackingHistoryChunkPersistenceInput[]) => Promise<void>
  readonly persistChunk?: (input: TrackingHistoryChunkPersistenceInput) => Promise<TrackingHistoryChunkPersistenceResult>
  readonly onAcknowledged: (
    input: TrackingHistoryChunkPersistenceInput,
    index: number,
    result: TrackingHistoryChunkPersistenceResult | null,
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
  ): PromiseSettledResult<void> {
    try {
      options.onAcknowledged(entry.input, entry.index, result)
      return { status: 'fulfilled', value: undefined }
    } catch (reason) {
      return { status: 'rejected', reason }
    }
  }

  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex > 0) await options.yieldBetweenGroups()
    let groupFailure: { readonly reason: unknown } | undefined
    try {
      await options.persistGroup(group.map(({ input }) => input))
    } catch (reason) {
      groupFailure = { reason }
    }
    if (groupFailure === undefined) {
      for (const entry of group) results[entry.index] = acknowledge(entry, null)
      continue
    }
    if (group.length === 1 && options.persistChunk === undefined) {
      results[group[0]!.index] = { status: 'rejected', reason: groupFailure.reason }
      continue
    }
    await Promise.all(group.map(async (entry) => {
      let result: TrackingHistoryChunkPersistenceResult | null = null
      try {
        if (options.persistChunk !== undefined) {
          result = await options.persistChunk(entry.input)
        } else {
          await options.persistGroup([entry.input])
        }
      } catch (reason) {
        results[entry.index] = { status: 'rejected', reason }
        return
      }
      results[entry.index] = acknowledge(entry, result)
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
