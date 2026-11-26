import { useEffect, useMemo, useRef, useState } from 'react'

import { getAppRuntimeController } from '../features/runtime/app-runtime-controller'
import { WorkspaceOverlay, WorkspaceHeader } from './workspace-overlay'
import {
  buildDeviceWorkspaceRows,
  buildDeviceWorkspaceSummary,
  filterDeviceWorkspaceRows,
  resolveVisibleDeviceSelection,
  type DeviceWorkspaceFilter,
  type DeviceWorkspaceRow,
} from '../features/tracking/device-workspace-model'
import { useDeviceWorkspaceStore } from '../features/tracking/device-workspace-store'
import { SAR_PALETTE } from './color-palette-input'
import { createDeviceColor } from '../features/tracking/tracking-color'
import {
  MAX_BREADCRUMB_SIZE,
  MIN_BREADCRUMB_SIZE,
  type BreadcrumbTrailMode,
  useTrackingStyleStore,
} from '../features/tracking/tracking-style-store'
import { useTrackingStore } from '../features/tracking/tracking-store'
import { formatDevicePositionDisplay } from '../features/tracking/device-position-display'
import { EXACT_BREADCRUMB_DOT_PAGE_LIMIT } from '../features/tracking/exact-breadcrumb-dot-controller'
import { useIngestHealthStore } from '../features/tracking/ingest-health-store'
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import { useMapTargetStore } from '../features/map/map-target-store'
import { useStationaryAttentionStore } from '../features/tracking/stationary-attention-store'

const DEVICES_WORKSPACE_TITLE_ID = 'devices-workspace-title'
const DEVICE_ROW_GRID_COLUMNS =
  'grid-cols-[minmax(7.5rem,1fr)_minmax(9rem,1.2fr)_4rem_6rem_11.5rem_5.5rem_6rem_8rem]'
/** Docked after Zoom: name, status, shown and Zoom fit the narrow window without scrolling sideways. */
const DOCKED_ROW_GRID_COLUMNS = 'grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_4.5rem]'

/**
 * Renders the dedicated tracking devices workspace used for roster-scale operations.
 */
export function DevicesWorkspace() {
  const open = useDeviceWorkspaceStore((state) => state.open)
  const docked = useDeviceWorkspaceStore((state) => state.docked)
  const closeWorkspace = useDeviceWorkspaceStore((state) => state.closeWorkspace)

  return (
    <WorkspaceOverlay
      labelledBy={DEVICES_WORKSPACE_TITLE_ID}
      open={open}
      onClose={closeWorkspace}
      maxWidth={docked ? 'max-w-md' : 'max-w-7xl'}
      docked={docked}
    >
      <DevicesWorkspaceContent closeWorkspace={closeWorkspace} docked={docked} />
    </WorkspaceOverlay>
  )
}

