import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import { openModalWorkspaceCount, requestTopModalWorkspaceClose, subscribeModalWorkspaces } from '../modal-workspace-registry'

/**
 * What to do in the tracking alarm. With a modal workspace open, the advice is
 * behind it, so the workspace is asked to close through its own close handler
 * (Settings asks before losing unsaved edits) and Tracking shows once it has
 * closed. If the operator stays in the workspace (Keep editing, or any press
 * inside it that leaves it open), the request lapses.
 */
export function useOpenTrackingAdvice(showTracking: () => void): () => void {
  const pending = useRef(false)
  const show = useRef(showTracking)
  useLayoutEffect(() => { show.current = showTracking })

  useEffect(() => {
    const onModalsChanged = () => {
      if (!pending.current || openModalWorkspaceCount() > 0) return
      pending.current = false
      show.current()
    }
    const onClick = (event: MouseEvent) => {
      if (!pending.current) return
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (dialog === null || !(event.target instanceof Node) || !dialog.contains(event.target)) return
      // After the press has run: a Discard closes the workspace, Keep editing does not.
      window.setTimeout(() => { if (openModalWorkspaceCount() > 0) pending.current = false }, 0)
    }
    const unsubscribe = subscribeModalWorkspaces(onModalsChanged)
    document.addEventListener('click', onClick, true)
    return () => {
      unsubscribe()
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  return useCallback(() => {
    if (openModalWorkspaceCount() === 0) {
      showTracking()
      return
    }
    pending.current = true
    requestTopModalWorkspaceClose()
  }, [showTracking])
}
