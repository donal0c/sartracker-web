import { describe, expect, it } from 'vitest'

import { createDeviceColor } from '../../src/features/tracking/tracking-color'

describe('tracking colors', () => {
  it('is deterministic for the same device id', () => {
    expect(createDeviceColor('tracker-1')).toBe(createDeviceColor('tracker-1'))
  })

  it('stays within the visible channel range', () => {
    const color = createDeviceColor('tracker-1')
    const channels = color
      .replace('#', '')
      .match(/.{2}/g)
      ?.map((channel) => Number.parseInt(channel, 16))

    expect(channels).toBeDefined()
    expect(channels).toHaveLength(3)
    expect(channels?.every((channel) => channel >= 50 && channel <= 255)).toBe(true)
  })
})
