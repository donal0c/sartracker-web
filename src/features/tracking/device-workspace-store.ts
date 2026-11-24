import { create } from 'zustand'

import { MODAL_WORKSPACE_TITLE_IDS, mayOpenModalWorkspace } from '../../lib/modal-workspace-registry'

type DeviceWorkspaceStoreState = {
  readonly open: boolean
  readonly selectedDeviceId: string | null
  /**
   * Docked narrow at the left after Zoom, so the device the map centres on is
   * not underneath the window (DON-368, as Review docks for live replay).
   */
  readonly docked: boolean
  readonly openWorkspace: () => void
  readonly closeWorkspace: () => void
  readonly selectDevice: (deviceId: string | null) => void
  /** Docks the open window narrow so the map behind it stays visible and usable. */
  readonly dock: () => void
  /** Returns a docked window to full width. */
  readonly undock: () => void
}

export const useDeviceWorkspaceStore = create<DeviceWorkspaceStoreState>((set, get) => ({
  open: false,
  selectedDeviceId: null,
  docked: false,
  // Refused while another workspace or a question is open (see the registry).
  openWorkspace: () => {
    if (!get().open && !mayOpenModalWorkspace(MODAL_WORKSPACE_TITLE_IDS.devices)) return
    // Every fresh open is full width; only Zoom docks it.
    if (!get().open) set({ open: true, docked: false })
  },
  closeWorkspace: () => set({ open: false, selectedDeviceId: null, docked: false }),
  selectDevice: (deviceId) => set({ selectedDeviceId: deviceId }),
  dock: () => { if (get().open) set({ docked: true }) },
  // Full width is modal again, so it follows the same rule as opening.
  undock: () => {
    if (get().docked && !mayOpenModalWorkspace(MODAL_WORKSPACE_TITLE_IDS.devices)) return
    set({ docked: false })
  },
}))
