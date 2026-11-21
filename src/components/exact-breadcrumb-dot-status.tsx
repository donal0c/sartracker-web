import type { ExactBreadcrumbDotState } from '../features/tracking/exact-breadcrumb-dot-controller'
import { formatOperatorLocalTimestamp } from '../features/tracking/operator-time'
import {
  describeHiddenTrails,
  describeTrailLine,
  type TrailDrawingSummary,
} from '../features/tracking/trail-line-visibility'

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
  /**
   * What the map draws, from the same geometry and hidden-device list the
   * renderers use (see summarizeTrailDrawing); never from the roster.
   */
  readonly trailDrawing: TrailDrawingSummary
}

/**
 * Renders the explicit scope and navigation state for exact breadcrumb dots.
 * It says what the map is actually drawing: the whole trail line, the line
 * for only the devices whose trail is shown, nothing when trails are off, or
 * that there is no trail line yet.
 * The dots are always described as one page of exact recorded fixes, so they
 * are never read as the whole trail [DON-338].
 */
export function ExactBreadcrumbDotStatus(props: ExactBreadcrumbDotStatusProps) {
  const { line: visibility, dots, hiddenTrailCount } = props.trailDrawing
  // Sentences about the line come only from `line`; sentences about the dots
  // come only from `dots`. The line and the page can hold different devices,
  // so one never decides what the other says [DON-338].
  const lineSentence = describeTrailLine(visibility)
  const lineNotDrawn = visibility === 'switched-off' || visibility === 'all-hidden'
  const trailLineAttribute = lineNotDrawn ? 'off' : visibility === 'no-trail' ? 'none' : visibility
  const hiddenTrailNote = describeHiddenTrails(hiddenTrailCount)
  const hiddenTrailElement = hiddenTrailNote === null ? null : (
    <p className="mt-1 text-amber-200" data-testid="exact-breadcrumb-dots-hidden-trails">
      {hiddenTrailNote}
    </p>
  )
  if (props.state.status === 'unavailable') {
    return (
      <div
        className="mb-4 border-l-4 border-l-red-400 bg-red-400/15 px-3 py-2 text-xs font-medium leading-relaxed text-red-100"
        data-testid="exact-breadcrumb-dots-unavailable"
        role="alert"
      >
        <p>{props.state.message}</p>
        <p data-testid="exact-breadcrumb-dots-whole-trail-note" data-trail-line={trailLineAttribute} data-trail-dots={dots}>
          {dots === 'none' ? lineSentence : `${lineSentence} No dots are drawn until the exact fixes load.`}
        </p>
        {hiddenTrailElement}
      </div>
    )
  }
  if (props.state.status === 'loading') {
    return (
      <div
        className="mb-4 border-l-4 border-l-sky-400 bg-sky-400/10 px-3 py-2 text-xs font-medium leading-relaxed text-sky-100"
        data-testid="exact-breadcrumb-dots-loading"
        role="status"
      >
        <p data-testid="exact-breadcrumb-dots-whole-trail-note" data-trail-line={trailLineAttribute} data-trail-dots={dots}>
          {dots === 'none'
            ? `${lineSentence} Loading exact recorded fixes; none are drawn while trails are not shown.`
            : `${lineSentence} Loading exact recorded fixes to mark as dots…`}
        </p>
        {hiddenTrailElement}
      </div>
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
  const isPaged = props.state.hasEarlier || props.state.hasLater ||
    props.state.pagePositionCount < props.state.totalPositionCount
  const pagingSentence = isPaged ? ' Use Earlier and Later to move through the rest.' : ''
  const pageScope = isPaged ? `${pageCount} of ${totalCount}` : `all ${totalCount}`
  const dotsSentence = props.state.totalPositionCount === 0
    ? dots === 'none'
      ? 'There are no exact recorded fixes yet.'
      : 'There are no exact recorded fixes to mark as dots yet.'
    : dots === 'all'
      ? `The dots mark ${pageScope} exact recorded fixes${rangeText}.${pagingSentence}`
      : dots === 'some'
        ? `This page holds ${pageScope} exact recorded fixes${rangeText}. Dots are drawn only for devices whose trail is shown.${pagingSentence}`
        : `This page holds ${pageScope} exact recorded fixes${rangeText}. None are drawn while trails are not shown.${pagingSentence}`

  return (
    <div className="mb-4 border-l-4 border-l-sky-400 bg-sky-400/10 px-3 py-2 text-xs font-medium leading-relaxed text-sky-100">
      <p data-testid="exact-breadcrumb-dots-whole-trail-note" data-trail-line={trailLineAttribute} data-trail-dots={dots}>
        {lineSentence} {dotsSentence}
      </p>
      {hiddenTrailElement}
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

