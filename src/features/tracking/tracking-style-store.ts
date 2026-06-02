import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DEFAULT_BREADCRUMB_SIZE = 4
export const MIN_BREADCRUMB_SIZE = 2
export const MAX_BREADCRUMB_SIZE = 10

export type TrackingStylePreferences = {
  readonly deviceColors: Readonly<Record<string, string>>
  readonly breadcrumbSize: number
}

type TrackingStyleStoreState = TrackingStylePreferences & {
  readonly setDeviceColor: (deviceId: string, color: string) => void
  readonly setBreadcrumbSize: (size: number) => void
  readonly getDeviceColor: (deviceId: string) => string | null
}

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/

/**
 * Stores operator-controlled tracking trail styling for map renderers.
 */
export const useTrackingStyleStore = create<TrackingStyleStoreState>()(
  persist(
    (set, get) => ({
      deviceColors: {},
      breadcrumbSize: DEFAULT_BREADCRUMB_SIZE,
      setDeviceColor: (deviceId, color) => {
        const normalizedColor = normalizeHexColor(color)
        if (normalizedColor === null) {
          return
        }

        set((state) => ({
          deviceColors: {
            ...state.deviceColors,
            [deviceId]: normalizedColor,
          },
        }))
      },
      setBreadcrumbSize: (size) =>
        set({
          breadcrumbSize: clampBreadcrumbSize(size),
        }),
      getDeviceColor: (deviceId) => get().deviceColors[deviceId] ?? null,
    }),
    {
      name: 'sartracker:tracking-style',
      partialize: (state) => ({
        deviceColors: state.deviceColors,
        breadcrumbSize: state.breadcrumbSize,
      }),
    },
  ),
)

/**
 * Returns the map-renderer style preferences without using an object-literal
 * Zustand selector, which can trigger uncached external-store snapshots.
 */
export function useTrackingStylePreferences(): TrackingStylePreferences {
  const deviceColors = useTrackingStyleStore((state) => state.deviceColors)
  const breadcrumbSize = useTrackingStyleStore((state) => state.breadcrumbSize)

  return useMemo(
    () => ({
      deviceColors,
      breadcrumbSize,
    }),
    [breadcrumbSize, deviceColors],
  )
}

/**
 * Normalizes browser colour-input values into uppercase hex colours.
 */
export function normalizeHexColor(color: string): string | null {
  const normalized = color.trim().toUpperCase()
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null
}

/**
 * Keeps global breadcrumb line size inside an operator-readable range.
 */
export function clampBreadcrumbSize(size: number): number {
  if (!Number.isFinite(size)) {
    return DEFAULT_BREADCRUMB_SIZE
  }

  return Math.min(MAX_BREADCRUMB_SIZE, Math.max(MIN_BREADCRUMB_SIZE, Math.round(size)))
}
