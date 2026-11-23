import { create } from 'zustand'

import { MODAL_WORKSPACE_TITLE_IDS, mayOpenModalWorkspace } from '../../lib/modal-workspace-registry'

type DiagnosticsWorkspaceStoreState = {
  readonly open: boolean
  readonly openWorkspace: () => void
  readonly closeWorkspace: () => void
}

export const useDiagnosticsWorkspaceStore = create<DiagnosticsWorkspaceStoreState>((set, get) => ({
  open: false,
  // Refused while another workspace or a question is open (see the registry).
  openWorkspace: () => {
    if (!get().open && !mayOpenModalWorkspace(MODAL_WORKSPACE_TITLE_IDS.diagnostics)) return
    set({ open: true })
  },
  closeWorkspace: () => set({ open: false }),
}))
