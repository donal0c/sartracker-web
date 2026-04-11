import { describe, expect, it } from 'vitest'

import {
  computeMapInteractionMode,
  type MapInteractionModeInputs,
} from '../../src/features/map/map-interaction-mode-store'

describe('map interaction mode store', () => {
  const idle: MapInteractionModeInputs = {
    drawingActiveTool: 'select',
    drawingDialog: null,
    drawingSketch: null,
    measurementMode: 'idle',
    markerDialog: null,
  }

  describe('computeMapInteractionMode', () => {
    it('returns idle when no features are active', () => {
      expect(computeMapInteractionMode(idle)).toBe('idle')
    })

    it('returns measurement_armed when measurement is armed and nothing else active', () => {
      expect(
        computeMapInteractionMode({ ...idle, measurementMode: 'armed' }),
      ).toBe('measurement_armed')
    })

    it('returns drawing_sketching when a sketch is in progress', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          drawingSketch: { tool: 'line', points: [] },
        }),
      ).toBe('drawing_sketching')
    })

    it('returns drawing_dialog when a drawing dialog is open', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          drawingDialog: { mode: 'create', draft: {} as never },
        }),
      ).toBe('drawing_dialog')
    })

    it('returns marker_dialog when a marker dialog is open', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          markerDialog: { mode: 'create', draft: {} as never },
        }),
      ).toBe('marker_dialog')
    })

    it('returns drawing_tool_armed when a non-select drawing tool is active', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          drawingActiveTool: 'range_ring',
        }),
      ).toBe('drawing_tool_armed')
    })

    it('prioritises drawing sketch over measurement armed', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          drawingSketch: { tool: 'line', points: [] },
          measurementMode: 'armed',
        }),
      ).toBe('drawing_sketching')
    })

    it('prioritises drawing dialog over measurement armed', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          drawingDialog: { mode: 'edit', draft: {} as never },
          measurementMode: 'armed',
        }),
      ).toBe('drawing_dialog')
    })

    it('prioritises marker dialog over measurement armed', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          markerDialog: { mode: 'create', draft: {} as never },
          measurementMode: 'armed',
        }),
      ).toBe('marker_dialog')
    })

    it('prioritises drawing tool armed over measurement armed', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          drawingActiveTool: 'bearing_line',
          measurementMode: 'armed',
        }),
      ).toBe('drawing_tool_armed')
    })

    it('prioritises drawing sketch over drawing dialog', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          drawingSketch: { tool: 'search_area', points: [] },
          drawingDialog: { mode: 'create', draft: {} as never },
        }),
      ).toBe('drawing_sketching')
    })

    it('prioritises drawing dialog over marker dialog', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          drawingDialog: { mode: 'edit', draft: {} as never },
          markerDialog: { mode: 'create', draft: {} as never },
        }),
      ).toBe('drawing_dialog')
    })

    it('prioritises marker dialog over drawing tool armed', () => {
      expect(
        computeMapInteractionMode({
          ...idle,
          markerDialog: { mode: 'create', draft: {} as never },
          drawingActiveTool: 'line',
        }),
      ).toBe('marker_dialog')
    })

    it('returns non-idle during marker dialog so marker clicks are self-suppressed', () => {
      const mode = computeMapInteractionMode({
        ...idle,
        markerDialog: { mode: 'create', draft: {} as never },
      })
      expect(mode).not.toBe('idle')
    })
  })
})
