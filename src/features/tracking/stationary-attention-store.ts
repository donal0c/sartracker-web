import { create } from 'zustand'

import {
  DEFAULT_STATIONARY_ATTENTION_CONFIG,
  sanitizeStationaryAttentionConfig,
  type StationaryAttentionConfig,
  type StationaryAttentionEvaluation,
} from './stationary-attention'
import { createStationaryAttentionProjector } from './stationary-attention-projection'
import type { TrackingSnapshot } from './tracking-types'

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

const stationaryAttentionProjector = createStationaryAttentionProjector()

export const useStationaryAttentionStore = create<StationaryAttentionStore>((set, get) => ({
  missionId: null,
  byDevice: {},
  config: DEFAULT_STATIONARY_ATTENTION_CONFIG,
  applySnapshot: (snapshot, suppliedMissionId, activeDeviceIds) => {
    const current = get()
    const missionId = suppliedMissionId === undefined ? current.missionId : suppliedMissionId
    const evidenceIsIdentical = hasIdenticalStationaryEvidence(
      snapshot,
      missionId,
      activeDeviceIds,
      current.config,
    )
    if (Object.keys(current.byDevice).length > 0 && evidenceIsIdentical) {
      return
    }
    const previous = missionId === get().missionId ? get().byDevice : {}
    const evaluations = stationaryAttentionProjector.project(
      snapshot,
      current.config,
      activeDeviceIds,
    )
    const byDevice: Record<string, DeviceStationaryAttention> = {}
    const activeDeviceIdSet = activeDeviceIds === undefined || activeDeviceIds.length === 0
      ? null
      : new Set(activeDeviceIds)
    for (const device of snapshot.devices) {
      if (activeDeviceIdSet !== null && !activeDeviceIdSet.has(device.device_id)) continue
      const evaluation = evaluations.get(device.device_id)
      if (evaluation === undefined) continue
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
  setConfig: (input) => {
    previousSnapshot = null
    stationaryAttentionProjector.reset()
    set({ config: sanitizeStationaryAttentionConfig(input) })
  },
}))

let previousSnapshot: TrackingSnapshot | null = null
let previousMissionId: string | null = null
let previousActiveDeviceKey = ''
let previousConfig: StationaryAttentionConfig | null = null

/** Skips duplicate runtime publications that contain the same immutable evidence arrays. */
function hasIdenticalStationaryEvidence(
  snapshot: TrackingSnapshot,
  missionId: string | null,
  activeDeviceIds: readonly string[] | undefined,
  config: StationaryAttentionConfig,
): boolean {
  const activeDeviceKey = activeDeviceIds === undefined
    ? '*'
    : [...activeDeviceIds].sort().join('\u0000')
  const identical = previousSnapshot?.positions === snapshot.positions &&
    previousSnapshot.breadcrumbs === snapshot.breadcrumbs &&
    previousSnapshot.devices === snapshot.devices &&
    previousMissionId === missionId &&
    previousActiveDeviceKey === activeDeviceKey &&
    previousConfig === config
  previousSnapshot = snapshot
  previousMissionId = missionId
  previousActiveDeviceKey = activeDeviceKey
  previousConfig = config
  return identical
}

/** Publishes a derived attention snapshot without changing evidence truth. */
export function applyStationaryAttentionSnapshot(
  snapshot: TrackingSnapshot,
  missionId?: string | null,
  activeDeviceIds?: readonly string[],
): void {
  useStationaryAttentionStore.getState().applySnapshot(snapshot, missionId, activeDeviceIds)
}
