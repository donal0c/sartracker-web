import { create } from 'zustand'

import {
  DEFAULT_STATIONARY_ATTENTION_CONFIG,
  evaluateStationaryAttention,
  type StationaryAttentionEvaluation,
} from './stationary-attention'
import type { NormalizedTrackingPosition, TrackingSnapshot } from './tracking-types'

export type DeviceStationaryAttention = StationaryAttentionEvaluation & {
  readonly acknowledged: boolean
}

export type StationaryAttentionStore = {
  readonly missionId: string | null
  readonly byDevice: Readonly<Record<string, DeviceStationaryAttention>>
  readonly applySnapshot: (snapshot: TrackingSnapshot, missionId?: string | null) => void
  readonly acknowledge: (deviceId: string) => void
}

export const useStationaryAttentionStore = create<StationaryAttentionStore>((set, get) => ({
  missionId: null,
  byDevice: {},
  applySnapshot: (snapshot, suppliedMissionId) => {
    const missionId = suppliedMissionId === undefined ? get().missionId : suppliedMissionId
    const previous = missionId === get().missionId ? get().byDevice : {}
    const fixesByDevice = groupAcceptedFixes(snapshot)
    const byDevice: Record<string, DeviceStationaryAttention> = {}
    for (const device of snapshot.devices) {
      const evaluation = evaluateStationaryAttention(
        fixesByDevice.get(device.device_id) ?? [],
        DEFAULT_STATIONARY_ATTENTION_CONFIG,
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
}))

/** Publishes a derived attention snapshot without changing evidence truth. */
export function applyStationaryAttentionSnapshot(
  snapshot: TrackingSnapshot,
  missionId?: string | null,
): void {
  useStationaryAttentionStore.getState().applySnapshot(snapshot, missionId)
}

function groupAcceptedFixes(snapshot: TrackingSnapshot): Map<string, NormalizedTrackingPosition[]> {
  const byDevice = new Map<string, Map<string, NormalizedTrackingPosition>>()
  for (const fix of [...snapshot.breadcrumbs, ...snapshot.positions]) {
    const fixes = byDevice.get(fix.device_id) ?? new Map<string, NormalizedTrackingPosition>()
    fixes.set(fix.id, fix)
    byDevice.set(fix.device_id, fixes)
  }
  return new Map([...byDevice].map(([deviceId, fixes]) => [deviceId, [...fixes.values()]]))
}
