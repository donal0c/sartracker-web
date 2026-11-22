import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { focusFirstElement, restoreFocus, trapTabKey } from '../lib/focus-management'
import { registerOpenDecision, subscribeModalWorkspaceRefusals } from './modal-workspace-registry'

type InlineDecisionDialogProps = {
  readonly labelledBy: string
  readonly describedBy?: string
  readonly className: string
  readonly 'data-testid': string
  readonly onCancel: () => void
  readonly children: ReactNode
}

/** Keeps one destructive inline decision keyboard-contained and dismissible. */
export function InlineDecisionDialog(props: InlineDecisionDialogProps) {
  const { onCancel } = props
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<Element | null>(null)
  const [refusedWorkspace, setRefusedWorkspace] = useState<string | null>(null)

  // A workspace does not open over this question; say so here and bring the
  // question back to the keyboard, so the press is never silently lost.
  useEffect(() => registerOpenDecision(), [])
  useEffect(() => subscribeModalWorkspaceRefusals((workspaceName) => {
    setRefusedWorkspace(workspaceName)
    panelRef.current?.focus()
  }), [])

  useEffect(() => {
    returnFocusRef.current = document.activeElement
    const panel = panelRef.current
    if (panel === null) return
    const focusFrame = requestAnimationFrame(() => focusFirstElement(panel))
    return () => {
      cancelAnimationFrame(focusFrame)
      restoreFocus(returnFocusRef.current)
      returnFocusRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Behind an open workspace this question is out of reach; Escape is that workspace's.
      if (panelRef.current?.closest('[inert]') != null) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onCancel()
    }
    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true)
  }, [onCancel])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      onCancel()
      return
    }
    if (panelRef.current !== null) trapTabKey(event.nativeEvent, panelRef.current)
  }

  return (
    <div
      aria-describedby={props.describedBy}
      aria-labelledby={props.labelledBy}
      className={props.className}
      data-testid={props['data-testid']}
      onKeyDown={handleKeyDown}
      ref={panelRef}
      role="alertdialog"
      tabIndex={-1}
    >
      {refusedWorkspace === null ? null : (
        <p className="mb-2 text-[13px] font-semibold text-amber-300" data-testid="decision-refused-workspace" role="status">
          {refusedWorkspace} did not open. Answer this question first.
        </p>
      )}
      {props.children}
    </div>
  )
}
