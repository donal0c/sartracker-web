import maplibregl from 'maplibre-gl'
import * as turf from '@turf/turf'
import proj4 from 'proj4'
import { create } from 'zustand'
import { TerraDraw } from 'terra-draw'

/**
 * Returns dependency metadata so smoke tests can prove the core packages resolve.
 */
export function getDependencySmoke() {
  const store = create<{ ready: boolean }>(() => ({ ready: true }))

  return {
    hasMapLibre: typeof maplibregl.Map === 'function',
    hasProj4: typeof proj4 === 'function',
    hasTurf: typeof turf.distance === 'function',
    hasZustand: store.getState().ready,
    hasTerraDraw: typeof TerraDraw === 'function',
  }
}
