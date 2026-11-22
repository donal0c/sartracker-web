import { useMemo } from 'react'
import { useTrackingStore } from '../features/tracking/tracking-store'
import { resolveMissionHistoryOmissions } from '../features/layers/breadcrumb-coverage-visibility'
import { isCriticalTrackingTrustWarning } from '../features/tracking/tracking-trust-warning'
import { describeTrackingFeed, describeTrackingFreshness } from '../features/tracking/persistent-tracking-health'
import { useDeviceWorkspaceStore } from '../features/tracking/device-workspace-store'
import { useExactBreadcrumbDotStore } from '../features/tracking/exact-breadcrumb-dot-store'
import type { ExactBreadcrumbDotState } from '../features/tracking/exact-breadcrumb-dot-controller'
import { useTrackingStyleStore } from '../features/tracking/tracking-style-store'
import { ExactBreadcrumbDotStatus } from './exact-breadcrumb-dot-status'
import {
  collectTrailDeviceIds,
  describeTrailLineNotDrawn,
  summarizeTrailDrawing,
} from '../features/tracking/trail-line-visibility'
import { useIngestHealthStore } from '../features/tracking/ingest-health-store'
import { useStationaryAttentionStore } from '../features/tracking/stationary-attention-store'
import { useCoverageStore } from '../features/tracking/coverage-store'
import { useCoverageFilterStore } from '../features/tracking/coverage-filter-store'
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import { getEffectiveTrackingVisible } from '../features/layers/effective-overlay-visibility'
import { CoverageStatusPanel } from './coverage-status-panel'
import { useMissionStore } from '../features/mission/mission-store'
import { selectCoverageStateForMission } from '../features/tracking/mission-coverage-scope'
import type { NormalizedTrackingPosition } from '../features/tracking/tracking-types'
import { formatOperatorLocalTimestamp } from '../features/tracking/operator-time'
import { FIX_TIME_AHEAD_TOLERANCE_MS } from '../features/tracking/tracking-snapshot-health'

type TrackingStatusPanelProps = {
  readonly exactBreadcrumbDotState?: ExactBreadcrumbDotState
  readonly onExactBreadcrumbDotsEarlier?: () => void
  readonly onExactBreadcrumbDotsLater?: () => void
  /** Simplified workspace: only the warnings and history status; the plain summary sits above it. */
  readonly variant?: 'standard' | 'simplified'
}

/**
 * Renders the operator-facing tracking status summary.
 */
