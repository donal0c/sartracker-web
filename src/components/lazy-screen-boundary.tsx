import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'

import { recordDiagnosticEvent } from '../features/diagnostics/diagnostic-event-log'
import { WorkspaceOverlay } from './workspace-overlay'

/**
 * The operator's request for an on-demand screen, so a press made while its
 * code loads is answered at once and can be left like the screen itself.
 */
export type LazyScreenRequest = {
  /** True once the operator has asked for the screen. */
  readonly open: boolean
  /** The screen's title id, so the waiting shell holds its place among open workspaces. */
  readonly titleId: string
  /** Withdraws the request (Escape, Cancel, the backdrop, or What to do in the alarm). */
  readonly onCancel: () => void
  /** Beside a live mission Review covers nothing, and neither does its waiting shell. */
  readonly docked?: boolean
}

type LazyScreenBoundaryState = { readonly error: Error | null }

/**
 * Loads one on-demand screen and contains its failure. If the screen's code
 * cannot be loaded (a damaged or half-replaced install), only that screen is
 * replaced by a plain message; the top bar, alarms and banners stay up.
 */
export class LazyScreenBoundary extends Component<
  {
    readonly screen: string
    /** The operator's request for this screen; without it nothing shows while the code loads. */
    readonly request?: LazyScreenRequest
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
        <Suspense fallback={this.props.request?.open === true ? <LazyScreenLoading request={this.props.request} screen={this.props.screen} /> : null}>
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
 * it the press looked ignored. It is a workspace in its own right: it takes the
 * screen's place among open workspaces, so nothing else opens under it, and
 * Escape, Cancel or What to do in the alarm withdraw the request, so the
 * screen does not open later over whatever the operator moved on to.
 */
function LazyScreenLoading(props: { readonly screen: string; readonly request: LazyScreenRequest }) {
  const { request } = props
  return (
    <WorkspaceOverlay docked={request.docked === true} labelledBy={request.titleId} maxWidth="max-w-md" onClose={request.onCancel} open>
      <div className="flex items-center justify-between gap-4 p-5">
        <h2 className="text-base font-bold" data-screen={props.screen} data-testid="lazy-screen-loading" id={request.titleId} role="status">
          Opening {props.screen}…
        </h2>
        <button className="sar-button px-3 py-1 text-sm" data-testid="lazy-screen-loading-cancel" onClick={request.onCancel} type="button">
          Cancel
        </button>
      </div>
    </WorkspaceOverlay>
  )
}
