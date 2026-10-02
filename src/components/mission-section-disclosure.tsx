import { useState, type ReactNode } from 'react'

import type { MissionSectionSummary } from '../features/mission/mission-section-summary'

type MissionSectionDisclosureProps = {
  readonly title: string
  readonly testId: string
  readonly section: MissionSectionSummary
  /** Collapsing applies only while a mission is running or paused. */
  readonly collapsible: boolean
  readonly children: ReactNode
}

/**
 * One Mission Control section that folds to a single line during a mission,
 * so the Tracking, Tools and Layers tabs keep room on a 900 px screen. Any
 * attention reason keeps it open; the operator can always open it [DON-300].
 * Folding only hides the section: an unfinished entry or its error survives.
 */
export function MissionSectionDisclosure(props: MissionSectionDisclosureProps) {
  const [expanded, setExpanded] = useState(false)
  if (!props.collapsible) return <>{props.children}</>
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
