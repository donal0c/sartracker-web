import { beforeEach, describe, expect, it } from 'vitest'

import { createParticipantSelectionViewModel } from '../../src/features/participants/use-participant-selection-view-model'
import { createParticipationScope } from '../../src/features/participants/participation-scope'
import { buildCoverageCatalogInput } from '../../src/features/layers/coverage-catalog-projection'
import { createDeviceFeatureCollection } from '../../src/features/tracking/tracking-geojson'
import {
  getBrowserHarnessStore,
  resetBrowserHarnessStore,
} from '../../src/features/browser-validation/browser-harness-store'
import type { MissionParticipant } from '../../src/infrastructure/mission-store/tauri-mission-store'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

describe('coverage participant scope [DON-275]', () => {
  beforeEach(() => resetBrowserHarnessStore())

  it('keeps a discovery-only device out of evidence, coverage controls, and the mission map', async () => {
    const selected = device('selected', 'Selected Team')
    const discoveryOnly = device('discovery-only', 'Discovery Only')
    const snapshot: TrackingSnapshot = {
      devices: [selected, discoveryOnly],
      positions: [position('selected', 'selected-current'), position('discovery-only', 'discovery-current')],
      breadcrumbs: [position('selected', 'selected-history'), position('discovery-only', 'discovery-history')],
    }
    const scope = createParticipationScope({
      participants: [participant('selected')],
      membershipEvents: [],
    })
    const evidence = scope.filterEvidenceSnapshot(snapshot, '2026-08-24T12:00:00.000Z')
    const missionMap = scope.filterSnapshot(snapshot, '2026-08-24T12:00:00.000Z')
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Coverage scope regression',
      start_time: '2026-08-24T08:00:00.000Z',
    })

    for (const admittedDevice of evidence.devices) {
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: admittedDevice.device_id,
        name: admittedDevice.name,
        color: '#38bdf8',
        status: admittedDevice.status,
        last_seen: admittedDevice.last_seen,
        group_id: admittedDevice.group_id ?? null,
        unique_id: admittedDevice.unique_id,
      })
    }
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [...evidence.breadcrumbs, ...evidence.positions].map((fix) => ({
        source_position_id: fix.id,
        device_id: fix.device_id,
        lat: fix.lat,
        lon: fix.lon,
        timestamp: fix.timestamp,
        data_origin: fix.data_origin,
      })),
    })

    const persisted = await store.listPositions(mission.id)
    const manifest = await store.readCoverageManifest(mission.id)
    const coverageCatalog = buildCoverageCatalogInput(manifest, snapshot.devices, [], [])
    const liveFeatures = createDeviceFeatureCollection(missionMap).features
    const picker = createParticipantSelectionViewModel({
      controller: null,
      availableDevices: snapshot.devices,
      availableGroups: [],
      draftDeviceIds: ['selected'],
      draftGroupIds: [],
      rosterError: null,
    })

    expect(persisted.map((fix) => fix.device_id)).toEqual(['selected', 'selected'])
    expect(manifest.chunks.map((chunk) => chunk.key.device_id)).toEqual(['selected'])
    expect(coverageCatalog.devices.map((entry) => entry.deviceId)).toEqual(['selected'])
    expect(liveFeatures.map((feature) => feature.properties?.deviceId)).toEqual(['selected'])
    expect(picker.availableDevices.map((entry) => entry.deviceId)).toEqual([
      'selected',
      'discovery-only',
    ])
  })
})

function participant(deviceId: string): MissionParticipant {
  return {
    id: `participant-${deviceId}`,
    mission_id: 'mission-1',
    kind: 'device',
    traccar_device_id: deviceId,
    mission_team_id: null,
    traccar_group_id: null,
    team_name: null,
    provenance: 'explicit',
    effective_from: '2026-08-24T08:00:00.000Z',
    added_at: '2026-08-24T08:00:00.000Z',
    added_by: 'Coordinator',
    removed_at: null,
    removed_by: null,
  }
}

function device(deviceId: string, name: string): NormalizedTrackingDevice {
  return {
    device_id: deviceId,
    name,
    status: 'online',
    last_seen: '2026-08-24T12:00:00.000Z',
    unique_id: `imei-${deviceId}`,
    category: null,
    group_id: null,
  }
}

function position(deviceId: string, id: string): NormalizedTrackingPosition {
  return {
    id,
    device_id: deviceId,
    lat: 52.1,
    lon: -9.1,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: '2026-08-24T11:00:00.000Z',
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}
