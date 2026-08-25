import { useTrackingStore } from '../features/tracking/tracking-store'
import { useDeviceWorkspaceStore } from '../features/tracking/device-workspace-store'
import { useExactBreadcrumbDotStore } from '../features/tracking/exact-breadcrumb-dot-store'
import type { ExactBreadcrumbDotState } from '../features/tracking/exact-breadcrumb-dot-controller'
import { useTrackingStyleStore } from '../features/tracking/tracking-style-store'
import { ExactBreadcrumbDotStatus } from './exact-breadcrumb-dot-status'
import { useIngestHealthStore } from '../features/tracking/ingest-health-store'
import { useStationaryAttentionStore } from '../features/tracking/stationary-attention-store'
import { useCoverageStore } from '../features/tracking/coverage-store'
import { useCoverageFilterStore } from '../features/tracking/coverage-filter-store'
import { CoverageStatusPanel } from './coverage-status-panel'
import { useMissionStore } from '../features/mission/mission-store'
import { selectCoverageStateForMission } from '../features/tracking/mission-coverage-scope'

type TrackingStatusPanelProps = {
  readonly exactBreadcrumbDotState?: ExactBreadcrumbDotState
  readonly onExactBreadcrumbDotsEarlier?: () => void
  readonly onExactBreadcrumbDotsLater?: () => void
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
  const missionCoverageState = selectCoverageStateForMission(coverageState, missionId)
  const coverageController = useCoverageStore((state) => state.controller)
  const omittedCoverageDeviceCount = useCoverageFilterStore(
    (state) => state.omittedDeviceIds.length,
  )
  const omittedCoverageOutingCount = useCoverageFilterStore(
    (state) => state.omittedPeriodKeys.filter((key) => key.startsWith('outing\u0000')).length,
  )
  const unassignedCoverageOmitted = useCoverageFilterStore(
    (state) => state.omittedPeriodKeys.includes('unassigned\u0000'),
  )
  const storedExactBreadcrumbDotState = useExactBreadcrumbDotStore((state) => state.state)
  const exactBreadcrumbDotController = useExactBreadcrumbDotStore((state) => state.controller)
  const ingestHealth = useIngestHealthStore((state) => state.summary)
  const evidenceHealth = useIngestHealthStore((state) => state.evidenceHealth)
  const stationaryAttentionCount = useStationaryAttentionStore((state) =>
    Object.values(state.byDevice).filter((attention) => attention.state === 'attention').length,
  )
  const exactBreadcrumbDotState = props.exactBreadcrumbDotState ?? storedExactBreadcrumbDotState
  const staleDeviceCount = snapshot.positions.filter((position) => position.device_cache_stale).length
  const unverifiedFixTimeCount = snapshot.positions.filter(
    (position) => position.fix_time_unverified === true,
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
  const modeLabel = getTrackingModeLabel(status.mode, status.warning)
  const modeChipClassName =
    status.mode === 'online' && !criticalTrustWarning
      ? 'sar-status-chip-success'
      : status.mode === 'offline' || criticalTrustWarning
        ? 'sar-status-chip-alert'
        : 'sar-status-chip-neutral'

  return (
    <div
      className="sar-panel p-4 text-sm"
      data-testid="tracking-status"
    >
      <div className="mb-4 flex items-center justify-between border-b border-[var(--sar-line)] pb-3">
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
              status.mode === 'online' && !criticalTrustWarning
                ? 'bg-emerald-300'
                : status.mode === 'offline' || criticalTrustWarning
                  ? 'bg-red-200 animate-pulse shadow-[0_0_10px_rgba(248,113,113,0.85)]'
                  : 'bg-stone-300'
            }`}
          />
          <span className="font-bold uppercase text-[11px]">{modeLabel}</span>
        </div>
      </div>

      <div className="mb-4 flex">
        <button
          className="sar-button w-full px-3 py-2 text-xs font-bold uppercase tracking-[0.1em]"
          aria-describedby={status.warning === null ? undefined : 'tracking-status-message'}
          data-testid="open-devices-workspace"
          onClick={() => openWorkspace()}
          type="button"
        >
          Open Devices
        </button>
      </div>

      {status.warning === null ? null : (
        <TrackingStatusMessage tone={criticalTrustWarning ? 'critical' : 'warning'}>
          {status.warning}
        </TrackingStatusMessage>
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
          {' '}Current positions remain live, but anomaly evidence is not fully saved; mission finalization and archive export are blocked {formatEvidenceRecovery(evidenceHealth.reason)}.
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
          {unverifiedFixTimeCount === 1 ? 'position has' : 'positions have'} server receipt time
          only and {unverifiedFixTimeCount === 1 ? 'is' : 'are'} not treated as a fresh device fix.
        </p>
      )}

      {stationaryAttentionCount === 0 ? null : (
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
        onRetry={() => void coverageController?.resume()}
      />

      {breadcrumbTrailMode === 'dots' ? (
        <ExactBreadcrumbDotStatus
          state={exactBreadcrumbDotState}
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

      {breadcrumbTrailMode === 'line' &&
      boundedBreadcrumbDeviceCount > 0 &&
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
        </p>
      ) : null}

      <div
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
        <div className="sar-readout flex items-center justify-between px-3 py-2 text-[11px] font-medium text-stone-300">
          <span>Last success</span>
          <span className="font-mono font-bold text-stone-300">
            {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleTimeString() : 'N/A'}
          </span>
        </div>
        {status.warning === null ? (
          <TrackingStatusMessage tone="healthy">
            Telemetry stream healthy
          </TrackingStatusMessage>
        ) : null}
      </div>
    </div>
  )
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
    case 'renderer_evidence_pending':
      return 'rejected-position evidence is waiting to be saved'
    default:
      return 'mission evidence persistence requires repair'
  }
}

function formatEvidenceRecovery(reason: string | null): string {
  return reason === 'renderer_evidence_pending'
    ? 'until the queued evidence is saved'
    : 'until storage is repaired'
}

function getTrackingModeLabel(mode: 'idle' | 'offline' | 'online', warning: string | null): string {
  if (warning !== null && /live refresh suspended/i.test(warning)) {
    return 'paused'
  }
  return mode
}

function isCriticalTrackingTrustWarning(warning: string | null): boolean {
  if (warning === null) {
    return false
  }

  return /offline mode|live refresh suspended/i.test(warning)
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
