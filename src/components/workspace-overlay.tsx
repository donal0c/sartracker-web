import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { focusFirstElement, restoreFocus, trapTabKey } from '../lib/focus-management'
import { isModalWorkspacePanel, isTopModalWorkspacePanel, modalWorkspaceOpenRefusal, registerOpenModal, reportModalWorkspaceRefusal } from '../lib/modal-workspace-registry'

type WorkspaceOverlayProps = {
  /** Whether the workspace is open. Controls immediate mount and unmount. */
  readonly open: boolean
  /** Called when the user requests close (backdrop click, Esc key, or close button). */
  readonly onClose: () => void
  /** Maximum width class for the panel (e.g. "max-w-4xl"). */
  readonly maxWidth?: string
  /** Element id for the visible workspace title. */
  readonly labelledBy: string
  /**
   * Docked (non-blocking) mode. When true the workspace renders as a left-side
   * panel that does NOT mount a full-screen dismiss backdrop and does NOT trap
   * focus, so controls underneath (e.g. the active-mission rail and the map)
   * stay operable while it is open (DON-176). The panel is non-modal in this
   * mode. Defaults to false (full-screen modal) for Settings/Diagnostics/Devices.
   */
  readonly docked?: boolean
  /** Content rendered inside the workspace panel. */
  readonly children: ReactNode
}

