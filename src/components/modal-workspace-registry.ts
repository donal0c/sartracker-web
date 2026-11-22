/**
 * Which modal workspaces (Settings, Diagnostics, All devices) are open and in
 * what order, so the newest owns Escape and the tracking alarm can ask the
 * topmost to close through its own close handler.
 */

type OpenModal = {
  readonly requestClose: () => void
  readonly panel: () => HTMLElement | null
}

/** The open modal workspaces, the topmost (opened last) last. */
const openModals: OpenModal[] = []
const modalListeners = new Set<() => void>()

/** Records an open modal workspace's panel and close request; returns the unregister. */
export function registerOpenModal(requestClose: () => void, panel: () => HTMLElement | null): () => void {
  const entry: OpenModal = { requestClose, panel }
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
