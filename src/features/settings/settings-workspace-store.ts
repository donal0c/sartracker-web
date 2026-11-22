import { create } from 'zustand'

import { MODAL_WORKSPACE_TITLE_IDS, mayOpenModalWorkspace, type ModalOpenOptions } from '../../lib/modal-workspace-registry'

/** A Settings field that a caller can ask the workspace to focus when it opens. */
export type SettingsFocusTarget = 'admin-roster'

type SettingsWorkspaceStoreState = {
  readonly open: boolean
  /** Field to focus once settings have loaded; cleared when the workspace closes. */
  readonly focusTarget: SettingsFocusTarget | null
  readonly openWorkspace: (focusTarget?: SettingsFocusTarget, options?: ModalOpenOptions) => void
  readonly closeWorkspace: () => void
}

/**
 * Owns whether the Settings workspace is open, so a workflow outside the
 * command mast (for example an empty Admin Roster during a governance decision)
 * can open it at a specific field and observe when the operator leaves.
 */
export const useSettingsWorkspaceStore = create<SettingsWorkspaceStoreState>((set, get) => ({
  open: false,
  focusTarget: null,
  // Refused while another workspace or a question is open (see the registry).
  openWorkspace: (focusTarget, options) => {
    if (!get().open && !mayOpenModalWorkspace(MODAL_WORKSPACE_TITLE_IDS.settings, options)) return
    set({ open: true, focusTarget: focusTarget ?? null })
  },
  closeWorkspace: () => set({ open: false, focusTarget: null }),
}))
