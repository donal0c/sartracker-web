import { Component, type ErrorInfo, type ReactNode } from 'react'

import { recordDiagnosticEvent } from '../features/diagnostics/diagnostic-event-log'

type MapErrorBoundaryState = { readonly error: Error | null }

/**
 * Contains a map failure that escapes the map's own handling, so the shell,
 * tracking and mission records stay usable and the operator sees why the map
 * is missing instead of a blank window [DON-288].
 */
export class MapErrorBoundary extends Component<{ readonly children: ReactNode }, MapErrorBoundaryState> {
  override state: MapErrorBoundaryState = { error: null }

  /** Switches to the visible failure panel. */
  static getDerivedStateFromError(error: unknown): MapErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  /** Records the failure for the support bundle. */
  override componentDidCatch(error: Error, info: ErrorInfo) {
    void recordDiagnosticEvent({
      level: 'error',
      category: 'map',
      event: 'map_view_crashed',
      fields: {
        message: error.message.slice(0, 500),
        componentStack: (info.componentStack ?? '').slice(0, 1000),
      },
    })
  }

  override render() {
    if (this.state.error === null) return this.props.children
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-stone-950 p-6"
        data-testid="map-error-boundary"
        role="alert"
      >
        <div className="max-w-xl space-y-3 border border-rose-300/75 bg-stone-900 p-5 text-sm text-stone-100">
          <p className="text-base font-bold text-rose-100">The map stopped working.</p>
          <p>
            Tracking, devices and mission records still work. Restart SAR Tracker to bring the map back. If it
            happens again, export a support bundle from Settings and contact support.
          </p>
          <p className="text-xs text-stone-400">Cause: {this.state.error.message}</p>
        </div>
      </div>
    )
  }
}
