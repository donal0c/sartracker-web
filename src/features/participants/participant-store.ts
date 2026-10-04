import { create } from 'zustand'

import type {
  GroupMembershipEvent,
  MissionParticipant,
  ParticipantBackfillCheckpoint,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  NormalizedTrackingDevice,
  NormalizedTraccarGroup,
} from '../tracking/tracking-types'
import {
  assessParticipantEnvelope,
  type ParticipantEnvelopeAssessment,
} from './participant-envelope'
import {
  EMPTY_PARTICIPATION_SCOPE,
  type ParticipationScope,
} from './participation-scope'
import type { ParticipantCatalogueSource } from './participant-catalogue'
import type { ParticipantRuntimeController } from './start-participant-runtime'

export type ParticipantRuntimeState = {
  readonly activeMissionId: string | null
  readonly participants: readonly MissionParticipant[]
  readonly membershipEvents: readonly GroupMembershipEvent[]
  readonly backfillCheckpoints: readonly ParticipantBackfillCheckpoint[]
  readonly availableDevices: readonly NormalizedTrackingDevice[]
  readonly availableGroups: readonly NormalizedTraccarGroup[]
  readonly draftDeviceIds: readonly string[]
  readonly draftGroupIds: readonly string[]
  /** The team's default group from Settings, pre-ticked at Start [DON-296]. */
  readonly defaultGroupId: string | null
  /** True when the default group is set but the tracking server has no such group. */
  readonly defaultGroupMissing: boolean
  readonly membershipNotices: readonly string[]
  readonly scope: ParticipationScope
  readonly envelope: ParticipantEnvelopeAssessment
  readonly loading: boolean
  readonly saving: boolean
  readonly rosterError: string | null
  /** True while a Traccar group/device catalogue refresh is in flight [DON-330]. */
  readonly catalogueRefreshing: boolean
  /** Why the last catalogue refresh failed; null when it succeeded or none ran. */
  readonly catalogueError: string | null
  readonly error: string | null
}

type ParticipantStoreState = ParticipantRuntimeState & {
  readonly controller: ParticipantRuntimeController | null
  /** The live Traccar catalogue reader, registered by the tracking runtime. */
  readonly catalogueSource: ParticipantCatalogueSource | null
  readonly applyRuntime: (runtime: ParticipantRuntimeState) => void
  readonly applyController: (controller: ParticipantRuntimeController) => void
}

const EMPTY_PARTICIPANT_RUNTIME: ParticipantRuntimeState = {
  activeMissionId: null,
  participants: [],
  membershipEvents: [],
  backfillCheckpoints: [],
  availableDevices: [],
  availableGroups: [],
  draftDeviceIds: [],
  draftGroupIds: [],
  defaultGroupId: null,
  defaultGroupMissing: false,
  membershipNotices: [],
  scope: EMPTY_PARTICIPATION_SCOPE,
  envelope: assessParticipantEnvelope([]),
  loading: false,
  saving: false,
  rosterError: null,
  catalogueRefreshing: false,
  catalogueError: null,
  error: null,
}

export const useParticipantStore = create<ParticipantStoreState>((set) => ({
  ...EMPTY_PARTICIPANT_RUNTIME,
  controller: null,
  catalogueSource: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

/** Applies participant runtime state outside React render code. */
export function applyParticipantRuntime(runtime: ParticipantRuntimeState): void {
  useParticipantStore.setState(runtime)
}

/** Registers or clears the participant controller and its safety scope. */
export function applyParticipantController(controller: ParticipantRuntimeController | null): void {
  useParticipantStore.setState(controller === null
    ? { ...EMPTY_PARTICIPANT_RUNTIME, controller: null }
    : { controller })
}

/**
 * Registers the live Traccar catalogue reader and returns its unregister
 * function. Unregistering clears the reader only if it is still the current
 * one, so a replaced connection cannot remove its successor.
 */
export function registerParticipantCatalogueSource(
  source: ParticipantCatalogueSource,
): () => void {
  useParticipantStore.setState({ catalogueSource: source })
  return () => {
    if (useParticipantStore.getState().catalogueSource === source) {
      useParticipantStore.setState({ catalogueSource: null })
    }
  }
}
