import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  NO_COVERAGE_TILE_BASE64,
  NO_COVERAGE_TILE_BYTES,
  TILE_SIZE,
  createNoCoverageTilePng,
  createNoCoverageTileResponse,
} = require('../../electron/official-map-no-coverage.cjs') as {
  readonly NO_COVERAGE_TILE_BASE64: string
  readonly NO_COVERAGE_TILE_BYTES: Buffer
  readonly TILE_SIZE: number
  readonly createNoCoverageTilePng: () => Buffer
  readonly createNoCoverageTileResponse: () => {
    readonly contentType: string
    readonly bytesBase64: string
  }
}

describe('Electron official map no-coverage tile', () => {
  it('creates stable opaque 256px PNG bytes', () => {
    const bytes = createNoCoverageTilePng()
    expect(TILE_SIZE).toBe(256)
    expect(bytes).toEqual(NO_COVERAGE_TILE_BYTES)
    expect(bytes.toString('base64')).toBe(NO_COVERAGE_TILE_BASE64)
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  })

  it('returns the local PNG response without a filesystem or network dependency', () => {
    expect(createNoCoverageTileResponse()).toEqual({
      contentType: 'image/png',
      bytesBase64: NO_COVERAGE_TILE_BASE64,
    })
  })
})
