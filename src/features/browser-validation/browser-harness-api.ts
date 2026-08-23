import { applyTrackingSnapshot, applyTrackingStatus } from '../tracking/tracking-store'
import { useExactBreadcrumbDotStore } from '../tracking/exact-breadcrumb-dot-store'
import { useDrawingStore } from '../drawings/drawing-store'
import { useGpxStore } from '../gpx/gpx-store'
import { useMarkerStore } from '../markers/marker-store'
import type {
  UpsertDrawingInput,
  UpsertMarkerInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type {
  TrackingConnectionStatus,
  TrackingSnapshot,
} from '../tracking/tracking-types'
import {
  getBrowserHarnessStore,
  readBrowserHarnessState,
  resetBrowserHarnessStore,
} from './browser-harness-store'
import { useParticipantStore } from '../participants/participant-store'
import { createOperationalPositionRetention } from '../participants/operational-position-retention'
import type {
  NormalizedTrackingDevice,
  NormalizedTraccarGroup,
} from '../tracking/tracking-types'

type BrowserHarnessApi = {
  readonly setParticipantDiscovery: (input: {
    readonly devices: readonly NormalizedTrackingDevice[]
    readonly groups: readonly NormalizedTraccarGroup[]
  }) => Promise<void>
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
  readonly seedReadOnlyMapSurface: (input: {
    readonly markers?: readonly UpsertMarkerInput[]
    readonly drawings?: readonly UpsertDrawingInput[]
  }) => Promise<void>
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

  const operationalPositionRetention = createOperationalPositionRetention()

  window.__SARTRACKER_BROWSER_HARNESS__ = {
    setParticipantDiscovery: async ({ devices, groups }) => {
      const controller = useParticipantStore.getState().controller
      if (controller === null) {
        throw new Error('Participant runtime controller is unavailable.')
      }
      controller.applyGroups(groups)
      await controller.applyRoster(devices)
    },
    injectTrackingSnapshot: async (snapshot, status = DEFAULT_ONLINE_STATUS) => {
      const store = getBrowserHarnessStore()
      const state = readBrowserHarnessState()
      const missionId = state.currentMissionId ?? state.recoverableMissionId
      if (missionId === null) {
        throw new Error('No active or recoverable mission is available for tracking injection.')
      }

      const participantController = useParticipantStore.getState().controller
      await participantController?.applyRoster(snapshot.devices)
      const participantState = useParticipantStore.getState()
      const missionSnapshot =
        participantController !== null && participantState.activeMissionId === missionId
          ? operationalPositionRetention.apply(
              snapshot,
              participantState.scope,
              new Date(),
              missionId,
            )
          : snapshot
      const missionEvidenceSnapshot =
        participantController !== null && participantState.activeMissionId === missionId
          ? participantState.scope.filterEvidenceSnapshot(snapshot)
          : snapshot

      for (const device of missionSnapshot.devices) {
        await store.upsertDevice({
          mission_id: missionId,
          device_id: device.device_id,
          name: device.name,
          color: '#38bdf8',
          status: mapTrackingStatus(device.status),
          last_seen: device.last_seen,
          group_id: device.group_id ?? null,
          unique_id: device.unique_id,
        })
      }

      const positions = [
        ...missionEvidenceSnapshot.breadcrumbs,
        ...missionEvidenceSnapshot.positions,
      ]
      if (positions.length > 0) {
        await store.addPositionsBulk({
          mission_id: missionId,
          positions: positions.map((position) => ({
            source_position_id: position.id,
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
          })),
        })
        useExactBreadcrumbDotStore.getState().controller?.notifyDurableChange(
          positions.length,
        )
      }

      applyTrackingSnapshot(missionSnapshot)
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
    seedReadOnlyMapSurface: async (input) => {
      const store = getBrowserHarnessStore()
      const state = readBrowserHarnessState()
      const missionId = state.currentMissionId ?? state.recoverableMissionId
      if (missionId === null) {
        throw new Error('No active or recoverable mission is available for map-surface seeding.')
      }

      for (const marker of input.markers ?? []) {
        await store.upsertMarker({ ...marker, mission_id: missionId })
      }

      for (const drawing of input.drawings ?? []) {
        await store.upsertDrawing({ ...drawing, mission_id: missionId })
      }

      await useMarkerStore.getState().controller?.refreshMission(missionId)
      await useDrawingStore.getState().controller?.refreshMission(missionId)
    },
    readState: () => readBrowserHarnessState(),
    reset: () => {
      operationalPositionRetention.reset()
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
