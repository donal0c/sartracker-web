import { create } from 'zustand'

type MissionReviewWorkspaceStoreState = {
  readonly open: boolean
  readonly openWorkspace: () => void
  readonly closeWorkspace: () => void
}

export const useMissionReviewWorkspaceStore = create<MissionReviewWorkspaceStoreState>((set) => ({
  open: false,
  openWorkspace: () => set({ open: true }),
  closeWorkspace: () => set({ open: false }),
}))
