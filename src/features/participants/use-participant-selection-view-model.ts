import type {
  NormalizedTrackingDevice,
  NormalizedTraccarGroup,
} from '../tracking/tracking-types'
import { assessParticipantEnvelope } from './participant-envelope'
import { useParticipantStore } from './participant-store'
import type { ParticipantRuntimeController } from './start-participant-runtime'

type ParticipantSelectionSourceState = {
  readonly controller: ParticipantRuntimeController | null
  readonly availableDevices: readonly NormalizedTrackingDevice[]
  readonly availableGroups: readonly NormalizedTraccarGroup[]
  readonly draftDeviceIds: readonly string[]
  readonly draftGroupIds: readonly string[]
  readonly rosterError: string | null
}

export type ParticipantSelectionViewModel = {
  readonly availableDevices: readonly {
    readonly deviceId: string
    readonly name: string
    readonly uniqueId: string | null
    readonly reportingNow: boolean
    readonly selected: boolean
    readonly coveredBySelectedGroup: boolean
  }[]
  readonly availableGroups: readonly {
    readonly groupId: string
    readonly name: string
    readonly selected: boolean
    readonly currentMemberCount: number
  }[]
  readonly selectedDeviceCount: number
  readonly envelopeWarning: string | null
  readonly identityWarning: string | null
  readonly rosterError: string | null
  readonly toggleDevice: (deviceId: string) => void
  readonly toggleGroup: (groupId: string) => void
}

/** Builds the mission-start participant picker without mutating roster identity. */
export function createParticipantSelectionViewModel(
  state: ParticipantSelectionSourceState,
): ParticipantSelectionViewModel {
  const selectedIds = new Set(state.draftDeviceIds)
  for (const device of state.availableDevices) {
    if (device.group_id !== undefined && device.group_id !== null &&
      state.draftGroupIds.includes(device.group_id)) {
      selectedIds.add(device.device_id)
    }
  }
  const envelope = assessParticipantEnvelope([...selectedIds])

  return {
    availableDevices: state.availableDevices.map((device) => {
      const coveredBySelectedGroup =
        device.group_id !== null &&
        device.group_id !== undefined &&
        state.draftGroupIds.includes(device.group_id)
      return {
        deviceId: device.device_id,
        name: device.name,
        uniqueId: device.unique_id,
        reportingNow: device.status === 'online',
        selected: coveredBySelectedGroup || state.draftDeviceIds.includes(device.device_id),
        coveredBySelectedGroup,
      }
    }),
    availableGroups: state.availableGroups.map((group) => ({
      groupId: group.group_id,
      name: group.name,
      selected: state.draftGroupIds.includes(group.group_id),
      currentMemberCount: state.availableDevices.filter(
        (device) => device.group_id === group.group_id,
      ).length,
    })),
    selectedDeviceCount: envelope.activeDeviceCount,
    envelopeWarning: envelope.warning,
    identityWarning: duplicateIdentityWarning(state.availableDevices),
    rosterError: state.rosterError,
    toggleDevice: (deviceId) => state.controller?.toggleDraftDevice(deviceId),
    toggleGroup: (groupId) => state.controller?.toggleDraftGroup(groupId),
  }
}

/** Selects the participant picker model from the shared runtime store. */
export function useParticipantSelectionViewModel(): ParticipantSelectionViewModel {
  return createParticipantSelectionViewModel(useParticipantStore())
}

function duplicateIdentityWarning(
  devices: readonly NormalizedTrackingDevice[],
): string | null {
  const idsByUniqueId = new Map<string, string[]>()
  for (const device of devices) {
    if (device.unique_id === null || device.unique_id.trim() === '') continue
    const ids = idsByUniqueId.get(device.unique_id) ?? []
    ids.push(device.device_id)
    idsByUniqueId.set(device.unique_id, ids)
  }
  const duplicates = [...idsByUniqueId.entries()]
    .filter(([, deviceIds]) => deviceIds.length > 1)
    .map(([uniqueId, deviceIds]) => `${uniqueId}: ${deviceIds.sort().join(', ')}`)
  return duplicates.length === 0
    ? null
    : `Duplicate Traccar unique IDs detected (${duplicates.join('; ')}). Numeric device IDs remain canonical; these devices will not be merged.`
}
