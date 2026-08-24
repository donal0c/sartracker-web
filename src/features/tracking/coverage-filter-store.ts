import { create } from 'zustand'

import type {
  CoverageChunkKey,
  CoverageManifest,
} from '../../infrastructure/mission-store/tauri-mission-store'

export type CoverageFilterState = {
  readonly missionId: string | null
  readonly omittedDeviceIds: readonly string[]
  readonly omittedPeriodKeys: readonly string[]
  readonly reconcile: (missionId: string, manifest: CoverageManifest) => void
  readonly resetMission: (missionId: string | null) => void
  readonly setDeviceVisibility: (deviceId: string, visible: boolean) => void
  readonly setPeriodVisibility: (periodKey: string, visible: boolean) => void
}

const EMPTY_FILTERS = {
  missionId: null,
  omittedDeviceIds: [] as readonly string[],
  omittedPeriodKeys: [] as readonly string[],
}

/** Stores mission-keyed renderer omissions; it has no persistence adapter. */
export const useCoverageFilterStore = create<CoverageFilterState>((set) => ({
  ...EMPTY_FILTERS,
  reconcile: (missionId, manifest) => set((state) => {
    if (state.missionId !== missionId) {
      return { missionId, omittedDeviceIds: [], omittedPeriodKeys: [] }
    }
    const deviceIds = new Set(manifest.chunks.map((chunk) => chunk.key.device_id))
    const periodKeys = new Set(manifest.chunks.map((chunk) => coveragePeriodKey(chunk.key)))
    const omittedDeviceIds = state.omittedDeviceIds.filter((id) => deviceIds.has(id))
    const omittedPeriodKeys = state.omittedPeriodKeys.filter((key) => periodKeys.has(key))
    return arraysEqual(omittedDeviceIds, state.omittedDeviceIds) &&
      arraysEqual(omittedPeriodKeys, state.omittedPeriodKeys)
      ? state
      : { omittedDeviceIds, omittedPeriodKeys }
  }),
  resetMission: (missionId) => set((state) => state.missionId === missionId
    ? state
    : { missionId, omittedDeviceIds: [], omittedPeriodKeys: [] }),
  setDeviceVisibility: (deviceId, visible) => set((state) => ({
    omittedDeviceIds: updateOmission(state.omittedDeviceIds, deviceId, visible),
  })),
  setPeriodVisibility: (periodKey, visible) => set((state) => ({
    omittedPeriodKeys: updateOmission(state.omittedPeriodKeys, periodKey, visible),
  })),
}))

/** Selects the exact claim denominator without changing evidence or live scope. */
export function selectCoverageChunkKeys(
  manifest: CoverageManifest | null,
  filters: Pick<CoverageFilterState, 'omittedDeviceIds' | 'omittedPeriodKeys'>,
): readonly CoverageChunkKey[] | undefined {
  if (filters.omittedDeviceIds.length === 0 && filters.omittedPeriodKeys.length === 0) {
    return undefined
  }
  if (manifest === null) return []
  const omittedDevices = new Set(filters.omittedDeviceIds)
  const omittedPeriods = new Set(filters.omittedPeriodKeys)
  return manifest.chunks
    .filter((chunk) => !omittedDevices.has(chunk.key.device_id) &&
      !omittedPeriods.has(coveragePeriodKey(chunk.key)))
    .map((chunk) => chunk.key)
}

export function coveragePeriodKey(key: CoverageChunkKey): string {
  return `${key.period_kind}\u0000${key.period_id}`
}

function updateOmission(
  current: readonly string[],
  identity: string,
  visible: boolean,
): readonly string[] {
  const omitted = current.includes(identity)
  if (visible) return omitted ? current.filter((entry) => entry !== identity) : current
  return omitted ? current : [...current, identity]
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
