import { describe, expect, it } from 'vitest'

import { findNearestMarkerId } from '../../src/features/markers/marker-hit-testing'
import type { Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('findNearestMarkerId', () => {
  it('returns the closest marker inside the pixel tolerance', () => {
    const marker = createMarker({
      id: 'marker-1',
      lat: 52.0,
      lon: -9.7,
    })

    const map = createMapDouble({
      '-9.7,52': { x: 100, y: 120 },
    })

    expect(findNearestMarkerId(map, { x: 108, y: 125 }, [marker])).toBe('marker-1')
  })

  it('returns null when no marker is within the pick radius', () => {
    const marker = createMarker({
      id: 'marker-1',
      lat: 52.0,
      lon: -9.7,
    })

    const map = createMapDouble({
      '-9.7,52': { x: 100, y: 120 },
    })

    expect(findNearestMarkerId(map, { x: 180, y: 190 }, [marker])).toBeNull()
  })

  it('prefers the nearest marker when multiple candidates are close', () => {
    const markers = [
      createMarker({
        id: 'marker-a',
        lat: 52.0,
        lon: -9.7,
      }),
      createMarker({
        id: 'marker-b',
        lat: 52.0001,
        lon: -9.7001,
      }),
    ]

    const map = createMapDouble({
      '-9.7,52': { x: 100, y: 120 },
      '-9.7001,52.0001': { x: 110, y: 125 },
    })

    expect(findNearestMarkerId(map, { x: 109, y: 124 }, markers)).toBe('marker-b')
  })
})

function createMapDouble(
  projectedPoints: Record<string, { readonly x: number; readonly y: number }>,
) {
  return {
    project([lon, lat]: [number, number]) {
      const key = `${lon},${lat}`
      const point = projectedPoints[key]

      if (point === undefined) {
        throw new Error(`Missing projected point for ${key}`)
      }

      return point
    },
  } as Pick<import('maplibre-gl').Map, 'project'> as import('maplibre-gl').Map
}

function createMarker(overrides: Partial<Marker>): Marker {
  return {
    id: overrides.id ?? 'marker-id',
    mission_id: overrides.mission_id ?? 'mission-id',
    type: overrides.type ?? 'clue',
    name: overrides.name ?? 'Marker',
    description: overrides.description ?? null,
    lat: overrides.lat ?? 52.0,
    lon: overrides.lon ?? -9.7,
    itm_e: overrides.itm_e ?? 0,
    itm_n: overrides.itm_n ?? 0,
    grid_ref: overrides.grid_ref ?? 'V 00000 00000',
    subject_category: overrides.subject_category ?? null,
    clue_type: overrides.clue_type ?? null,
    confidence: overrides.confidence ?? null,
    found_by: overrides.found_by ?? null,
    hazard_type: overrides.hazard_type ?? null,
    severity: overrides.severity ?? null,
    condition: overrides.condition ?? null,
    evacuation_priority: overrides.evacuation_priority ?? null,
    treatment: overrides.treatment ?? null,
    display_order: overrides.display_order ?? 1,
    created_at: overrides.created_at ?? '2026-04-09T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-04-09T00:00:00.000Z',
  }
}
