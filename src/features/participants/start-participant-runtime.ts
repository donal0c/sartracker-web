import type {
  AddMissionParticipantInput,
  GroupMembershipEvent,
  MissionParticipant,
  ParticipantBackfillCheckpoint,
  SelectMissionParticipantsInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  NormalizedTrackingDevice,
  NormalizedTraccarGroup,
} from '../tracking/tracking-types'
import { assessParticipantEnvelope } from './participant-envelope'
import type { ParticipantRuntimeState } from './participant-store'
import { createParticipationScope } from './participation-scope'

type ParticipantStoreBoundary = {
  readonly selectMissionParticipants: (
    input: SelectMissionParticipantsInput,
  ) => Promise<readonly MissionParticipant[]>
  readonly addMissionParticipant: (
    input: AddMissionParticipantInput,
  ) => Promise<MissionParticipant>
  readonly removeMissionParticipant: (input: {
    readonly mission_id: string
    readonly participant_id: string
    readonly removed_by: string
    readonly reason?: string
  }) => Promise<MissionParticipant>
  readonly listMissionParticipants: (
    missionId: string,
  ) => Promise<readonly MissionParticipant[]>
  readonly recordGroupMembershipEvents: (input: {
    readonly mission_id: string
    readonly events: readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[]
  }) => Promise<readonly GroupMembershipEvent[]>
  readonly listGroupMembershipEvents: (
    missionId: string,
  ) => Promise<readonly GroupMembershipEvent[]>
  readonly listParticipantBackfillCheckpoints: (
    missionId: string,
  ) => Promise<readonly ParticipantBackfillCheckpoint[]>
}

type StartParticipantRuntimeDependencies = {
  readonly participantStore: ParticipantStoreBoundary
  readonly applyRuntime: (runtime: ParticipantRuntimeState) => void
  readonly now?: () => Date
}

export type ParticipantRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly applyRoster: (
    devices: readonly NormalizedTrackingDevice[],
    observedAt?: string,
    options?: { readonly complete: boolean },
  ) => Promise<void>
  readonly applyGroups: (groups: readonly NormalizedTraccarGroup[]) => void
  readonly reportRosterError: (message: string | null) => void
  readonly toggleDraftDevice: (deviceId: string) => void
  readonly toggleDraftGroup: (groupId: string) => void
  readonly clearDraft: () => void
  readonly selectInitialParticipants: (
    missionId: string,
    selectedBy: string,
  ) => Promise<readonly MissionParticipant[]>
  readonly addParticipant: (input: Omit<AddMissionParticipantInput, 'mission_id'>) => Promise<MissionParticipant | null>
  readonly removeParticipant: (
    participantId: string,
    removedBy: string,
    reason?: string,
  ) => Promise<MissionParticipant | null>
  readonly runWithMembershipFinishFence: <Result>(
    missionId: string,
    finish: () => Promise<Result>,
  ) => Promise<Result>
  readonly clearMembershipNotices: () => void
}

