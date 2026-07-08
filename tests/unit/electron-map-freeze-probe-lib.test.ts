import { describe, expect, it } from 'vitest'

import {
  buildFreezeVerdict,
  generateSerpentinePanPath,
  parseFreezeProbeArgs,
  summarizeResponsiveness,
} from '../../build/electron-map-freeze-probe-lib.js'

describe('generateSerpentinePanPath [DON-240]', () => {
  const bounds = [-10.18, 51.73, -9.33, 52.27] as const

  it('produces rows*cols waypoints all inside the inset bounds', () => {
    const path = generateSerpentinePanPath(bounds, { rows: 4, cols: 5, insetRatio: 0.1 })
    expect(path).toHaveLength(20)
    const insetX = (bounds[2] - bounds[0]) * 0.1
    const insetY = (bounds[3] - bounds[1]) * 0.1
    for (const { center } of path) {
      const [lon, lat] = center
      expect(lon).toBeGreaterThanOrEqual(bounds[0] + insetX - 1e-9)
      expect(lon).toBeLessThanOrEqual(bounds[2] - insetX + 1e-9)
      expect(lat).toBeGreaterThanOrEqual(bounds[1] + insetY - 1e-9)
      expect(lat).toBeLessThanOrEqual(bounds[3] - insetY + 1e-9)
    }
  })

  it('sweeps serpentine so consecutive rows reverse direction (no long jump back)', () => {
    const path = generateSerpentinePanPath(bounds, { rows: 2, cols: 3 })
    // Row 0 goes west->east, row 1 goes east->west, so the last of row 0 and first of row 1
    // share the same longitude (a continuous sweep, not a jump across the whole package).
    expect(path[2].center[0]).toBeCloseTo(path[3].center[0], 9)
  })

  it('cycles the provided zoom levels across waypoints', () => {
    const path = generateSerpentinePanPath(bounds, { rows: 1, cols: 4, zooms: [14, 16] })
    expect(path.map((point) => point.zoom)).toEqual([14, 16, 14, 16])
  })

  it('rejects malformed bounds', () => {
    expect(() => generateSerpentinePanPath([0, 0, 0] as never)).toThrow()
    expect(() => generateSerpentinePanPath([0, 0, Number.NaN, 1] as never)).toThrow()
  })
})

describe('summarizeResponsiveness [DON-240]', () => {
  it('computes distribution stats and threshold breaches', () => {
    const stats = summarizeResponsiveness([10, 20, 30, 40, 50, 2000], 250)
    expect(stats.count).toBe(6)
    expect(stats.maxMs).toBe(2000)
    expect(stats.overThresholdCount).toBe(1)
    expect(stats.p50Ms).toBeGreaterThan(0)
    expect(stats.p99Ms).toBe(2000)
  })

  it('ignores non-finite and negative samples', () => {
    const stats = summarizeResponsiveness([Number.NaN, -5, 'x', 100, undefined], 250)
    expect(stats.count).toBe(1)
    expect(stats.maxMs).toBe(100)
  })

  it('returns zeroed stats for an empty series', () => {
    const stats = summarizeResponsiveness([], 250)
    expect(stats.count).toBe(0)
    expect(stats.maxMs).toBe(0)
  })
})

describe('buildFreezeVerdict [DON-240]', () => {
  it('flags a freeze and attributes it to the main process when main stalled worst', () => {
    const verdict = buildFreezeVerdict({
      mainStats: summarizeResponsiveness([50, 3200]),
      rendererStats: summarizeResponsiveness([16, 40]),
      freezeThresholdMs: 1000,
    })
    expect(verdict.frozen).toBe(true)
    expect(verdict.offender).toBe('main')
    expect(verdict.worstStallMs).toBe(3200)
  })

  it('attributes a freeze to the renderer when the renderer stalled worst', () => {
    const verdict = buildFreezeVerdict({
      mainStats: summarizeResponsiveness([50, 120]),
      rendererStats: summarizeResponsiveness([16, 1800]),
    })
    expect(verdict.frozen).toBe(true)
    expect(verdict.offender).toBe('renderer')
  })

  it('reports no freeze when both threads stayed responsive', () => {
    const verdict = buildFreezeVerdict({
      mainStats: summarizeResponsiveness([50, 90]),
      rendererStats: summarizeResponsiveness([16, 40]),
    })
    expect(verdict.frozen).toBe(false)
    expect(verdict.offender).toBe('none')
  })
})

describe('parseFreezeProbeArgs [DON-240]', () => {
  it('parses required and optional arguments with defaults', () => {
    const args = parseFreezeProbeArgs([
      '--app',
      '/opt/sartracker/sartracker',
      '--package',
      '/maps/reeks.mbtiles',
      '--rows',
      '8',
      '--cols',
      '8',
    ])
    expect(args.appPath).toBe('/opt/sartracker/sartracker')
    expect(args.packagePath).toBe('/maps/reeks.mbtiles')
    expect(args.rows).toBe(8)
    expect(args.blockNetwork).toBe(true)
    expect(args.probeIntervalMs).toBe(50)
  })

  it('supports --allow-network and pass-through extra args after --', () => {
    const args = parseFreezeProbeArgs([
      '--app',
      '/a',
      '--package',
      '/p',
      '--allow-network',
      '--',
      '--no-sandbox',
      '--ozone-platform=x11',
    ])
    expect(args.blockNetwork).toBe(false)
    expect(args.extraArgs).toEqual(['--no-sandbox', '--ozone-platform=x11'])
  })

  it('throws when required arguments are missing', () => {
    expect(() => parseFreezeProbeArgs(['--package', '/p'])).toThrow('--app')
    expect(() => parseFreezeProbeArgs(['--app', '/a'])).toThrow('--package')
  })
})
