import { useEffect, type ReactNode } from 'react'

import { useFocusModeStore } from '../../features/focus-mode/focus-mode-store'
import type { LayoutTrialVersion } from '../../features/layout-trial/layout-trial-store'
import { readTheme, THEME_KEY } from '../../lib/theme-preference'
import { useTrialChrome } from './use-trial-chrome'

/** Trial screens: the same map and workspaces, with the chrome rearranged around them. */
export function TrialLayout(props: {
  readonly version: LayoutTrialVersion
  readonly decisionOpen: boolean
  readonly actionError: string | null
  readonly onActionErrorChange: (error: string | null) => void
  readonly onDecisionOpenChange: (open: boolean) => void
  readonly map: ReactNode
  readonly safetyBanner: ReactNode
  readonly weather: ReactNode
}) {
  const chrome = useTrialChrome({
    version: props.version,
    weather: props.weather,
    decisionOpen: props.decisionOpen,
    actionError: props.actionError,
    onActionErrorChange: props.onActionErrorChange,
    onDecisionOpenChange: props.onDecisionOpenChange,
  })

  // Focus Mode is what the team used to get here, so it must not stack on top.
  useEffect(() => { useFocusModeStore.getState().setActive(false) }, [])
  useEffect(() => {
    // Contrast is the default for the trial (raised by the team since May 2026).
    // Stored as well, because the Contrast button re-applies the stored choice.
    const previous = readTheme()
    const store = (contrast: boolean) => {
      try { window.localStorage.setItem(THEME_KEY, String(contrast)) } catch { /* display choice only */ }
      document.documentElement.dataset.theme = contrast ? 'high-contrast' : 'standard'
    }
    store(true)
    return () => store(previous)
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-layout-trial={props.version} data-testid="layout-trial-root">
      {chrome.top}
      {props.safetyBanner}
      <div className="relative flex min-h-0 flex-1">
        {chrome.side}
        <section className={`relative flex-1 overflow-hidden ${chrome.slotSide === 'left' ? 'order-2' : '-order-1'}`}>
          {props.map}
          {chrome.overMap}
        </section>
      </div>
    </div>
  )
}
