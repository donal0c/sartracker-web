import { describe, expect, it } from 'vitest'

import { createDeviceColor } from '../../src/features/tracking/tracking-color'

describe('tracking colors', () => {
  it('is deterministic for the same device id', () => {
    expect(createDeviceColor('tracker-1')).toBe(createDeviceColor('tracker-1'))
  })

  it('returns a valid hex color from the SAR palette', () => {
    const color = createDeviceColor('tracker-1')
    expect(color).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('produces different colors for different device ids', () => {
    const ids = ['1', '2', '3', '4', '5', '6', '7', '8']
    const colors = ids.map(createDeviceColor)
    const unique = new Set(colors)
    expect(unique.size).toBe(8)
  })
})
