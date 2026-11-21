import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateMissionStoreFixture } from '../../build/seed-mission-store-runtime.js'
import { trailGapFindings } from '../../scripts/team-smoke/lib/whole-trail.mjs'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'
import { useExactBreadcrumbDotStore } from '../../src/features/tracking/exact-breadcrumb-dot-store'
import {
  startExactBreadcrumbDotRuntime,
  type ExactBreadcrumbDotMissionStore,
} from '../../src/features/tracking/start-exact-breadcrumb-dot-runtime'
import { syncTrackingOverlay } from '../../src/features/tracking/sync-tracking-overlay'
import { useTrackingStyleStore } from '../../src/features/tracking/tracking-style-store'
import type { NormalizedTrackingPosition, TrackingSnapshot } from '../../src/features/tracking/tracking-types'

/**
 * DON-338 at the team's shape: 34 devices on one mission, one of them past
 * 10,000 fixes. The exact-dot page holds 10,000 dots pooled across every
 * device, so with Breadcrumb dots selected most of each device's trail is
 * left undrawn. Drives the real store (seeded through the production store
 * by the field-34-devices preset), the real exact-dot worker, runtime and
 * controller, and the real tracking overlay sync; only MapLibre is replaced
 * by a recorder of the GeoJSON it is given.
 */

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (input: { readonly userDataPath: string }) => RealMissionStore
}
type RealMissionStore = ExactBreadcrumbDotMissionStore & {
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}
type RecordedFeature = {
  readonly geometry: { readonly type: string, readonly coordinates: unknown }
  readonly properties: { readonly featureKind?: string, readonly deviceId?: string }
}
type StoredFix = { readonly deviceId: string, readonly lat: number, readonly lon: number, readonly time: number }

let userDataPath: string | undefined
let store: RealMissionStore | undefined
let stopRuntime: (() => void) | undefined

afterEach(async () => {
  stopRuntime?.()
  stopRuntime = undefined
  if (store !== undefined) {
    await store.prepareClose().catch(() => undefined)
    store.close()
    store = undefined
  }
  if (userDataPath !== undefined) {
    await rm(userDataPath, { recursive: true, force: true })
    userDataPath = undefined
  }
  useMissionStore.setState(useMissionStore.getInitialState())
  useExactBreadcrumbDotStore.setState(useExactBreadcrumbDotStore.getInitialState())
  useTrackingStyleStore.setState(useTrackingStyleStore.getInitialState())
})

describe('[DON-338] whole trail with Breadcrumb dots on a 34-device mission', () => {
  // LIV-1: before the fix dots mode removed the line and drew only the newest
  // 10,000-dot page pooled across all devices.
  it('draws every fix of every device with Breadcrumb dots selected [LIV-1]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-don-338-dots-'))
    const fixture = await generateMissionStoreFixture({
      preset: 'field-34-devices',
      outputPath: path.join(userDataPath, 'mission-store.sqlite'),
    })
    const { mission, stored } = readStored(fixture.outputPath)
    store = createElectronMissionStore({ userDataPath })

    const liveSnapshot = liveTrailSnapshot(stored)
    const lineMap = createRecordingMap()
    syncTrackingOverlay(lineMap as never, liveSnapshot, [], [], true, {
      deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'line',
    })
    // Control: the default Solid line draws every device start to finish.
    expect(trailGapFindings(drawnTrail(lineMap), stored, { layer: 'live trail', toleranceMetres: 30 })).toEqual([])

    useMissionStore.setState({
      phase: 'active',
      currentMission: {
        id: mission.id, name: mission.name, status: 'active', start_time: mission.start_time,
        pause_time: null, finish_time: null, paused_seconds: 0, notes: null, schema_version: 1,
      },
    })
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    stopRuntime = startExactBreadcrumbDotRuntime(store)
    await vi.waitFor(() => expect(useExactBreadcrumbDotStore.getState().state.status).toBe('ready'), { timeout: 60_000, interval: 50 })

    const dotsMap = createRecordingMap()
    syncTrackingOverlay(dotsMap as never, liveSnapshot, [], [], true,
      { deviceColors: {}, breadcrumbSize: 8, breadcrumbTrailMode: 'dots' },
      useExactBreadcrumbDotStore.getState().state)
    expect(trailGapFindings(drawnTrail(dotsMap), stored, { layer: 'drawn trail', toleranceMetres: 30 })).toEqual([])
  }, 180_000)
})

