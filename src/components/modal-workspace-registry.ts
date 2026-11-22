/**
 * Which modal workspaces (Settings, Diagnostics, All devices) are open, so the
 * tracking alarm can ask the topmost to close through its own close handler.
 */

/** Close requests of the open modal workspaces, the topmost last. */
const openModals: Array<() => void> = []
const modalListeners = new Set<() => void>()

/** Records an open modal workspace's close request; returns the unregister. */
export function registerOpenModal(requestClose: () => void): () => void {
  openModals.push(requestClose)
  modalListeners.forEach((listener) => listener())
  return () => {
    const index = openModals.lastIndexOf(requestClose)
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
  openModals.at(-1)?.()
}
