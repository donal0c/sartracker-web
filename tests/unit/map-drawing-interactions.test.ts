import { describe, expect, it } from 'vitest'

import {
  getInteractiveDrawingLayerIds,
  resolveClickedDrawingId,
  shouldIgnoreDrawingMapClick,
} from '../../src/features/map/map-drawing-interactions'

describe('map drawing interactions', () => {
  describe('shouldIgnoreDrawingMapClick', () => {
    it('ignores clicks when there is no active mission', () => {
      expect(shouldIgnoreDrawingMapClick(null, 'idle', null)).toBe(true)
    })

    it('ignores clicks during recovery mode', () => {
      expect(shouldIgnoreDrawingMapClick('mission-1', 'recovery', null)).toBe(true)
    })

    it('ignores clicks originating from interactive controls including textarea', () => {
      const textarea = document.createElement('textarea')
      expect(shouldIgnoreDrawingMapClick('mission-1', 'active', textarea)).toBe(true)
    })

    it('allows clicks on the map surface during an active mission', () => {
      const surface = document.createElement('div')
      expect(shouldIgnoreDrawingMapClick('mission-1', 'active', surface)).toBe(false)
    })

    it('allows clicks during a paused mission', () => {
      const surface = document.createElement('div')
      expect(shouldIgnoreDrawingMapClick('mission-1', 'paused', surface)).toBe(false)
    })
  })

  describe('getInteractiveDrawingLayerIds', () => {
    it('returns only drawing layers that exist on the map', () => {
      const available = new Set([
        'mission-drawings-fill-hitbox',
        'mission-drawings-line',
        'mission-drawings-point-hitbox',
      ])

      const result = getInteractiveDrawingLayerIds((id) => available.has(id))
      expect(result).toEqual(expect.arrayContaining([
        'mission-drawings-fill-hitbox',
        'mission-drawings-line',
        'mission-drawings-point-hitbox',
      ]))
      expect(result).toHaveLength(3)
    })

    it('returns an empty array when no drawing layers exist', () => {
      expect(getInteractiveDrawingLayerIds(() => false)).toEqual([])
    })
  })

  describe('resolveClickedDrawingId', () => {
    it('returns the drawing id when it is a string', () => {
      expect(resolveClickedDrawingId('drawing-1')).toBe('drawing-1')
    })

    it('returns null when the drawing id is null', () => {
      expect(resolveClickedDrawingId(null)).toBeNull()
    })

    it('returns null when the drawing id is undefined', () => {
      expect(resolveClickedDrawingId(undefined)).toBeNull()
    })

    it('returns null when the drawing id is a number', () => {
      expect(resolveClickedDrawingId(42)).toBeNull()
    })
  })
})
