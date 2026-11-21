import { useEffect, useRef, type ReactNode } from 'react'

import { useFocusModeStore } from '../../features/focus-mode/focus-mode-store'
import type { PanelArrangement } from '../../features/workspace/panel-arrangement'
import { useWorkspacePanels } from './use-workspace-panels'

/** CSS variable holding where the top bar and alarms end; docked overlays start there. */
export const WORKSPACE_HEADER_BOTTOM_VAR = '--sar-workspace-header-bottom'

/**
 * The desktop workspace approved by the team (DON-341): one shallow top bar, a
 * full-width alarm when the map cannot be trusted, and one side panel at a time
 * around the map. Every safety warning from the old mast and sidebar is kept,
 * moved into the top bar, the alarm or the Tracking panel.
 */
export function SimplifiedWorkspace(props: {
  readonly arrangement: PanelArrangement
  readonly decisionOpen: boolean
  readonly actionError: string | null
  readonly onActionErrorChange: (error: string | null) => void
  readonly onDecisionOpenChange: (open: boolean) => void
  readonly map: ReactNode
  readonly safetyBanner: ReactNode
  readonly weather: ReactNode
}) {
  const panels = useWorkspacePanels({
    arrangement: props.arrangement,
    weather: props.weather,
    decisionOpen: props.decisionOpen,
    actionError: props.actionError,
    onActionErrorChange: props.onActionErrorChange,
    onDecisionOpenChange: props.onDecisionOpenChange,
  })

  // Focus Mode belonged to the old screen; it must never stack on top of this one.
  useEffect(() => { useFocusModeStore.getState().setActive(false) }, [])

  // Docked workspaces (Review and replay) start below the top bar and alarms, so
  // the Mission button, Resume and every warning stay visible and clickable (DON-176).
  const headerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const header = headerRef.current
    if (header === null) return undefined
    const root = document.documentElement
    const publish = () => root.style.setProperty(WORKSPACE_HEADER_BOTTOM_VAR, `${header.getBoundingClientRect().bottom}px`)
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(header)
    window.addEventListener('resize', publish)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', publish)
      root.style.removeProperty(WORKSPACE_HEADER_BOTTOM_VAR)
    }
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-panel-arrangement={props.arrangement} data-testid="simplified-workspace">
      <div ref={headerRef}>
        {panels.top}
        {props.safetyBanner}
      </div>
      <div className="relative flex min-h-0 flex-1">
        {panels.side}
        <section className={`relative flex-1 overflow-hidden ${panels.slotSide === 'left' ? 'order-2' : '-order-1'}`}>
          {props.map}
          {panels.overMap}
        </section>
      </div>
    </div>
  )
}