function readStored(databasePath: string) {
  const db = new Database(databasePath, { readonly: true })
  try {
    const mission = db.prepare('SELECT id, name, start_time FROM missions LIMIT 1').get() as { id: string, name: string, start_time: string }
    const stored = (db.prepare('SELECT device_id, lat, lon, timestamp FROM positions WHERE mission_id = ?').raw()
      .all(mission.id) as [string, number, number, string][])
      .map(([deviceId, lat, lon, timestamp]): StoredFix => ({ deviceId: String(deviceId), lat, lon, time: Date.parse(timestamp) }))
    return { mission, stored }
  } finally {
    db.close()
  }
}

/** The live trail as the production accumulator publishes it after polling every fix. */
function liveTrailSnapshot(stored: readonly StoredFix[]): TrackingSnapshot {
  const ordered = [...stored].sort((a, b) => a.time - b.time)
  const positions = ordered.map((fix, index): NormalizedTrackingPosition => ({
    id: String(index + 1), device_id: fix.deviceId, lat: fix.lat, lon: fix.lon,
    altitude: null, speed: null, battery: null, accuracy: null,
    timestamp: new Date(fix.time).toISOString(), source: 'traccar', data_origin: 'live',
    cache_age_seconds: null, device_cache_stale: false,
  }))
  const accumulator = createBreadcrumbAccumulator()
  for (let offset = 0; offset < positions.length; offset += 2_000) {
    accumulator.ingest(positions.slice(offset, offset + 2_000))
    accumulator.compact()
  }
  const trail = accumulator.compact()
  return { devices: [], positions: [], breadcrumbs: trail.positions, breadcrumbMetadata: trail.metadata }
}

/** Records the GeoJSON handed to MapLibre sources and the layer filters; draws nothing. */
function createRecordingMap() {
  const layers = new Map<string, { id: string, filter?: unknown, paint?: Record<string, unknown> }>()
  const sourceData = new Map<string, { features: RecordedFeature[] }>()
  return {
    sourceData,
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => (sourceData.has(id)
      ? {
          setData: (data: { features: RecordedFeature[] }) => { sourceData.set(id, data) },
          updateData: () => { throw new Error('Incremental source updates are not expected on a fresh map.') },
        }
      : undefined),
    addLayer: (spec: { id: string, filter?: unknown, paint?: Record<string, unknown> }) => { layers.set(spec.id, spec) },
    addSource: (id: string, config: { data: { features: RecordedFeature[] } }) => { sourceData.set(id, config.data) },
    getFilter: (id: string) => layers.get(id)?.filter,
    getPaintProperty: (id: string, property: string) => layers.get(id)?.paint?.[property],
    setFilter: (id: string, filter: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.filter = filter
    },
    setPaintProperty: (id: string, property: string, value: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.paint = { ...(layer.paint ?? {}), [property]: value }
    },
  }
}

/** Every breadcrumb line and dot the overlay put on the map, by device. */
function drawnTrail(map: ReturnType<typeof createRecordingMap>) {
  const drawn: Record<string, { lines: number[][][], points: number[][] }> = {}
  for (const data of map.sourceData.values()) {
    for (const feature of data.features) {
      const kind = feature.properties.featureKind
      const deviceId = feature.properties.deviceId
      if (deviceId === undefined || (kind !== 'breadcrumb' && kind !== 'breadcrumbLine')) continue
      const entry = (drawn[deviceId] ??= { lines: [], points: [] })
      if (feature.geometry.type === 'Point') entry.points.push(feature.geometry.coordinates as number[])
      else if (feature.geometry.type === 'LineString') entry.lines.push(feature.geometry.coordinates as number[][])
    }
  }
  return drawn
}
