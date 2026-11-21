import type { ExactBreadcrumbDotState } from '../features/tracking/exact-breadcrumb-dot-controller'
import { formatOperatorLocalTimestamp } from '../features/tracking/operator-time'

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
  readonly timeZone?: string
  /** Devices whose trail is hidden on the Layers tab; their fixes are counted but not drawn. */
  readonly hiddenTrailCount?: number
}

/** First sentence of every dots status: the line, not the dots, is the whole trail [DON-338]. */
export const WHOLE_TRAIL_LINE_SENTENCE = 'The line on the map shows the whole trail.'

/**
 * Renders the explicit scope and navigation state for exact breadcrumb dots.
 * It always says that the line shows the whole trail and that the dots are
 * one page of exact recorded fixes, so the dots are never read as the whole
 * trail [DON-338].
 */
export function ExactBreadcrumbDotStatus(props: ExactBreadcrumbDotStatusProps) {
  const hiddenTrailNote = describeHiddenTrails(props.hiddenTrailCount ?? 0)
  if (props.state.status === 'unavailable') {
    return (
      <div
        className="mb-4 border-l-4 border-l-red-400 bg-red-400/15 px-3 py-2 text-xs font-medium leading-relaxed text-red-100"
        data-testid="exact-breadcrumb-dots-unavailable"
        role="alert"
      >
        <p>{props.state.message}</p>
        <p data-testid="exact-breadcrumb-dots-whole-trail-note">
          {WHOLE_TRAIL_LINE_SENTENCE} No dots are drawn until the exact fixes load.
        </p>
      </div>
    )
  }
  if (props.state.status === 'loading') {
    return (
      <p
        className="mb-4 border-l-4 border-l-sky-400 bg-sky-400/10 px-3 py-2 text-xs font-medium leading-relaxed text-sky-100"
        data-testid="exact-breadcrumb-dots-loading"
        role="status"
      >
        <span data-testid="exact-breadcrumb-dots-whole-trail-note">
          {WHOLE_TRAIL_LINE_SENTENCE} Loading exact recorded fixes to mark as dots…
        </span>
      </p>
    )
  }
  if (props.state.status !== 'ready') {
    return null
  }

  const formattedFrom = formatOperatorLocalTimestamp(
    props.state.fromTimestamp,
    props.timeZone === undefined ? {} : { timeZone: props.timeZone },
  )
  const formattedTo = formatOperatorLocalTimestamp(
    props.state.toTimestamp,
    props.timeZone === undefined ? {} : { timeZone: props.timeZone },
  )
  const formattedRange = props.state.fromTimestamp === props.state.toTimestamp
    ? formattedFrom
    : `${formattedFrom} to ${formattedTo}`

  const hasRange = props.state.fromTimestamp !== null && props.state.toTimestamp !== null
  const rangeText = !hasRange
    ? ''
    : props.state.fromTimestamp === props.state.toTimestamp
      ? `, at ${formattedFrom}`
      : `, from ${formattedFrom} to ${formattedTo}`
  const pageCount = props.state.pagePositionCount.toLocaleString()
  const totalCount = props.state.totalPositionCount.toLocaleString()
  const dotsSentence = props.state.totalPositionCount === 0
    ? 'There are no exact recorded fixes to mark as dots yet.'
    : props.state.hasEarlier || props.state.hasLater ||
        props.state.pagePositionCount < props.state.totalPositionCount
      ? `The dots mark ${pageCount} of ${totalCount} exact recorded fixes${rangeText}. Use Earlier and Later to move through the rest.`
      : `The dots mark all ${totalCount} exact recorded fixes${rangeText}.`

  return (
    <div className="mb-4 border-l-4 border-l-sky-400 bg-sky-400/10 px-3 py-2 text-xs font-medium leading-relaxed text-sky-100">
      <p data-testid="exact-breadcrumb-dots-whole-trail-note">
        {WHOLE_TRAIL_LINE_SENTENCE} {dotsSentence}
      </p>
      {hiddenTrailNote === null ? null : (
        <p className="mt-1 text-amber-200" data-testid="exact-breadcrumb-dots-hidden-trails">
          {hiddenTrailNote}
        </p>
      )}
      {/* Machine-read by the packaged exact-dot proofs; keep this exact format. */}
      <p className="mt-1 text-[11px] text-sky-200/80" data-testid="exact-breadcrumb-dot-page-summary">
        Exact fix inspection — showing {props.state.pagePositionCount.toLocaleString()} of{' '}
        {props.state.totalPositionCount.toLocaleString()}
        {props.state.fromTimestamp === null || props.state.toTimestamp === null
          ? null
          : ` — ${formattedRange}`}
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

/** Explains that hidden trails are counted in the page but not drawn [LIV-2]. */
function describeHiddenTrails(hiddenTrailCount: number): string | null {
  if (!Number.isSafeInteger(hiddenTrailCount) || hiddenTrailCount <= 0) {
    return null
  }
  return hiddenTrailCount === 1
    ? '1 device has its trail hidden on the Layers tab. Its fixes are counted here but its line and dots are not drawn.'
    : `${hiddenTrailCount} devices have their trails hidden on the Layers tab. Their fixes are counted here but their lines and dots are not drawn.`
}
