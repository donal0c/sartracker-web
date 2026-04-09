import { describe, expect, it } from 'vitest'

import {
  getInteractiveMarkerLayerIds,
  isPointInsideMapContainer,
  resolveClickedMarkerId,
  shouldIgnoreMarkerMapClick,
} from '../../src/features/map/map-marker-interactions'

describe('map marker interactions', () => {
  it('ignores clicks when there is no active mission', () => {
    expect(shouldIgnoreMarkerMapClick(null, 'idle', null)).toBe(true)
  })

  it('ignores clicks during recovery mode', () => {
    expect(shouldIgnoreMarkerMapClick('mission-1', 'recovery', null)).toBe(true)
  })

  it('ignores clicks originating from interactive controls', () => {
    const button = document.createElement('button')
    expect(shouldIgnoreMarkerMapClick('mission-1', 'active', button)).toBe(true)
  })

  it('allows clicks on the map surface during an active mission', () => {
    const surface = document.createElement('div')
    expect(shouldIgnoreMarkerMapClick('mission-1', 'active', surface)).toBe(false)
  })

  it('detects points inside the map container bounds', () => {
    expect(
      isPointInsideMapContainer(
        { x: 120, y: 80 },
        { left: 100, right: 300, top: 50, bottom: 250 },
      ),
    ).toBe(true)
  })

  it('detects points outside the map container bounds', () => {
    expect(
      isPointInsideMapContainer(
        { x: 99, y: 80 },
        { left: 100, right: 300, top: 50, bottom: 250 },
      ),
    ).toBe(false)
  })

  it('builds only the marker layers that currently exist on the map', () => {
    const availableLayers = new Set([
      'mission-markers-hitbox',
      'mission-markers-symbol-clue',
      'mission-markers-label-clue',
    ])

    expect(getInteractiveMarkerLayerIds((layerId) => availableLayers.has(layerId))).toEqual([
      'mission-markers-hitbox',
      'mission-markers-symbol-clue',
      'mission-markers-label-clue',
    ])
  })

  it('prefers the rendered marker id over the fallback nearest marker id', () => {
    expect(resolveClickedMarkerId('marker-1', 'marker-2')).toBe('marker-1')
  })

  it('uses the nearest marker id when the rendered marker id is unavailable', () => {
    expect(resolveClickedMarkerId(null, 'marker-2')).toBe('marker-2')
  })
})