export function TrackingStatusPanel(props: TrackingStatusPanelProps = {}) {
  const snapshot = useTrackingStore((state) => state.snapshot)
  const status = useTrackingStore((state) => state.status)
  const openWorkspace = useDeviceWorkspaceStore((state) => state.openWorkspace)
  const breadcrumbTrailMode = useTrackingStyleStore((state) => state.breadcrumbTrailMode)
  const setBreadcrumbTrailMode = useTrackingStyleStore((state) => state.setBreadcrumbTrailMode)
  const coverageState = useCoverageStore((state) => state.state)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const recoverableMissionId = useMissionStore(
    (state) => state.recoverableMission?.id ?? null,
  )
  const governanceEvidenceHealth = useMissionStore(
    (state) => state.governanceEvidenceHealth,
  )
  const missionCoverageState = selectCoverageStateForMission(coverageState, missionId)
  const coverageController = useCoverageStore((state) => state.controller)
  const omittedDeviceIds = useCoverageFilterStore((state) => state.omittedDeviceIds)
  const omittedCoverageDeviceCount = resolveMissionHistoryOmissions(
    [...new Set(missionCoverageState.status === 'inactive' ? [] : missionCoverageState.manifest?.chunks.map((chunk) => chunk.key.device_id) ?? [])], omittedDeviceIds).length
  const omittedCoverageOutingCount = useCoverageFilterStore(
    (state) => state.omittedPeriodKeys.filter((key) => key.startsWith('outing\u0000')).length,
  )
  const unassignedCoverageOmitted = useCoverageFilterStore(
    (state) => state.omittedPeriodKeys.includes('unassigned\u0000'),
  )
  const storedExactBreadcrumbDotState = useExactBreadcrumbDotStore((state) => state.state)
  const hiddenBreadcrumbDeviceIds = useLayerVisibilityStore(
    (state) => state.hiddenBreadcrumbDeviceIds,
  )
  // Same rule the maps use: the Tracking group and the Trails switch must both be on [DON-338].
  const trailsVisible = useLayerVisibilityStore(
    (state) => getEffectiveTrackingVisible(state.groupVisibility) && state.breadcrumbsVisible,
  )
  const exactBreadcrumbDotController = useExactBreadcrumbDotStore((state) => state.controller)
  const ingestHealth = useIngestHealthStore((state) => state.summary)
  const activeEvidenceHealth = useIngestHealthStore((state) => state.evidenceHealth)
  const evidenceHealth = missionId === null &&
    recoverableMissionId === null &&
    governanceEvidenceHealth !== null
    ? governanceEvidenceHealth
    : activeEvidenceHealth
  const stationaryAttentionCount = useStationaryAttentionStore((state) =>
    Object.values(state.byDevice).filter((attention) => attention.state === 'attention').length,
  )
  const exactBreadcrumbDotState = props.exactBreadcrumbDotState ?? storedExactBreadcrumbDotState
  // Judge what is drawn from the renderers' own geometry inputs, never the roster:
  // the line comes from the live trail, the dots from the exact page [DON-338].
  const lineDeviceIds = useMemo(
    () => collectTrailDeviceIds(snapshot.breadcrumbs),
    [snapshot.breadcrumbs],
  )
  const dotDeviceIds = useMemo(
    () => collectTrailDeviceIds(
      exactBreadcrumbDotState.status === 'ready' && 'positions' in exactBreadcrumbDotState
        ? exactBreadcrumbDotState.positions
        : [],
    ),
    [exactBreadcrumbDotState],
  )
  const trailDrawing = useMemo(
    () => summarizeTrailDrawing({ trailsVisible, hiddenBreadcrumbDeviceIds, lineDeviceIds, dotDeviceIds }),
    [trailsVisible, hiddenBreadcrumbDeviceIds, lineDeviceIds, dotDeviceIds],
  )
  const trailLineNotDrawnSentence = describeTrailLineNotDrawn(trailDrawing.line)
  const staleDeviceCount = snapshot.positions.filter((position) => position.device_cache_stale).length
  const unverifiedFixTimePositions = snapshot.positions.filter(
    (position) => position.fix_time_unverified === true,
  )
  const unverifiedFixTimeCount = unverifiedFixTimePositions.length
  const aheadOfClockCount = snapshot.positions.filter(
    (position) => position.fix_time_ahead_of_clock === true,
  ).length
  const cachedDeviceCount = snapshot.positions.filter((position) => position.data_origin === 'cache').length
  const boundedBreadcrumbDeviceCount =
    snapshot.breadcrumbMetadata?.deviceBudgets.filter((budget) => budget.truncated).length ?? 0
  const degradedBreadcrumbBudgets =
    snapshot.breadcrumbMetadata?.deviceBudgets.filter(
      (budget) =>
        budget.truncated && budget.targetGeometryErrorSatisfied !== true,
    ) ?? []
  const hasUnknownBreadcrumbErrorBound = degradedBreadcrumbBudgets.some(
    (budget) =>
      typeof budget.geometryErrorBoundMetres !== 'number' ||
      !Number.isFinite(budget.geometryErrorBoundMetres),
  )
  const maximumBreadcrumbErrorBoundMetres = degradedBreadcrumbBudgets.reduce<number | null>(
    (maximum, budget) =>
      typeof budget.geometryErrorBoundMetres !== 'number' ||
      !Number.isFinite(budget.geometryErrorBoundMetres)
        ? maximum
        : Math.max(maximum ?? 0, budget.geometryErrorBoundMetres),
    null,
  )
  const criticalTrustWarning = isCriticalTrackingTrustWarning(status.warning)
  const historyTransfer = status.savedHistoryTransfer?.missionId === missionId ? status.savedHistoryTransfer : undefined
  const modeLabel = getTrackingModeLabel(status.mode, status.warning)
  // Online with old or unverified positions is not healthy: same rule as the
  // Devices header and the top bar [M-20].
  const freshnessWarning = describeTrackingFreshness(staleDeviceCount, unverifiedFixTimeCount)
  const feedHealthy = status.mode === 'online' && !criticalTrustWarning && status.warning === null && freshnessWarning === null
  // Connection-aware words for old positions: never "Feed connected" while
  // tracking is offline or not connected [DON-358].
  const freshnessMessage = freshnessWarning === null
    ? null
    : describeTrackingFeed(status, staleDeviceCount, unverifiedFixTimeCount, '')
  const modeChipClassName =
    feedHealthy
      ? 'sar-status-chip-success'
      : status.mode === 'online' && !criticalTrustWarning
        ? 'sar-status-chip-warning'
      : status.mode === 'offline' || criticalTrustWarning
        ? 'sar-status-chip-alert'
        : 'sar-status-chip-neutral'

  const simplified = props.variant === 'simplified'

  return (
    <div
      className={simplified ? 'text-sm' : 'sar-panel p-4 text-sm'}
      data-testid="tracking-status"
    >
      {simplified ? null : <div className="mb-4 flex items-center justify-between border-b border-[var(--sar-line)] pb-3">
        <div>
          <span className="sar-section-label text-amber-300">Tracking System</span>
          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-stone-300">
            telemetry stream
          </p>
        </div>
        <div
          className={`flex items-center gap-2 px-2 py-1 ${modeChipClassName}`}
          data-testid="tracking-mode-chip"
        >
          <div
            className={`h-2 w-2 rounded-full ${
              feedHealthy
                ? 'bg-emerald-300'
                : status.mode === 'online' && !criticalTrustWarning
                  ? 'bg-amber-300'
                : status.mode === 'offline' || criticalTrustWarning
                  ? 'bg-red-200 animate-pulse shadow-[0_0_10px_rgba(248,113,113,0.85)]'
                  : 'bg-stone-300'
            }`}
          />
          <span className="font-bold uppercase text-[11px]">{modeLabel}</span>
        </div>
      </div>}

      {simplified ? null : <div className="mb-4 flex">
        <button
          className="sar-button w-full px-3 py-2 text-xs font-bold uppercase tracking-[0.1em]"
          aria-describedby={status.warning === null && freshnessWarning === null ? undefined : 'tracking-status-message'}
          data-testid="open-devices-workspace"
          onClick={() => openWorkspace()}
          type="button"
        >
          Open Devices
        </button>
      </div>}

      {status.warning === null || simplified ? null : (
        <TrackingStatusMessage tone={criticalTrustWarning ? 'critical' : 'warning'}>
          {status.warning}
        </TrackingStatusMessage>
      )}
      {status.warning !== null || freshnessMessage === null || simplified ? null : (
        <TrackingStatusMessage tone={freshnessMessage.tone === 'alert' ? 'critical' : 'warning'}>
          {freshnessMessage.headline}
        </TrackingStatusMessage>
      )}

      {historyTransfer === undefined ? null : (
        <div className="mb-3 text-xs" role="status" data-testid="saved-history-transfer-status">
          <p className="mb-2">
            {historyTransfer.state === 'complete' ? 'Saved history transfer complete.'
              : historyTransfer.state === 'failed' ? 'Saved history could not be loaded. History remains incomplete; retry the history load.'
                : historyTransfer.totalPositions === 0 ? 'Reading saved breadcrumb history; history is not yet complete.'
                  : `${historyTransfer.receivedPositions.toLocaleString()} of ${historyTransfer.totalPositions.toLocaleString()} selected fixes transferred; history is not yet complete.`}
          </p>
          {historyTransfer.state !== 'loading' ? null : <progress
          aria-label="Saved breadcrumb history transfer"
          className="mb-3 h-2 w-full accent-cyan-400"
          value={historyTransfer.receivedPositions}
          max={Math.max(1, historyTransfer.totalPositions)}
        />}
        </div>
      )}

      {ingestHealth.totalRejected === 0 ? null : (
        <p
          className="mb-4 border-l-4 border-l-amber-400 bg-amber-400/15 px-3 py-2 text-xs font-medium leading-relaxed text-amber-100"
          data-testid="current-position-ingest-warning"
        >
          POSITION DATA WARNING — {ingestHealth.totalRejected}{' '}
          {ingestHealth.totalRejected === 1 ? 'row was' : 'rows were'} rejected in the latest
          poll across {ingestHealth.affectedDeviceCount}{' '}
          {ingestHealth.affectedDeviceCount === 1 ? 'identified device' : 'identified devices'}
          {ingestHealth.unidentifiedRejected === 0
            ? ''
            : `; ${ingestHealth.unidentifiedRejected} ${ingestHealth.unidentifiedRejected === 1 ? 'row had' : 'rows had'} no valid device identity`}
          . Valid current fixes remain visible.
        </p>
      )}

      {evidenceHealth.state === 'healthy' ? null : (
        <p
          className="sar-status-alert-panel mb-4 border-l-4 px-3 py-2 text-xs font-medium leading-relaxed"
          data-testid="ingest-evidence-health-warning"
        >
          EVIDENCE HEALTH {evidenceHealth.state.toUpperCase()} — {formatEvidenceFailure(evidenceHealth.reason)}.
          {evidenceHealth.acknowledgedLoss === undefined ? (
            <> Current positions remain live, but anomaly evidence is not fully saved; mission finalization and archive export are blocked {formatEvidenceRecovery(evidenceHealth.reason)}.</>
          ) : (
            <> Evidence loss was acknowledged by {evidenceHealth.acknowledgedLoss.adminName}. Complete and 100% remain blocked permanently; archive and lock may proceed with this warning retained.</>
          )}
        </p>
      )}

      {evidenceHealth.conflictCount === 0 ? null : (
        <p
          className="mb-4 border-l-4 border-l-amber-400 bg-amber-400/15 px-3 py-2 text-xs font-medium leading-relaxed text-amber-100"
          data-testid="position-conflict-warning"
        >
          POSITION SOURCE CONFLICT — {evidenceHealth.conflictCount}{' '}
          {evidenceHealth.conflictCount === 1 ? 'conflicting observation was' : 'conflicting observations were'} retained. The first accepted fix remains displayed.
        </p>
      )}

      {unverifiedFixTimeCount === 0 ? null : (
        <p
          className="mb-4 border-l-4 border-l-amber-400 bg-amber-400/15 px-3 py-2 text-xs font-medium leading-relaxed text-amber-100"
          data-testid="fix-time-unverified-warning"
        >
          FIX TIME UNVERIFIED — {unverifiedFixTimeCount}{' '}
          {unverifiedFixTimeCount === 1 ? 'position uses' : 'positions use'}{' '}
          {describeUnverifiedFixTimeSources(unverifiedFixTimePositions)}, not verified Traccar fixTime.
          {' '}{unverifiedFixTimeCount === 1 ? 'It remains' : 'They remain'} visible for immediate
          safety but {unverifiedFixTimeCount === 1 ? 'is' : 'are'} excluded from exact breadcrumb evidence.
        </p>
      )}

      {aheadOfClockCount === 0 ? null : (
        <p
          className="mb-4 border-l-4 border-l-amber-400 bg-amber-400/15 px-3 py-2 text-xs font-medium leading-relaxed text-amber-100"
          data-testid="fix-time-ahead-warning"
        >
          FIX TIME AHEAD OF THIS LAPTOP — {aheadOfClockCount}{' '}
          {aheadOfClockCount === 1 ? 'device reports a fix time' : 'devices report fix times'} more than
          {' '}{FIX_TIME_AHEAD_TOLERANCE_MS / 60_000} minutes in the future.
          {' '}{aheadOfClockCount === 1 ? 'It is' : 'They are'} shown as stale. Check the laptop clock and the tracker time zone.
        </p>
      )}

      {stationaryAttentionCount === 0 || simplified ? null : (
        <p
          className="mb-4 border-l-4 border-l-amber-400 bg-amber-400/15 px-3 py-2 text-xs font-medium leading-relaxed text-amber-100"
          data-testid="stationary-attention-summary"
        >
          STATIONARY ATTENTION — {stationaryAttentionCount}{' '}
          {stationaryAttentionCount === 1 ? 'device needs' : 'devices need'} stationary attention. Open Devices to review or acknowledge the presentation; movement clears the underlying state.
        </p>
      )}

      <CoverageStatusPanel
        state={missionCoverageState}
        omittedDeviceCount={omittedCoverageDeviceCount}
        omittedOutingCount={omittedCoverageOutingCount}
        unassignedOmitted={unassignedCoverageOmitted}
        onInspectExactFixes={() => setBreadcrumbTrailMode('dots')}
        {...(simplified ? { inspectLabel: 'Show recorded positions' } : {})}
        onRetry={() => void coverageController?.resume()}
      />

      {breadcrumbTrailMode === 'dots' ? (
        <ExactBreadcrumbDotStatus
          state={exactBreadcrumbDotState}
          trailDrawing={trailDrawing}
          onEarlier={
            props.onExactBreadcrumbDotsEarlier ??
            (() => exactBreadcrumbDotController?.showEarlier())
          }
          onLater={
            props.onExactBreadcrumbDotsLater ??
            (() => exactBreadcrumbDotController?.showLater())
          }
        />
      ) : null}

      {/* The simplified line is drawn in both modes, so its disclosure is too [DON-338]. */}
      {boundedBreadcrumbDeviceCount > 0 &&
      snapshot.breadcrumbMetadata !== undefined ? (
        <p
          className={`mb-4 border-l-4 px-3 py-2 text-xs font-medium leading-relaxed ${
            degradedBreadcrumbBudgets.length > 0
              ? 'border-l-amber-400 bg-amber-400/10 text-amber-100'
              : 'border-l-sky-400 bg-sky-400/10 text-sky-100'
          }`}
          data-testid="breadcrumb-display-summary"
        >
          Trail display simplified: showing{' '}
          {snapshot.breadcrumbMetadata.totalRetained.toLocaleString()} of at least{' '}
          {snapshot.breadcrumbMetadata.totalObserved.toLocaleString()} known fixes across the
          full route.{' '}
          {degradedBreadcrumbBudgets.length === 0
            ? 'Displayed route error is bounded to 25 metres.'
            : hasUnknownBreadcrumbErrorBound || maximumBreadcrumbErrorBoundMetres === null
              ? 'This route is too complex for a guaranteed display-error bound.'
              : `Displayed route error may be up to ${Math.ceil(maximumBreadcrumbErrorBoundMetres)} metres for this route.`}{' '}
          Full mission history remains stored.
          {trailLineNotDrawnSentence === null ? null : ` ${trailLineNotDrawnSentence}`}
        </p>
      ) : null}

      {simplified ? null : <><div
        className="grid grid-cols-4 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] font-mono text-[13px] tracking-tight text-stone-100"
        data-testid="tracking-counters"
      >
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Devices</span>
          <span className="mt-1 block text-lg font-black text-stone-100">{snapshot.devices.length}</span>
        </div>
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Fixes</span>
          <span className="mt-1 block text-lg font-black text-stone-100">{snapshot.positions.length}</span>
        </div>
        <div className="border-r border-[var(--sar-line)] px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Cache</span>
          <span className="mt-1 block text-lg font-black text-amber-400">{cachedDeviceCount}</span>
        </div>
        <div className="px-3 py-3">
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Stale</span>
          <span className={`mt-1 block text-lg font-black ${staleDeviceCount > 0 ? 'text-rose-300' : 'text-stone-200'}`}>{staleDeviceCount}</span>
        </div>
      </div>

      <div className="mt-4 space-y-3 border-t border-[var(--sar-line)] pt-4">
        <div className="sar-readout px-3 py-2 text-[11px] font-medium text-stone-300">
          <span className="block">Last success</span>
          <span className="mt-1 block text-right font-mono font-bold text-stone-300">
            {formatOperatorLocalTimestamp(status.lastSuccessAt)}
          </span>
        </div>
        {feedHealthy ? (
          <TrackingStatusMessage tone="healthy">
            Telemetry stream healthy
          </TrackingStatusMessage>
        ) : null}
      </div></>}
    </div>
  )
}

