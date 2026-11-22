import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'

import { recordDiagnosticEvent } from '../features/diagnostics/diagnostic-event-log'

type LazyScreenBoundaryState = { readonly error: Error | null }

/**
 * Loads one on-demand screen and contains its failure. If the screen's code
 * cannot be loaded (a damaged or half-replaced install), only that screen is
 * replaced by a plain message; the top bar, alarms and banners stay up.
 */
export class LazyScreenBoundary extends Component<
  {
    readonly screen: string
    /** True once the operator has asked for this screen, so a press made while its code loads is answered at once. */
    readonly requested?: boolean
    readonly children: ReactNode
  },
  LazyScreenBoundaryState
> {
  override state: LazyScreenBoundaryState = { error: null }

  /** Switches to the visible failure message. */
  static getDerivedStateFromError(error: unknown): LazyScreenBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  /** Records the failure for the support bundle. */
  override componentDidCatch(error: Error, info: ErrorInfo) {
    void recordDiagnosticEvent({
      level: 'error',
      category: 'runtime',
      event: 'lazy_screen_failed',
      fields: {
        screen: this.props.screen,
        message: error.message.slice(0, 500),
        componentStack: (info.componentStack ?? '').slice(0, 1000),
      },
    }).catch(() => undefined)
  }

  override render() {
    if (this.state.error === null) {
      return (
        <Suspense fallback={this.props.requested === true ? <LazyScreenLoading screen={this.props.screen} /> : null}>
          {this.props.children}
        </Suspense>
      )
    }
    return (
      <div
        className="sar-inline-critical m-2 p-3 text-[13px]"
        data-screen={this.props.screen}
        data-testid="lazy-screen-load-failure"
        role="alert"
      >
        <p className="font-bold">{this.props.screen} could not be loaded.</p>
        <p className="mt-1">
          The map, tracking and alarms still work. Restart SAR Tracker to bring {this.props.screen} back. If it
          happens again, reinstall SAR Tracker.
        </p>
        <p className="mt-1 text-[11px] opacity-80">Cause: {this.state.error.message}</p>
      </div>
    )
  }
}

/**
 * Shown when a screen was asked for before its code arrived (DON-229). Without
 * it the press looked ignored and an operator would press again or give up.
 */
function LazyScreenLoading(props: { readonly screen: string }) {
  return (
    <div
      className="sar-module fixed left-1/2 top-24 z-50 -translate-x-1/2 p-3 text-sm font-semibold"
      data-screen={props.screen}
      data-testid="lazy-screen-loading"
      role="status"
    >
      Opening {props.screen}…
    </div>
  )
}
