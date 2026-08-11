import type { ExactBreadcrumbDotState } from '../features/tracking/exact-breadcrumb-dot-controller'

type ExactBreadcrumbDotStatusProps = {
  readonly state: ExactBreadcrumbDotState | {
    readonly status: 'ready'
    readonly totalPositionCount: number
    readonly pagePositionCount: number
    readonly fromTimestamp: string
    readonly toTimestamp: string
    readonly hasEarlier: boolean
    readonly hasLater: boolean
  }
  readonly onEarlier: () => void
  readonly onLater: () => void
}

/** Renders the explicit scope and navigation state for exact breadcrumb dots. */
export function ExactBreadcrumbDotStatus(props: ExactBreadcrumbDotStatusProps) {
  if (props.state.status === 'unavailable') {
    return (
      <p
        className="mb-4 border-l-4 border-l-red-400 bg-red-400/15 px-3 py-2 text-xs font-medium leading-relaxed text-red-100"
        data-testid="exact-breadcrumb-dots-unavailable"
        role="alert"
      >
        {props.state.message}
      </p>
    )
  }
  if (props.state.status === 'loading') {
    return (
      <p
        className="mb-4 border-l-4 border-l-sky-400 bg-sky-400/10 px-3 py-2 text-xs font-medium leading-relaxed text-sky-100"
        data-testid="exact-breadcrumb-dots-loading"
        role="status"
      >
        Loading exact breadcrumb fixes…
      </p>
    )
  }
  if (props.state.status !== 'ready') {
    return null
  }

  return (
    <div className="mb-4 border-l-4 border-l-sky-400 bg-sky-400/10 px-3 py-2 text-xs font-medium leading-relaxed text-sky-100">
      <p data-testid="exact-breadcrumb-dot-page-summary">
        Showing {props.state.pagePositionCount.toLocaleString()} exact fixes of{' '}
        {props.state.totalPositionCount.toLocaleString()}
        {props.state.fromTimestamp === null || props.state.toTimestamp === null
          ? null
          : ` — ${props.state.fromTimestamp} to ${props.state.toTimestamp}`}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          className="sar-button px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em]"
          data-testid="exact-breadcrumb-dots-earlier"
          disabled={!props.state.hasEarlier}
          onClick={props.onEarlier}
          type="button"
        >
          Earlier
        </button>
        <button
          className="sar-button px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em]"
          data-testid="exact-breadcrumb-dots-later"
          disabled={!props.state.hasLater}
          onClick={props.onLater}
          type="button"
        >
          Later
        </button>
      </div>
    </div>
  )
}
