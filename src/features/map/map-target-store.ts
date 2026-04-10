import { create } from 'zustand'

export type MapTargetRequest = {
  readonly id: number
  readonly latitude: number
  readonly longitude: number
  readonly label: string | null
}

type MapTargetStoreState = {
  readonly activeTarget: MapTargetRequest | null
  readonly pendingTarget: MapTargetRequest | null
  readonly queueTarget: (latitude: number, longitude: number, label?: string | null) => void
  readonly clearPendingTarget: (id: number) => void
  readonly clearActiveTarget: (id: number) => void
}

export const useMapTargetStore = create<MapTargetStoreState>((set, get) => ({
  activeTarget: null,
  pendingTarget: null,
  queueTarget: (latitude, longitude, label = null) =>
    set(() => {
      const request = {
        id: (get().activeTarget?.id ?? get().pendingTarget?.id ?? 0) + 1,
        latitude,
        longitude,
        label,
      }

      return {
        pendingTarget: request,
        activeTarget: request,
      }
    }),
  clearPendingTarget: (id) => {
    if (get().pendingTarget?.id !== id) {
      return
    }

    set({ pendingTarget: null })
  },
  clearActiveTarget: (id) => {
    if (get().activeTarget?.id !== id) {
      return
    }

    set({ activeTarget: null })
  },
}))
