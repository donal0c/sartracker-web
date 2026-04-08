import { describe, expect, it } from 'vitest'

import { createManualChunk } from '../../build/vite-manual-chunks'

describe('vite manual chunk strategy', () => {
  it('keeps application files in their feature chunks', () => {
    expect(createManualChunk('/workspace/src/components/map-view.tsx')).toBeUndefined()
  })

  it('splits React runtime into a stable vendor chunk', () => {
    expect(createManualChunk('/workspace/node_modules/react/index.js')).toBe('react-vendor')
    expect(createManualChunk('/workspace/node_modules/react-dom/client.js')).toBe('react-vendor')
  })

  it('splits MapLibre into a dedicated map vendor chunk', () => {
    expect(createManualChunk('/workspace/node_modules/maplibre-gl/dist/maplibre-gl.js')).toBe(
      'map-vendor',
    )
  })

  it('splits proj4 into a dedicated geodesy vendor chunk', () => {
    expect(createManualChunk('/workspace/node_modules/proj4/dist/proj4.js')).toBe(
      'geodesy-vendor',
    )
  })
})
