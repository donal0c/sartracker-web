import { useEffect, type ReactNode } from 'react'

import { useFocusModeStore } from '../../features/focus-mode/focus-mode-store'
import type { PanelArrangement } from '../../features/workspace/panel-arrangement'
import { useWorkspacePanels } from './use-workspace-panels'

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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-panel-arrangement={props.arrangement} data-testid="simplified-workspace">
      {panels.top}
      {props.safetyBanner}
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
