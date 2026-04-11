import { create } from 'zustand'

type DiagnosticsWorkspaceStoreState = {
  readonly open: boolean
  readonly openWorkspace: () => void
  readonly closeWorkspace: () => void
}

export const useDiagnosticsWorkspaceStore = create<DiagnosticsWorkspaceStoreState>((set) => ({
  open: false,
  openWorkspace: () => set({ open: true }),
  closeWorkspace: () => set({ open: false }),
}))
