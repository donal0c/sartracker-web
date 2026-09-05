import type { IngestEvidenceLossReason } from '../../domain/tracking-ingest-evidence'

export type MissionEvidenceObservation = {
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
  readonly payloadKey?: (payload: Payload) => string
}

type DeferredMissionEvidenceEntry<Payload> = {
  readonly missionId: string
  readonly payload: Payload
  readonly payloadKey: string | null
}

type MissionSettlementState = {
  readonly missionId: string
  readonly guardian: MissionEvidenceObservation
  readonly waiters: Set<() => void>
  flushRequested: boolean
  lossReason: IngestEvidenceLossReason | null
  lossMarkerDurable: boolean
  lossMarkerError: unknown
  lossMarkerInFlight: Promise<void> | null
}

export type DeferredMissionEvidenceQueue<Payload> = {
  readonly enqueue: (missionId: string, payload: Payload) => boolean
  readonly enqueueOwned: (
    missionId: string,
    payload: Payload,
    observation: MissionEvidenceObservation,
  ) => boolean
  readonly requestFlushMission: (missionId: string) => void
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
 * Owns accepted fixes behind one guardian observation per mission. Admission is
 * bounded and synchronous: each mission's distinct retained payloads persist
 * FIFO, while overflow is represented by one sticky durable evidence-loss marker.
 */
export function createDeferredMissionEvidenceQueue<Payload>(
  dependencies: DeferredMissionEvidenceQueueDependencies<Payload>,
): DeferredMissionEvidenceQueue<Payload> {
  if (!Number.isSafeInteger(dependencies.capacity) || dependencies.capacity < 1) {
    throw new Error('Deferred mission evidence capacity must be a positive integer.')
  }

  const statesByMission = new Map<string, MissionSettlementState>()
  const queuedEntries: DeferredMissionEvidenceEntry<Payload>[] = []
  let activeEntry: DeferredMissionEvidenceEntry<Payload> | null = null
  let pumpInFlight: Promise<void> | null = null
  let accepting = true
  let stopBarrierComplete = false

  /** Wakes explicit Finish and stop drains after one ownership transition. */
  function notifyState(state: MissionSettlementState): void {
    const waiters = [...state.waiters]
    state.waiters.clear()
    for (const resolve of waiters) resolve()
  }

  /** Waits without adding a polling timer to the evidence boundary. */
  function waitForStateChange(state: MissionSettlementState): Promise<void> {
    return new Promise((resolve) => state.waiters.add(resolve))
  }

  /** Counts the active and queued payloads retained in renderer memory. */
  function retainedCount(missionId?: string): number {
    const activeCount = activeEntry !== null && (
      missionId === undefined || activeEntry.missionId === missionId
    ) ? 1 : 0
    return activeCount + queuedEntries.filter(
      (entry) => missionId === undefined || entry.missionId === missionId,
    ).length
  }

  /** Completes a guardian only after all represented obligations are durable. */
  function completeStateIfDurable(state: MissionSettlementState): void {
    if (statesByMission.get(state.missionId) !== state) return
    if (retainedCount(state.missionId) > 0) return
    if (state.lossReason !== null && !state.lossMarkerDurable) return
    statesByMission.delete(state.missionId)
    state.guardian.complete()
    notifyState(state)
  }

  /** Starts at most one loss-marker write while preserving the guardian on failure. */
  function startLossMarker(
    state: MissionSettlementState,
    retryFailedMarker: boolean,
  ): Promise<void> | null {
    if (state.lossReason === null || state.lossMarkerDurable) return null
    if (state.lossMarkerInFlight !== null) return state.lossMarkerInFlight
    if (state.lossMarkerError !== null && !retryFailedMarker) return null
    state.lossMarkerError = null
    const operation = Promise.resolve().then(() => dependencies.markEvidenceLoss(
      state.missionId,
      state.lossReason!,
    )).then(() => {
      state.lossMarkerDurable = true
    }, (error: unknown) => {
      state.lossMarkerError = error
    }).finally(() => {
      if (state.lossMarkerInFlight === operation) state.lossMarkerInFlight = null
      notifyState(state)
      completeStateIfDurable(state)
    })
    state.lossMarkerInFlight = operation
    return operation
  }

  /** Coalesces every discarded payload behind one mission-level loss marker. */
  function requireEvidenceLoss(
    state: MissionSettlementState,
    reason: IngestEvidenceLossReason,
  ): void {
    state.lossReason ??= reason
    void startLossMarker(state, false)
  }

  /** Returns whether one payload is already represented by this FIFO. */
  function hasEquivalentPayload(
    missionId: string,
    payloadKey: string | null,
  ): boolean {
    if (payloadKey === null) return false
    return (activeEntry?.missionId === missionId && activeEntry.payloadKey === payloadKey) ||
      queuedEntries.some((entry) =>
        entry.missionId === missionId && entry.payloadKey === payloadKey)
  }

  /** Selects the next entry whose mission has explicitly requested persistence. */
  function takeNextFlushableEntry(): DeferredMissionEvidenceEntry<Payload> | null {
    const index = queuedEntries.findIndex((entry) =>
      statesByMission.get(entry.missionId)?.flushRequested === true)
    if (index < 0) return null
    return queuedEntries.splice(index, 1)[0] ?? null
  }

  /** Drains admitted payloads one at a time without queuing persistence closures. */
  async function runPump(): Promise<void> {
    while (true) {
      const entry = takeNextFlushableEntry()
      if (entry === null) return
      activeEntry = entry
      const state = statesByMission.get(entry.missionId)
      try {
        await dependencies.persist(entry.missionId, entry.payload)
      } catch {
        if (state !== undefined) {
          requireEvidenceLoss(state, 'mission_persistence_failed')
        }
      } finally {
        activeEntry = null
        if (state !== undefined) {
          notifyState(state)
          completeStateIfDurable(state)
        }
      }
    }
  }

  /** Owns exactly one pump promise regardless of poll frequency. */
  function startPump(): void {
    if (pumpInFlight !== null) return
    const operation = runPump()
    pumpInFlight = operation
    void operation.finally(() => {
      if (pumpInFlight === operation) pumpInFlight = null
      if (queuedEntries.some((entry) =>
        statesByMission.get(entry.missionId)?.flushRequested === true)) {
        startPump()
      }
    })
  }

  /** Transfers one already-open observation into bounded renderer ownership. */
  function enqueueOwned(
    missionId: string,
    payload: Payload,
    observation: MissionEvidenceObservation,
  ): boolean {
    if (stopBarrierComplete) return false
    if (observation.missionId !== missionId) return false
    const payloadKey = dependencies.payloadKey?.(payload) ?? null
    let state = statesByMission.get(missionId)
    if (state === undefined) {
      state = {
        missionId,
        guardian: observation,
        waiters: new Set(),
        flushRequested: false,
        lossReason: null,
        lossMarkerDurable: false,
        lossMarkerError: null,
        lossMarkerInFlight: null,
      }
      statesByMission.set(missionId, state)
    } else {
      observation.complete()
    }

    if (!accepting) {
      requireEvidenceLoss(state, 'renderer_pending_evidence_lost')
      return true
    }
    if (hasEquivalentPayload(missionId, payloadKey)) {
      return true
    }
    if (retainedCount() >= dependencies.capacity) {
      requireEvidenceLoss(state, 'renderer_pending_capacity_exhausted')
      return true
    }
    queuedEntries.push({ missionId, payload, payloadKey })
    notifyState(state)
    if (state.flushRequested) startPump()
    return true
  }

  /** Retries a failed marker once for an explicit Finish or stop drain. */
  async function settleLossMarker(state: MissionSettlementState): Promise<void> {
    if (state.lossReason === null || state.lossMarkerDurable) return
    if (state.lossMarkerInFlight !== null) await state.lossMarkerInFlight
    if (!state.lossMarkerDurable) {
      const retry = startLossMarker(state, true)
      if (retry !== null) await retry
    }
    if (!state.lossMarkerDurable) {
      throw state.lossMarkerError ?? new Error(
        'Mission evidence loss could not be marked durably.',
      )
    }
  }

  /** Drains one mission and keeps its guardian open through any failed marker. */
  async function flushMission(missionId: string): Promise<void> {
    let state = statesByMission.get(missionId)
    if (state === undefined) return
    state.flushRequested = true
    startPump()
    while (retainedCount(missionId) > 0) {
      await waitForStateChange(state)
      state = statesByMission.get(missionId) ?? state
    }
    await settleLossMarker(state)
    completeStateIfDurable(state)
  }

  return {
    enqueue: (missionId, payload) => {
      const observation = dependencies.beginObservation(missionId)
      return enqueueOwned(missionId, payload, observation)
    },
    enqueueOwned,
    requestFlushMission: (missionId) => {
      const state = statesByMission.get(missionId)
      if (state === undefined) return
      state.flushRequested = true
      startPump()
    },
    flushMission,
    settleMissionForFinish: async (missionId, participantScopeReady) => {
      if (retainedCount(missionId) > 0 && !participantScopeReady) {
        throw new Error(
          'Participant scope is still loading; retry Finish once participants are available.',
        )
      }
      await flushMission(missionId)
    },
    settleForStop: async (canPersistMission) => {
      accepting = false
      const settledStates = new Set<MissionSettlementState>()
      const settlementErrors: unknown[] = []
      while (true) {
        let unsettledStates = [...statesByMission.values()].filter(
          (state) => !settledStates.has(state),
        )
        if (unsettledStates.length === 0) {
          // Include ownership transferred in the same producer-shutdown turn.
          await Promise.resolve()
          unsettledStates = [...statesByMission.values()].filter(
            (state) => !settledStates.has(state),
          )
          if (unsettledStates.length === 0) break
        }

        for (const state of unsettledStates) {
          state.flushRequested = true
          if (!canPersistMission(state.missionId)) {
            for (let index = queuedEntries.length - 1; index >= 0; index -= 1) {
              if (queuedEntries[index]?.missionId === state.missionId) {
                queuedEntries.splice(index, 1)
              }
            }
            requireEvidenceLoss(state, 'renderer_pending_evidence_lost')
            notifyState(state)
          }
        }
        startPump()
        const results = await Promise.allSettled(
          unsettledStates.map((state) => flushMission(state.missionId)),
        )
        unsettledStates.forEach((state, index) => {
          settledStates.add(state)
          const result = results[index]
          if (result?.status === 'rejected') settlementErrors.push(result.reason)
        })
      }
      stopBarrierComplete = true
      if (settlementErrors.length > 0) {
        throw settlementErrors[0]
      }
    },
    pendingCount: retainedCount,
  }
}
