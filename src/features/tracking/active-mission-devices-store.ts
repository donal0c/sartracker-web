import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ActiveMissionDevicesState = {
  readonly activeDeviceIdsByMission: Readonly<Record<string, readonly string[]>>
  readonly getActiveDeviceIds: (missionId: string | null) => readonly string[]
  readonly setDeviceActive: (missionId: string, deviceId: string, active: boolean) => void
}

const EMPTY_ACTIVE_DEVICE_IDS: readonly string[] = []

/**
 * Stores the operator-selected devices that are actively participating in each mission.
 */
export const useActiveMissionDevicesStore = create<ActiveMissionDevicesState>()(
  persist(
    (set, get) => ({
      activeDeviceIdsByMission: {},
      getActiveDeviceIds: (missionId) =>
        missionId === null
          ? EMPTY_ACTIVE_DEVICE_IDS
          : get().activeDeviceIdsByMission[missionId] ?? EMPTY_ACTIVE_DEVICE_IDS,
      setDeviceActive: (missionId, deviceId, active) =>
        set((state) => {
          const current = state.activeDeviceIdsByMission[missionId] ?? []
          const next = active
            ? current.includes(deviceId)
              ? current
              : [...current, deviceId].sort()
            : current.filter((candidate) => candidate !== deviceId)

          return {
            activeDeviceIdsByMission: {
              ...state.activeDeviceIdsByMission,
              [missionId]: next,
            },
          }
        }),
    }),
    {
      name: 'sartracker:active-mission-devices',
      partialize: (state) => ({
        activeDeviceIdsByMission: state.activeDeviceIdsByMission,
      }),
    },
  ),
)
