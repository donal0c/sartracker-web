import { create } from 'zustand'

type SettingsApplyStoreState = {
  /** Why saved settings could not be applied to the running app, if they could not. */
  readonly failure: string | null
  readonly reportFailure: (message: string) => void
  readonly clearFailure: () => void
}

/**
 * Holds the one operator-facing failure from applying saved settings. Settings
 * closes before the running app reloads them, so the failure must outlive the
 * dialog and stay on screen until dismissed or a later apply succeeds
 * [DON-352, audit M-67].
 */
export const useSettingsApplyStore = create<SettingsApplyStoreState>((set) => ({
  failure: null,
  reportFailure: (message) => set({ failure: message }),
  clearFailure: () => set({ failure: null }),
}))
