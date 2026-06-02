import { describe, expect, it } from 'vitest'

import {
  createTextLabelDragState,
  resolveDraggableTextLabelId,
} from '../../src/features/map/text-label-drag'
import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'

/**
 * DON-72: text labels must be movable by clicking and dragging them on the
 * map. These pure helpers isolate the hit-test and the drag-vs-click decision
 * from the DOM event wiring.
 */

function createTextLabel(overrides: Partial<Drawing> = {}): Drawing {
  return {
    id: 'label-1',
    mission_id: 'mission-1',
    type: 'text_label',
    name: 'Command Post',
    description: null,
    color: '#FFCC00',
    width: null,
    distance_m: null,
    temporary_measure: null,
    label: 'Command Post',
    display_order: 1,
    geometry_json: JSON.stringify({ type: 'Point', coordinates: [-9.7, 52.0] }),
    metadata_json: JSON.stringify({
      kind: 'text_label',
      text: 'Command Post',
      fontSize: 14,
      color: '#FFCC00',
      rotation: 0,
      point: [-9.7, 52.0],
    }),
    created_at: '2026-04-09T00:00:00.000Z',
    updated_at: '2026-04-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveDraggableTextLabelId', () => {
  it('returns the text-label id when the projected anchor is within the grab radius', () => {
    const project = () => ({ x: 100, y: 100 })
    const id = resolveDraggableTextLabelId({
      drawings: [createTextLabel()],
      point: { x: 108, y: 104 },
      project,
    })
    expect(id).toBe('label-1')
  })

  it('returns null when the click is far from the anchor', () => {
    const project = () => ({ x: 100, y: 100 })
    const id = resolveDraggableTextLabelId({
      drawings: [createTextLabel()],
      point: { x: 400, y: 400 },
      project,
    })
    expect(id).toBeNull()
  })

  it('ignores non-text-label drawings', () => {
    const project = () => ({ x: 100, y: 100 })
    const id = resolveDraggableTextLabelId({
      drawings: [createTextLabel({ id: 'area-1', type: 'search_area' })],
      point: { x: 100, y: 100 },
      project,
    })
    expect(id).toBeNull()
  })
})

describe('createTextLabelDragState', () => {
  it('reports a drag only after the pointer moves past the threshold', () => {
    const drag = createTextLabelDragState('label-1', { x: 100, y: 100 })
    expect(drag.hasMoved()).toBe(false)

    drag.recordMove({ x: 102, y: 101 })
    expect(drag.hasMoved()).toBe(false)

    drag.recordMove({ x: 120, y: 118 })
    expect(drag.hasMoved()).toBe(true)
    expect(drag.drawingId).toBe('label-1')
  })
})
