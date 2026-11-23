import { create } from 'zustand'

import { MODAL_WORKSPACE_TITLE_IDS, mayOpenModalWorkspace } from '../../lib/modal-workspace-registry'
import { useMissionStore } from '../mission/mission-store'

type MissionReviewWorkspaceStoreState = {
  readonly open: boolean
  readonly openWorkspace: () => void
  readonly closeWorkspace: () => void
}

export const useMissionReviewWorkspaceStore = create<MissionReviewWorkspaceStoreState>((set, get) => ({
  open: false,
  // Docked beside a live mission it covers nothing; otherwise it is a modal
  // workspace and is refused while another workspace or a question is open.
  openWorkspace: () => {
    const phase = useMissionStore.getState().phase
    const docked = phase === 'active' || phase === 'paused'
    if (!get().open && !docked && !mayOpenModalWorkspace(MODAL_WORKSPACE_TITLE_IDS.review)) return
    set({ open: true })
  },
  closeWorkspace: () => set({ open: false }),
}))
