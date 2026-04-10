import { create } from 'zustand'

export type CoordinateTargetRequest = {
  readonly id: number
  readonly latitude: number
  readonly longitude: number
}

type CoordinateToolStoreState = {
  readonly open: boolean
  readonly activeTarget: CoordinateTargetRequest | null
  readonly pendingTarget: CoordinateTargetRequest | null
  readonly openDialog: () => void
  readonly closeDialog: () => void
  readonly queueTarget: (latitude: number, longitude: number) => void
  readonly clearPendingTarget: (id: number) => void
  readonly clearActiveTarget: (id: number) => void
}

export const useCoordinateToolStore = create<CoordinateToolStoreState>((set, get) => ({
  open: false,
  activeTarget: null,
  pendingTarget: null,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
  queueTarget: (latitude, longitude) =>
    set(() => {
      const request = {
        id: (get().activeTarget?.id ?? get().pendingTarget?.id ?? 0) + 1,
        latitude,
        longitude,
      }

      return {
        pendingTarget: request,
        activeTarget: request,
        open: false,
      }
    }),
  clearActiveTarget: (id) => {
    if (get().activeTarget?.id !== id) {
      return
    }

    set({ activeTarget: null })
  },
  clearPendingTarget: (id) => {
    if (get().pendingTarget?.id !== id) {
      return
    }

    set({ pendingTarget: null })
  },
}))
