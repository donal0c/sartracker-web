import { create } from 'zustand'

type DeviceWorkspaceStoreState = {
  readonly open: boolean
  readonly selectedDeviceId: string | null
  readonly openWorkspace: () => void
  readonly closeWorkspace: () => void
  readonly selectDevice: (deviceId: string | null) => void
}

export const useDeviceWorkspaceStore = create<DeviceWorkspaceStoreState>((set) => ({
  open: false,
  selectedDeviceId: null,
  openWorkspace: () => set({ open: true }),
  closeWorkspace: () => set({ open: false, selectedDeviceId: null }),
  selectDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
}))