/** Owns participant hydration, selection, and observation-time group expansion. */
export async function startParticipantRuntime(
  dependencies: StartParticipantRuntimeDependencies,
): Promise<ParticipantRuntimeController> {
  const now = dependencies.now ?? (() => new Date())
  let activeMissionId: string | null = null
  let participants: readonly MissionParticipant[] = []
  let membershipEvents: readonly GroupMembershipEvent[] = []
  let backfillCheckpoints: readonly ParticipantBackfillCheckpoint[] = []
  let availableDevices: readonly NormalizedTrackingDevice[] = []
  let availableRosterComplete = false
  let rosterObservationReceived = false
  let availableGroups: readonly NormalizedTraccarGroup[] = []
  let draftDeviceIds: readonly string[] = []
  let draftGroupIds: readonly string[] = []
  let membershipNotices: readonly string[] = []
  let loading = false
  let saving = false
  let rosterReadError: string | null = null
  let membershipWriteError: string | null = null
  let error: string | null = null
  let refreshToken = 0
  let missionGeneration = 0
  let selectionGeneration = 0
  let lastReconciledMissionGeneration = -1
  let nextRosterObservationVersion = 0
  const pendingRosterObservations: RosterObservation[] = []
  let pendingMembershipWrite: PendingMembershipWrite | null = null
  let rosterReconciliationRunning = false
  let inFlightRosterApplicationCount = 0
  let hydrationBlockedRosterObservations: FencedRosterObservation[] = []
  let fencedRosterObservations: FencedRosterObservation[] = []
  let membershipFinishFence: MembershipFinishFence | null = null
  const rosterWaiters: Array<{
    readonly version: number
    readonly resolve: () => void
  }> = []
  const rosterReconciliationWaiters: Array<() => void> = []

  const controller: ParticipantRuntimeController = {
    refreshMission: async (missionId) => {
      const previousMissionId = activeMissionId
      const missionChanged = activeMissionId !== missionId
      if (missionChanged) {
        missionGeneration += 1
        selectionGeneration += 1
        lastReconciledMissionGeneration = -1
        pendingMembershipWrite = null
        membershipFinishFence = null
        hydrationBlockedRosterObservations = []
        fencedRosterObservations = []
        membershipWriteError = null
        saving = false
        participants = []
        membershipEvents = []
        backfillCheckpoints = []
        membershipNotices = []
        if (previousMissionId !== null) {
          draftDeviceIds = []
          draftGroupIds = []
        }
      }
      const token = ++refreshToken
      activeMissionId = missionId
      error = null
      if (missionId === null) {
        participants = []
        membershipEvents = []
        backfillCheckpoints = []
        loading = false
        publishRuntime()
        return
      }
      loading = true
      publishRuntime()
      try {
        const [nextParticipants, nextEvents, nextCheckpoints] = await Promise.all([
          dependencies.participantStore.listMissionParticipants(missionId),
          dependencies.participantStore.listGroupMembershipEvents(missionId),
          dependencies.participantStore.listParticipantBackfillCheckpoints(missionId),
        ])
        if (token !== refreshToken || activeMissionId !== missionId) return
        participants = nextParticipants
        membershipEvents = nextEvents
        backfillCheckpoints = nextCheckpoints
      } catch (runtimeError) {
        if (token === refreshToken && activeMissionId === missionId) {
          participants = []
          membershipEvents = []
          backfillCheckpoints = []
          error = toErrorMessage(runtimeError)
        }
      } finally {
        if (token === refreshToken && activeMissionId === missionId) {
          loading = false
          publishRuntime()
        }
      }
    },
    applyRoster: async (devices, observedAt = now().toISOString(), options = { complete: true }) => {
      const fence = membershipFinishFence
      if (
        fence !== null &&
        activeMissionId === fence.missionId &&
        missionGeneration === fence.missionGeneration
      ) {
        if (fence.status !== 'finished') {
          updateAvailableRoster(devices, options.complete)
          fencedRosterObservations.push({
            missionId: fence.missionId,
            missionGeneration: fence.missionGeneration,
            devices: [...devices],
            observedAt,
            complete: options.complete,
          })
        }
        return
      }
      inFlightRosterApplicationCount += 1
      try {
        await applyRosterObservation(devices, observedAt, options.complete)
      } finally {
        inFlightRosterApplicationCount -= 1
        notifyRosterReconciliationWaiters()
      }
    },
    applyGroups: (groups) => {
      availableGroups = [...groups]
      publishRuntime()
    },
    reportRosterError: (message) => {
      rosterReadError = message
      publishRuntime()
    },
    toggleDraftDevice: (deviceId) => {
      const device = availableDevices.find((candidate) => candidate.device_id === deviceId)
      if (
        device?.group_id !== null &&
        device?.group_id !== undefined &&
        draftGroupIds.includes(device.group_id)
      ) return
      draftDeviceIds = toggleId(draftDeviceIds, deviceId)
      publishRuntime()
    },
    toggleDraftGroup: (groupId) => {
      const selectingGroup = !draftGroupIds.includes(groupId)
      draftGroupIds = toggleId(draftGroupIds, groupId)
      if (selectingGroup) {
        const coveredDeviceIds = new Set(availableDevices
          .filter((device) => device.group_id === groupId)
          .map((device) => device.device_id))
        draftDeviceIds = draftDeviceIds.filter((deviceId) =>
          !coveredDeviceIds.has(deviceId))
      }
      publishRuntime()
    },
    clearDraft: () => {
      draftDeviceIds = []
      draftGroupIds = []
      publishRuntime()
    },
    selectInitialParticipants: async (missionId, selectedBy) => {
      if (draftGroupIds.length > 0 && !canSelectGroups()) {
        const selectionError = incompleteRosterSelectionError()
        rosterReadError = selectionError.message
        error = selectionError.message
        publishRuntime()
        throw selectionError
      }
      const operationGeneration = ++selectionGeneration
      if (activeMissionId !== missionId) {
        missionGeneration += 1
        lastReconciledMissionGeneration = -1
        pendingMembershipWrite = null
        hydrationBlockedRosterObservations = []
        membershipWriteError = null
        participants = []
        membershipEvents = []
        backfillCheckpoints = []
        membershipNotices = []
        loading = true
      }
      saving = true
      error = null
      activeMissionId = missionId
      publishRuntime()
      try {
        const selected = await dependencies.participantStore.selectMissionParticipants({
          mission_id: missionId,
          groups: draftGroupIds.map((groupId) => {
            const group = requireGroup(availableGroups, groupId)
            return {
              traccar_group_id: group.group_id,
              name: group.name,
              member_device_ids: availableDevices
                .filter((device) => device.group_id === groupId)
                .map((device) => device.device_id),
            }
          }),
          devices: draftDeviceIds.map((deviceId) => ({ traccar_device_id: deviceId })),
          selected_by: selectedBy,
        })
        if (activeMissionId !== missionId || selectionGeneration !== operationGeneration) {
          return selected
        }
        draftDeviceIds = []
        draftGroupIds = []
        await controller.refreshMission(missionId)
        return selected
      } catch (runtimeError) {
        if (activeMissionId === missionId && selectionGeneration === operationGeneration) {
          loading = false
          error = toErrorMessage(runtimeError)
          publishRuntime()
        }
        throw runtimeError
      } finally {
        if (activeMissionId === missionId && selectionGeneration === operationGeneration) {
          saving = false
          publishRuntime()
        }
      }
    },
    addParticipant: async (input) => mutate(async (missionId) => {
      const participantRef = input.ref
      if (input.kind === 'group' && !canSelectGroups()) {
        throw incompleteRosterSelectionError()
      }
      const observedInput = input.kind === 'group' && typeof participantRef !== 'string'
        ? {
            ...input,
            ref: {
              ...participantRef,
              member_device_ids: availableDevices
                .filter((device) => device.group_id === participantRef.traccar_group_id)
                .map((device) => device.device_id),
            },
          }
        : input
      return dependencies.participantStore.addMissionParticipant({
        mission_id: missionId,
        ...observedInput,
      })
    }),
    removeParticipant: async (participantId, removedBy, reason) => mutate(async (missionId) =>
      dependencies.participantStore.removeMissionParticipant({
        mission_id: missionId,
        participant_id: participantId,
        removed_by: removedBy,
        ...(reason === undefined ? {} : { reason }),
      })),
    runWithMembershipFinishFence: async <Result>(missionId: string, finish: () => Promise<Result>) => {
      if (activeMissionId !== missionId) {
        throw new Error('Mission cannot be finished until its participant scope is loaded.')
      }
      if (membershipFinishFence !== null) {
        throw new Error('Mission finish is already checking participant membership changes.')
      }
      const fence: MembershipFinishFence = {
        missionId,
        missionGeneration,
        status: 'pending',
      }
      membershipFinishFence = fence
      let finishSucceeded = false
      try {
        await waitForRosterReconciliation()
        const hydrationBlocked = hydrationBlockedRosterObservations.some((observation) =>
          observation.missionId === fence.missionId &&
          observation.missionGeneration === fence.missionGeneration)
        if (hydrationBlocked) {
          throw unresolvedMembershipFinishError(error)
        }
        const pendingWrite = pendingMembershipWrite
        if (pendingWrite !== null) {
          const writeSucceeded = await persistMembershipWrite(pendingWrite)
          if (!writeSucceeded) {
            throw unresolvedMembershipFinishError(membershipWriteError)
          }
        }
        if (pendingRosterObservations.length > 0) {
          void drainRosterReconciliation()
          await waitForRosterReconciliation()
        }
        if (
          pendingRosterObservations.length > 0 ||
          pendingMembershipWrite !== null ||
          membershipWriteError !== null
        ) {
          throw unresolvedMembershipFinishError(membershipWriteError)
        }
        const result = await finish()
        finishSucceeded = true
        if (membershipFinishFence === fence) {
          fence.status = 'finished'
          discardFencedRosterObservations(fence)
        }
        return result
      } finally {
        if (!finishSucceeded && membershipFinishFence === fence) {
          fence.status = 'replaying'
          await replayFencedRosterObservations(fence)
          if (pendingRosterObservations.length > 0) void drainRosterReconciliation()
        }
      }
    },
    clearMembershipNotices: () => {
      membershipNotices = []
      publishRuntime()
    },
  }

  publishRuntime()
  return controller

  async function mutate(
    operation: (missionId: string) => Promise<MissionParticipant>,
  ): Promise<MissionParticipant | null> {
    const missionId = activeMissionId
    if (missionId === null || saving) return null
    const operationMissionGeneration = missionGeneration
    saving = true
    error = null
    publishRuntime()
    try {
      const result = await operation(missionId)
      if (
        activeMissionId !== missionId ||
        missionGeneration !== operationMissionGeneration
      ) return result
      await controller.refreshMission(missionId)
      return result
    } catch (runtimeError) {
      if (
        activeMissionId === missionId &&
        missionGeneration === operationMissionGeneration
      ) error = toErrorMessage(runtimeError)
      return null
    } finally {
      if (
        activeMissionId === missionId &&
        missionGeneration === operationMissionGeneration
      ) {
        saving = false
        publishRuntime()
      }
    }
  }

  function publishRuntime(): void {
    const scope = createParticipationScope({
      participants,
      membershipEvents,
      backfillCheckpoints,
      observedCurrentDeviceIds: collectObservedCurrentGroupMembers(
        participants,
        availableDevices,
        now().toISOString(),
        rosterObservationReceived,
        pendingMembershipWrite?.events ?? [],
      ),
    })
    dependencies.applyRuntime({
      activeMissionId,
      participants,
      membershipEvents,
      backfillCheckpoints,
      availableDevices,
      availableGroups,
      draftDeviceIds,
      draftGroupIds,
      membershipNotices,
      scope,
      envelope: assessParticipantEnvelope(scope.operationalDeviceIdsAt(now().toISOString())),
      loading,
      saving,
      rosterError: currentRosterError(),
      error,
    })
  }

  /** Applies one accepted roster observation without crossing the finish cutoff again. */
  async function applyRosterObservation(
    devices: readonly NormalizedTrackingDevice[],
    observedAt: string,
    complete: boolean,
    forceReconciliation = false,
  ): Promise<void> {
    const missionIdBeforeRefresh = activeMissionId
    if (error !== null && missionIdBeforeRefresh !== null) {
      await controller.refreshMission(missionIdBeforeRefresh)
      if (activeMissionId !== missionIdBeforeRefresh) return
      if (error !== null) {
        hydrationBlockedRosterObservations.push({
          missionId: missionIdBeforeRefresh,
          missionGeneration,
          devices: [...devices],
          observedAt,
          complete,
        })
        return
      }
    }
    const recoveredObservations = hydrationBlockedRosterObservations.filter((observation) =>
      observation.missionId === activeMissionId &&
      observation.missionGeneration === missionGeneration)
    hydrationBlockedRosterObservations = hydrationBlockedRosterObservations.filter(
      (observation) => !recoveredObservations.includes(observation),
    )
    for (const observation of recoveredObservations) {
      await acceptRosterObservation(
        observation.devices,
        observation.observedAt,
        observation.complete,
      )
    }
    await acceptRosterObservation(devices, observedAt, complete, forceReconciliation)
  }

  /** Publishes and queues one roster observation after participant scope is available. */
  async function acceptRosterObservation(
    devices: readonly NormalizedTrackingDevice[],
    observedAt: string,
    complete: boolean,
    forceReconciliation = false,
  ): Promise<void> {
    const rosterChanged = !areRostersEquivalent(availableDevices, devices)
    const completenessChanged = complete !== availableRosterComplete
    const readErrorCleared = rosterReadError !== null
    const retryRequired = membershipWriteError !== null
    const missionNeedsReconciliation =
      activeMissionId !== null && lastReconciledMissionGeneration !== missionGeneration
    if (
      !forceReconciliation &&
      !rosterChanged &&
      !completenessChanged &&
      !readErrorCleared &&
      !retryRequired &&
      !missionNeedsReconciliation
    ) return
    updateAvailableRoster(devices, complete)
    const missionId = activeMissionId
    if (missionId === null) return
    const version = ++nextRosterObservationVersion
    pendingRosterObservations.push({
      version,
      missionId,
      missionGeneration,
      devices: [...availableDevices],
      observedAt,
      complete,
    })
    await new Promise<void>((resolve) => {
      rosterWaiters.push({ version, resolve })
      void drainRosterReconciliation()
    })
  }

  /** Replays post-cutoff observations only when the persisted finish was refused. */
  async function replayFencedRosterObservations(
    fence: MembershipFinishFence,
  ): Promise<void> {
    while (membershipFinishFence === fence) {
      const observationIndex = fencedRosterObservations.findIndex((observation) =>
        observation.missionId === fence.missionId &&
        observation.missionGeneration === fence.missionGeneration)
      if (observationIndex < 0) {
        membershipFinishFence = null
        return
      }
      const [observation] = fencedRosterObservations.splice(observationIndex, 1)
      if (observation === undefined) continue
      await applyRosterObservation(
        observation.devices,
        observation.observedAt,
        observation.complete,
        true,
      )
    }
  }

  /** Discards observations strictly after a finish cutoff that durably succeeded. */
  function discardFencedRosterObservations(
    fence: MembershipFinishFence,
  ): void {
    fencedRosterObservations = fencedRosterObservations.filter((observation) =>
      observation.missionId !== fence.missionId ||
      observation.missionGeneration !== fence.missionGeneration)
  }

  /** Serializes roster churn while preserving every accepted observation time. */
  async function drainRosterReconciliation(): Promise<void> {
    if (rosterReconciliationRunning) return
    rosterReconciliationRunning = true
    let retryBlocked = false
    try {
      while (pendingRosterObservations.length > 0) {
        const observation = pendingRosterObservations[0]
        if (observation === undefined) break
        if (
          activeMissionId !== observation.missionId ||
          missionGeneration !== observation.missionGeneration
        ) {
          pendingRosterObservations.shift()
          resolveRosterWaiters(observation.version)
          continue
        }
        if (pendingMembershipWrite !== null) {
          const retrySucceeded = await persistMembershipWrite(pendingMembershipWrite)
          if (!retrySucceeded) {
            resolveRosterWaitersThroughQueued(observation.version)
            retryBlocked = true
            break
          }
          if (
            activeMissionId !== observation.missionId ||
            missionGeneration !== observation.missionGeneration
          ) {
            pendingRosterObservations.shift()
            resolveRosterWaiters(observation.version)
            continue
          }
        }
        pendingRosterObservations.shift()
        const changes = collectMembershipChanges(
          participants,
          membershipEvents,
          observation.devices,
          observation.observedAt,
          observation.complete,
        )
        if (changes.length === 0) {
          const recoveredFromWriteError = membershipWriteError !== null
          membershipWriteError = null
          lastReconciledMissionGeneration = observation.missionGeneration
          if (recoveredFromWriteError) publishRuntime()
          resolveRosterWaiters(observation.version)
          continue
        }
        const write: PendingMembershipWrite = {
          missionId: observation.missionId,
          missionGeneration: observation.missionGeneration,
          events: changes,
        }
        pendingMembershipWrite = write
        const writeSucceeded = await persistMembershipWrite(write)
        resolveRosterWaiters(observation.version)
        if (!writeSucceeded) {
          resolveRosterWaitersThroughQueued(observation.version)
          retryBlocked = true
          break
        }
      }
    } finally {
      rosterReconciliationRunning = false
      notifyRosterReconciliationWaiters()
      if (!retryBlocked && pendingRosterObservations.length > 0) {
        void drainRosterReconciliation()
      }
    }
  }

  /** Waits until every roster observation accepted before the finish fence has settled. */
  async function waitForRosterReconciliation(): Promise<void> {
    while (
      inFlightRosterApplicationCount > 0 ||
      rosterReconciliationRunning ||
      (pendingRosterObservations.length > 0 && membershipWriteError === null)
    ) {
      await new Promise<void>((resolve) => {
        rosterReconciliationWaiters.push(resolve)
        if (
          pendingRosterObservations.length > 0 &&
          !rosterReconciliationRunning
        ) void drainRosterReconciliation()
      })
    }
  }

  /** Wakes finish waiters after either application or persistence work settles. */
  function notifyRosterReconciliationWaiters(): void {
    for (const resolve of rosterReconciliationWaiters.splice(0)) resolve()
  }

  /** Persists one immutable observed membership delta until it is durably acknowledged. */
  async function persistMembershipWrite(write: PendingMembershipWrite): Promise<boolean> {
    try {
      const inserted = await dependencies.participantStore.recordGroupMembershipEvents({
        mission_id: write.missionId,
        events: write.events,
      })
      if (
        activeMissionId !== write.missionId ||
        missionGeneration !== write.missionGeneration
      ) return true
      if (inserted.length > 0) {
        membershipEvents = [...membershipEvents, ...inserted]
        membershipNotices = [
          ...membershipNotices,
          ...inserted.map((event) => membershipNotice(event, participants)),
        ]
      } else {
        const reloadedEvents = await dependencies.participantStore
          .listGroupMembershipEvents(write.missionId)
        if (
          activeMissionId !== write.missionId ||
          missionGeneration !== write.missionGeneration
        ) return true
        membershipEvents = reloadedEvents
      }
      if (pendingMembershipWrite === write) pendingMembershipWrite = null
      membershipWriteError = null
      lastReconciledMissionGeneration = write.missionGeneration
      publishRuntime()
      return true
    } catch (runtimeError) {
      if (
        activeMissionId === write.missionId &&
        missionGeneration === write.missionGeneration
      ) {
        pendingMembershipWrite = write
        membershipWriteError =
          `Group membership could not be recorded: ${toErrorMessage(runtimeError)}`
        lastReconciledMissionGeneration = -1
        publishRuntime()
      }
      return false
    }
  }

  /** Settles every roster caller whose observation has now been processed or superseded. */
  function resolveRosterWaiters(version: number): void {
    for (let index = rosterWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = rosterWaiters[index]
      if (waiter !== undefined && waiter.version <= version) {
        rosterWaiters.splice(index, 1)
        waiter.resolve()
      }
    }
  }

  /** Releases poll callers after a visible write failure without dropping queued truth. */
  function resolveRosterWaitersThroughQueued(version: number): void {
    const latestQueuedVersion = pendingRosterObservations.at(-1)?.version ?? version
    resolveRosterWaiters(Math.max(version, latestQueuedVersion))
  }

  /** Allows group selection only when its complete starting membership is known. */
  function canSelectGroups(): boolean {
    return rosterObservationReceived && availableRosterComplete
  }

  /** Combines roster read/completeness and durable reconciliation failures for the operator. */
  function currentRosterError(): string | null {
    return rosterReadError ?? membershipWriteError ?? (
      rosterObservationReceived && !availableRosterComplete
        ? incompleteRosterSelectionError().message
        : null
    )
  }

  /** Updates roster discovery immediately without treating it as durable evidence. */
  function updateAvailableRoster(
    devices: readonly NormalizedTrackingDevice[],
    complete: boolean,
  ): void {
    const rosterChanged = !areRostersEquivalent(availableDevices, devices)
    const completenessChanged = complete !== availableRosterComplete
    const readErrorCleared = rosterReadError !== null
    if (rosterChanged) availableDevices = [...devices]
    availableRosterComplete = complete
    rosterObservationReceived = true
    rosterReadError = null
    if (rosterChanged || completenessChanged || readErrorCleared) publishRuntime()
  }
}

