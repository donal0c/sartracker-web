import type { CoverageState } from '../features/tracking/coverage-controller'
import type { CoverageErrorClass } from '../features/tracking/coverage-diagnostics'
import { describeCurrentPositionsFreshness } from '../features/tracking/current-positions-freshness'
import {
  COVERAGE_CATCH_UP_STALL_MS,
  summarizeCoverageStatus,
} from '../features/tracking/coverage-progress'

type CoverageStatusPanelProps = {
  readonly state: CoverageState
  readonly omittedDeviceCount: number
  readonly omittedOutingCount: number
  readonly unassignedOmitted: boolean
  readonly onRetry: () => void
  readonly onInspectExactFixes: () => void
  readonly inspectLabel?: string
  /** Whether the tracking feed is online; when false no message calls positions live [DON-375]. Defaults to true. */
  readonly trackingLive?: boolean
}

/** Renders calm, database-backed mission-history progress and recovery controls. */
export function CoverageStatusPanel(props: CoverageStatusPanelProps) {
  if (props.state.status === 'inactive') return null

  const summary = summarizeCoverageStatus(props.state)
  const freshness = describeCurrentPositionsFreshness(props.trackingLive !== false)
  const blockers = new Set(props.state.blockers ?? [])
  const historyUnreconciled = blockers.has('history_reconciliation_incomplete')
  const reorganizing = props.state.manifest?.pendingInvalidation === true ||
    blockers.has('pending_invalidation')
  const backfill = props.state.manifest?.backfillIncomplete === true ||
    blockers.has('backfill_incomplete')
  const outboxPending = blockers.has('ingest_outbox_pending')
  const degraded = blockers.has('ingest_health_degraded') || outboxPending
  const rendererEvidencePending = blockers.has('renderer_evidence_pending')
  const rendererEvidenceDegraded = blockers.has('renderer_evidence_degraded')
  const rendererDetached = blockers.has('renderer_detached')
  const rendererFilterPending = blockers.has('renderer_filter_pending')
  const evidenceBlocked = degraded || rendererEvidencePending || rendererEvidenceDegraded
  const progressUntrusted = historyUnreconciled || evidenceBlocked || rendererDetached || rendererFilterPending ||
    reorganizing || backfill
  const completenessUnverified = props.state.status !== 'complete' &&
    summary.drawnFixCount >= summary.totalFixCount
  const omissions = props.omittedDeviceCount + props.omittedOutingCount +
    (props.unassignedOmitted ? 1 : 0)
  // A failure or a stall outranks every temporary waiting message: the
  // operator must not read "still working" when the line has stopped
  // [DON-338 REN-3].
  const failed = props.state.status === 'error'
  const stalled = !failed && summary.stalled
  // Retry re-reads saved history and, for a stalled map, re-stages the
  // catalog so the map reattaches and re-applies the filter.
  // Attention notices stand beside any failure, waiting or stall message,
  // never behind one: they say why history cannot be called complete, and
  // rebuilding the line does not fix them [DON-338]. Positions waiting to be
  // saved are already covered by a stall or failure, so that alone is not repeated.
  const degradedShown = blockers.has('ingest_health_degraded') || (outboxPending && !stalled && !failed)
  const attentionShown = rendererEvidenceDegraded || degradedShown || historyUnreconciled
  const showRetry = failed || stalled ||
    (summary.kind === 'behind' && !stalled &&
      !evidenceBlocked && !rendererDetached && !rendererFilterPending)

  return (
    <section
      aria-live="polite"
      className="mb-4 border-l-4 border-l-violet-400 bg-violet-400/10 px-3 py-3 text-xs leading-relaxed text-violet-50"
      data-testid="coverage-status-panel"
    >
      <div className="flex flex-col items-start gap-3">
        <div>
          <p className="font-bold uppercase tracking-[0.08em]">Mission history coverage</p>
          {failed ? null : stalled ? (
            <p className="mt-1 font-bold" data-testid="coverage-stalled">
              History line stalled — it has not updated for over {formatStallMinutes()}
              {describeStallContext({
                rendererDetached, rendererFilterPending, reorganizing, backfill,
                rendererEvidencePending, outboxPending,
              })}.
              {' '}The line may be missing recent positions or be out of date.
              {' '}{freshness} Press Retry.
            </p>
          ) : rendererDetached ? (
            <p className="mt-1" data-testid="coverage-renderer-detached">
              Coverage is being reattached to the map. {freshness}
            </p>
          ) : rendererFilterPending ? (
            <p className="mt-1" data-testid="coverage-filter-pending">
              Applying the selected history filter to the map. Completion is paused.
              {' '}{freshness}
            </p>
          ) : reorganizing ? (
            <p className="mt-1" data-testid="coverage-reorganizing">
              Updating outing assignment — loaded coverage remains shown.
            </p>
          ) : backfill ? (
            <p className="mt-1" data-testid="coverage-backfill">
              Participant history is still being added. {freshness}
            </p>
          ) : rendererEvidencePending ? (
            <p className="mt-1" data-testid="coverage-evidence-pending">
              Anomaly evidence is waiting to be saved. History cannot be called complete yet.
              {' '}{freshness}
            </p>
          ) : attentionShown ? null : props.state.status === 'complete' ? (
            <CompleteSummary
              omittedDeviceCount={props.omittedDeviceCount}
              omittedOutingCount={props.omittedOutingCount}
              unassignedOmitted={props.unassignedOmitted}
              updatedAt={props.state.updatedAt}
              freshness={freshness}
            />
          ) : summary.kind === 'loading' ? (
            <p className="mt-1" data-testid="coverage-loading">
              Loading complete mission history from saved evidence.
            </p>
          ) : summary.kind === 'catching_up' ? (
            <p className="mt-1" data-testid="coverage-updating">
              Updating — the newest positions are being added to the history line.
              {' '}Earlier history is shown.
            </p>
          ) : summary.kind === 'behind' ? (
            <p className="mt-1" data-testid="coverage-partial">
              History incomplete — showing loaded coverage. Press Retry to load the rest.
            </p>
          ) : null}
          {attentionShown ? (
            <>
              {rendererEvidenceDegraded ? (
                <p className="mt-1" data-testid="coverage-evidence-degraded">
                  Anomaly evidence may not have been fully saved. History cannot be called complete.
                  {' '}{freshness} Resolve the evidence warning in Tracking.
                </p>
              ) : null}
              {degradedShown ? (
                <p className="mt-1" data-testid="coverage-degraded">
                  Evidence health is degraded. History cannot be called complete until storage recovers.
                </p>
              ) : null}
              {historyUnreconciled ? (
                <p className="mt-1" data-testid="coverage-retrieval-warning">
                  Saved history has not been reconciled through the mission window. Completeness is not verified.
                  {' '}Loaded saved evidence remains shown. A connection recovery or visibility change does not fill this gap.
                </p>
              ) : null}
            </>
          ) : null}
          {props.state.status === 'error' ? (
            <p className="mt-1" data-testid="coverage-error">
              History incomplete — {rendererDetached
                ? 'coverage is not currently attached to the map.'
                : 'showing loaded coverage.'}
              {props.state.lastErrorClass === undefined || props.state.lastErrorClass === null
                ? ''
                : ` Reason: ${describeErrorClass(props.state.lastErrorClass)}.`}
              {summary.automaticRetry
                ? ' Retrying automatically; press Retry to try now.'
                : ' Press Retry.'}
            </p>
          ) : null}
          {failed && props.state.lastErrorClass === 'worker_out_of_memory' ? (
            <p className="mt-1" data-testid="coverage-out-of-memory">
              This mission&apos;s history is too large for the history builder, so the whole-history
              line may stay missing. Saved positions are safe. {freshness}{' '}
              Use Inspect exact fixes to check saved positions.
            </p>
          ) : null}
          {completenessUnverified && !progressUntrusted ? (
            <p className="mt-1" data-testid="coverage-completeness-unverified">
              Loaded history is shown, but completeness is not yet verified.
            </p>
          ) : null}
        </div>
        {showRetry ? (
          <button
            className="sar-button px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
            data-testid="coverage-retry"
            onClick={props.onRetry}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </div>

      {props.state.status === 'loading' || props.state.status === 'partial' ||
      props.state.status === 'error' ? (
        progressUntrusted || completenessUnverified ? null :
        <div className="mt-3">
          <progress
            aria-label="Mission history loading progress"
            aria-valuetext={`${summary.drawnFixCount} of ${summary.totalFixCount} fixes drawn`}
            className="h-2 w-full accent-violet-400"
            data-testid="coverage-progress"
            max={Math.max(1, summary.totalFixCount)}
            role="progressbar"
            value={Math.min(summary.drawnFixCount, Math.max(1, summary.totalFixCount))}
          />
          <p className="mt-1 font-mono text-[11px]" data-testid="coverage-progress-text">
            {summary.drawnFixCount.toLocaleString()} of{' '}
            {summary.totalFixCount.toLocaleString()} fixes
          </p>
        </div>
      ) : null}

      <button
        className="sar-button mt-3 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
        data-testid="coverage-inspect-exact-fixes"
        onClick={props.onInspectExactFixes}
        type="button"
      >
        {props.inspectLabel ?? 'Inspect exact fixes'}
      </button>
      {omissions > 0 && props.state.status !== 'complete' ? (
        <p className="mt-2 text-[11px] text-violet-100">
          Progress is for selected history; omitted history remains saved.
        </p>
      ) : null}
    </section>
  )
}

function CompleteSummary(props: {
  readonly omittedDeviceCount: number
  readonly omittedOutingCount: number
  readonly unassignedOmitted: boolean
  readonly updatedAt: string | undefined
  /** The sentence about current positions, which is never "live" while tracking is not [DON-375]. */
  readonly freshness: string
}) {
  const omitted = props.omittedDeviceCount + props.omittedOutingCount > 0 ||
    props.unassignedOmitted
  return (
    <div className="mt-1" data-testid="coverage-complete">
      <p>{omitted ? 'All selected history shown' : 'All mission history shown'}</p>
      {omitted ? (
        <p data-testid="coverage-omission-summary">
          {formatOmissionSummary(props)} {props.freshness}
        </p>
      ) : null}
      {props.updatedAt === undefined ? null : (
        <time dateTime={props.updatedAt}>{formatTime(props.updatedAt)}</time>
      )}
    </div>
  )
}

function formatOmissionSummary(props: {
  readonly omittedDeviceCount: number
  readonly omittedOutingCount: number
  readonly unassignedOmitted: boolean
}): string {
  const scopes = [
    ...(props.omittedDeviceCount === 0
      ? []
      : [formatCount(props.omittedDeviceCount, 'device')]),
    ...(props.omittedOutingCount === 0
      ? []
      : [formatCount(props.omittedOutingCount, 'outing')]),
    ...(props.unassignedOmitted ? ['Outside outings'] : []),
  ]
  return `${scopes.join(', ')} omitted.`
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function formatTime(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime())
    ? `Updated ${parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Updated'
}

/** Describes a coverage failure class in words a volunteer can act on. */
function describeErrorClass(value: CoverageErrorClass): string {
  switch (value) {
    case 'timeout': return 'loading took too long'
    case 'worker': return 'the history builder stopped'
    case 'worker_out_of_memory': return 'the history builder ran out of memory'
    case 'chunk_stale': return 'new positions kept arriving while it loaded'
    case 'runtime_unavailable': return 'the history service is not available'
    case 'malformed_sequence': return 'saved history returned an invalid update'
    case 'cancelled': return 'loading was stopped'
    case 'unknown': return 'an unexpected error'
  }
}

/** Names what a stalled line was waiting for, as a clause after "for over N minutes". */
function describeStallContext(waiting: {
  readonly rendererDetached: boolean
  readonly rendererFilterPending: boolean
  readonly reorganizing: boolean
  readonly backfill: boolean
  readonly rendererEvidencePending: boolean
  readonly outboxPending: boolean
}): string {
  if (waiting.rendererDetached) return ' while reattaching to the map'
  if (waiting.rendererFilterPending) return ' while applying the selected history filter'
  if (waiting.reorganizing) return ' while updating outing assignment'
  if (waiting.backfill) return ' while adding participant history'
  if (waiting.rendererEvidencePending) return ' while waiting for anomaly evidence to be saved'
  if (waiting.outboxPending) return ' while waiting for new positions to be saved'
  return ''
}

/** Formats the stall interval for the operator, for example "2 minutes". */
function formatStallMinutes(): string {
  const minutes = Math.round(COVERAGE_CATCH_UP_STALL_MS / 60_000)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
