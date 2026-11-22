import { Component, type ErrorInfo, type ReactNode } from 'react'

import { recordDiagnosticEvent } from '../features/diagnostics/diagnostic-event-log'
import { reloadRuntimeFaultShell } from '../features/runtime/runtime-fault-reload'

type OperationalShellErrorBoundaryState = { readonly error: Error | null }

/**
 * Catches a failure while rendering the operational screen, including its
 * first render after startup, so the operator sees a fault they can act on
 * instead of a blank window [DON-354]. Map failures are contained lower down
 * by `MapErrorBoundary`; this is the last line for the rest of the shell.
 */
export class OperationalShellErrorBoundary extends Component<
  { readonly children: ReactNode },
  OperationalShellErrorBoundaryState
> {
  override state: OperationalShellErrorBoundaryState = { error: null }

  /** Switches to the visible fault screen. */
  static getDerivedStateFromError(error: unknown): OperationalShellErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  /** Records the failure in the diagnostic log and the support bundle. */
  override componentDidCatch(error: Error, info: ErrorInfo) {
    void recordDiagnosticEvent({
      level: 'error',
      category: 'runtime',
      event: 'operational_shell_render_failed',
      fields: {
        message: error.message.slice(0, 500),
        componentStack: (info.componentStack ?? '').slice(0, 1000),
      },
    })
  }

  override render() {
    if (this.state.error === null) return this.props.children
    return (
      <main
        className="sar-shell flex h-screen w-screen items-center justify-center p-6"
        data-testid="operational-shell-fault"
        role="alert"
      >
        <section className="max-w-xl border border-rose-300/40 bg-rose-950/30 p-6 shadow-2xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-rose-200">Screen fault</p>
          <h1 className="mt-2 font-mono text-[24px] font-black text-stone-50">
            SAR Tracker could not show its mission screen
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-stone-200">
            No mission-data damage was confirmed. Copy or screenshot this message if you are in an incident,
            then reload. If it happens again, restart SAR Tracker and contact support.
          </p>
          <pre className="mt-4 whitespace-pre-wrap border border-rose-200/20 bg-stone-950/70 p-3 text-left text-xs text-rose-100">
            {this.state.error.message}
          </pre>
          <button
            autoFocus
            className="sar-action-primary mt-5 px-4 py-2 text-[12px] font-black uppercase tracking-[0.08em]"
            onClick={() => reloadRuntimeFaultShell()}
            type="button"
          >
            Reload clean runtime
          </button>
        </section>
      </main>
    )
  }
}