/** Describes only clock provenance categories, never position or device identity. */
function describeUnverifiedFixTimeSources(
  positions: readonly NormalizedTrackingPosition[],
): string {
  const counts = positions.reduce(
    (result, position) => {
      if (position.timestamp_source === 'device') result.device += 1
      else if (position.timestamp_source === 'server') result.server += 1
      else result.legacy += 1
      return result
    },
    { device: 0, server: 0, legacy: 0 },
  )
  return [
    counts.device === 0 ? null : `${counts.device === 1 ? '' : `${counts.device} × `}device clock`,
    counts.server === 0 ? null : `${counts.server === 1 ? '' : `${counts.server} × `}server receipt clock`,
    counts.legacy === 0
      ? null
      : `${counts.legacy === 1 ? '' : `${counts.legacy} × `}legacy cache provenance unavailable`,
  ].filter((label): label is string => label !== null).join('; ')
}

function formatEvidenceFailure(reason: string | null): string {
  switch (reason) {
    case 'projection_failed':
    case 'ledger_projection_failed':
      return 'mission evidence projection failed'
    case 'outbox_storage_unavailable':
      return 'local evidence storage is unavailable'
    case 'outbox_capacity_exceeded':
    case 'outbox_capacity_exhausted':
    case 'renderer_pending_capacity_exhausted':
      return 'local evidence storage capacity was exceeded'
    case 'outbox_corrupt':
    case 'outbox_corrupt_record':
      return 'stored evidence requires repair'
    case 'evidence_delivery_unavailable':
    case 'evidence_health_unavailable':
      return 'the evidence persistence service is unavailable'
    case 'renderer_pending_evidence_lost':
      return 'rejected-position evidence may have been lost when the app closed unexpectedly'
    case 'renderer_evidence_pending':
      return 'rejected-position evidence is waiting to be saved'
    default:
      return 'mission evidence persistence requires repair'
  }
}

