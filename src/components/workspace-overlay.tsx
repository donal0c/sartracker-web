import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { focusFirstElement, restoreFocus, trapTabKey } from '../lib/focus-management'

type WorkspaceOverlayProps = {
  /** Whether the workspace is open. Controls mount/unmount with exit animation. */
  readonly open: boolean
  /** Called when the user requests close (backdrop click, Esc key, or close button). */
  readonly onClose: () => void
  /** Maximum width class for the panel (e.g. "max-w-4xl"). */
  readonly maxWidth?: string
  /** Element id for the visible workspace title. */
  readonly labelledBy: string
  /**
   * Docked (non-blocking) mode. When true the workspace renders as a right-side
   * panel that does NOT mount a full-screen dismiss backdrop and does NOT trap
   * focus, so controls underneath (e.g. the active-mission rail and the map)
   * stay operable while it is open (DON-176). The panel is non-modal in this
   * mode. Defaults to false (full-screen modal) for Settings/Diagnostics/Devices.
   */
  readonly docked?: boolean
  /** Content rendered inside the sliding panel. */
  readonly children: ReactNode
}

/**
 * Shared workspace overlay with slide-in/out animation and Esc key support.
 *
 * All workspace panels (Settings, Diagnostics, Devices, Mission Review) use this
 * wrapper for consistent entry/exit transitions and close affordance. By default
 * it is a focus-trapping modal with a backdrop. In `docked` mode it becomes a
 * non-blocking side panel (see {@link WorkspaceOverlayProps.docked}).
 */
export function WorkspaceOverlay({
  open,
  onClose,
  maxWidth = 'max-w-4xl',
  labelledBy,
  docked = false,
  children,
}: WorkspaceOverlayProps) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<Element | null>(null)

  const finishClose = useCallback(() => {
    setMounted(false)
    restoreFocus(returnFocusRef.current)
    returnFocusRef.current = null
  }, [])

  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement
      const mountFrame = requestAnimationFrame(() => {
        setMounted(true)
        // Allow one frame for the DOM to mount before triggering the enter animation.
        requestAnimationFrame(() => setVisible(true))
      })
      return () => cancelAnimationFrame(mountFrame)
    }

    if (mounted) {
      const hideFrame = requestAnimationFrame(() => setVisible(false))
      return () => cancelAnimationFrame(hideFrame)
    }
  }, [open, mounted])

  /** After exit animation completes, unmount the DOM. */
  const handleTransitionEnd = useCallback(() => {
    if (!visible) {
      finishClose()
    }
  }, [finishClose, visible])

  useEffect(() => {
    if (!mounted || visible) {
      return
    }

    const closeTimer = window.setTimeout(finishClose, 350)
    return () => window.clearTimeout(closeTimer)
  }, [finishClose, mounted, visible])

  useEffect(() => {
    const panel = panelRef.current
    // Docked mode is non-modal: do not steal focus from the operator's current
    // control (e.g. the active-mission rail) when the panel opens (DON-176).
    if (!mounted || panel === null || docked) {
      return
    }

    const focusFrame = requestAnimationFrame(() => focusFirstElement(panel))
    return () => cancelAnimationFrame(focusFrame)
  }, [mounted, docked])

  // Docked mode does not trap focus, so the operator can click the map or
  // mission rail and move focus out of the panel. Listen for Escape at the
  // document level so Esc still closes Review regardless of where focus is
  // (DON-176). Modal mode keeps its panel-scoped handler (focus is trapped).
  useEffect(() => {
    if (!mounted || !docked) {
      return
    }

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [mounted, docked, onClose])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    // Docked mode is non-modal: never trap Tab, or the operator could not move
    // keyboard focus back to the active-mission controls (DON-176).
    if (!docked && panelRef.current !== null) {
      trapTabKey(event.nativeEvent, panelRef.current)
    }
  }

  if (!mounted) {
    return null
  }

  // Docked mode: the container must not capture pointer events outside the
  // panel, so the active-mission rail and map underneath stay clickable. There
  // is no dismiss backdrop and no focus trap; Esc and the header close button
  // remain the close affordances.
  if (docked) {
    return (
      <div
        className="pointer-events-none fixed inset-0 z-30 flex"
        onTransitionEnd={handleTransitionEnd}
      >
        {/*
          Docked panel is left-aligned over the map so it never covers the
          right-hand operational sidebar where Pause/Finish live (DON-176). A
          fixed, modest width keeps a usable map band clear to its right. It
          slides in from the left edge.
        */}
        <div
          aria-labelledby={labelledBy}
          className={`sar-sidebar pointer-events-auto mr-auto flex h-full w-full ${maxWidth} flex-col border-r border-[var(--sar-line)] shadow-2xl transition-transform duration-250 ${
            visible ? 'translate-x-0 ease-out' : '-translate-x-full ease-in'
          }`}
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

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onTransitionEnd={handleTransitionEnd}
    >
      {/* Backdrop — click to close */}
      <button
        aria-label="Close workspace"
        className={`absolute inset-0 transition-opacity duration-250 ease-out ${
          visible ? 'bg-stone-950/82 backdrop-blur-[2px]' : 'bg-transparent'
        }`}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />

      {/* Sliding panel */}
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`sar-sidebar ml-auto flex h-full w-full ${maxWidth} flex-col transition-transform duration-250 ${
          visible ? 'translate-x-0 ease-out' : 'translate-x-full ease-in'
        }`}
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

type WorkspaceHeaderProps = {
  /** Stable id used by the parent dialog's aria-labelledby. */
  readonly titleId: string
  /** Small uppercase subtitle (e.g. "Diagnostics Workspace"). */
  readonly subtitle: string
  /** Large heading text (e.g. "Operational Diagnostics"). */
  readonly title: string
  /** Accent color class for the subtitle (defaults to amber-300/80). */
  readonly subtitleColor?: string
  /** Called when close is requested. */
  readonly onClose: () => void
  /** Optional extra buttons rendered before the close button. */
  readonly actions?: ReactNode
}

/**
 * Consistent workspace header with close button (× icon + Esc hint).
 */
export function WorkspaceHeader({
  titleId,
  subtitle,
  title,
  subtitleColor = 'text-amber-300',
  onClose,
  actions,
}: WorkspaceHeaderProps) {
  return (
    <header className="sar-workspace-header flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${subtitleColor}`}>
          {subtitle}
        </p>
        <h2 className="mt-1 font-mono text-2xl font-bold text-stone-50" id={titleId}>{title}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        <button
          className="sar-button group flex items-center gap-2 px-3 py-2 text-sm font-semibold"
          data-testid="workspace-close-btn"
          onClick={onClose}
          type="button"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Close
          <kbd className="ml-1 border border-stone-600 bg-stone-950 px-1.5 py-0.5 font-mono text-[10px] text-stone-200">Esc</kbd>
        </button>
      </div>
    </header>
  )
}
