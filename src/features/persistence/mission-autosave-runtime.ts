export type MissionAutosaveRuntime = {
  readonly getVisibilityState: () => DocumentVisibilityState | null
  readonly setInterval: (handler: TimerHandler, timeout?: number) => number
  readonly clearInterval: (id: number) => void
  readonly addDocumentEventListener: (
    type: 'visibilitychange',
    listener: EventListener,
  ) => void
  readonly removeDocumentEventListener: (
    type: 'visibilitychange',
    listener: EventListener,
  ) => void
  readonly addWindowEventListener: (type: 'pagehide', listener: EventListener) => void
  readonly removeWindowEventListener: (type: 'pagehide', listener: EventListener) => void
}

/**
 * Creates the browser lifecycle adapter used by mission autosave.
 */
export function createBrowserMissionAutosaveRuntime(): MissionAutosaveRuntime | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  return {
    getVisibilityState: () => document.visibilityState,
    setInterval: (handler, timeout) => window.setInterval(handler, timeout),
    clearInterval: (id) => window.clearInterval(id),
    addDocumentEventListener: (type, listener) => document.addEventListener(type, listener),
    removeDocumentEventListener: (type, listener) =>
      document.removeEventListener(type, listener),
    addWindowEventListener: (type, listener) => window.addEventListener(type, listener),
    removeWindowEventListener: (type, listener) => window.removeEventListener(type, listener),
  }
}
