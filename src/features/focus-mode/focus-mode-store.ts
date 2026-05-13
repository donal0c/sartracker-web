import { create } from 'zustand'

const FOCUS_MODE_STORAGE_KEY = 'sartracker:focus-mode-active'

export type FocusModeStore = {
  readonly active: boolean
  readonly setActive: (active: boolean) => void
  readonly toggle: () => void
}

/**
 * Reads the persisted focus-mode flag while tolerating locked-down storage.
 */
export function readStoredFocusMode(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(FOCUS_MODE_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Persists the focus-mode flag for crash/reload recovery.
 */
export function persistFocusMode(active: boolean): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(FOCUS_MODE_STORAGE_KEY, active ? 'true' : 'false')
  } catch {
    // Focus mode remains usable for this session even if preference persistence fails.
  }
}

export const useFocusModeStore = create<FocusModeStore>((set) => ({
  active: readStoredFocusMode(),
  setActive: (active) => {
    persistFocusMode(active)
    set({ active })
  },
  toggle: () => {
    set((state) => {
      const active = !state.active
      persistFocusMode(active)

      return { active }
    })
  },
}))
