import { useState } from 'react'

export type FocusSidebarTab = 'tracking' | 'tools' | 'layers'

/** Sidebar tab selection, owned by the layout so controls outside the sidebar can open a tab. */
export interface SidebarTabs {
  readonly activeTab: FocusSidebarTab
  readonly setActiveTab: (tab: FocusSidebarTab) => void
}

/**
 * Keeps separate remembered tabs for normal and Focus presentations: Focus
 * opens on Layers, normal on Tracking.
 */
export function useSidebarTabs(focusModeActive: boolean): SidebarTabs {
  const [focusTab, setFocusTab] = useState<FocusSidebarTab>('layers')
  const [normalTab, setNormalTab] = useState<FocusSidebarTab>('tracking')
  return focusModeActive
    ? { activeTab: focusTab, setActiveTab: setFocusTab }
    : { activeTab: normalTab, setActiveTab: setNormalTab }
}
