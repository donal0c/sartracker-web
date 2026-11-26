import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/coordinates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/coordinates')>()
  return {
    ...actual,
    formatIrishGridReference: () => {
      throw new RangeError('TM65 easting outside valid range during format_irish_grid_reference')
    },
  }
})

const { formatDevicePositionDisplay } = await import('../../src/features/tracking/device-position-display')

describe('formatDevicePositionDisplay when the grid cannot be formed [DON-377]', () => {
  it('says Irish Grid unavailable and keeps lat/lon, never a guessed reference', () => {
    expect(formatDevicePositionDisplay(51.99917, -9.74406)).toEqual({
      kind: 'grid_unavailable',
      primary: 'Irish Grid unavailable',
      secondary: '51.99917, -9.74406',
    })
  })
})
