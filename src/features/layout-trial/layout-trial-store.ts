import { create } from 'zustand'

export type LayoutTrialVersion = 'a' | 'b' | 'c'

type LayoutTrialChoice = LayoutTrialVersion | 'current'

const LAYOUT_PARAM = 'layout'

/**
 * Reads the trial choice from a URL query. Anything unrecognised means no trial,
 * so a normal or desktop launch keeps today's screen exactly.
 */
export function parseLayoutTrialChoice(search: string): LayoutTrialChoice | null {
  const value = new URLSearchParams(search).get(LAYOUT_PARAM)
  return value === 'a' || value === 'b' || value === 'c' || value === 'current' ? value : null
}

/** Returns the same URL with the trial choice replaced, keeping other parameters. */
export function withLayoutTrialChoice(href: string, choice: LayoutTrialChoice): string {
  const url = new URL(href)
  url.searchParams.set(LAYOUT_PARAM, choice)
  return url.toString()
}

const initialChoice = typeof window === 'undefined' ? null : parseLayoutTrialChoice(window.location.search)

type LayoutTrialState = {
  /** True once this session was opened through a trial link; shows the switcher. */
  readonly enabled: boolean
  readonly choice: LayoutTrialChoice | null
  readonly setChoice: (choice: LayoutTrialChoice) => void
}

export const useLayoutTrialStore = create<LayoutTrialState>((set) => ({
  enabled: initialChoice !== null,
  choice: initialChoice,
  setChoice: (choice) => {
    // Replacing the URL keeps a reload on the same version without remounting the app.
    window.history.replaceState(null, '', withLayoutTrialChoice(window.location.href, choice))
    set({ choice })
  },
}))

/** Returns the active trial layout, or null when today's screen should render. */
export function selectLayoutTrialVersion(state: LayoutTrialState): LayoutTrialVersion | null {
  return state.choice === null || state.choice === 'current' ? null : state.choice
}
