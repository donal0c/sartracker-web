import type { CoverageState } from '../features/tracking/coverage-controller'

type CoverageStatusPanelProps = {
  readonly state: CoverageState
  readonly omittedDeviceCount: number
  readonly omittedOutingCount: number
  readonly unassignedOmitted: boolean
  readonly onRetry: () => void
  readonly onInspectExactFixes: () => void
}

/** Renders calm, database-backed mission-history progress and recovery controls. */
export function CoverageStatusPanel(props: CoverageStatusPanelProps) {
  if (props.state.status === 'inactive') return null

  const blockers = new Set(props.state.blockers ?? [])
  const reorganizing = props.state.manifest?.pendingInvalidation === true ||
    blockers.has('pending_invalidation')
  const backfill = props.state.manifest?.backfillIncomplete === true ||
    blockers.has('backfill_incomplete')
  const degraded = blockers.has('ingest_health_degraded') ||
    blockers.has('ingest_outbox_pending')
  const rendererEvidencePending = blockers.has('renderer_evidence_pending')
  const rendererEvidenceDegraded = blockers.has('renderer_evidence_degraded')
  const rendererDetached = blockers.has('renderer_detached')
  const rendererFilterPending = blockers.has('renderer_filter_pending')
  const evidenceBlocked = degraded || rendererEvidencePending || rendererEvidenceDegraded
  const progressUntrusted = evidenceBlocked || rendererDetached || rendererFilterPending ||
    reorganizing || backfill
  const completenessUnverified = props.state.status !== 'complete' &&
    props.state.deliveredFixCount >= props.state.totalFixCount
  const omissions = props.omittedDeviceCount + props.omittedOutingCount +
    (props.unassignedOmitted ? 1 : 0)

  return (
    <section
      aria-live="polite"
      className="mb-4 border-l-4 border-l-violet-400 bg-violet-400/10 px-3 py-3 text-xs leading-relaxed text-violet-50"
      data-testid="coverage-status-panel"
    >
      <div className="flex flex-col items-start gap-3">
        <div>
          <p className="font-bold uppercase tracking-[0.08em]">Mission history coverage</p>
          {rendererDetached ? (
            <p className="mt-1" data-testid="coverage-renderer-detached">
              Coverage is being reattached to the map. Current positions remain live.
            </p>
          ) : rendererFilterPending ? (
            <p className="mt-1" data-testid="coverage-filter-pending">
              Applying the selected history filter to the map. Completion is paused.
              {' '}Current positions remain live.
            </p>
          ) : reorganizing ? (
            <p className="mt-1" data-testid="coverage-reorganizing">
              Updating outing assignment — loaded coverage remains shown.
            </p>
          ) : backfill ? (
            <p className="mt-1" data-testid="coverage-backfill">
              Participant history is still being added. Current positions remain live.
            </p>
          ) : rendererEvidencePending ? (
            <p className="mt-1" data-testid="coverage-evidence-pending">
              Anomaly evidence is waiting to be saved. History cannot be called complete yet.
              {' '}Current positions remain live.
            </p>
          ) : rendererEvidenceDegraded ? (
            <p className="mt-1" data-testid="coverage-evidence-degraded">
              Anomaly evidence could not be fully saved. History cannot be called complete.
              {' '}Current positions remain live; resolve the evidence warning in Tracking.
            </p>
          ) : degraded ? (
            <p className="mt-1" data-testid="coverage-degraded">
              Evidence health is degraded. History cannot be called complete until storage recovers.
            </p>
          ) : props.state.status === 'complete' ? (
            <CompleteSummary
              omittedDeviceCount={props.omittedDeviceCount}
              omittedOutingCount={props.omittedOutingCount}
              unassignedOmitted={props.unassignedOmitted}
              updatedAt={props.state.updatedAt}
            />
          ) : props.state.status === 'partial' ? (
            <p className="mt-1" data-testid="coverage-partial">
              History incomplete — showing loaded coverage.
              {props.state.lastErrorClass === undefined || props.state.lastErrorClass === null
                ? ''
                : ` Reason: ${formatErrorClass(props.state.lastErrorClass)}.`}
            </p>
          ) : props.state.status === 'loading' ? (
            <p className="mt-1" data-testid="coverage-loading">
              Loading complete mission history from saved evidence.
            </p>
          ) : null}
          {props.state.status === 'error' ? (
            <p className="mt-1" data-testid="coverage-error">
              History incomplete — {rendererDetached
                ? 'coverage is not currently attached to the map.'
                : 'showing loaded coverage.'}
              {props.state.lastErrorClass === undefined || props.state.lastErrorClass === null
                ? ''
                : ` Reason: ${formatErrorClass(props.state.lastErrorClass)}.`}
            </p>
          ) : null}
          {completenessUnverified && !progressUntrusted ? (
            <p className="mt-1" data-testid="coverage-completeness-unverified">
              Loaded history is shown, but completeness is not yet verified.
            </p>
          ) : null}
        </div>
        {(props.state.status === 'partial' || props.state.status === 'error') &&
        !evidenceBlocked && !rendererDetached && !rendererFilterPending ? (
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
            aria-valuetext={`${props.state.deliveredFixCount} of ${props.state.totalFixCount} fixes`}
            className="h-2 w-full accent-violet-400"
            data-testid="coverage-progress"
            max={Math.max(1, props.state.totalFixCount)}
            role="progressbar"
            value={Math.min(props.state.deliveredFixCount, Math.max(1, props.state.totalFixCount))}
          />
          <p className="mt-1 font-mono text-[11px]" data-testid="coverage-progress-text">
            {props.state.deliveredFixCount.toLocaleString()} of{' '}
            {props.state.totalFixCount.toLocaleString()} fixes
          </p>
        </div>
      ) : null}

      <button
        className="sar-button mt-3 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
        data-testid="coverage-inspect-exact-fixes"
        onClick={props.onInspectExactFixes}
        type="button"
      >
        Inspect exact fixes
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
}) {
  const omitted = props.omittedDeviceCount + props.omittedOutingCount > 0 ||
    props.unassignedOmitted
  return (
    <div className="mt-1" data-testid="coverage-complete">
      <p>{omitted ? 'All selected history shown' : 'All mission history shown'}</p>
      {omitted ? (
        <p data-testid="coverage-omission-summary">
          {formatOmissionSummary(props)} Live positions are unchanged.
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

function formatErrorClass(value: string): string {
  return value.replaceAll('_', ' ')
}
