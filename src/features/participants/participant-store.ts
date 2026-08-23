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
  readonly membershipNotices: readonly string[]
  readonly scope: ParticipationScope
  readonly envelope: ParticipantEnvelopeAssessment
  readonly loading: boolean
  readonly saving: boolean
  readonly rosterError: string | null
  readonly error: string | null
}

type ParticipantStoreState = ParticipantRuntimeState & {
  readonly controller: ParticipantRuntimeController | null
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
  membershipNotices: [],
  scope: EMPTY_PARTICIPATION_SCOPE,
  envelope: assessParticipantEnvelope([]),
  loading: false,
  saving: false,
  rosterError: null,
  error: null,
}

export const useParticipantStore = create<ParticipantStoreState>((set) => ({
  ...EMPTY_PARTICIPANT_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

/** Applies participant runtime state outside React render code. */
export function applyParticipantRuntime(runtime: ParticipantRuntimeState): void {
  useParticipantStore.setState(runtime)
}

/** Registers the participant controller for mission and tracking surfaces. */
export function applyParticipantController(controller: ParticipantRuntimeController): void {
  useParticipantStore.setState({ controller })
}