function DevicesWorkspaceContent(props: {
  readonly closeWorkspace: () => void
  readonly docked: boolean
}) {
  const { docked } = props
  const dock = useDeviceWorkspaceStore((state) => state.dock)
  const undock = useDeviceWorkspaceStore((state) => state.undock)
  const selectedDeviceId = useDeviceWorkspaceStore((state) => state.selectedDeviceId)
  const selectDevice = useDeviceWorkspaceStore((state) => state.selectDevice)
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const trackingStatus = useTrackingStore((state) => state.status)
  const deviceColors = useTrackingStyleStore((state) => state.deviceColors)
  const breadcrumbSize = useTrackingStyleStore((state) => state.breadcrumbSize)
  const breadcrumbTrailMode = useTrackingStyleStore((state) => state.breadcrumbTrailMode)
  const setDeviceColor = useTrackingStyleStore((state) => state.setDeviceColor)
  const setBreadcrumbSize = useTrackingStyleStore((state) => state.setBreadcrumbSize)
  const setBreadcrumbTrailMode = useTrackingStyleStore((state) => state.setBreadcrumbTrailMode)
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const toggleDeviceVisibility = useLayerVisibilityStore((state) => state.toggleDeviceVisibility)
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<DeviceWorkspaceFilter>('all')
  const [deviceQuery, setDeviceQuery] = useState('')
  const ingestHealth = useIngestHealthStore((state) => state.summary)
  const attentionByDevice = useStationaryAttentionStore((state) => state.byDevice)
  const acknowledgeAttention = useStationaryAttentionStore((state) => state.acknowledge)

  const rows = useMemo(
    () => buildDeviceWorkspaceRows(
      trackingSnapshot,
      hiddenDeviceIds,
      ingestHealth,
      attentionByDevice,
      trackingStatus.mode,
    ),
    [attentionByDevice, hiddenDeviceIds, ingestHealth, trackingSnapshot, trackingStatus.mode],
  )
  const summary = useMemo(
    () => buildDeviceWorkspaceSummary(rows, trackingStatus),
    [rows, trackingStatus],
  )

  const filteredRows = useMemo(
    () => filterDeviceWorkspaceRows(rows, activeFilter, deviceQuery),
    [activeFilter, deviceQuery, rows],
  )

  useEffect(() => {
    const resolvedSelection = resolveVisibleDeviceSelection(filteredRows, selectedDeviceId)
    if (resolvedSelection !== selectedDeviceId) {
      selectDevice(resolvedSelection)
    }
  }, [filteredRows, selectDevice, selectedDeviceId])

  const selectedRow =
    filteredRows.find((row) => row.deviceId === selectedDeviceId) ?? filteredRows[0] ?? null

  const filterTabs: readonly { readonly id: DeviceWorkspaceFilter; readonly label: string; readonly count: number }[] = [
    { id: 'all', label: 'Devices', count: summary.totalDevices },
    { id: 'hidden', label: 'Hidden', count: summary.hiddenDevices },
    { id: 'online', label: 'Online', count: summary.onlineDevices },
    { id: 'stale', label: 'Stale', count: summary.staleDevices },
    { id: 'nofix', label: 'No position', count: rows.filter((row) => !row.hasFix).length },
  ]

  return (
    <>
      <WorkspaceHeader
        subtitle="All devices"
        titleId={DEVICES_WORKSPACE_TITLE_ID}
        title="Tracking Devices"
        onClose={props.closeWorkspace}
        actions={
          <>
          {docked ? (
            <button
              className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-200"
              data-testid="devices-full-width"
              onClick={undock}
              type="button"
            >
              Full width
            </button>
          ) : null}
          <button
            className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-200 disabled:opacity-50"
            data-testid="devices-refresh-btn"
            disabled={refreshing}
            onClick={() => void refreshTracking()}
            type="button"
          >
            {refreshing ? 'Refreshing…' : 'Reconnect'}
          </button>
          </>
        }
      />

      {docked ? (
        <p
          className="border-b border-amber-400/40 bg-amber-400/10 px-6 py-2 text-[13px] font-semibold text-amber-100"
          data-testid="devices-docked-note"
          role="status"
        >
          This list is narrow so the map shows beside it. Full width shows each device&apos;s details and trail settings.
        </p>
      ) : null}

        <div className={`sar-devices-layout grid min-h-0 flex-1 gap-0 ${docked ? '' : 'lg:grid-cols-[minmax(0,1fr)_18rem]'}`}>
          <section
            className="flex min-h-0 flex-col overflow-hidden border-r border-stone-800"
            data-testid="devices-workspace"
          >
            {/* Tracking health + breadcrumb controls */}
            <div className="flex-shrink-0 space-y-4 border-b border-stone-800 px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                    Tracking Health
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      summary.tone === 'success'
                        ? 'text-emerald-300'
                        : summary.tone === 'alert'
                          ? 'text-rose-300'
                          : summary.tone === 'warning'
                            ? 'text-amber-300'
                            : 'text-stone-300'
                    }`}
                    data-testid="devices-tracking-mode"
                  >
                    {summary.mode}
                  </p>
                </div>
                <div className="text-right">
                  <p className="sar-meta-label">Last Success</p>
                  <p className="font-mono text-sm text-stone-100" data-testid="devices-last-success">
                    {summary.lastSuccessAtDisplay}
                  </p>
                </div>
              </div>
              <p
                className={`text-sm ${
                  summary.tone === 'success'
                    ? 'text-emerald-200 italic'
                    : summary.tone === 'alert'
                      ? 'text-rose-200'
                      : summary.tone === 'warning'
                        ? 'text-amber-200'
                        : 'text-stone-300'
                }`}
                data-testid="devices-tracking-warning"
              >
                {summary.headline}
              </p>
              {error !== null ? (
                <p className="text-sm text-rose-300" data-testid="devices-refresh-error">
                  {error}
                </p>
              ) : null}

              <div hidden={docked}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Breadcrumb Display
                </p>
                <div className="mt-2 grid grid-cols-2 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] p-1">
                  {(['line', 'dots'] as const).map((mode) => (
                    <button
                      className={`px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] ${
                        breadcrumbTrailMode === mode ? 'sar-segment-option-active' : 'sar-segment-option'
                      }`}
                      data-testid={`breadcrumb-mode-${mode}`}
                      key={mode}
                      onClick={() => setBreadcrumbTrailMode(mode)}
                      type="button"
                    >
                      {renderBreadcrumbModeLabel(mode)}
                    </button>
                  ))}
                </div>
                <p
                  className="mt-2 text-xs leading-relaxed text-stone-300"
                  data-testid="breadcrumb-mode-description"
                >
                  {describeBreadcrumbMode(breadcrumbTrailMode)}
                </p>
                <label className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-stone-200">
                  <span>
                    <span className="block text-[11px] font-bold uppercase tracking-wider text-stone-400">
                      Breadcrumb Size
                    </span>
                    <span className="font-mono text-xs text-stone-300" data-testid="breadcrumb-size-label">
                      {breadcrumbSize}px {breadcrumbTrailMode === 'dots' ? 'dot diameter and trail width' : 'trail width'}
                    </span>
                  </span>
                  <input
                    aria-label={
                      breadcrumbTrailMode === 'dots'
                        ? 'Breadcrumb dot diameter and trail width'
                        : 'Breadcrumb trail width'
                    }
                    className="w-44 accent-amber-400"
                    data-testid="breadcrumb-size-control"
                    max={MAX_BREADCRUMB_SIZE}
                    min={MIN_BREADCRUMB_SIZE}
                    onChange={(event) => setBreadcrumbSize(event.currentTarget.valueAsNumber)}
                    onInput={(event) => setBreadcrumbSize(event.currentTarget.valueAsNumber)}
                    step={1}
                    type="range"
                    value={breadcrumbSize}
                  />
                </label>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex-shrink-0 border-b border-stone-800 px-6 py-3" data-testid="device-filter-tabs">
              <div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
                {filterTabs.map((tab) => (
                  <button
                    className={`flex flex-col items-center rounded-lg border px-2 py-2 text-center transition-colors ${
                      activeFilter === tab.id
                        ? 'border-amber-500/60 bg-amber-500/10 text-amber-200'
                        : 'border-stone-700 bg-stone-900/40 text-stone-300 hover:border-stone-500'
                    }`}
                    aria-pressed={activeFilter === tab.id}
                    data-testid={`device-filter-${tab.id}`}
                    key={tab.id}
                    onClick={() => setActiveFilter(tab.id)}
                    type="button"
                  >
                    <span className="font-mono text-lg font-bold">{tab.count}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider">{tab.label}</span>
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-sm text-stone-200">
                <span className="sr-only">Search visible devices</span>
                <input
                  className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-500 focus:outline-none"
                  data-testid="device-list-search"
                  onChange={(event) => setDeviceQuery(event.currentTarget.value)}
                  onInput={(event) => setDeviceQuery(event.currentTarget.value)}
                  placeholder={`Search ${activeFilter === 'all' ? 'all' : getFilterLabel(activeFilter).toLowerCase()} devices`}
                  type="search"
                  value={deviceQuery}
                />
              </label>
            </div>

            {/* Device list — fills remaining vertical space */}
            <div aria-label="Device list; scroll horizontally for all actions" className="sar-device-list-scroll min-h-0 flex-1 overflow-auto" data-testid="device-list-scroll" role="region" tabIndex={0}>
              {filteredRows.length === 0 ? (
                <p
                  className="px-6 py-6 text-sm text-stone-300"
                  data-testid="device-filter-empty-state"
                >
                  {getEmptyStateMessage(activeFilter, deviceQuery)}
                </p>
              ) : (
                <>
                  <div
                    className={`${docked ? DOCKED_ROW_GRID_COLUMNS : `sar-device-grid ${DEVICE_ROW_GRID_COLUMNS}`} sticky top-0 z-10 grid border-b border-stone-800 bg-[var(--sar-panel)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-300`}
                  >
                    {docked ? null : <span>Device</span>}
                    <span>Name</span>
                    {docked ? null : <span>Trail</span>}
                    <span>Status</span>
                    {docked ? null : <span>Last Seen</span>}
                    {docked ? null : <span>Source</span>}
                    <span>Visible</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {filteredRows.map((row) => (
                    <DeviceRow
                      compact={docked}
                      key={row.deviceId}
                      row={row}
                      selected={row.deviceId === selectedRow?.deviceId}
                      deviceColor={deviceColors[row.deviceId] ?? createDeviceColor(row.deviceId)}
                      onSelectDevice={selectDevice}
                      onSetDeviceColor={setDeviceColor}
                      onToggleVisibility={toggleDeviceVisibility}
                      onZoomDevice={zoomDevice}
                    />
                  ))}
                </>
              )}
            </div>
          </section>

          <aside className="sar-devices-inspector min-w-0 overflow-y-auto px-6 py-6" data-testid="devices-inspector" hidden={docked}>
            {selectedRow === null ? (
              <div className="rounded-2xl border border-dashed border-stone-600 bg-stone-900/30 p-5 text-sm italic text-stone-300">
                No devices available. Configure a tracking provider in Settings to see devices here.
              </div>
            ) : (
              <div className="min-w-0 space-y-4 rounded-2xl border border-stone-800 bg-stone-900/40 p-5">
                <div>
                  <p className="sar-meta-label">Selected Device</p>
                  <h3
                    className="mt-2 text-xl font-semibold text-stone-50"
                    data-testid="devices-inspector-title"
                  >
                    {selectedRow.name}
                  </h3>
                  <p className="mt-1 font-mono text-xs text-stone-300">{selectedRow.deviceId}</p>
                </div>

                <dl className="space-y-3 text-sm text-stone-300">
                  <Detail label="Status" value={selectedRow.status} />
                  <Detail
                    label="Last Seen"
                    value={selectedRow.lastSeenDisplay}
                    testId={`device-inspector-last-seen-${selectedRow.deviceId}`}
                  />
                  <Detail
                    label="Position Time"
                    value={selectedRow.fixTimeDisplay}
                    testId={`device-fix-time-${selectedRow.deviceId}`}
                  />
                  <Detail label="Source" value={selectedRow.sourceDisplay} />
                  {selectedRow.ingestWarning === null ? null : (
                    <Detail label="Position Data" value={selectedRow.ingestWarning} />
                  )}
                  {selectedRow.stationaryAttention ? (
                    <Detail
                      label="Stationary Attention"
                      value={`${selectedRow.attentionAcknowledged ? 'Acknowledged — ' : ''}${selectedRow.attentionElapsedDisplay}`}
                    />
                  ) : null}
                  <Detail label="GPS Accuracy" value={selectedRow.accuracyDisplay} />
                  <Detail label="Battery" value={selectedRow.batteryDisplay} />
                  <Detail label="Speed" value={selectedRow.speedDisplay} />
                  <DevicePositionDetail
                    deviceId={selectedRow.deviceId}
                    latitude={selectedRow.latitude}
                    longitude={selectedRow.longitude}
                  />
                </dl>

                <div className="grid gap-3">
                  {selectedRow.stationaryAttention ? (
                    <button
                      className="min-h-10 w-full rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-100 disabled:opacity-50"
                      data-testid="acknowledge-stationary-attention"
                      disabled={selectedRow.attentionAcknowledged}
                      onClick={() => acknowledgeAttention(selectedRow.deviceId)}
                      type="button"
                    >
                      {selectedRow.attentionAcknowledged ? 'Attention Acknowledged' : 'Acknowledge Attention'}
                    </button>
                  ) : null}
                  <button
                    className="min-h-10 w-full whitespace-normal rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-100 disabled:opacity-40"
                    data-testid="devices-inspector-zoom"
                    disabled={!selectedRow.hasFix}
                    onClick={() => {
                      zoomDevice(selectedRow)
                    }}
                    type="button"
                  >
                    Zoom To Device
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
    </>
  )

  async function refreshTracking(): Promise<void> {
    const controller = getAppRuntimeController()
    if (controller === null) {
      return
    }

    setRefreshing(true)
    setError(null)
    try {
      await controller.reloadSettings({ forceConnect: true })
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Tracking reconnect failed.')
    } finally {
      setRefreshing(false)
    }
  }

  /**
   * Centres the map on a device and docks this window narrow at the left, so
   * the device is not centred underneath it (DON-368, rule 8).
   */
  function zoomDevice(row: DeviceWorkspaceRow): void {
    selectDevice(row.deviceId)
    if (row.latitude !== null && row.longitude !== null) {
      dock()
      queueTarget(row.latitude, row.longitude, row.name)
    }
  }
}

function getEmptyStateMessage(filter: DeviceWorkspaceFilter, query: string): string {
  const normalizedQuery = query.trim()
  if (normalizedQuery !== '') {
    return `No devices match ${normalizedQuery} in ${getFilterLabel(filter)}.`
  }

  switch (filter) {
    case 'all':
      return 'No devices available. Configure a tracking provider in Settings to see devices here.'
    case 'hidden':
      return 'No hidden devices. Toggle visibility on individual devices to hide them from the map.'
    case 'online':
      return 'No devices currently online. Devices will appear here when they report a live position.'
    case 'nofix':
      return 'Every device has a position. Devices without one will appear here.'
    case 'stale':
      return 'No stale devices. Devices that stop reporting for more than 5 minutes will appear here.'
  }
}

function getFilterLabel(filter: DeviceWorkspaceFilter): string {
  switch (filter) {
    case 'all':
      return 'Devices'
    case 'hidden':
      return 'Hidden'
    case 'online':
      return 'Online'
    case 'nofix':
      return 'No position'
    case 'stale':
      return 'Stale'
  }
}

function renderBreadcrumbModeLabel(mode: BreadcrumbTrailMode): string {
  return mode === 'dots' ? 'Breadcrumb dots' : 'Solid line'
}

/**
 * Says plainly what each breadcrumb display draws, so Breadcrumb dots is never
 * read as replacing the whole trail [DON-338].
 */
function describeBreadcrumbMode(mode: BreadcrumbTrailMode): string {
  return mode === 'dots'
    ? `The line still shows the whole trail. Dots mark exact recorded fixes on top of it, up to ${EXACT_BREADCRUMB_DOT_PAGE_LIMIT.toLocaleString('en-IE')} at a time. The Tracking tab says which fixes are marked and has Earlier and Later to move through them.`
    : 'The line shows the whole trail of each device.'
}

function DeviceRow(props: {
  readonly row: DeviceWorkspaceRow
  readonly selected: boolean
  readonly deviceColor: string
  readonly onSelectDevice: (deviceId: string | null) => void
  readonly onSetDeviceColor: (deviceId: string, color: string) => void
  readonly onToggleVisibility: (deviceId: string) => void
  readonly onZoomDevice: (row: DeviceWorkspaceRow) => void
  /** Docked window: only name, status, shown and Zoom. */
  readonly compact?: boolean
}) {
  const compact = props.compact === true
  const rowTestId = `device-row-${props.row.deviceId}`

  return (
    <div
      className={`${compact ? DOCKED_ROW_GRID_COLUMNS : `sar-device-grid ${DEVICE_ROW_GRID_COLUMNS}`} grid cursor-pointer items-center border-b border-stone-800/70 px-4 py-3 text-sm ${
        props.selected ? 'sar-selected-row' : 'bg-transparent'
      }`}
      data-testid={rowTestId}
      onClick={() => props.onSelectDevice(props.row.deviceId)}
    >
      {compact ? null : <button
        className="block min-w-0 w-full text-left"
        data-testid={`device-select-${props.row.deviceId}`}
        onClick={(event) => {
          event.stopPropagation()
          props.onSelectDevice(props.row.deviceId)
        }}
        type="button"
      >
        <p className="truncate font-mono text-[11px] text-stone-300">
          {props.row.deviceId}
        </p>
      </button>}
      <button
        className="block min-w-0 w-full text-left"
        data-testid={`device-select-name-${props.row.deviceId}`}
        onClick={(event) => {
          event.stopPropagation()
          props.onSelectDevice(props.row.deviceId)
        }}
        type="button"
      >
        <p className="truncate font-semibold text-stone-100">{props.row.name}</p>
        {compact && (!props.row.hasFix || props.row.sourceDisplay !== 'Live') ? (
          // The narrow list has no Source column, so a position that is not
          // live, or missing, says so in words beside the name, never by colour alone.
          <p
            className={`mt-1 truncate text-[11px] font-bold ${props.row.stale ? 'text-rose-300' : 'text-amber-300'}`}
            data-testid={`device-trust-${props.row.deviceId}`}
          >
            {props.row.hasFix ? props.row.sourceDisplay : 'No position'}
          </p>
        ) : null}
        {props.row.stationaryAttention ? (
          <p
            className="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-amber-300"
            data-testid={`device-attention-${props.row.deviceId}`}
          >
            {props.row.attentionAcknowledged ? 'Attention Acknowledged' : 'Stationary Attention'}
            {props.row.stationaryAttentionUnreliable ? ' — latest fix uncorroborated' : ''}
          </p>
        ) : props.row.stationaryAttentionUnavailable ? (
          <p
            className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-stone-400"
            data-testid={`device-attention-unavailable-${props.row.deviceId}`}
          >
            Stationary check unavailable
          </p>
        ) : null}
        {props.row.ingestWarning === null ? null : (
          <p
            className="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-amber-300"
            data-testid={`device-ingest-warning-${props.row.deviceId}`}
          >
            Position row rejected
          </p>
        )}
      </button>
      {compact ? null : <DeviceColorSwatch
        color={props.deviceColor}
        deviceId={props.row.deviceId}
        deviceName={props.row.name}
        onSetColor={props.onSetDeviceColor}
      />}
      <span
        className={`font-semibold uppercase ${
          // A stale or missing position must not read as reporting now in green [M-21, DON-368].
          props.row.status === 'online' && props.row.hasFix && !props.row.stale
            ? 'text-emerald-300'
            : props.row.status === 'offline'
              ? 'text-amber-300'
              : 'text-stone-300'
        }`}
        data-testid={`device-status-${props.row.deviceId}`}
      >
        {props.row.status}
      </span>
      {compact ? null : <span
        className="font-mono text-[10px] leading-4 text-stone-300"
        data-testid={`device-last-seen-${props.row.deviceId}`}
      >
        <CompactOperatorTimestamp value={props.row.lastSeenDisplay} />
      </span>}
      {compact ? null : <span
        className={`text-xs font-semibold ${
          props.row.stale
            ? 'text-rose-300'
            : props.row.sourceDisplay === 'Saved earlier'
              ? 'text-amber-300'
              : 'text-stone-300'
        }`}
        data-testid={`device-source-${props.row.deviceId}`}
      >
        {props.row.sourceDisplay}
      </span>}
      <label className="flex items-center gap-2 text-xs text-stone-300">
        <input
          checked={!props.row.hidden}
          data-testid={`device-visibility-${props.row.deviceId}`}
          onChange={() => props.onToggleVisibility(props.row.deviceId)}
          onClick={(event) => event.stopPropagation()}
          type="checkbox"
        />
        {props.row.hidden ? 'Hidden' : 'Shown'}
      </label>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-lg border border-stone-700 bg-stone-950 px-2 py-1 text-[11px] text-stone-200 disabled:opacity-40"
          data-testid={`device-zoom-${props.row.deviceId}`}
          disabled={!props.row.hasFix}
          onClick={(event) => {
            event.stopPropagation()
            props.onZoomDevice(props.row)
          }}
          type="button"
        >
          Zoom
        </button>
      </div>
    </div>
  )
}

/** Keeps the full explicit timestamp scannable in two stable roster lines. */
function CompactOperatorTimestamp(props: { readonly value: string }) {
  const zoneStart = props.value.indexOf(' GMT')
  if (zoneStart < 0) return props.value
  return (
    <>
      <span className="block whitespace-nowrap">{props.value.slice(0, zoneStart)}</span>
      <span className="block whitespace-nowrap">{props.value.slice(zoneStart + 1)}</span>
    </>
  )
}

function Detail(props: {
  readonly label: string
  readonly value: string
  readonly testId?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="sar-meta-label">{props.label}</dt>
      <dd
        className="font-mono text-right text-stone-100"
        data-testid={props.testId}
      >
        {props.value}
      </dd>
    </div>
  )
}

/**
 * The selected device's position: Irish Grid first and large, decimal lat/lon beneath
 * [DON-377]. Formatting lives in `formatDevicePositionDisplay`; this only lays it out.
 */
function DevicePositionDetail(props: {
  readonly deviceId: string
  readonly latitude: number | null
  readonly longitude: number | null
}) {
  const display = formatDevicePositionDisplay(props.latitude, props.longitude)
  return (
    <div
      className="border-t border-stone-800 pt-3"
      data-position-kind={display.kind}
      data-testid={`device-inspector-position-${props.deviceId}`}
    >
      <dt className="sar-meta-label">Position</dt>
      <dd className="mt-1">
        {display.kind === 'irish_grid' ? <span className="sr-only">Irish Grid </span> : null}
        <span
          className={
            display.kind === 'irish_grid'
              ? 'block whitespace-nowrap font-mono text-xl font-semibold text-stone-50'
              : 'block font-mono text-base font-semibold text-amber-100'
          }
          data-testid={`device-inspector-grid-${props.deviceId}`}
        >
          {display.primary}
        </span>
        {display.secondary === null ? null : (
          <>
            <span className="sr-only">Latitude, longitude </span>
            <span
              className="mt-0.5 block font-mono text-xs text-stone-300"
              data-testid={`device-inspector-latlon-${props.deviceId}`}
            >
              {display.secondary}
            </span>
          </>
        )}
      </dd>
    </div>
  )
}

function DeviceColorSwatch(props: {
  readonly color: string
  readonly deviceId: string
  readonly deviceName: string
  readonly onSetColor: (deviceId: string, color: string) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div
      className="relative flex items-center"
      onClick={(event) => event.stopPropagation()}
      ref={containerRef}
    >
      <button
        aria-label={`${props.deviceName} breadcrumb trail colour`}
        className="h-7 w-7 rounded border-2 border-stone-700 hover:border-stone-400"
        data-testid={`device-breadcrumb-color-${props.deviceId}`}
        onClick={() => setOpen(!open)}
        style={{ backgroundColor: props.color }}
        type="button"
      />
      {open ? (
        <div
          className="absolute left-full top-0 z-50 ml-2 flex w-60 flex-wrap gap-2 rounded border border-stone-700 bg-stone-900 p-2 shadow-xl"
          data-testid={`device-color-popover-${props.deviceId}`}
          onMouseLeave={() => setOpen(false)}
        >
          {SAR_PALETTE.map((color) => (
            <button
              aria-label={color}
              className={`h-7 w-7 rounded border ${
                props.color.toUpperCase() === color
                  ? 'border-white ring-2 ring-white/50'
                  : 'border-stone-600 hover:border-stone-300'
              }`}
              data-testid={`device-color-option-${color.replace('#', '')}`}
              key={color}
              onClick={() => {
                props.onSetColor(props.deviceId, color)
                setOpen(false)
              }}
              style={{ backgroundColor: color }}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
