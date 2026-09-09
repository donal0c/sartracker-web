import { useState } from 'react'

/** Keeps operator hiding choices within one uninterrupted, unprotected mission context. */
export function useWorkspaceVisibility(contextKey: string, blockedReason: string | null) {
  const [stored, setStored] = useState({ contextKey, blockedReason, collapsed: false, minimized: false })
  const current = stored.contextKey === contextKey && stored.blockedReason === blockedReason
    ? stored
    : { contextKey, blockedReason, collapsed: false, minimized: false }
  // Reset during render: neither a painted hidden safety panel nor a stale resume latch.
  if (current !== stored) setStored(current)

  return {
    collapsed: blockedReason === null && current.collapsed,
    minimized: blockedReason === null && current.minimized,
    collapse: () => { if (blockedReason === null) setStored({ ...current, collapsed: true }) },
    minimize: (minimized: boolean) => { if (blockedReason === null) setStored({ ...current, minimized }) },
    restore: () => setStored({ ...current, collapsed: false, minimized: false }),
    restoreRail: () => setStored({ ...current, collapsed: false }),
  }
}
