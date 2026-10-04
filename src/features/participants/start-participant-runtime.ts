import type { LegacyRosterAttestationInput } from '../../../shared/legacy-roster-attestation.mjs'
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
import type { ParticipantCatalogueSource } from './participant-catalogue'
import type { ParticipantRuntimeState } from './participant-store'
import { createParticipationScope } from './participation-scope'

type ParticipantStoreBoundary = {
  readonly resolveLegacyParticipantRoster?: (input: LegacyRosterAttestationInput) => Promise<MissionParticipant>
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
  /** Reads the live Traccar catalogue source, or null when tracking has none. */
  readonly readCatalogueSource?: () => ParticipantCatalogueSource | null
}

/** The groups and devices ticked in the pre-start picker. */
export type ParticipantDraftSnapshot = {
  readonly groupIds: readonly string[]
  readonly deviceIds: readonly string[]
}

export type ParticipantRuntimeController = {
  readonly refreshMission: (missionId: string | null) => Promise<void>
  readonly refreshBackfillCheckpoints: (missionId: string) => Promise<void>
  readonly applyRoster: (
    devices: readonly NormalizedTrackingDevice[],
    observedAt?: string,
    options?: RosterObservationOptions,
  ) => Promise<void>
  readonly applyGroups: (groups: readonly NormalizedTraccarGroup[]) => void
  readonly reportRosterError: (message: string | null) => void
  /**
   * Re-reads the authorised Traccar groups (and, before a mission exists,
   * devices) so a group added on the server becomes selectable. It only
   * refreshes choices: it never enrols anyone or changes the draft, the
   * participants or their windows. Failure and staleness are published as
   * `catalogueError`; a stale answer is discarded.
   */
  readonly refreshCatalogue: () => Promise<void>
  readonly toggleDraftDevice: (deviceId: string) => void
  readonly toggleDraftGroup: (groupId: string) => void
  readonly clearDraft: () => void
  /** Sets the coordinator-configured team group pre-ticked at Start, or null for none [DON-296]. */
  readonly setDefaultGroup: (groupId: string | null) => void
  /**
   * Returns the operator's pre-start selection as it stands now. The Start
   * handler captures it before creating the mission, because the mission
   * change that follows may clear the live draft (DON-292).
   */
  readonly takeDraftSnapshot: () => ParticipantDraftSnapshot
  readonly selectInitialParticipants: (
    missionId: string,
    selectedBy: string,
    draft?: ParticipantDraftSnapshot,
  ) => Promise<readonly MissionParticipant[]>
  readonly addParticipant: (input: Omit<AddMissionParticipantInput, 'mission_id' | 'ref' | 'kind'> & (
    | { readonly kind: 'device'; readonly ref: string }
    | { readonly kind: 'group'; readonly ref: { readonly traccar_group_id: string; readonly name: string } }
  )) => Promise<MissionParticipant | null>
  readonly resolveLegacyRoster: (input: Omit<LegacyRosterAttestationInput, 'mission_id'>) => Promise<MissionParticipant | null>
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
  // The team's default group is pre-ticked until the coordinator changes the
  // Start selection; it is never forced back after they untick it [DON-296].
  let defaultGroupId: string | null = null
  let autoTickedGroupId: string | null = null
  let draftTouched = false
  let groupsObserved = false
  // A member missing from one complete roster may be a provider glitch; it
  // leaves only when the next complete roster agrees, dated at that
  // confirming roster (Donal, 1 Oct) [DON-300]. Key: team id + device id.
  // A repeat delivery of the roster fetch that started a hold never confirms
  // it: one poll hands one fetch to several snapshots (box run 5a, 2 Oct).
  const pendingAbsences = new Map<string, { readonly observedAt: string, readonly rosterObservationId: string | null }>()
  // The visible "still tracking" notice per team while its whole group is held.
  const pendingGroupNotices = new Map<string, string>()
  let membershipNotices: readonly string[] = []
  let loading = false
  let saving = false
  let rosterReadError: string | null = null
  let membershipWriteError: string | null = null
  let error: string | null = null
  let catalogueRefreshing = false
  let catalogueError: string | null = null
  let catalogueRefreshToken = 0
  let refreshToken = 0
  let backfillRefreshToken = 0
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
      backfillRefreshToken += 1
      const previousMissionId = activeMissionId
      const missionChanged = activeMissionId !== missionId
      if (missionChanged) {
        invalidateCatalogueRefresh()
        missionGeneration += 1
        selectionGeneration += 1
        lastReconciledMissionGeneration = -1
        pendingMembershipWrite = null
        membershipFinishFence = null
        hydrationBlockedRosterObservations = []
        fencedRosterObservations = []
        pendingAbsences.clear()
        pendingGroupNotices.clear()
        membershipWriteError = null
        saving = false
        participants = []
        membershipEvents = []
        backfillCheckpoints = []
        membershipNotices = []
        if (previousMissionId !== null) {
          draftDeviceIds = []
          draftGroupIds = []
          resetDraftDefault()
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
    refreshBackfillCheckpoints: async (missionId) => {
      if (activeMissionId !== missionId) return
      const missionRefreshVersion = refreshToken
      const token = ++backfillRefreshToken
      try {
        const [nextParticipants, nextCheckpoints] = await Promise.all([
          dependencies.participantStore.listMissionParticipants(missionId),
          dependencies.participantStore.listParticipantBackfillCheckpoints(missionId),
        ])
        if (
          activeMissionId !== missionId ||
          token !== backfillRefreshToken ||
          missionRefreshVersion !== refreshToken
        ) return
        participants = nextParticipants
        backfillCheckpoints = nextCheckpoints
        publishRuntime()
      } catch (runtimeError) {
        if (activeMissionId === missionId && token === backfillRefreshToken) {
          error = toErrorMessage(runtimeError)
          publishRuntime()
        }
        throw runtimeError
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
            rosterObservationId: options.rosterObservationId ?? null,
          })
        }
        return
      }
      inFlightRosterApplicationCount += 1
      try {
        await applyRosterObservation(devices, observedAt, options.complete, false, options.rosterObservationId ?? null)
      } finally {
        inFlightRosterApplicationCount -= 1
        notifyRosterReconciliationWaiters()
      }
    },
    applyGroups: (groups) => {
      availableGroups = [...groups]
      groupsObserved = true
      applyDefaultGroupToDraft()
      publishRuntime()
    },
    reportRosterError: (message) => {
      rosterReadError = message
      publishRuntime()
    },
    refreshCatalogue: async () => {
      const token = ++catalogueRefreshToken
      const operationMissionGeneration = missionGeneration
      const source = dependencies.readCatalogueSource?.() ?? null
      if (source === null) {
        catalogueRefreshing = false
        catalogueError = 'Traccar groups cannot be refreshed because tracking is not connected. The groups already listed are unchanged. Check the tracking connection, then retry.'
        publishRuntime()
        return
      }
      catalogueRefreshing = true
      catalogueError = null
      publishRuntime()
      /** True while no newer refresh, mission change or connection change has superseded this one. */
      const isCurrent = (): boolean => token === catalogueRefreshToken &&
        missionGeneration === operationMissionGeneration
      try {
        const catalogue = await source()
        if (!isCurrent()) return
        if (catalogue === null || (dependencies.readCatalogueSource?.() ?? null) !== source) {
          catalogueRefreshing = false
          catalogueError = 'The tracking connection changed while groups were loading, so the answer was discarded. The groups already listed are unchanged. Retry.'
          publishRuntime()
          return
        }
        availableGroups = [...catalogue.groups]
        groupsObserved = true
        applyDefaultGroupToDraft()
        // Before a mission exists the roster is only a catalogue, so it can be
        // refreshed with the groups. In a running mission the poll owns the
        // roster and its durable membership reconciliation; a group-list
        // refresh must not reconcile or enrol anyone on its own.
        if (activeMissionId === null) {
          await controller.applyRoster(catalogue.devices, undefined, { complete: catalogue.rosterComplete })
          if (!isCurrent()) return
        }
        catalogueRefreshing = false
        catalogueError = null
        publishRuntime()
      } catch (refreshError) {
        if (!isCurrent()) return
        catalogueRefreshing = false
        catalogueError = `Traccar groups could not be refreshed. The groups already listed are unchanged. Retry. (${toErrorMessage(refreshError)})`
        publishRuntime()
      }
    },
    toggleDraftDevice: (deviceId) => {
      const device = availableDevices.find((candidate) => candidate.device_id === deviceId)
      if (
        device?.group_id !== null &&
        device?.group_id !== undefined &&
        draftGroupIds.includes(device.group_id)
      ) return
      draftDeviceIds = toggleId(draftDeviceIds, deviceId)
      draftTouched = true
      publishRuntime()
    },
    toggleDraftGroup: (groupId) => {
      toggleDraftGroupSelection(groupId)
      draftTouched = true
      publishRuntime()
    },
    clearDraft: () => {
      draftDeviceIds = []
      draftGroupIds = []
      resetDraftDefault()
      publishRuntime()
    },
    setDefaultGroup: (groupId) => {
      // A changed or cleared default replaces only the automatic tick, and
      // only while the coordinator has not changed the selection themselves.
      if (!draftTouched && autoTickedGroupId !== null && autoTickedGroupId !== groupId) {
        draftGroupIds = draftGroupIds.filter((id) => id !== autoTickedGroupId)
        autoTickedGroupId = null
      }
      defaultGroupId = groupId
      applyDefaultGroupToDraft()
      publishRuntime()
    },
    takeDraftSnapshot: () => ({ groupIds: [...draftGroupIds], deviceIds: [...draftDeviceIds] }),
    selectInitialParticipants: async (missionId, selectedBy, draft) => {
      const selectedGroupIds = draft?.groupIds ?? draftGroupIds
      const selectedDeviceIds = draft?.deviceIds ?? draftDeviceIds
      if (selectedGroupIds.length > 0 && !canSelectGroups()) {
        const selectionError = incompleteRosterSelectionError()
        rosterReadError = selectionError.message
        error = selectionError.message
        publishRuntime()
        throw selectionError
      }
      const operationGeneration = ++selectionGeneration
      if (activeMissionId !== missionId) {
        invalidateCatalogueRefresh()
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
          groups: selectedGroupIds.map((groupId) => {
            const group = requireGroup(availableGroups, groupId)
            return {
              traccar_group_id: group.group_id,
              name: group.name,
              member_device_ids: availableDevices
                .filter((device) => device.group_id === groupId)
                .map((device) => device.device_id),
            }
          }),
          devices: selectedDeviceIds.map((deviceId) => ({ traccar_device_id: deviceId })),
          selected_by: selectedBy,
        })
        if (selectedGroupIds.length + selectedDeviceIds.length > 0 && selected.length === 0) {
          throw new Error(
            'The mission started, but no participants were recorded from the pre-start selection. '
              + 'Add the groups and devices under Participants, choosing History from: Mission start.',
          )
        }
        if (activeMissionId !== missionId || selectionGeneration !== operationGeneration) {
          return selected
        }
        draftDeviceIds = []
        draftGroupIds = []
        resetDraftDefault()
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
      const observedInput = typeof participantRef !== 'string'
        ? {
            ...input,
            ref: {
              ...participantRef,
              member_device_ids: availableDevices
                .filter((device) => device.group_id === participantRef.traccar_group_id)
                .map((device) => device.device_id),
            },
          }
        : { ...input, ref: participantRef }
      return dependencies.participantStore.addMissionParticipant({
        mission_id: missionId,
        ...observedInput,
      })
    }),
    resolveLegacyRoster: async (input) => mutate(async (missionId) => {
      if (!dependencies.participantStore.resolveLegacyParticipantRoster) {
        throw new Error('Legacy roster recovery is unavailable in this runtime.')
      }
      return dependencies.participantStore.resolveLegacyParticipantRoster({ ...input, mission_id: missionId })
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
          // Only this mission's holds: another mission may be active by now.
          clearHeldAbsences()
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
      defaultGroupId,
      defaultGroupMissing: defaultGroupId !== null && groupsObserved
        && !availableGroups.some((group) => group.group_id === defaultGroupId),
      membershipNotices,
      scope,
      envelope: assessParticipantEnvelope(scope.operationalDeviceIdsAt(now().toISOString())),
      loading,
      saving,
      rosterError: currentRosterError(),
      catalogueRefreshing,
      catalogueError,
      error,
    })
  }

  /** Abandons any catalogue refresh in flight; its answer will be discarded. */
  function invalidateCatalogueRefresh(): void {
    catalogueRefreshToken += 1
    catalogueRefreshing = false
  }

  /** Applies one accepted roster observation without crossing the finish cutoff again. */
  async function applyRosterObservation(
    devices: readonly NormalizedTrackingDevice[],
    observedAt: string,
    complete: boolean,
    forceReconciliation = false,
    rosterObservationId: string | null = null,
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
          rosterObservationId,
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
        false,
        observation.rosterObservationId,
      )
    }
    await acceptRosterObservation(devices, observedAt, complete, forceReconciliation, rosterObservationId)
  }

  /** Publishes and queues one roster observation after participant scope is available. */
  async function acceptRosterObservation(
    devices: readonly NormalizedTrackingDevice[],
    observedAt: string,
    complete: boolean,
    forceReconciliation = false,
    rosterObservationId: string | null = null,
  ): Promise<void> {
    const rosterChanged = !areRostersEquivalent(availableDevices, devices)
    const completenessChanged = complete !== availableRosterComplete
    const readErrorCleared = rosterReadError !== null
    const retryRequired = membershipWriteError !== null
    const missionNeedsReconciliation =
      activeMissionId !== null && lastReconciledMissionGeneration !== missionGeneration
    // An unchanged roster still confirms (or clears) a pending absence.
    const absenceAwaitingConfirmation = pendingAbsences.size > 0
    if (
      !forceReconciliation &&
      !rosterChanged &&
      !completenessChanged &&
      !readErrorCleared &&
      !retryRequired &&
      !missionNeedsReconciliation &&
      !absenceAwaitingConfirmation
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
      rosterObservationId,
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
        observation.rosterObservationId,
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
        const noticesBefore = membershipNotices
        const changes = confirmAbsences(collectMembershipChanges(
          participants,
          membershipEvents,
          observation.devices,
          observation.observedAt,
          observation.complete,
        ), observation)
        if (changes.length === 0) {
          const recoveredFromWriteError = membershipWriteError !== null
          membershipWriteError = null
          lastReconciledMissionGeneration = observation.missionGeneration
          if (recoveredFromWriteError || membershipNotices !== noticesBefore) publishRuntime()
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

  /**
   * Holds each "left" until a second complete roster confirms the absence;
   * the leave is dated at the confirming roster, never back-dated. Any
   * positive sighting, even in an incomplete roster, cancels a held absence.
   * A whole group going missing shows one "still tracking" notice, replaced
   * when the absence resolves [DON-300].
   */
  function confirmAbsences(
    changes: readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[],
    observation: {
      readonly observedAt: string
      readonly complete: boolean
      readonly devices: readonly NormalizedTrackingDevice[]
      readonly rosterObservationId: string | null
    },
  ): readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[] {
    const keyOf = (teamId: string, deviceId: string) => `${teamId}\u0000${deviceId}`
    const groupOfTeam = (teamId: string) =>
      participants.find((participant) => participant.mission_team_id === teamId)?.traccar_group_id ?? null
    const seenInGroup = new Set(observation.devices.flatMap((device) =>
      device.group_id === null || device.group_id === undefined ? [] : [`${device.group_id}\u0000${device.device_id}`]))
    for (const key of [...pendingAbsences.keys()]) {
      const [teamId, deviceId] = key.split('\u0000') as [string, string]
      if (seenInGroup.has(`${groupOfTeam(teamId)}\u0000${deviceId}`)) pendingAbsences.delete(key)
    }
    let kept: readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[] = changes
    const confirmedTeams = new Set<string>()
    if (observation.complete) {
      const absentNow = new Set(changes.filter((change) => change.change === 'left')
        .map((change) => keyOf(change.mission_team_id, change.traccar_device_id)))
      for (const key of [...pendingAbsences.keys()]) {
        if (!absentNow.has(key)) pendingAbsences.delete(key)
      }
      const next: Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[] = []
      const newlyMissingByTeam = new Map<string, number>()
      for (const change of changes) {
        if (change.change !== 'left') {
          next.push(change)
          continue
        }
        const key = keyOf(change.mission_team_id, change.traccar_device_id)
        const firstAbsence = pendingAbsences.get(key)
        const sameFetch = firstAbsence !== undefined &&
          firstAbsence.rosterObservationId !== null &&
          firstAbsence.rosterObservationId === observation.rosterObservationId
        if (firstAbsence !== undefined && !sameFetch && firstAbsence.observedAt < observation.observedAt) {
          next.push(change)
          pendingAbsences.delete(key)
          confirmedTeams.add(change.mission_team_id)
        } else if (firstAbsence === undefined) {
          pendingAbsences.set(key, { observedAt: observation.observedAt, rosterObservationId: observation.rosterObservationId })
          newlyMissingByTeam.set(change.mission_team_id, (newlyMissingByTeam.get(change.mission_team_id) ?? 0) + 1)
        }
      }
      kept = next
      for (const [teamId, missing] of newlyMissingByTeam) {
        if (missing < 2 || missing !== currentMemberCount(membershipEvents, teamId)) continue
        const notice = `All ${missing} devices in ${teamNameOf(teamId)} are missing from the tracking server's roster; SAR Tracker is still tracking them until the next roster confirms it.`
        pendingGroupNotices.set(teamId, notice)
        membershipNotices = [...membershipNotices, notice]
      }
    }
    for (const [teamId, notice] of [...pendingGroupNotices]) {
      const held = [...pendingAbsences.keys()].filter((key) => key.startsWith(`${teamId}\u0000`)).length
      if (held > 0) {
        // Some members came back: describe only the remaining absence.
        const updated = `${held} device${held === 1 ? '' : 's'} in ${teamNameOf(teamId)} ${held === 1 ? 'is' : 'are'} missing from the tracking server's roster; SAR Tracker is still tracking ${held === 1 ? 'it' : 'them'} until the next roster confirms it.`
        if (updated !== notice) {
          pendingGroupNotices.set(teamId, updated)
          membershipNotices = [...membershipNotices.filter((candidate) => candidate !== notice), updated]
        }
        continue
      }
      pendingGroupNotices.delete(teamId)
      membershipNotices = membershipNotices.filter((candidate) => candidate !== notice)
      // A confirmed leave gets its own notice when the write lands.
      if (!confirmedTeams.has(teamId)) {
        membershipNotices = [...membershipNotices,
          `All ${teamNameOf(teamId)} devices are back on the tracking server's roster; nothing changed.`]
      }
    }
    return kept
  }

  /**
   * A finished mission accepts no further rosters, so an unconfirmed hold can
   * never resolve. Drop it and its provisional notice; no leave is invented.
   */
  function clearHeldAbsences(): void {
    const provisional = new Set(pendingGroupNotices.values())
    pendingAbsences.clear()
    pendingGroupNotices.clear()
    if (provisional.size === 0) return
    membershipNotices = membershipNotices.filter((notice) => !provisional.has(notice))
    publishRuntime()
  }

  /** The coordinator-facing name of a mission team. */
  function teamNameOf(teamId: string): string {
    return participants.find((participant) => participant.mission_team_id === teamId)?.team_name ?? 'selected group'
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
          ...collapseMembershipNotices(inserted, participants),
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
  /** Adds or removes one group in the Start selection, dropping devices it now covers. */
  function toggleDraftGroupSelection(groupId: string): void {
    const selectingGroup = !draftGroupIds.includes(groupId)
    draftGroupIds = toggleId(draftGroupIds, groupId)
    if (selectingGroup) {
      const coveredDeviceIds = new Set(availableDevices
        .filter((device) => device.group_id === groupId)
        .map((device) => device.device_id))
      draftDeviceIds = draftDeviceIds.filter((deviceId) =>
        !coveredDeviceIds.has(deviceId))
    }
  }

  /**
   * Pre-ticks the team's default group in an untouched Start selection, only
   * when the roster is complete (Start refuses a group from an incomplete
   * roster). The draft is read only by the Start step, so ticking it while a
   * mission runs enrols no one; it prepares the next Start, including after
   * Finish, when this runtime still points at the finished mission.
   */
  function applyDefaultGroupToDraft(): void {
    if (defaultGroupId === null || draftTouched) return
    if (draftGroupIds.includes(defaultGroupId) || !canSelectGroups()) return
    if (!availableGroups.some((group) => group.group_id === defaultGroupId)) return
    toggleDraftGroupSelection(defaultGroupId)
    autoTickedGroupId = defaultGroupId
  }

  /** Starts a fresh Start selection that again receives the team default. */
  function resetDraftDefault(): void {
    draftTouched = false
    autoTickedGroupId = null
    applyDefaultGroupToDraft()
  }

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
    const draftBefore = draftGroupIds
    applyDefaultGroupToDraft()
    if (rosterChanged || completenessChanged || readErrorCleared || draftBefore !== draftGroupIds) publishRuntime()
  }
}

type RosterObservation = {
  readonly version: number
  readonly missionId: string
  readonly missionGeneration: number
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly observedAt: string
  readonly complete: boolean
  readonly rosterObservationId: string | null
}

/**
 * How a roster was observed. `rosterObservationId` names the provider fetch
 * it came from; the same fetch delivered again is not a second roster.
 */
export type RosterObservationOptions = {
  readonly complete: boolean
  readonly rosterObservationId?: string
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
  readonly rosterObservationId: string | null
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

/** Counts devices whose latest membership event for the team is "member". */
function currentMemberCount(events: readonly GroupMembershipEvent[], teamId: string): number {
  const latest = new Map<string, GroupMembershipEvent>()
  for (const event of events) {
    if (event.mission_team_id !== teamId) continue
    const previous = latest.get(event.traccar_device_id)
    if (previous === undefined || event.observed_at > previous.observed_at
      || (event.observed_at === previous.observed_at && event.sequence > previous.sequence)) {
      latest.set(event.traccar_device_id, event)
    }
  }
  return [...latest.values()].filter((event) => event.change === 'member').length
}

/** One notice per team and direction when several devices change together [DON-300]. */
function collapseMembershipNotices(
  events: readonly GroupMembershipEvent[],
  participants: readonly MissionParticipant[],
): readonly string[] {
  const groups = new Map<string, GroupMembershipEvent[]>()
  for (const event of events) {
    const key = `${event.mission_team_id}\u0000${event.change}`
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return membershipNotice(group[0]!, participants)
    const first = group[0]!
    const teamName = participants.find((participant) => participant.mission_team_id === first.mission_team_id)?.team_name ?? 'selected group'
    const direction = first.change === 'member' ? 'joined' : 'left'
    const from = group.map((event) => event.observed_at).sort()[0]
    return `${group.length} devices ${direction} ${teamName} (${group.map((event) => event.traccar_device_id).join(', ')}); mission participation changed from ${from}. No earlier evidence was invented.`
  })
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
