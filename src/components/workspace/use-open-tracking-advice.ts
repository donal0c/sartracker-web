import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import { openModalWorkspaceCount, requestTopModalWorkspaceClose, subscribeModalWorkspaces } from '../modal-workspace-registry'

/**
 * What to do in the tracking alarm. With a modal workspace open, the advice is
 * behind it, so the workspace is asked to close through its own close handler
 * (Settings asks before losing unsaved edits) and Tracking shows once it has
 * closed; nested workspaces are asked one after another. If the operator stays
 * in a workspace (Keep editing, or any press inside it that leaves it open),
 * the request lapses.
 */
export function useOpenTrackingAdvice(showTracking: () => void): () => void {
  const pending = useRef(false)
  const show = useRef(showTracking)
  useLayoutEffect(() => { show.current = showTracking })

  useEffect(() => {
    let lastCount = openModalWorkspaceCount()
    const onModalsChanged = () => {
      const count = openModalWorkspaceCount()
      const closedOne = count < lastCount
      lastCount = count
      if (!pending.current) return
      if (count === 0) {
        pending.current = false
        show.current()
        return
      }
      // Nested workspaces: ask the next one down, through its own close handler.
      if (closedOne) requestTopModalWorkspaceClose()
    }
    const onClick = (event: MouseEvent) => {
      if (!pending.current || !(event.target instanceof Element)) return
      // The workspace the press came from, which with nested workspaces need not be the first in the page.
      const dialog = event.target.closest('[role="dialog"][aria-modal="true"]')
      if (dialog === null) return
      // After the press has run: a Discard closes that workspace; Keep editing leaves it open and drops the request.
      window.setTimeout(() => { if (dialog.isConnected) pending.current = false }, 0)
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
