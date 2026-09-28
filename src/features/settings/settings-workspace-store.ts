import { create } from 'zustand'

/** A Settings field that a caller can ask the workspace to focus when it opens. */
export type SettingsFocusTarget = 'admin-roster'

type SettingsWorkspaceStoreState = {
  readonly open: boolean
  /** Field to focus once settings have loaded; cleared when the workspace closes. */
  readonly focusTarget: SettingsFocusTarget | null
  readonly openWorkspace: (focusTarget?: SettingsFocusTarget) => void
  readonly closeWorkspace: () => void
}

/**
 * Owns whether the Settings workspace is open, so a workflow outside the
 * command mast (for example an empty Admin Roster during a governance decision)
 * can open it at a specific field and observe when the operator leaves.
 */
export const useSettingsWorkspaceStore = create<SettingsWorkspaceStoreState>((set) => ({
  open: false,
  focusTarget: null,
  openWorkspace: (focusTarget) => set({ open: true, focusTarget: focusTarget ?? null }),
  closeWorkspace: () => set({ open: false, focusTarget: null }),
}))
