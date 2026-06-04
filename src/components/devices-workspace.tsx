import { useMemo, useRef, useState } from 'react'

import { getAppRuntimeController } from '../features/runtime/app-runtime-controller'
import { WorkspaceOverlay, WorkspaceHeader } from './workspace-overlay'
import {
  buildDeviceWorkspaceRows,
  buildDeviceWorkspaceSummary,
  type DeviceWorkspaceRow,
} from '../features/tracking/device-workspace-model'
import { useMissionStore } from '../features/mission/mission-store'
import { useActiveMissionDevicesStore } from '../features/tracking/active-mission-devices-store'
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
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import { useMapTargetStore } from '../features/map/map-target-store'

const DEVICES_WORKSPACE_TITLE_ID = 'devices-workspace-title'
const DEVICE_ROW_GRID_COLUMNS =
  'grid-cols-[minmax(7.5rem,1fr)_minmax(9rem,1.2fr)_4rem_6rem_7rem_5.5rem_6rem_8rem]'

/**
 * Renders the dedicated tracking devices workspace used for roster-scale operations.
 */
export function DevicesWorkspace() {
  const open = useDeviceWorkspaceStore((state) => state.open)
  const selectedDeviceId = useDeviceWorkspaceStore((state) => state.selectedDeviceId)
  const closeWorkspace = useDeviceWorkspaceStore((state) => state.closeWorkspace)
  const selectDevice = useDeviceWorkspaceStore((state) => state.selectDevice)
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const trackingStatus = useTrackingStore((state) => state.status)
  const currentMissionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const activeDeviceIds = useActiveMissionDevicesStore((state) =>
    state.getActiveDeviceIds(currentMissionId),
  )
  const setDeviceActive = useActiveMissionDevicesStore((state) => state.setDeviceActive)
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

  const rows = useMemo(
    () => buildDeviceWorkspaceRows(trackingSnapshot, hiddenDeviceIds, activeDeviceIds),
    [activeDeviceIds, hiddenDeviceIds, trackingSnapshot],
  )
  const activeRows = useMemo(() => rows.filter((row) => row.active), [rows])
  const summary = useMemo(
    () => buildDeviceWorkspaceSummary(rows, trackingStatus),
    [rows, trackingStatus],
  )
  const selectedRow =
    rows.find((row) => row.deviceId === selectedDeviceId) ?? rows[0] ?? null

  return (
    <WorkspaceOverlay
      labelledBy={DEVICES_WORKSPACE_TITLE_ID}
      open={open}
      onClose={closeWorkspace}
      maxWidth="max-w-7xl"
    >
      <WorkspaceHeader
        subtitle="Devices Workspace"
        titleId={DEVICES_WORKSPACE_TITLE_ID}
        title="Tracking Devices"
        onClose={closeWorkspace}
        actions={
          <button
            className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-200 disabled:opacity-50"
            data-testid="devices-refresh-btn"
            disabled={refreshing}
            onClick={() => void refreshTracking()}
            type="button"
          >
            {refreshing ? 'Refreshing…' : 'Reconnect'}
          </button>
        }
      />

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
          <section
            className="overflow-y-auto border-r border-stone-800 px-6 py-6"
            data-testid="devices-workspace"
          >
            <div className="grid gap-3 sm:grid-cols-6">
              <SummaryCard label="Devices" value={String(summary.totalDevices)} />
              <SummaryCard label="Active" value={String(summary.activeDevices)} />
              <SummaryCard label="Online" value={String(summary.onlineDevices)} />
              <SummaryCard label="Hidden" value={String(summary.hiddenDevices)} />
              <SummaryCard label="Stale" value={String(summary.staleDevices)} />
              <SummaryCard label="Cached" value={String(summary.cachedDevices)} />
            </div>

            <div className="mt-4 rounded-2xl border border-stone-800 bg-stone-900/40 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                    Tracking Health
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      summary.mode === 'online'
                        ? 'text-emerald-300'
                        : summary.mode === 'offline'
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
                className={`mt-3 text-sm ${
                  summary.warning === null ? 'text-emerald-200 italic' : 'text-amber-200'
                }`}
                data-testid="devices-tracking-warning"
              >
                {summary.warning ?? 'Tracking feed healthy.'}
              </p>
              {error !== null ? (
                <p className="mt-2 text-sm text-rose-300" data-testid="devices-refresh-error">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-4 rounded-2xl border border-stone-800 bg-stone-900/40 p-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Breadcrumb Display
                </p>
                <div className="mt-3 grid grid-cols-2 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] p-1">
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
              </div>
              <label className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-200">
                <span className="mt-4">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-stone-400">
                    Breadcrumb Size
                  </span>
                  <span className="font-mono text-xs text-stone-300" data-testid="breadcrumb-size-label">
                    {breadcrumbSize}px {breadcrumbTrailMode === 'dots' ? 'dot diameter' : 'trail width'}
                  </span>
                </span>
                <input
                  aria-label={
                    breadcrumbTrailMode === 'dots'
                      ? 'Breadcrumb dot diameter'
                      : 'Breadcrumb trail width'
                  }
                  className="mt-4 w-44 accent-amber-400"
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

            <DeviceRowsSection
              emptyMessage="No active mission devices selected. Until a device is added, the map continues showing every tracked device."
              rows={activeRows}
              sectionLabel="Active Mission Devices"
              selectedDeviceId={selectedRow?.deviceId ?? null}
              testId="active-devices"
              testPrefix="active-device"
              deviceColors={deviceColors}
              onSelectDevice={selectDevice}
              onSetDeviceColor={setDeviceColor}
              onToggleActive={(deviceId) => {
                if (currentMissionId !== null) {
                  setDeviceActive(currentMissionId, deviceId, false)
                }
              }}
              onToggleVisibility={toggleDeviceVisibility}
              onZoomDevice={zoomDevice}
            />

            <DeviceRowsSection
              emptyMessage="No devices available. Configure a tracking provider in Settings to see devices here."
              rows={rows}
              sectionLabel="All Devices"
              selectedDeviceId={selectedRow?.deviceId ?? null}
              testId="all-devices"
              testPrefix="device"
              deviceColors={deviceColors}
              onSelectDevice={selectDevice}
              onSetDeviceColor={setDeviceColor}
              onToggleActive={(deviceId, active) => {
                if (currentMissionId !== null) {
                  setDeviceActive(currentMissionId, deviceId, active)
                }
              }}
              onToggleVisibility={toggleDeviceVisibility}
              onZoomDevice={zoomDevice}
            />
          </section>

          <aside className="overflow-y-auto px-6 py-6" data-testid="devices-inspector">
            {selectedRow === null ? (
              <div className="rounded-2xl border border-dashed border-stone-600 bg-stone-900/30 p-5 text-sm italic text-stone-300">
                No devices available. Configure a tracking provider in Settings to see devices here.
              </div>
            ) : (
              <div className="space-y-4 rounded-2xl border border-stone-800 bg-stone-900/40 p-5">
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
                  <Detail label="Last Seen" value={selectedRow.lastSeenDisplay} />
                  <Detail label="Source" value={selectedRow.sourceDisplay} />
                  <Detail label="Battery" value={selectedRow.batteryDisplay} />
                  <Detail label="Speed" value={selectedRow.speedDisplay} />
                  <Detail
                    label="Coordinates"
                    value={
                      selectedRow.latitude === null || selectedRow.longitude === null
                        ? 'No fix'
                        : `${selectedRow.latitude.toFixed(5)}, ${selectedRow.longitude.toFixed(5)}`
                    }
                  />
                </dl>

                <div className="flex gap-3">
                  <button
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-100 disabled:opacity-40"
                    data-testid="devices-inspector-zoom"
                    disabled={!selectedRow.hasFix}
                    onClick={() => {
                      if (selectedRow.latitude !== null && selectedRow.longitude !== null) {
                        queueTarget(
                          selectedRow.latitude,
                          selectedRow.longitude,
                          selectedRow.name,
                        )
                      }
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
    </WorkspaceOverlay>
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

  function zoomDevice(row: DeviceWorkspaceRow): void {
    selectDevice(row.deviceId)
    if (row.latitude !== null && row.longitude !== null) {
      queueTarget(row.latitude, row.longitude, row.name)
    }
  }
}

function renderBreadcrumbModeLabel(mode: BreadcrumbTrailMode): string {
  return mode === 'dots' ? 'Breadcrumb dots' : 'Solid line'
}

function DeviceRowsSection(props: {
  readonly sectionLabel: string
  readonly rows: readonly DeviceWorkspaceRow[]
  readonly selectedDeviceId: string | null
  readonly testId: string
  readonly testPrefix: 'active-device' | 'device'
  readonly deviceColors: Readonly<Record<string, string>>
  readonly emptyMessage: string
  readonly onSelectDevice: (deviceId: string | null) => void
  readonly onSetDeviceColor: (deviceId: string, color: string) => void
  readonly onToggleActive: (deviceId: string, active: boolean) => void
  readonly onToggleVisibility: (deviceId: string) => void
  readonly onZoomDevice: (row: DeviceWorkspaceRow) => void
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-stone-800 bg-stone-900/40" data-testid={`${props.testId}-section`}>
      <div className="border-b border-stone-700 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-200">
          {props.sectionLabel}
        </p>
      </div>
      {props.rows.length === 0 ? (
        <p
          className="px-4 py-3 text-xs text-stone-300"
          data-testid={`${props.testId}-empty-state`}
        >
          {props.emptyMessage}
        </p>
      ) : (
        <>
          <div
            className={`grid ${DEVICE_ROW_GRID_COLUMNS} border-b border-stone-800 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-300`}
          >
            <span>Device</span>
            <span>Name</span>
            <span>Trail</span>
            <span>Status</span>
            <span>Last Seen</span>
            <span>Source</span>
            <span>Visible</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="max-h-[18rem] overflow-y-auto">
            {props.rows.map((row) => (
              <DeviceRow
                key={row.deviceId}
                row={row}
                selected={row.deviceId === props.selectedDeviceId}
                testPrefix={props.testPrefix}
                deviceColor={props.deviceColors[row.deviceId] ?? createDeviceColor(row.deviceId)}
                onSelectDevice={props.onSelectDevice}
                onSetDeviceColor={props.onSetDeviceColor}
                onToggleActive={props.onToggleActive}
                onToggleVisibility={props.onToggleVisibility}
                onZoomDevice={props.onZoomDevice}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DeviceRow(props: {
  readonly row: DeviceWorkspaceRow
  readonly selected: boolean
  readonly testPrefix: 'active-device' | 'device'
  readonly deviceColor: string
  readonly onSelectDevice: (deviceId: string | null) => void
  readonly onSetDeviceColor: (deviceId: string, color: string) => void
  readonly onToggleActive: (deviceId: string, active: boolean) => void
  readonly onToggleVisibility: (deviceId: string) => void
  readonly onZoomDevice: (row: DeviceWorkspaceRow) => void
}) {
  const rowTestId =
    props.testPrefix === 'active-device'
      ? `active-device-row-${props.row.deviceId}`
      : `device-row-${props.row.deviceId}`

  return (
    <div
      className={`grid cursor-pointer ${DEVICE_ROW_GRID_COLUMNS} items-center border-b border-stone-800/70 px-4 py-3 text-sm ${
        props.selected ? 'sar-selected-row' : 'bg-transparent'
      }`}
      data-testid={rowTestId}
      onClick={() => props.onSelectDevice(props.row.deviceId)}
    >
      <button
        className="block min-w-0 w-full text-left"
        data-testid={`${props.testPrefix}-select-${props.row.deviceId}`}
        onClick={(event) => {
          event.stopPropagation()
          props.onSelectDevice(props.row.deviceId)
        }}
        type="button"
      >
        <p className="truncate font-mono text-[11px] text-stone-300">
          {props.row.deviceId}
        </p>
      </button>
      <button
        className="block min-w-0 w-full text-left"
        data-testid={`${props.testPrefix}-select-name-${props.row.deviceId}`}
        onClick={(event) => {
          event.stopPropagation()
          props.onSelectDevice(props.row.deviceId)
        }}
        type="button"
      >
        <p className="truncate font-semibold text-stone-100">{props.row.name}</p>
      </button>
      <DeviceColorSwatch
        color={props.deviceColor}
        deviceId={props.row.deviceId}
        deviceName={props.row.name}
        onSetColor={props.onSetDeviceColor}
        testPrefix={props.testPrefix}
      />
      <span
        className={`font-semibold uppercase ${
          props.row.status === 'online'
            ? 'text-emerald-300'
            : props.row.status === 'offline'
              ? 'text-amber-300'
              : 'text-stone-300'
        }`}
        data-testid={`${props.testPrefix}-status-${props.row.deviceId}`}
      >
        {props.row.status}
      </span>
      <span
        className="font-mono text-xs text-stone-300"
        data-testid={`${props.testPrefix}-last-seen-${props.row.deviceId}`}
      >
        {props.row.lastSeenDisplay}
      </span>
      <span
        className={`text-xs font-semibold ${
          props.row.sourceDisplay === 'Stale'
            ? 'text-rose-300'
            : props.row.sourceDisplay === 'Cache'
              ? 'text-amber-300'
              : 'text-stone-300'
        }`}
        data-testid={`${props.testPrefix}-source-${props.row.deviceId}`}
      >
        {props.row.sourceDisplay}
      </span>
      <label className="flex items-center gap-2 text-xs text-stone-300">
        <input
          checked={!props.row.hidden}
          data-testid={`${props.testPrefix}-visibility-${props.row.deviceId}`}
          onChange={() => props.onToggleVisibility(props.row.deviceId)}
          onClick={(event) => event.stopPropagation()}
          type="checkbox"
        />
        {props.row.hidden ? 'Hidden' : 'Shown'}
      </label>
      <div className="flex justify-end gap-2">
        <button
          className="rounded-lg border border-stone-700 bg-stone-950 px-2 py-1 text-[11px] text-stone-200 disabled:opacity-40"
          data-testid={`${props.testPrefix}-zoom-${props.row.deviceId}`}
          disabled={!props.row.hasFix}
          onClick={(event) => {
            event.stopPropagation()
            props.onZoomDevice(props.row)
          }}
          type="button"
        >
          Zoom
        </button>
        <button
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-100"
          data-testid={
            props.testPrefix === 'active-device'
              ? `active-device-remove-${props.row.deviceId}`
              : `device-active-toggle-${props.row.deviceId}`
          }
          onClick={(event) => {
            event.stopPropagation()
            props.onToggleActive(props.row.deviceId, !props.row.active)
          }}
          type="button"
        >
          {props.row.active ? 'Remove' : 'Add'}
        </button>
      </div>
    </div>
  )
}

function SummaryCard(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-2xl border border-stone-700 bg-stone-900/40 p-4">
      <p className="sar-meta-label">{props.label}</p>
      <p className="mt-2 font-mono text-xl text-stone-100">{props.value}</p>
    </div>
  )
}

function Detail(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="sar-meta-label">{props.label}</dt>
      <dd className="font-mono text-right text-stone-100">{props.value}</dd>
    </div>
  )
}

function DeviceColorSwatch(props: {
  readonly color: string
  readonly deviceId: string
  readonly deviceName: string
  readonly onSetColor: (deviceId: string, color: string) => void
  readonly testPrefix: string
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
        data-testid={`${props.testPrefix}-breadcrumb-color-${props.deviceId}`}
        onClick={() => setOpen(!open)}
        style={{ backgroundColor: props.color }}
        type="button"
      />
      {open ? (
        <div
          className="absolute left-full top-0 z-50 ml-2 flex w-60 flex-wrap gap-2 rounded border border-stone-700 bg-stone-900 p-2 shadow-xl"
          data-testid={`${props.testPrefix}-color-popover-${props.deviceId}`}
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
              data-testid={`${props.testPrefix}-color-option-${color.replace('#', '')}`}
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
