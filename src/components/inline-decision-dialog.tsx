import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { focusFirstElement, restoreFocus, trapTabKey } from '../lib/focus-management'

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
      {props.children}
    </div>
  )
}
