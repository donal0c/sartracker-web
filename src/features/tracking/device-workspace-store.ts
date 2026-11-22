import { create } from 'zustand'

import { MODAL_WORKSPACE_TITLE_IDS, mayOpenModalWorkspace } from '../../lib/modal-workspace-registry'

type DeviceWorkspaceStoreState = {
  readonly open: boolean
  readonly selectedDeviceId: string | null
  readonly openWorkspace: () => void
  readonly closeWorkspace: () => void
  readonly selectDevice: (deviceId: string | null) => void
}

export const useDeviceWorkspaceStore = create<DeviceWorkspaceStoreState>((set, get) => ({
  open: false,
  selectedDeviceId: null,
  // Refused while another workspace or a question is open (see the registry).
  openWorkspace: () => {
    if (!get().open && !mayOpenModalWorkspace(MODAL_WORKSPACE_TITLE_IDS.devices)) return
    set({ open: true })
  },
  closeWorkspace: () => set({ open: false, selectedDeviceId: null }),
  selectDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
}))