function formatEvidenceRecovery(reason: string | null): string {
  if (reason === 'renderer_evidence_pending') {
    return 'until the queued evidence is saved'
  }
  if (
    reason === 'renderer_pending_evidence_lost' ||
    reason === 'renderer_pending_capacity_exhausted'
  ) {
    return 'until an authorized admin records the permanent known loss'
  }
  return 'until storage is repaired'
}

function getTrackingModeLabel(mode: 'idle' | 'offline' | 'online', warning: string | null): string {
  if (warning !== null && /live refresh suspended/i.test(warning)) {
    return 'paused'
  }
  return mode
}


function TrackingStatusMessage(props: {
  readonly children: string
  readonly tone: 'critical' | 'healthy' | 'warning'
}) {
  const className =
    props.tone === 'critical'
      ? 'sar-status-alert-panel mb-4'
      : props.tone === 'warning'
        ? 'mb-4 border-l-amber-400 bg-amber-400/15 text-amber-100'
        : 'border-l-emerald-400 bg-emerald-400/10 text-emerald-200'

  return (
    <p
      className={`border-l-4 px-3 py-2 text-xs font-medium leading-relaxed ${className}`}
      data-testid="tracking-warning"
      id="tracking-status-message"
    >
      {props.children}
    </p>
  )
}
