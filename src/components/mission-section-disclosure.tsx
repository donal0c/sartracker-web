import { useState, type ReactNode } from 'react'

import type { MissionSectionSummary } from '../features/mission/mission-section-summary'

type MissionSectionDisclosureProps = {
  readonly title: string
  readonly testId: string
  readonly section: MissionSectionSummary
  /** Collapsing applies only while a mission is running or paused. */
  readonly collapsible: boolean
  readonly children: ReactNode
  /**
   * Simplified panel (DON-368): the button that opens the fold, for example
   * "Change who's taking part". With it, a warning never forces the fold open;
   * warnings go in `alwaysShown`, which stays on screen above the fold.
   */
  readonly foldLabel?: string
  /** Shown between the summary line and the fold, whether folded or not. */
  readonly alwaysShown?: ReactNode
}

/**
 * One Mission Control section that folds to a single line during a mission,
 * so the Tracking, Tools and Layers tabs keep room on a 900 px screen. Any
 * attention reason keeps it open; the operator can always open it [DON-300].
 * Folding only hides the section: an unfinished entry or its error survives.
 */
export function MissionSectionDisclosure(props: MissionSectionDisclosureProps) {
  const [expanded, setExpanded] = useState(false)
  if (!props.collapsible) return <>{props.alwaysShown}{props.children}</>
  if (props.foldLabel !== undefined) {
    return (
      <SummaryWithFold
        alwaysShown={props.alwaysShown}
        expanded={expanded}
        foldLabel={props.foldLabel}
        onToggle={() => setExpanded((value) => !value)}
        section={props.section}
        testId={props.testId}
        title={props.title}
      >
        {props.children}
      </SummaryWithFold>
    )
  }
  const forced = props.section.attention.length > 0
  const open = forced || expanded
  return (
    <div
      className="space-y-2"
      data-attention={props.section.attention.join('; ')}
      data-forced={forced ? 'true' : 'false'}
      data-open={open ? 'true' : 'false'}
      data-testid={props.testId}
    >
      <button
        aria-expanded={open}
        className="sar-readout flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left disabled:cursor-default"
        data-testid={`${props.testId}-toggle`}
        disabled={forced}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-bold uppercase leading-tight tracking-[0.1em] text-amber-300">{props.title}</span>
          {/* One line on every platform; the full text stays in the tooltip. */}
          <span className="block truncate text-xs leading-snug text-stone-200" data-testid={`${props.testId}-summary`} title={props.section.summary}>
            {props.section.summary}
          </span>
        </span>
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-stone-300">
          {forced ? 'Needs attention' : open ? 'Hide' : 'Show'}
        </span>
      </button>
      <div data-testid={`${props.testId}-body`} hidden={!open}>{props.children}</div>
    </div>
  )
}

/**
 * A one-line summary, then whatever must stay on screen (warnings), then one
 * button that opens the rest. The fold holds only controls, so it is never
 * forced open: two clicks reach Add or Remove (DON-368).
 */
function SummaryWithFold(props: {
  readonly title: string
  readonly testId: string
  readonly section: MissionSectionSummary
  readonly foldLabel: string
  readonly alwaysShown: ReactNode
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}) {
  const attention = props.section.attention.length > 0
  return (
    <div
      className="space-y-2"
      data-attention={props.section.attention.join('; ')}
      data-forced="false"
      data-open={props.expanded ? 'true' : 'false'}
      data-testid={props.testId}
    >
      <div className="sar-readout flex items-center justify-between gap-3 px-3 py-1.5">
        <span className="min-w-0">
          <span className="block text-[12px] font-bold leading-tight text-amber-300">{props.title}</span>
          <span className="block truncate text-[13px] leading-snug text-stone-200" data-testid={`${props.testId}-summary`} title={props.section.summary}>
            {props.section.summary}
          </span>
        </span>
        {attention ? (
          <span className="shrink-0 text-[12px] font-bold text-amber-300" data-testid={`${props.testId}-attention`}>Needs attention</span>
        ) : null}
      </div>
      {props.alwaysShown}
      <button
        aria-expanded={props.expanded}
        className="sar-button w-full px-3 py-2 text-left text-[13px] font-semibold"
        data-testid={`${props.testId}-toggle`}
        onClick={props.onToggle}
        type="button"
      >
        {props.expanded ? '▾ ' : '▸ '}{props.foldLabel}
      </button>
      <div data-testid={`${props.testId}-body`} hidden={!props.expanded}>{props.children}</div>
    </div>
  )
}
