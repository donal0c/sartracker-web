/**
 * The event half of a MapLibre source, for test stand-ins (DON-357). The
 * tracking sync watches its source's `dataloading`, `data`, `error` and
 * `dataabort` events, so every fake tracking source needs `on` and `off`.
 * `fire` lets a test play the events MapLibre would send.
 */
type SourceListener = (event: unknown) => void

/**
 * Creates `on`, `off` and `fire` for a fake source.
 *
 * @returns the methods to spread into a fake source handle
 */
export function createFakeSourceEvents() {
  const listeners = new Map<string, Set<SourceListener>>()
  return {
    on(type: string, listener: SourceListener) {
      const set = listeners.get(type) ?? new Set<SourceListener>()
      set.add(listener)
      listeners.set(type, set)
    },
    off(type: string, listener: SourceListener) {
      listeners.get(type)?.delete(listener)
    },
    /** Delivers one event to every listener, as MapLibre's Evented does. */
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type, ...event })
    },
    /** How many listeners are attached, across every event type. */
    listenerCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0)
    },
  }
}
