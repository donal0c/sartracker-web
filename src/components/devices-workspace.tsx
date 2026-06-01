import { useMemo, useState } from 'react'

import { getAppRuntimeController } from '../features/runtime/app-runtime-controller'
import { WorkspaceOverlay, WorkspaceHeader } from './workspace-overlay'
import {
  buildDeviceWorkspaceRows,
  buildDeviceWorkspaceSummary,
} from '../features/tracking/device-workspace-model'
import { useDeviceWorkspaceStore } from '../features/tracking/device-workspace-store'
import { useTrackingStore } from '../features/tracking/tracking-store'
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import { useMapTargetStore } from '../features/map/map-target-store'

const DEVICES_WORKSPACE_TITLE_ID = 'devices-workspace-title'

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
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const toggleDeviceVisibility = useLayerVisibilityStore((state) => state.toggleDeviceVisibility)
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(
    () => buildDeviceWorkspaceRows(trackingSnapshot, hiddenDeviceIds),
    [hiddenDeviceIds, trackingSnapshot],
  )
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
      maxWidth="max-w-5xl"
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

        <div className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
          <section
            className="border-r border-stone-800 px-6 py-6"
            data-testid="devices-workspace"
          >
            <div className="grid gap-3 sm:grid-cols-5">
              <SummaryCard label="Devices" value={String(summary.totalDevices)} />
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

            <div className="mt-4 overflow-hidden rounded-2xl border border-stone-800 bg-stone-900/40">
              <div className="grid grid-cols-[minmax(0,1.4fr)_7rem_8rem_7rem_7rem_7rem] border-b border-stone-700 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-stone-200">
                <span>Device</span>
                <span>Status</span>
                <span>Last Seen</span>
                <span>Source</span>
                <span>Visible</span>
                <span className="text-right">Actions</span>
              </div>
              <div className="max-h-[32rem] overflow-y-auto">
                {rows.map((row) => {
                  const selected = row.deviceId === selectedRow?.deviceId
                  return (
                    <div
                      className={`grid cursor-pointer grid-cols-[minmax(0,1.4fr)_7rem_8rem_7rem_7rem_7rem] items-center border-b border-stone-800/70 px-4 py-3 text-sm ${
                        selected ? 'bg-amber-500/10' : 'bg-transparent'
                      }`}
                      data-testid={`device-row-${row.deviceId}`}
                      key={row.deviceId}
                      onClick={() => selectDevice(row.deviceId)}
                    >
                      <button
                        className="block min-w-0 w-full text-left"
                        data-testid={`device-select-${row.deviceId}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          selectDevice(row.deviceId)
                        }}
                        type="button"
                      >
                        <p className="truncate font-semibold text-stone-100">{row.name}</p>
                        <p className="truncate font-mono text-[11px] text-stone-300">
                          {row.deviceId}
                        </p>
                      </button>
                      <span
                        className={`font-semibold uppercase ${
                          row.status === 'online'
                            ? 'text-emerald-300'
                            : row.status === 'offline'
                              ? 'text-amber-300'
                              : 'text-stone-300'
                        }`}
                        data-testid={`device-status-${row.deviceId}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.status}
                      </span>
                      <span
                        className="font-mono text-xs text-stone-300"
                        data-testid={`device-last-seen-${row.deviceId}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.lastSeenDisplay}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          row.sourceDisplay === 'Stale'
                            ? 'text-rose-300'
                            : row.sourceDisplay === 'Cache'
                              ? 'text-amber-300'
                              : 'text-stone-300'
                        }`}
                        data-testid={`device-source-${row.deviceId}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.sourceDisplay}
                      </span>
                      <label className="flex items-center gap-2 text-xs text-stone-300">
                        <input
                          checked={!row.hidden}
                          data-testid={`device-visibility-${row.deviceId}`}
                          onChange={() => toggleDeviceVisibility(row.deviceId)}
                          onClick={(event) => event.stopPropagation()}
                          type="checkbox"
                        />
                        {row.hidden ? 'Hidden' : 'Shown'}
                      </label>
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-lg border border-stone-700 bg-stone-950 px-2 py-1 text-[11px] text-stone-200 disabled:opacity-40"
                          data-testid={`device-zoom-${row.deviceId}`}
                          disabled={!row.hasFix}
                          onClick={(event) => {
                            event.stopPropagation()
                            selectDevice(row.deviceId)
                            if (row.latitude !== null && row.longitude !== null) {
                              queueTarget(row.latitude, row.longitude, row.name)
                            }
                          }}
                          type="button"
                        >
                          Zoom
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          <aside className="px-6 py-6" data-testid="devices-inspector">
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