type RosterObservation = {
  readonly version: number
  readonly missionId: string
  readonly missionGeneration: number
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly observedAt: string
  readonly complete: boolean
}

type PendingMembershipWrite = {
  readonly missionId: string
  readonly missionGeneration: number
  readonly events: readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[]
}

type FencedRosterObservation = {
  readonly missionId: string
  readonly missionGeneration: number
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly observedAt: string
  readonly complete: boolean
}

type MembershipFinishFence = {
  readonly missionId: string
  readonly missionGeneration: number
  status: 'pending' | 'replaying' | 'finished'
}

/** Creates the actionable fail-closed reason shown by the mission finish dialog. */
function unresolvedMembershipFinishError(detail: string | null): Error {
  const base =
    'Mission cannot be finished while a group membership change is not durably recorded. Keep the mission active and retry Traccar roster synchronization before finishing.'
  return new Error(detail === null ? base : `${base} ${detail}`)
}

/** Narrows the optional MissionStore participant surface after boot validation. */
export function hasParticipantStoreBoundary(
  store: Partial<ParticipantStoreBoundary>,
): store is ParticipantStoreBoundary {
  return (
    store.selectMissionParticipants !== undefined &&
    store.addMissionParticipant !== undefined &&
    store.removeMissionParticipant !== undefined &&
    store.listMissionParticipants !== undefined &&
    store.recordGroupMembershipEvents !== undefined &&
    store.listGroupMembershipEvents !== undefined &&
    store.listParticipantBackfillCheckpoints !== undefined
  )
}

