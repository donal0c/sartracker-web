import { describe, expect, it } from 'vitest'

import { createOperationalCrosshairCursor } from '../../src/features/map/use-map-drawing-interactions'

describe('operational map cursor', () => {
  it('uses a red SVG crosshair cursor for armed placement tools', () => {
    const cursor = createOperationalCrosshairCursor()

    expect(cursor).toContain('data:image/svg+xml')
    expect(cursor).toContain('%23EF4444')
    expect(cursor).toContain('16 16')
  })
})
