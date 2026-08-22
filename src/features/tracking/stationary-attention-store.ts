import { create } from 'zustand'

import {
  DEFAULT_STATIONARY_ATTENTION_CONFIG,
  evaluateStationaryAttention,
  sanitizeStationaryAttentionConfig,
  type StationaryAttentionConfig,
  type StationaryAttentionEvaluation,
} from './stationary-attention'
import { createTrackingPositionIdentityKey } from './tracking-position-identity'
import type { NormalizedTrackingPosition, TrackingSnapshot } from './tracking-types'

export type DeviceStationaryAttention = StationaryAttentionEvaluation & {
  readonly acknowledged: boolean
}

export type StationaryAttentionStore = {
  readonly missionId: string | null
  readonly byDevice: Readonly<Record<string, DeviceStationaryAttention>>
  readonly config: StationaryAttentionConfig
  readonly applySnapshot: (
    snapshot: TrackingSnapshot,
    missionId?: string | null,
    activeDeviceIds?: readonly string[],
  ) => void
  readonly acknowledge: (deviceId: string) => void
  readonly setConfig: (input: unknown) => void
}

export const useStationaryAttentionStore = create<StationaryAttentionStore>((set, get) => ({
  missionId: null,
  byDevice: {},
  config: DEFAULT_STATIONARY_ATTENTION_CONFIG,
  applySnapshot: (snapshot, suppliedMissionId, activeDeviceIds) => {
    const missionId = suppliedMissionId === undefined ? get().missionId : suppliedMissionId
    const previous = missionId === get().missionId ? get().byDevice : {}
    const fixesByDevice = groupAcceptedFixes(snapshot)
    const byDevice: Record<string, DeviceStationaryAttention> = {}
    const activeDeviceIdSet = activeDeviceIds === undefined || activeDeviceIds.length === 0
      ? null
      : new Set(activeDeviceIds)
    for (const device of snapshot.devices) {
      if (activeDeviceIdSet !== null && !activeDeviceIdSet.has(device.device_id)) continue
      const evaluation = evaluateStationaryAttention(
        fixesByDevice.get(device.device_id) ?? [],
        get().config,
      )
      byDevice[device.device_id] = {
        ...evaluation,
        acknowledged:
          evaluation.state === 'attention' && previous[device.device_id]?.state === 'attention'
            ? previous[device.device_id]?.acknowledged === true
            : false,
      }
    }
    set({ missionId, byDevice })
  },
  acknowledge: (deviceId) => set((state) => {
    const current = state.byDevice[deviceId]
    if (current?.state !== 'attention') {
      return state
    }
    return { byDevice: { ...state.byDevice, [deviceId]: { ...current, acknowledged: true } } }
  }),
  setConfig: (input) => set({ config: sanitizeStationaryAttentionConfig(input) }),
}))

/** Publishes a derived attention snapshot without changing evidence truth. */
export function applyStationaryAttentionSnapshot(
  snapshot: TrackingSnapshot,
  missionId?: string | null,
  activeDeviceIds?: readonly string[],
): void {
  useStationaryAttentionStore.getState().applySnapshot(snapshot, missionId, activeDeviceIds)
}

function groupAcceptedFixes(snapshot: TrackingSnapshot): Map<string, NormalizedTrackingPosition[]> {
  const byDevice = new Map<string, Map<string, NormalizedTrackingPosition>>()
  for (const fix of [...snapshot.breadcrumbs, ...snapshot.positions]) {
    const fixes = byDevice.get(fix.device_id) ?? new Map<string, NormalizedTrackingPosition>()
    fixes.set(createTrackingPositionIdentityKey(fix), fix)
    byDevice.set(fix.device_id, fixes)
  }
  return new Map([...byDevice].map(([deviceId, fixes]) => [deviceId, [...fixes.values()]]))
}