function collectMembershipChanges(
  participants: readonly MissionParticipant[],
  events: readonly GroupMembershipEvent[],
  devices: readonly NormalizedTrackingDevice[],
  observedAt: string,
  rosterComplete: boolean,
): readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[] {
  const changes: Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[] = []
  for (const participant of participants) {
    if (
      participant.kind !== 'group' ||
      participant.removed_at !== null ||
      participant.mission_team_id === null ||
      participant.traccar_group_id === null
    ) continue

    const current = new Set(
      devices
        .filter((device) => device.group_id === participant.traccar_group_id)
        .map((device) => device.device_id),
    )
    const latestByDevice = new Map<string, GroupMembershipEvent>()
    for (const event of events) {
      if (event.mission_team_id !== participant.mission_team_id) continue
      const previous = latestByDevice.get(event.traccar_device_id)
      if (
        previous === undefined ||
        event.observed_at > previous.observed_at ||
        (event.observed_at === previous.observed_at && event.sequence > previous.sequence)
      ) latestByDevice.set(event.traccar_device_id, event)
    }
    const known = new Set(
      [...latestByDevice.values()]
        .filter((event) => event.change === 'member')
        .map((event) => event.traccar_device_id),
    )
    const candidateIds = [...new Set([...known, ...current])].sort()
    for (const deviceId of candidateIds) {
      if (known.has(deviceId) === current.has(deviceId)) continue
      if (!rosterComplete && known.has(deviceId) && !current.has(deviceId)) continue
      changes.push({
        mission_team_id: participant.mission_team_id,
        traccar_device_id: deviceId,
        change: current.has(deviceId) ? 'member' : 'left',
        observed_at: observedAt,
      })
    }
  }
  return changes
}