/**
 * Shared workspace overlay with immediate open/close and Esc support.
 *
 * All workspace panels (Settings, Diagnostics, Devices, Mission Review) use this
 * wrapper for consistent immediate entry/exit and close affordance. By default
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
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  const refusedRef = useRef(false)
  const dockKeyRef = useRef<object>({})
  useLayoutEffect(() => { onCloseRef.current = onClose })

  useLayoutEffect(() => {
    refusedRef.current = false
    if (!open) {
      return
    }

    // At most one known nesting, and never over a waiting question: a refused
    // open is closed again before it paints, and the question says why.
    const refusal = docked ? null : modalWorkspaceOpenRefusal(labelledBy)
    if (refusal !== null) {
      refusedRef.current = true
      console.error(`Workspace "${labelledBy}" was not opened: ${refusal}.`)
      reportModalWorkspaceRefusal(labelledBy)
      onCloseRef.current()
      return
    }

    // A modal makes the screen behind it inert. In the new layout it starts below
    // the tracking alarm, so the uncovered top bar and side panel must not take
    // presses or focus; the alarm itself (Resume) stays live.
    const releaseBackground = docked ? null : makeBackgroundInert()
    const unregister = docked ? null : registerOpenModal(labelledBy, () => onCloseRef.current(), () => panelRef.current)
    return () => {
      releaseBackground?.()
      unregister?.()
    }
  }, [docked, labelledBy, open])

  // Focus goes back to the opener only when the workspace closes, not when it
  // switches between full width and docked (DON-368): Zoom keeps its focus.
  // Declared after the effect above so its cleanup runs after the background
  // is released, and so it sees whether that open was refused.
  useLayoutEffect(() => {
    if (!open || refusedRef.current) {
      return
    }

    returnFocusRef.current = document.activeElement
    return () => {
      const returnTarget = returnFocusRef.current
      returnFocusRef.current = null
      restoreFocus(returnTarget)
    }
  }, [open])

  // Docked, the panel takes real space: its width is published so the map
  // row moves right by it, keeping the map, its coordinate readouts and Map
  // Tools beside the panel rather than under it, and a zoom target in view
  // (DON-368).
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!open || !docked || panel === null) {
      return
    }

    const key = dockKeyRef.current
    const outer = panel.parentElement
    // The dock opened last is drawn on top and owns Escape (DON-368).
    dockedPanelOrder.push(key)
    if (outer !== null) outer.style.zIndex = String(DOCKED_Z_INDEX + dockedPanelOrder.length - 1)
    const publish = () => {
      dockedPanelWidths.set(key, panel.getBoundingClientRect().width)
      publishDockedPanelWidth()
    }
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(panel)
    return () => {
      observer?.disconnect()
      dockedPanelWidths.delete(key)
      dockedPanelOrder.splice(dockedPanelOrder.indexOf(key), 1)
      outer?.style.removeProperty('z-index')
      publishDockedPanelWidth()
    }
  }, [docked, open])

  useLayoutEffect(() => {
    const panel = panelRef.current
    // Docked mode is non-modal: do not steal focus from the operator's current
    // control (e.g. the active-mission rail) when the panel opens (DON-176).
    if (!open || panel === null || docked || refusedRef.current) {
      return
    }

    focusFirstElement(panel)
  }, [docked, open])

  // Listen at the document level so Escape remains reliable even when focus has
  // moved to the map, rail, or a recently dismissed inline confirmation. A
  // nested/topmost modal or alertdialog owns Escape first.
  useEffect(() => {
    if (!open) {
      return
    }

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (hasTopLayerAboveWorkspace(panelRef.current)) {
        return
      }
      // Review and All devices can both be docked: one Escape closes only the
      // one opened last, not both (DON-368).
      if (docked && dockedPanelOrder.at(-1) !== dockKeyRef.current) {
        return
      }

      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [docked, onClose, open])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      event.nativeEvent.stopImmediatePropagation()
      onClose()
      return
    }

    // Docked mode is non-modal: never trap Tab, or the operator could not move
    // keyboard focus back to the active-mission controls (DON-176).
    if (!docked && panelRef.current !== null) {
      trapTabKey(event.nativeEvent, panelRef.current)
    }
  }

  if (!open) {
    return null
  }

  // One element tree for both modes, so switching between full width and
  // docked keeps the content mounted with its filters, search and focus
  // (DON-368). Docked mode: the container does not capture pointer events
  // outside the panel, so the active-mission rail and map underneath stay
  // clickable. There is no dismiss backdrop and no focus trap; Esc and the
  // header close button remain the close affordances. The docked panel is
  // left-aligned so it never covers the right-hand operational sidebar where
  // Pause/Finish live (DON-176); the map row makes room for it.
  return (
    <div
      className={docked ? 'pointer-events-none fixed inset-x-0 bottom-0 z-30 flex' : 'fixed inset-x-0 bottom-0 z-50 flex'}
      // Docked, it starts at the top of the map row, beside the alarm that spans
      // the map (DON-176, DON-368); as a modal it
      // starts below the tracking alarm so the alarm and Resume are never hidden.
      // Elsewhere the variables are unset and it fills the window.
      style={{ top: docked ? 'var(--sar-workspace-row-top, var(--sar-workspace-header-bottom, 0px))' : 'var(--sar-workspace-alarm-bottom, 0px)' }}
    >
      {docked ? null : (
        // Backdrop — click to close
        <button
          aria-label="Close workspace"
          className="absolute inset-0 bg-stone-950/82"
          onClick={onClose}
          tabIndex={-1}
          type="button"
        />
      )}

      <div
        aria-labelledby={labelledBy}
        aria-modal={docked ? undefined : 'true'}
        className={
          docked
            ? `sar-sidebar pointer-events-auto mr-auto flex h-full w-full ${maxWidth} flex-col border-r border-[var(--sar-line)] shadow-2xl`
            : `sar-sidebar relative z-10 ml-auto flex h-full w-full ${maxWidth} flex-col`
        }
        data-map-interaction-boundary="true"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role="dialog"
        style={docked ? { maxWidth: dockedPanelMaxWidth(maxWidth) } : undefined}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  )
}

/** Narrowest map a docked panel may leave beside itself and the side panel (DON-368). */
export const MIN_DOCKED_MAP_WIDTH = '30rem'
/** Narrowest a docked panel gets while making room for that map (DON-368). */
export const MIN_DOCKED_PANEL_WIDTH = '20rem'
const DOCKED_PANEL_WIDTHS: Readonly<Record<string, string>> = { 'max-w-md': '28rem', 'max-w-xl': '36rem' }

