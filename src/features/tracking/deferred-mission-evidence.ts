import type { IngestEvidenceLossReason } from '../../domain/tracking-ingest-evidence'

type MissionEvidenceObservation = {
  readonly missionId: string | null
  readonly complete: () => void
}

type DeferredMissionEvidenceQueueDependencies<Payload> = {
  readonly capacity: number
  readonly beginObservation: (missionId: string) => MissionEvidenceObservation
  readonly persist: (missionId: string, payload: Payload) => Promise<unknown>
  readonly markEvidenceLoss: (
    missionId: string,
    reason: IngestEvidenceLossReason,
  ) => Promise<void>
}

type DeferredMissionEvidenceEntry<Payload> = {
  readonly missionId: string
  readonly payload: Payload
  readonly observation: MissionEvidenceObservation
}

export type DeferredMissionEvidenceQueue<Payload> = {
  readonly enqueue: (missionId: string, payload: Payload) => boolean
  readonly flushMission: (missionId: string) => Promise<void>
  readonly settleMissionForFinish: (
    missionId: string,
    participantScopeReady: boolean,
  ) => Promise<void>
  readonly settleForStop: (
    canPersistMission: (missionId: string) => boolean,
  ) => Promise<void>
  readonly pendingCount: (missionId?: string) => number
}

/**
 * Owns accepted fixes that cannot be participation-scoped yet. Each payload
 * retains a mission observation until it is persisted or durably marked lost.
 */
export function createDeferredMissionEvidenceQueue<Payload>(
  dependencies: DeferredMissionEvidenceQueueDependencies<Payload>,
): DeferredMissionEvidenceQueue<Payload> {
  if (!Number.isSafeInteger(dependencies.capacity) || dependencies.capacity < 1) {
    throw new Error('Deferred mission evidence capacity must be a positive integer.')
  }

  const entriesByMission = new Map<string, DeferredMissionEvidenceEntry<Payload>[]>()
  let operationTail: Promise<void> = Promise.resolve()
  let accepting = true

  /** Serializes settlement so the same payload cannot persist and mark concurrently. */
  function enqueueOperation(operation: () => Promise<void>): Promise<void> {
    const run = operationTail.then(operation)
    operationTail = run.catch(() => undefined)
    return run
  }

  /** Releases an observation only after its evidence obligation is owned durably. */
  async function settleEntry(
    entry: DeferredMissionEvidenceEntry<Payload>,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await operation()
    } finally {
      entry.observation.complete()
    }
  }

  /** Converts one discarded payload into the existing sticky mission blocker. */
  function markEntryLost(entry: DeferredMissionEvidenceEntry<Payload>): Promise<void> {
    return settleEntry(entry, () => dependencies.markEvidenceLoss(
      entry.missionId,
      'mission_persistence_failed',
    ))
  }

  /** Persists one queued entry, replacing persistence failure with a durable marker. */
  async function persistEntry(entry: DeferredMissionEvidenceEntry<Payload>): Promise<void> {
    try {
      await dependencies.persist(entry.missionId, entry.payload)
    } catch {
      await dependencies.markEvidenceLoss(entry.missionId, 'mission_persistence_failed')
    } finally {
      entry.observation.complete()
    }
  }

  /** Removes and settles every entry currently owned by one mission. */
  async function drainMission(
    missionId: string,
    settle: (entry: DeferredMissionEvidenceEntry<Payload>) => Promise<void>,
  ): Promise<void> {
    while (true) {
      const entries = entriesByMission.get(missionId)
      const entry = entries?.shift()
      if (entry === undefined) {
        entriesByMission.delete(missionId)
        return
      }
      if (entries?.length === 0) entriesByMission.delete(missionId)
      await settle(entry)
    }
  }

  return {
    enqueue: (missionId, payload) => {
      const observation = dependencies.beginObservation(missionId)
      if (observation.missionId !== missionId) {
        return false
      }
      const entry = { missionId, payload, observation }
      if (!accepting) {
        void enqueueOperation(() => markEntryLost(entry))
        return true
      }
      const entries = entriesByMission.get(missionId) ?? []
      entries.push(entry)
      entriesByMission.set(missionId, entries)
      if (entries.length > dependencies.capacity) {
        const overflow = entries.shift()
        if (overflow !== undefined) {
          void enqueueOperation(() => markEntryLost(overflow))
        }
      }
      return true
    },
    flushMission: (missionId) => enqueueOperation(() =>
      drainMission(missionId, persistEntry)),
    settleMissionForFinish: async (missionId, participantScopeReady) => {
      if ((entriesByMission.get(missionId)?.length ?? 0) === 0) return
      if (!participantScopeReady) {
        throw new Error(
          'Participant scope is still loading; retry Finish once participants are available.',
        )
      }
      await enqueueOperation(() => drainMission(missionId, persistEntry))
    },
    settleForStop: async (canPersistMission) => {
      accepting = false
      await enqueueOperation(async () => {
        for (const missionId of [...entriesByMission.keys()].sort()) {
          await drainMission(
            missionId,
            canPersistMission(missionId) ? persistEntry : markEntryLost,
          )
        }
      })
    },
    pendingCount: (missionId) => missionId === undefined
      ? [...entriesByMission.values()].reduce((sum, entries) => sum + entries.length, 0)
      : entriesByMission.get(missionId)?.length ?? 0,
  }
}