/** Returns only current positive roster observations for active selected groups. */
function collectObservedCurrentGroupMembers(
  participants: readonly MissionParticipant[],
  devices: readonly NormalizedTrackingDevice[],
  observedAt: string,
  rosterObservationReceived: boolean,
  pendingEvents: readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[],
): readonly string[] {
  if (!rosterObservationReceived) return []
  const selectedGroupIds = new Set(participants
    .filter((participant) =>
      participant.kind === 'group' &&
      participant.traccar_group_id !== null &&
      participant.effective_from <= observedAt &&
      (participant.removed_at === null || observedAt < participant.removed_at))
    .map((participant) => participant.traccar_group_id!))
  return [...new Set([
    ...devices
    .filter((device) =>
      device.group_id !== null &&
      device.group_id !== undefined &&
      selectedGroupIds.has(device.group_id))
      .map((device) => device.device_id),
    ...pendingEvents
      .filter((event) => event.change === 'member')
      .map((event) => event.traccar_device_id),
  ])].sort()
}

/** Creates the stable fail-closed message used by start and later group selection. */
function incompleteRosterSelectionError(): Error {
  return new Error(
    'Traccar roster is incomplete. Group selection is unavailable until a complete roster is received; individual device selection remains available.',
  )
}

function membershipNotice(
  event: GroupMembershipEvent,
  participants: readonly MissionParticipant[],
): string {
  const teamName = participants.find(
    (participant) => participant.mission_team_id === event.mission_team_id,
  )?.team_name ?? 'selected group'
  const direction = event.change === 'member' ? 'joined' : 'left'
  return `${event.traccar_device_id} ${direction} ${teamName}; mission participation changed from ${event.observed_at}. No earlier evidence was invented.`
}

function requireGroup(
  groups: readonly NormalizedTraccarGroup[],
  groupId: string,
): NormalizedTraccarGroup {
  const group = groups.find((candidate) => candidate.group_id === groupId)
  if (group === undefined) throw new Error(`Selected Traccar group is unavailable: ${groupId}`)
  return group
}

function toggleId(values: readonly string[], id: string): readonly string[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id]
}

/** Compares roster identity and discovery metadata without depending on server row order. */
function areRostersEquivalent(
  current: readonly NormalizedTrackingDevice[],
  incoming: readonly NormalizedTrackingDevice[],
): boolean {
  if (current === incoming) return true
  if (current.length !== incoming.length) return false
  const currentById = new Map(current.map((device) => [device.device_id, device]))
  if (currentById.size !== current.length) return false
  return incoming.every((device) => {
    const previous = currentById.get(device.device_id)
    return previous !== undefined &&
      previous.name === device.name &&
      previous.status === device.status &&
      previous.last_seen === device.last_seen &&
      previous.unique_id === device.unique_id &&
      previous.category === device.category &&
      (previous.group_id ?? null) === (device.group_id ?? null)
  })
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