/**
 * A docked panel narrows before the map gets narrower than
 * {@link MIN_DOCKED_MAP_WIDTH}, so the map, Map Tools and the alarm action stay
 * usable beside it and the side panel (DON-368).
 */
function dockedPanelMaxWidth(maxWidthClass: string): string {
  const preferred = DOCKED_PANEL_WIDTHS[maxWidthClass]
  if (preferred === undefined) {
    throw new Error(`Docked workspace width "${maxWidthClass}" has no known size; add it to DOCKED_PANEL_WIDTHS.`)
  }
  return `max(${MIN_DOCKED_PANEL_WIDTH}, min(${preferred}, calc(100vw - var(--sar-workspace-side-width, 0px) - ${MIN_DOCKED_MAP_WIDTH})))`
}

/** Width of an open docked workspace panel; the map row is padded by it (DON-368). */
export const DOCKED_PANEL_WIDTH_VAR = '--sar-docked-panel-width'

/**
 * Widths of every docked panel still open. Review and All devices can both be
 * docked, one over the other on the left, so the map row makes room for the
 * widest one still open; closing one never hands the map back under another
 * (DON-368).
 */
const dockedPanelWidths = new Map<object, number>()
/** Open docked panels, oldest first; the last one is on top and owns Escape. */
const dockedPanelOrder: object[] = []
/** Matches the docked container's z-30 class; later docks stack above it. */
const DOCKED_Z_INDEX = 30

/** Publishes the widest open docked panel, or clears the space when none is open. */
function publishDockedPanelWidth(): void {
  const root = document.documentElement
  if (dockedPanelWidths.size === 0) {
    root.style.removeProperty(DOCKED_PANEL_WIDTH_VAR)
    return
  }
  root.style.setProperty(DOCKED_PANEL_WIDTH_VAR, `${Math.max(...dockedPanelWidths.values())}px`)
}

/** Marks regions that a modal workspace makes inert while it is open. */
export const MODAL_BACKGROUND_ATTRIBUTE = 'data-modal-background'

/** How many open modal workspaces hold each background region inert. */
const inertHolds = new WeakMap<HTMLElement, number>()

/**
 * Makes every marked background region inert and returns the release. Release
 * runs before focus is restored, so focus can return to the button that opened
 * the workspace. Nested modals each hold the regions until both close.
 */
function makeBackgroundInert(): () => void {
  const regions = [...document.querySelectorAll<HTMLElement>(`[${MODAL_BACKGROUND_ATTRIBUTE}]`)]
  for (const region of regions) {
    inertHolds.set(region, (inertHolds.get(region) ?? 0) + 1)
    region.inert = true
  }
  return () => {
    for (const region of regions) {
      const holds = (inertHolds.get(region) ?? 1) - 1
      inertHolds.set(region, holds)
      if (holds <= 0) region.inert = false
    }
  }
}

/**
 * Returns true when another modal or alert dialog should receive Escape before
 * the workspace itself. Among open modal workspaces the one opened last owns
 * Escape, so two never defer to each other; any other modal or alert dialog
 * (for example Settings' unsaved-changes prompt) still comes first.
 */
function hasTopLayerAboveWorkspace(panel: HTMLElement | null): boolean {
  if (panel === null) {
    return false
  }

  const isModalWorkspace = isModalWorkspacePanel(panel)
  if (isModalWorkspace && !isTopModalWorkspacePanel(panel)) {
    return true
  }

  const topLayers = document.querySelectorAll('[aria-modal="true"], [role="alertdialog"]')
  for (const layer of topLayers) {
    // Modal workspaces opened earlier sit below this one.
    if (layer !== panel && !(isModalWorkspace && isModalWorkspacePanel(layer))) {
      return true
    }
  }

  return false
}

type WorkspaceHeaderProps = {
  /** Stable id used by the parent dialog's aria-labelledby. */
  readonly titleId: string
  /** Small uppercase subtitle (e.g. "Diagnostics"). */
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
