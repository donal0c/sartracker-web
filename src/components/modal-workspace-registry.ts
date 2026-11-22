import { useSyncExternalStore } from 'react'

/**
 * Which modal workspaces (Settings, Diagnostics, All devices) are open and in
 * what order, so the newest owns Escape and the tracking alarm can ask the
 * topmost to close through its own close handler. It also limits stacking to
 * the one nesting the product has.
 */

/**
 * The only nesting allowed: Settings over All devices, as the governance Admin
 * Roster link opens Settings from code. Keyed by each workspace's title id.
 */
const ALLOWED_NESTING = { under: 'devices-workspace-title', over: 'settings-workspace-title' } as const

/** What the operator calls each modal workspace, by title id. */
const WORKSPACE_NAMES: Readonly<Record<string, string>> = {
  'devices-workspace-title': 'All devices',
  'diagnostics-workspace-title': 'Diagnostics',
  'mission-review-workspace-title': 'Review',
  'settings-workspace-title': 'Settings',
}

type OpenModal = {
  readonly labelledBy: string
  readonly requestClose: () => void
  readonly panel: () => HTMLElement | null
}

/** The open modal workspaces, the topmost (opened last) last. */
const openModals: OpenModal[] = []
const modalListeners = new Set<() => void>()
const refusalListeners = new Set<(workspaceName: string) => void>()
let openDecisions = 0

/** Records an open modal workspace's title id, panel and close request; returns the unregister. */
export function registerOpenModal(labelledBy: string, requestClose: () => void, panel: () => HTMLElement | null): () => void {
  const entry: OpenModal = { labelledBy, requestClose, panel }
  openModals.push(entry)
  modalListeners.forEach((listener) => listener())
  return () => {
    const index = openModals.lastIndexOf(entry)
    if (index >= 0) openModals.splice(index, 1)
    modalListeners.forEach((listener) => listener())
  }
}

/** Subscribes to modal workspaces opening and closing. */
export function subscribeModalWorkspaces(listener: () => void): () => void {
  modalListeners.add(listener)
  return () => { modalListeners.delete(listener) }
}

/** How many modal workspaces (Settings, Diagnostics, All devices) are open. */
export function openModalWorkspaceCount(): number {
  return openModals.length
}

/**
 * Asks the topmost modal workspace to close through its normal close handler,
 * the same one Escape uses, so Settings still asks before losing unsaved edits.
 */
export function requestTopModalWorkspaceClose(): void {
  openModals.at(-1)?.requestClose()
}

/** True when the element is the panel of an open modal workspace. */
export function isModalWorkspacePanel(element: Element): boolean {
  return openModals.some((modal) => modal.panel() === element)
}

/** True when the panel belongs to the modal workspace opened last. */
export function isTopModalWorkspacePanel(panel: HTMLElement): boolean {
  return openModals.at(-1)?.panel() === panel
}

/**
 * Why the modal workspace with this title id may not open now, or null when it
 * may. Only Settings may open over All devices, and nothing opens over a
 * question waiting for an answer (such as Finish mission), so no decision is
 * ever hidden behind a workspace.
 */
export function modalWorkspaceOpenRefusal(labelledBy: string): string | null {
  if (document.querySelector('[role="alertdialog"]') !== null) {
    return 'a question is waiting for an answer'
  }
  if (openModals.length === 0) return null
  if (openModals.length === 1 && openModals[0]?.labelledBy === ALLOWED_NESTING.under && labelledBy === ALLOWED_NESTING.over) {
    return null
  }
  return 'another workspace is already open'
}

/** Tells whatever is in the way (a waiting question) that a workspace did not open. */
export function reportModalWorkspaceRefusal(labelledBy: string): void {
  const name = WORKSPACE_NAMES[labelledBy] ?? 'The workspace'
  refusalListeners.forEach((listener) => listener(name))
}

/** Subscribes to refused workspace opens; the listener gets the workspace's name. */
export function subscribeModalWorkspaceRefusals(listener: (workspaceName: string) => void): () => void {
  refusalListeners.add(listener)
  return () => { refusalListeners.delete(listener) }
}

/** Records an inline question (such as Finish mission) on screen; returns the unregister. */
export function registerOpenDecision(): () => void {
  openDecisions += 1
  modalListeners.forEach((listener) => listener())
  return () => {
    openDecisions -= 1
    modalListeners.forEach((listener) => listener())
  }
}

function workspaceBlockerCount(): number {
  return openModals.length + openDecisions
}

/**
 * How many open workspaces and waiting questions a workspace would cover, kept
 * current for rendering. Docked Review waits for none before it fills the screen.
 */
export function useWorkspaceBlockerCount(): number {
  return useSyncExternalStore(subscribeModalWorkspaces, workspaceBlockerCount)
}
