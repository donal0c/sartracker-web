import { useEffect, useMemo, useState } from 'react'

import { openExternalPath } from '../infrastructure/file-launcher/tauri-file-launcher'
import { WorkspaceOverlay, WorkspaceHeader } from './workspace-overlay'
import { useMapTargetStore } from '../features/map/map-target-store'
import {
  filterMissionReviewMarkers,
  type MissionReviewMarkerRow,
  type MissionReviewSummary,
  type MissionReviewEventRow,
  type MissionReviewSnapshot,
} from '../features/mission-review/mission-review-model'
import { getMissionReviewSelectionClassName } from '../features/mission-review/mission-review-selection-style'
import { useMissionReviewStore } from '../features/mission-review/mission-review-store'
import { useMissionReviewWorkspaceStore } from '../features/mission-review/mission-review-workspace-store'
import { useMissionStore } from '../features/mission/mission-store'

type ReviewTab = 'mission-details' | 'marker-log' | 'layer-console'

const MISSION_REVIEW_WORKSPACE_TITLE_ID = 'mission-review-workspace-title'

/**
 * Renders the mission review workspace for audit, marker review, and mission details.
 */
export function MissionReviewWorkspace() {
  const open = useMissionReviewWorkspaceStore((state) => state.open)
  const closeWorkspace = useMissionReviewWorkspaceStore((state) => state.closeWorkspace)
  const missionPhase = useMissionStore((state) => state.phase)
  // While a mission is live, Review must not block the mission-control rail or
  // map (DON-176): render it as a non-blocking docked, read-only panel. When
  // there is no live mission (idle/recovery review), there are no live controls
  // to protect, so it stays a full-screen modal review surface.
  const docked = missionPhase === 'active' || missionPhase === 'paused'
  const controller = useMissionReviewStore((state) => state.controller)
  const missions = useMissionReviewStore((state) => state.missions)
  const selectedMissionId = useMissionReviewStore((state) => state.selectedMissionId)
  const snapshot = useMissionReviewStore((state) => state.snapshot)
  const loading = useMissionReviewStore((state) => state.loading)
  const refreshing = useMissionReviewStore((state) => state.refreshing)
  const error = useMissionReviewStore((state) => state.error)
  const includeTelemetry = useMissionReviewStore((state) => state.includeTelemetry)
  const auditLogTruncated = useMissionReviewStore((state) => state.auditLogTruncated)
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const [activeTab, setActiveTab] = useState<ReviewTab>('mission-details')
  const [missionQuery, setMissionQuery] = useState('')
  const [markerQuery, setMarkerQuery] = useState('')
  const [markerType, setMarkerType] = useState<'all' | 'ipp_lkp' | 'clue' | 'hazard' | 'casualty'>('all')
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [pathFeedback, setPathFeedback] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)

  const filteredMissions = useMemo(() => {
    const normalizedQuery = missionQuery.trim().toLowerCase()
    if (normalizedQuery === '') {
      return missions
    }

    return missions.filter((mission) =>
      `${mission.name} ${mission.status}`.toLowerCase().includes(normalizedQuery),
    )
  }, [missionQuery, missions])

  const filteredMarkers = useMemo(
    () =>
      snapshot === null
        ? []
        : filterMissionReviewMarkers(snapshot.markerRows, { query: markerQuery, type: markerType }),
    [markerQuery, markerType, snapshot],
  )

  const selectedMarker =
    filteredMarkers.find((marker) => marker.id === selectedMarkerId) ?? filteredMarkers[0] ?? null

  useEffect(() => {
    if (!open || controller === null) {
      return
    }

    void controller.load(selectedMissionId)
  }, [controller, open, selectedMissionId])

  useEffect(() => {
    setSelectedMarkerId((current) =>
      current !== null && filteredMarkers.some((marker) => marker.id === current)
        ? current
        : (filteredMarkers[0]?.id ?? null),
    )
  }, [filteredMarkers])

  return (
    <WorkspaceOverlay
      labelledBy={MISSION_REVIEW_WORKSPACE_TITLE_ID}
      open={open}
      onClose={closeWorkspace}
      maxWidth={docked ? 'max-w-xl' : 'max-w-7xl'}
      docked={docked}
    >
      <WorkspaceHeader
        subtitle="Mission Review"
        titleId={MISSION_REVIEW_WORKSPACE_TITLE_ID}
        title="Audit Workspace"
        onClose={closeWorkspace}
        actions={
          <button
            className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-200 disabled:opacity-50"
            data-testid="mission-review-refresh"
            disabled={controller === null || refreshing}
            onClick={() => void controller?.refreshSelectedMission()}
            type="button"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {docked ? (
        <p
          className="border-b border-amber-400/40 bg-amber-400/10 px-6 py-2 text-[12px] font-semibold text-amber-100"
          data-testid="mission-review-docked-readonly-note"
          role="status"
        >
          Review is read-only. Mission controls and the map stay live next to it — close Review or
          press Esc to return full width.
        </p>
      ) : null}

      <div
        className={`grid flex-1 overflow-hidden ${
          docked ? '' : 'lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,2fr)]'
        }`}
      >
          {/*
            Docked Review is scoped to the live mission, so the mission selector
            is hidden to keep the narrow panel usable (DON-176). The runtime
            auto-selects the active/paused mission. Full-screen modal Review
            (no live mission) keeps the selector for cross-mission audit.
          */}
          <aside className={`border-r border-stone-800 px-5 py-5 ${docked ? 'hidden' : ''}`}>
            <div className="rounded-2xl border border-stone-800 bg-stone-900/30 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                Mission Selector
              </p>
              <input
                className="mt-3 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100 placeholder:text-stone-700 outline-none focus:border-amber-500/50"
                data-testid="mission-review-mission-search"
                onChange={(event) => setMissionQuery(event.target.value)}
                placeholder="Search missions..."
                value={missionQuery}
              />
              <div className="mt-3 max-h-[42rem] space-y-2 overflow-y-auto" data-testid="mission-review-mission-list">
                {filteredMissions.map((mission) => {
                  const selected = mission.id === selectedMissionId
                  return (
                    <button
                      className={`block w-full rounded-xl border px-3 py-3 text-left ${
                        selected
                          ? getMissionReviewSelectionClassName(true)
                          : 'border-stone-800 bg-stone-950/40 hover:border-stone-700'
                      }`}
                      data-testid={`mission-review-select-${mission.id}`}
                      key={mission.id}
                      onClick={() => void controller?.selectMission(mission.id)}
                      type="button"
                    >
                      <p className="truncate font-semibold text-stone-100">{mission.name}</p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                        {mission.status}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-stone-400">
                        {new Date(mission.start_time).toLocaleString('en-IE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                      </p>
                    </button>
                  )
                })}
                {filteredMissions.length === 0 ? (
                  <EmptyState message="No missions match the current filter." />
                ) : null}
              </div>
            </div>
          </aside>

          <section className="flex min-h-0 flex-col px-6 py-5">
            <div className="flex items-center gap-2 border-b border-stone-800 pb-3">
              <TabButton
                active={activeTab === 'mission-details'}
                label="Mission Details"
                onClick={() => setActiveTab('mission-details')}
              />
              <TabButton
                active={activeTab === 'marker-log'}
                label="Marker Log"
                onClick={() => setActiveTab('marker-log')}
              />
              <TabButton
                active={activeTab === 'layer-console'}
                label="Layer Console"
                onClick={() => setActiveTab('layer-console')}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pt-5" data-testid="mission-review-workspace">
              {loading && snapshot === null ? <EmptyState message="Loading mission review…" /> : null}
              {error !== null ? <EmptyState message={error} testId="mission-review-error" /> : null}
              {!loading && error === null && snapshot === null ? (
                <EmptyState message="No missions are available for review." />
              ) : null}

              {snapshot !== null && error === null ? (
                activeTab === 'mission-details' ? (
                  <MissionDetailsTab
                    auditLogTruncated={auditLogTruncated}
                    compact={docked}
                    events={snapshot.eventRows}
                    includeTelemetry={includeTelemetry}
                    onOpenPath={(path) => void handleOpenPath(path)}
                    onToggleTelemetry={(next) => void controller?.setIncludeTelemetry(next)}
                    pathError={pathError}
                    pathFeedback={pathFeedback}
                    summary={snapshot.summary}
                  />
                ) : activeTab === 'marker-log' ? (
                  <MarkerLogTab
                    compact={docked}
                    markerQuery={markerQuery}
                    markerType={markerType}
                    markers={filteredMarkers}
                    onMarkerQueryChange={setMarkerQuery}
                    onMarkerTypeChange={setMarkerType}
                    onOpenPath={(path) => void handleOpenPath(path)}
                    onSelectMarker={setSelectedMarkerId}
                    onZoomMarker={() => {
                      if (
                        selectedMarker === null ||
                        !isValidWgs84(selectedMarker.lat, selectedMarker.lon)
                      ) {
                        return
                      }
                      queueTarget(selectedMarker.lat, selectedMarker.lon, selectedMarker.name)
                    }}
                    selectedMarker={selectedMarker}
                  />
                ) : (
                  <LayerConsoleTab layerRoot={snapshot.layerRoot} />
                )
              ) : null}
            </div>
          </section>
        </div>
    </WorkspaceOverlay>
  )

  async function handleOpenPath(path: string | null): Promise<void> {
    if (path === null) {
      setPathError('No path is available for this item yet.')
      setPathFeedback(null)
      return
    }

    try {
      await openExternalPath(path)
      setPathError(null)
      setPathFeedback(`Opened ${path}`)
    } catch (error) {
      setPathFeedback(null)
      setPathError(toErrorMessage(error))
    }
  }
}

function MissionDetailsTab(props: {
  readonly summary: MissionReviewSummary
  readonly events: readonly MissionReviewEventRow[]
  readonly includeTelemetry: boolean
  readonly auditLogTruncated: boolean
  readonly compact: boolean
  readonly onToggleTelemetry: (includeTelemetry: boolean) => void
  readonly onOpenPath: (path: string | null) => void
  readonly pathFeedback: string | null
  readonly pathError: string | null
}) {
  return (
    <div className="space-y-5">
      <div className={`grid gap-3 ${props.compact ? 'grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
        <SummaryCard label="Status" value={props.summary.missionStatus} />
        <SummaryCard label="Markers" value={String(props.summary.markerCount)} />
        <SummaryCard label="Devices" value={String(props.summary.trackingDeviceCount)} />
        <SummaryCard label="Breadcrumbs" value={String(props.summary.breadcrumbCount)} />
        <SummaryCard label="GPX Imports" value={String(props.summary.gpxImportCount)} />
      </div>

      <div className={`grid gap-5 ${props.compact ? '' : 'lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]'}`}>
        <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
            Mission Details
          </h3>
          <dl className="mt-4 grid gap-3 text-sm text-stone-300 sm:grid-cols-2">
            <DetailRow label="Mission Name" value={props.summary.missionName} />
            <DetailRow label="Started" value={props.summary.startedAtDisplay} />
            <DetailRow label="Finished" value={props.summary.finishedAtDisplay} />
            <DetailRow label="Paused Time" value={props.summary.pausedDurationDisplay} />
            <DetailRow label="Database Path" value={props.summary.databasePath} />
            <DetailRow label="Backup Path" value={props.summary.backupPath} />
            <DetailRow label="Layer Count" value={String(props.summary.layerCount)} />
            <DetailRow label="Feature Count" value={String(props.summary.featureCount)} />
            <DetailRow label="Drawing Count" value={String(props.summary.drawingCount)} />
            <DetailRow label="GPX Imports" value={String(props.summary.gpxImportCount)} />
            <DetailRow label="Event Count" value={String(props.summary.eventCount)} />
          </dl>
          <div className="mt-4 rounded-xl border border-stone-800 bg-stone-950/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Notes</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-300">{props.summary.noteSummary}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
              Audit Log
            </h3>
            <label
              className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-stone-400"
              data-testid="mission-review-telemetry-toggle"
            >
              <input
                checked={props.includeTelemetry}
                className="h-3.5 w-3.5 accent-amber-500"
                onChange={(event) => props.onToggleTelemetry(event.target.checked)}
                type="checkbox"
              />
              Show tracking telemetry
            </label>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
            {props.includeTelemetry
              ? 'Showing all events, including high-volume device and position telemetry.'
              : 'Showing operator events only. Device and position telemetry are hidden.'}
          </p>
          {props.auditLogTruncated ? (
            <p
              className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
              data-testid="mission-review-audit-truncated"
            >
              Showing the most recent events only. Older events are not displayed.
            </p>
          ) : null}
          <div className="mt-4 max-h-[38rem] space-y-3 overflow-y-auto" data-testid="mission-review-event-log">
            {props.events.map((event) => (
              <div className="rounded-xl border border-stone-800 bg-stone-950/30 p-4" key={event.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-stone-100">{event.title}</p>
                    <p className="mt-1 text-xs text-stone-400">{event.timestampDisplay}</p>
                  </div>
                  <span className="rounded-full border border-stone-700 px-2 py-1 text-[10px] uppercase tracking-wider text-stone-400">
                    {event.eventType}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-stone-300">{event.description}</p>
                <div className="mt-3 flex gap-2">
                  {resolveEventPath(event) !== null ? (
                    <button
                      className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-300"
                      data-testid={`mission-review-open-path-${event.id}`}
                      onClick={() => props.onOpenPath(resolveEventPath(event))}
                      type="button"
                    >
                      Open Path
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {props.pathFeedback !== null ? (
            <p className="mt-3 text-sm text-emerald-300" data-testid="mission-review-path-feedback">
              {props.pathFeedback}
            </p>
          ) : null}
          {props.pathError !== null ? (
            <p className="mt-3 text-sm text-rose-300" data-testid="mission-review-path-error">
              {props.pathError}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function MarkerLogTab(props: {
  readonly markers: readonly MissionReviewMarkerRow[]
  readonly selectedMarker: MissionReviewMarkerRow | null
  readonly markerQuery: string
  readonly markerType: 'all' | 'ipp_lkp' | 'clue' | 'hazard' | 'casualty'
  readonly compact: boolean
  readonly onMarkerQueryChange: (value: string) => void
  readonly onMarkerTypeChange: (value: 'all' | 'ipp_lkp' | 'clue' | 'hazard' | 'casualty') => void
  readonly onSelectMarker: (markerId: string) => void
  readonly onZoomMarker: () => void
  readonly onOpenPath: (path: string | null) => void
}) {
  const selectedMarker = props.selectedMarker

  return (
    <div className={`grid gap-5 ${props.compact ? '' : 'lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]'}`}>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
          <input
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100 placeholder:text-stone-700 outline-none focus:border-amber-500/50"
            data-testid="mission-review-marker-search"
            onChange={(event) => props.onMarkerQueryChange(event.target.value)}
            placeholder="Search marker log..."
            value={props.markerQuery}
          />
          <select
            className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100 outline-none focus:border-amber-500/50"
            data-testid="mission-review-marker-type-filter"
            onChange={(event) =>
              props.onMarkerTypeChange(
                event.target.value as 'all' | 'ipp_lkp' | 'clue' | 'hazard' | 'casualty',
              )
            }
            value={props.markerType}
          >
            <option value="all">All types</option>
            <option value="ipp_lkp">IPP / LKP</option>
            <option value="clue">Clues</option>
            <option value="hazard">Hazards</option>
            <option value="casualty">Casualties</option>
          </select>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-stone-800 bg-stone-950/20">
          <div className="grid grid-cols-[6rem_minmax(0,1fr)_9rem_9rem] border-b border-stone-800 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-stone-400">
            <span>Type</span>
            <span>Name</span>
            <span>Created</span>
            <span>Updated</span>
          </div>
          <div className="max-h-[34rem] overflow-y-auto" data-testid="mission-review-marker-log">
            {props.markers.map((marker) => (
              <button
                className={`grid w-full grid-cols-[6rem_minmax(0,1fr)_9rem_9rem] border-b border-stone-800/70 px-4 py-3 text-left text-sm ${
                  props.selectedMarker?.id === marker.id
                    ? getMissionReviewSelectionClassName(true)
                    : 'bg-transparent'
                }`}
                data-testid={`mission-review-marker-${marker.id}`}
                key={marker.id}
                onClick={() => props.onSelectMarker(marker.id)}
                type="button"
              >
                <span className="font-semibold uppercase text-stone-300">{marker.type}</span>
                <span className="truncate text-stone-100">{marker.name}</span>
                <span className="font-mono text-xs text-stone-400">{marker.createdAtDisplay}</span>
                <span className="font-mono text-xs text-stone-400">{marker.updatedAtDisplay}</span>
              </button>
            ))}
            {props.markers.length === 0 ? <EmptyState message="No markers match the current filter." /> : null}
          </div>
        </div>
      </section>

      <aside className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="mission-review-marker-detail">
        {selectedMarker === null ? (
          <EmptyState message="Select a marker to inspect it." />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Selected Marker
                </p>
                <h3 className="mt-1 text-xl font-semibold text-stone-100">
                  {selectedMarker.name}
                </h3>
                <p className="mt-1 text-xs uppercase tracking-wider text-stone-400">
                  {selectedMarker.type}
                </p>
              </div>
              <button
                className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-200"
                data-testid="mission-review-marker-zoom"
                onClick={props.onZoomMarker}
                type="button"
              >
                Zoom
              </button>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-stone-300">
              {selectedMarker.description}
            </p>

            <dl className="mt-4 space-y-2 text-sm text-stone-300">
              {selectedMarker.detailRows.map((row) => (
                <div className="flex items-start justify-between gap-4" key={row.label}>
                  <dt className="text-stone-400">{row.label}</dt>
                  <dd className="text-right font-mono text-stone-200">{row.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex gap-3">
              <button
                className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-200"
                data-testid="mission-review-marker-open-attachment"
                disabled={selectedMarker.attachmentPath === null}
                onClick={() => props.onOpenPath(selectedMarker.attachmentPath)}
                type="button"
              >
                Open Attachment
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-stone-800 bg-stone-950/30 p-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Marker History
              </p>
              <div className="mt-3 space-y-3" data-testid="mission-review-marker-history">
                {selectedMarker.historyRows.length === 0 ? (
                  <p className="text-sm text-stone-400">No marker history recorded.</p>
                ) : (
                  selectedMarker.historyRows.map((event) => (
                    <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-3" key={event.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold text-stone-100">{event.title}</p>
                        <span className="font-mono text-[11px] text-stone-400">
                          {event.timestampDisplay}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-stone-300">
                        {event.description}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

function LayerConsoleTab(props: {
  readonly layerRoot: MissionReviewSnapshot['layerRoot']
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
          Layer Console Summary
        </p>
        <p className="mt-2 text-sm leading-relaxed text-stone-400">
          Layer visibility and ordering remain single-sourced through the live Layer Workspace in the
          main shell. This review tab mirrors the current grouped catalog for audit and count review.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {props.layerRoot.children.map((group) => (
          <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" key={group.id}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-stone-100">{group.displayLabel}</h3>
              <span className="rounded-full border border-stone-700 px-2 py-1 text-[10px] uppercase tracking-wider text-stone-400">
                {group.children.length} layers
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {group.children.map((layer) => (
                <div className="rounded-xl border border-stone-800 bg-stone-950/30 p-4" key={layer.id}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-stone-200">{layer.displayLabel}</p>
                    <span className="font-mono text-xs text-stone-400">
                      {layer.summary.visibleCount}/{layer.summary.totalCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function TabButton(props: {
  readonly active: boolean
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      className={`rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-wider ${
        props.active
          ? 'bg-amber-500/15 text-amber-100'
          : 'border border-stone-700 bg-stone-900 text-stone-300'
      }`}
      onClick={props.onClick}
      type="button"
    >
      {props.label}
    </button>
  )
}

function SummaryCard(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{props.label}</p>
      <p className="mt-2 font-mono text-xl font-bold text-stone-100">{props.value}</p>
    </div>
  )
}

function DetailRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-950/20 p-3">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{props.label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-stone-200">{props.value}</dd>
    </div>
  )
}

function EmptyState(props: { readonly message: string; readonly testId?: string }) {
  return (
    <div
      className="rounded-xl border border-dashed border-stone-800 bg-stone-900/20 p-5 text-sm italic text-stone-400"
      data-testid={props.testId}
    >
      {props.message}
    </div>
  )
}

function resolveEventPath(event: MissionReviewEventRow): string | null {
  const archivePath = event.rawDetails?.archive_path
  if (typeof archivePath === 'string' && archivePath.trim() !== '') {
    return archivePath
  }

  const backupPath = event.rawDetails?.backup_path
  if (typeof backupPath === 'string' && backupPath.trim() !== '') {
    return backupPath
  }

  return null
}

function isValidWgs84(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  )
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Path could not be opened.'
}
