import { describe, expect, it } from 'vitest'

import {
  HELICOPTER_SLOT_ORDER,
  selectHelicopterPanelSlots,
} from '../../src/features/helicopters/helicopter-panel-slots'

describe('selectHelicopterPanelSlots', () => {
  it('shows only assigned slots by default and counts the hidden empty slots', () => {
    const result = selectHelicopterPanelSlots({
      assignedSlots: ['slot_2'],
      showEmptySlots: false,
    })

    expect(result.visibleSlots).toEqual(['slot_2'])
    expect(result.assignedCount).toBe(1)
    expect(result.hiddenEmptyCount).toBe(3)
  })

  it('reveals every slot in canonical order when empty slots are shown', () => {
    const result = selectHelicopterPanelSlots({
      assignedSlots: ['slot_3'],
      showEmptySlots: true,
    })

    expect(result.visibleSlots).toEqual(['slot_1', 'slot_2', 'slot_3', 'slot_4'])
    expect(result.assignedCount).toBe(1)
    expect(result.hiddenEmptyCount).toBe(0)
  })

  it('keeps assigned slots in canonical order regardless of input order', () => {
    const result = selectHelicopterPanelSlots({
      assignedSlots: ['slot_4', 'slot_1'],
      showEmptySlots: false,
    })

    expect(result.visibleSlots).toEqual(['slot_1', 'slot_4'])
    expect(result.assignedCount).toBe(2)
    expect(result.hiddenEmptyCount).toBe(2)
  })

  it('never hides an assigned slot even when empty slots are collapsed', () => {
    const result = selectHelicopterPanelSlots({
      assignedSlots: HELICOPTER_SLOT_ORDER,
      showEmptySlots: false,
    })

    expect(result.visibleSlots).toEqual(['slot_1', 'slot_2', 'slot_3', 'slot_4'])
    expect(result.assignedCount).toBe(4)
    expect(result.hiddenEmptyCount).toBe(0)
  })

  it('reports no visible slots and four hidden empties when nothing is assigned', () => {
    const result = selectHelicopterPanelSlots({
      assignedSlots: [],
      showEmptySlots: false,
    })

    expect(result.visibleSlots).toEqual([])
    expect(result.assignedCount).toBe(0)
    expect(result.hiddenEmptyCount).toBe(4)
  })

  it('ignores duplicate assigned slot keys', () => {
    const result = selectHelicopterPanelSlots({
      assignedSlots: ['slot_1', 'slot_1'],
      showEmptySlots: false,
    })

    expect(result.visibleSlots).toEqual(['slot_1'])
    expect(result.assignedCount).toBe(1)
    expect(result.hiddenEmptyCount).toBe(3)
  })
})
