import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { focusFirstElement, restoreFocus, trapTabKey } from '../lib/focus-management'

type DialogOverlayProps = {
  /** Whether the dialog is mounted. */
  readonly open: boolean
  /** Stable id for the visible dialog heading. */
  readonly labelledBy: string
  /** Called when Escape or the backdrop requests dismissal. */
  readonly onClose: () => void
  /** Test id for the root overlay. */
  readonly testId: string
  /** Panel width classes. */
  readonly panelClassName?: string
  /** Dialog content. */
  readonly children: ReactNode
}

/**
 * Shared centered dialog shell with labelled semantics, focus trap, Escape close,
 * and focus return to the opener.
 */
export function DialogOverlay({
  open,
  labelledBy,
  onClose,
  testId,
  panelClassName = 'max-w-3xl',
  children,
}: DialogOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    returnFocusRef.current = document.activeElement
    const panel = panelRef.current
    if (panel === null) {
      return
    }

    const focusFrame = requestAnimationFrame(() => focusFirstElement(panel))
    return () => {
      cancelAnimationFrame(focusFrame)
      restoreFocus(returnFocusRef.current)
      returnFocusRef.current = null
    }
  }, [open])

  if (!open) {
    return null
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (panelRef.current !== null) {
      trapTabKey(event.nativeEvent, panelRef.current)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/82 px-4 py-8 backdrop-blur-[2px]"
      data-testid={testId}
    >
      <button
        aria-label="Close dialog"
        className="absolute inset-0"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`sar-panel relative w-full p-6 ${panelClassName}`}
        data-map-interaction-boundary="true"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}
