import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { normalizeCoverageTileAddress } = require('../../electron/coverage-tile-address.cjs') as {
  readonly normalizeCoverageTileAddress: (input: Readonly<Record<string, unknown>>) => {
    readonly z: number
    readonly x: number
    readonly y: number
  }
}

describe('coverage tile address validation', () => {
  it('accepts only integral coordinates inside the configured zoom pyramid', () => {
    expect(normalizeCoverageTileAddress({ z: 0, x: 0, y: 0 })).toEqual({ z: 0, x: 0, y: 0 })
    expect(normalizeCoverageTileAddress({ z: 16, x: 65_535, y: 65_535 })).toEqual({
      z: 16, x: 65_535, y: 65_535,
    })

    for (const address of [
      { z: 0, x: '0/../../escaped', y: 0 },
      { z: 0, x: 1, y: 0 },
      { z: 8.5, x: 0, y: 0 },
      { z: 17, x: 0, y: 0 },
      { z: 8, x: 0, y: Number.NaN },
    ]) {
      expect(() => normalizeCoverageTileAddress(address)).toThrow(/tile coordinate/i)
    }
  })
})
