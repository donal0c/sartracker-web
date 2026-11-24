/**
 * DON-368, rule 12: the casualty marker must stand out clearly from place labels
 * and other markers on both light and dark maps.
 */
import { describe, expect, it } from 'vitest'

import { getMarkerImageSvg, markerLabelOffset } from '../../src/features/markers/sync-marker-overlay'

function svgSize(svg: string): number {
  const match = /width="(\d+)"/.exec(svg)
  if (match === null) throw new Error('SVG has no width')
  return Number(match[1])
}

describe('casualty marker prominence [DON-368]', () => {
  it('is at least half as large again as every other marker', () => {
    const casualty = svgSize(getMarkerImageSvg('casualty'))
    for (const type of ['ipp_lkp', 'clue', 'hazard'] as const) {
      expect(casualty).toBeGreaterThanOrEqual(svgSize(getMarkerImageSvg(type)) * 1.5)
    }
  })

  it('sits on a white disc with a dark ring, so it reads on light and dark maps', () => {
    const svg = getMarkerImageSvg('casualty')
    expect(svg).toMatch(/<circle[^>]*fill="#FFFFFF"[^>]*stroke="#111827"/)
    expect(svg).toMatch(/fill="#FF0000"/)
  })

  it('puts its label below the larger symbol, not over it', () => {
    expect(markerLabelOffset('casualty')[1]).toBeGreaterThan(markerLabelOffset('hazard')[1])
    expect(markerLabelOffset('hazard')).toEqual([0, 1.1])
  })
})
