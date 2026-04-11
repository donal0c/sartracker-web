import { applyTrackingSnapshot, applyTrackingStatus } from '../tracking/tracking-store'
import { useGpxStore } from '../gpx/gpx-store'
import type {
  TrackingConnectionStatus,
  TrackingSnapshot,
} from '../tracking/tracking-types'
import {
  getBrowserHarnessStore,
  readBrowserHarnessState,
  resetBrowserHarnessStore,
} from './browser-harness-store'

type BrowserHarnessApi = {
  readonly injectTrackingSnapshot: (
    snapshot: TrackingSnapshot,
    status?: TrackingConnectionStatus,
  ) => Promise<void>
  readonly hydrateTracking: () => Promise<void>
  readonly importGpxFiles: (
    files: readonly {
      readonly sourcePath: string
      readonly fileName: string
      readonly contents: string
    }[],
  ) => Promise<void>
  readonly readState: () => ReturnType<typeof readBrowserHarnessState>
  readonly reset: () => void
}

declare global {
  interface Window {
    __SARTRACKER_BROWSER_HARNESS__?: BrowserHarnessApi
  }
}

const DEFAULT_ONLINE_STATUS: TrackingConnectionStatus = {
  mode: 'online',
  consecutiveFailures: 0,
  recovered: false,
  lastSuccessAt: null,
  warning: null,
}

/**
 * Installs a small browser-only API so Playwright can seed and inspect the validation harness.
 */
export function installBrowserHarnessApi(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.__SARTRACKER_BROWSER_HARNESS__ = {
    injectTrackingSnapshot: async (snapshot, status = DEFAULT_ONLINE_STATUS) => {
      const store = getBrowserHarnessStore()
      const state = readBrowserHarnessState()
      const missionId = state.currentMissionId ?? state.recoverableMissionId
      if (missionId === null) {
        throw new Error('No active or recoverable mission is available for tracking injection.')
      }

      for (const device of snapshot.devices) {
        await store.upsertDevice({
          mission_id: missionId,
          device_id: device.device_id,
          name: device.name,
          color: '#38bdf8',
          status: mapTrackingStatus(device.status),
          last_seen: device.last_seen,
        })
      }

      for (const position of [...snapshot.breadcrumbs, ...snapshot.positions]) {
        await store.addPosition({
          mission_id: missionId,
          device_id: position.device_id,
          lat: position.lat,
          lon: position.lon,
          altitude: position.altitude,
          speed: position.speed,
          battery: position.battery,
          accuracy: position.accuracy,
          source: position.source,
          timestamp: position.timestamp,
          data_origin: position.data_origin,
        })
      }

      applyTrackingSnapshot(snapshot)
      applyTrackingStatus({
        ...status,
        lastSuccessAt: status.lastSuccessAt ?? new Date().toISOString(),
      })
    },
    hydrateTracking: async () => {
      const snapshot = await createTrackingSnapshotFromHarness()
      applyTrackingSnapshot(snapshot)
      applyTrackingStatus(resolveHydratedStatus(snapshot))
    },
    importGpxFiles: async (files) => {
      const controller = useGpxStore.getState().controller
      if (controller === null) {
        throw new Error('GPX runtime controller is unavailable.')
      }

      await controller.importFiles(files)
    },
    readState: () => readBrowserHarnessState(),
    reset: () => {
      resetBrowserHarnessStore()
      applyTrackingSnapshot({ devices: [], positions: [], breadcrumbs: [] })
      applyTrackingStatus({
        mode: 'idle',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: null,
        warning: 'Tracking is not configured.',
      })
    },
  }
}

export async function hydrateTrackingFromBrowserHarness(): Promise<void> {
  const snapshot = await createTrackingSnapshotFromHarness()
  applyTrackingSnapshot(snapshot)
  applyTrackingStatus(resolveHydratedStatus(snapshot))
}

async function createTrackingSnapshotFromHarness(): Promise<TrackingSnapshot> {
  const store = getBrowserHarnessStore()
  const state = readBrowserHarnessState()
  const missionId = state.currentMissionId ?? state.recoverableMissionId
  if (missionId === null) {
    return { devices: [], positions: [], breadcrumbs: [] }
  }

  const [devices, positions] = await Promise.all([
    store.listDevices(missionId),
    store.listPositions(missionId),
  ])

  return {
    devices: devices.map((device) => ({
      device_id: device.device_id,
      name: device.name,
      status: device.status,
      last_seen: device.last_seen,
      unique_id: null,
      category: null,
    })),
    positions: latestPositionsByDevice(positions),
    breadcrumbs: positions.map((position) => ({
      id: position.id,
      device_id: position.device_id,
      lat: position.lat,
      lon: position.lon,
      altitude: position.altitude,
      speed: position.speed,
      battery: position.battery,
      accuracy: position.accuracy,
      timestamp: position.timestamp,
      source: position.source,
      data_origin: position.data_origin,
      cache_age_seconds: null,
      device_cache_stale: false,
    })),
  }
}

function latestPositionsByDevice(
  positions: Awaited<ReturnType<ReturnType<typeof getBrowserHarnessStore>['listPositions']>>,
): TrackingSnapshot['positions'] {
  const latestByDevice = new Map<string, TrackingSnapshot['positions'][number]>()

  for (const position of positions) {
    const normalizedPosition = {
      id: position.id,
      device_id: position.device_id,
      lat: position.lat,
      lon: position.lon,
      altitude: position.altitude,
      speed: position.speed,
      battery: position.battery,
      accuracy: position.accuracy,
      timestamp: position.timestamp,
      source: position.source,
      data_origin: position.data_origin,
      cache_age_seconds: null,
      device_cache_stale: false,
    } satisfies TrackingSnapshot['positions'][number]
    const existing = latestByDevice.get(position.device_id)
    if (existing === undefined || Date.parse(existing.timestamp) < Date.parse(position.timestamp)) {
      latestByDevice.set(position.device_id, normalizedPosition)
    }
  }

  return [...latestByDevice.values()]
}

function resolveHydratedStatus(snapshot: TrackingSnapshot): TrackingConnectionStatus {
  if (snapshot.devices.length === 0 && snapshot.positions.length === 0) {
    return {
      mode: 'idle',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: null,
      warning: 'Tracking is not configured.',
    }
  }

  return {
    mode: 'online',
    consecutiveFailures: 0,
    recovered: false,
    lastSuccessAt: new Date().toISOString(),
    warning: null,
  }
}

function mapTrackingStatus(status: TrackingSnapshot['devices'][number]['status']): 'online' | 'offline' | 'unknown' {
  return status
}
