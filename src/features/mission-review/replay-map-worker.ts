/// <reference lib="webworker" />
import { projectReplayMap } from './replay-map-projection'
import type { MissionReplayReadResult, MissionReplayTrackRecord } from '../../infrastructure/mission-store/tauri-mission-store'

const tracks: MissionReplayTrackRecord[] = []
const objects: MissionReplayReadResult['objects'][number][] = []

/** Builds large GeoJSON away from the live renderer and hands MapLibre a Blob URL. */
self.onmessage = (event: MessageEvent<{ tracks?: MissionReplayTrackRecord[]; objects?: MissionReplayReadResult['objects']; finish?: boolean }>) => {
  try {
    if (event.data.tracks) tracks.push(...event.data.tracks)
    if (event.data.objects) objects.push(...event.data.objects)
    if (!event.data.finish) { self.postMessage({ ready: true }); return }
    const data = projectReplayMap(tracks, objects)
    const bounds: [number, number, number, number] = [180, 90, -180, -90]
    /** Extends map bounds over already validated GeoJSON coordinates. */
    const extend = (value: unknown): void => {
      if (!Array.isArray(value)) return
      if (typeof value[0] === 'number' && typeof value[1] === 'number') {
        bounds[0] = Math.min(bounds[0], value[0]); bounds[1] = Math.min(bounds[1], value[1])
        bounds[2] = Math.max(bounds[2], value[0]); bounds[3] = Math.max(bounds[3], value[1])
      } else for (const child of value) extend(child)
    }
    for (const feature of data.features) if ('coordinates' in feature.geometry) extend(feature.geometry.coordinates)
    const blob = new Blob([JSON.stringify({ type: data.type, features: data.features })], { type: 'application/geo+json' })
    self.postMessage({ blob, bounds: data.features.length ? bounds : null, limitations: data.limitations })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Map projection failed.' })
  }
}
