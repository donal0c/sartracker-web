import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { qualifyOfficialMapView } = require('../../electron/official-map-view-qualification.cjs') as {
  qualifyOfficialMapView: (input: unknown, options: {
    packages: readonly unknown[]
    readTile: (mapPackage: unknown, tile: unknown) => Promise<{status: string}>
    isCurrent: (mapPackage: unknown) => boolean
    now?: () => Date
  }) => Promise<{status: string; totalTiles: number; usableTiles: number}>
}
const mapPackage = { id: 'synthetic', mapId: 'official_discovery_topo', status: 'ready',
  minZoom: 2, maxZoom: 2, attestation: { version: 1, identity: 'one', sha256: 'a'.repeat(64) } }
const input = {mapId: 'official_discovery_topo', bounds: {west: -10, east: 10, south: -10, north: 10}, zoom: 2}

describe('native official map required-view qualification', () => {
  it('requires every tile and never substitutes online or hatch data', async () => {
    const readTile = vi.fn().mockResolvedValueOnce({status: 'miss'}).mockResolvedValue({status: 'hit'})
    const result = await qualifyOfficialMapView(input, {packages: [mapPackage], readTile, isCurrent: () => true})
    expect(result).toMatchObject({status: 'partial', totalTiles: 4, usableTiles: 3})
    expect(readTile).toHaveBeenCalledTimes(4)
  })
  it('returns complete only for usable tiles from unchanged attested packages', async () => {
    const result = await qualifyOfficialMapView(input, {packages: [mapPackage], readTile: async () => ({status: 'hit'}), isCurrent: () => true})
    expect(result).toMatchObject({status: 'complete', totalTiles: 4, usableTiles: 4})
  })
  it('rejects a package replacement during the check', async () => {
    let current = true
    const result = await qualifyOfficialMapView(input, {packages: [mapPackage], readTile: async () => { current = false; return {status: 'hit'} }, isCurrent: () => current})
    expect(result.status).not.toBe('complete')
  })
  it('does not certify a zoom absent from the package', async () => {
    const readTile = vi.fn()
    const result = await qualifyOfficialMapView({...input, zoom: 3}, {packages: [mapPackage], readTile, isCurrent: () => true})
    expect(result.status).toBe('missing')
    expect(readTile).not.toHaveBeenCalled()
  })
  it.each([NaN, Infinity, -1, 20, 1.2])('rejects invalid tile zoom %s before reading', async zoom => {
    await expect(qualifyOfficialMapView({...input, zoom}, {packages: [mapPackage], readTile: vi.fn(), isCurrent: () => true})).rejects.toThrow()
  })
  it('bounds a huge view before allocation or SQLite reads', async () => {
    const readTile = vi.fn()
    await expect(qualifyOfficialMapView({...input, zoom: 19}, {packages: [mapPackage], readTile, isCurrent: () => true})).rejects.toThrow(/too large/)
    expect(readTile).not.toHaveBeenCalled()
  })
  it('rejects invalid bounds instead of silently clamping them', async () => {
    await expect(qualifyOfficialMapView({...input, bounds: {...input.bounds, west: NaN}}, {packages: [mapPackage], readTile: vi.fn(), isCurrent: () => true})).rejects.toThrow()
  })
})
