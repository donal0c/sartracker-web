import { create } from 'zustand'

type CoordinateToolStoreState = {
  readonly open: boolean
  readonly openDialog: () => void
  readonly closeDialog: () => void
}

export const useCoordinateToolStore = create<CoordinateToolStoreState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}))
