// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { RELEASE_CHECKS } from '../../build/release-checklist.js'
import { createFixturePlan, fieldShapeFix } from '../../build/seed-mission-store-lib.js'
import teamReports from '../../scripts/team-smoke/checks/team-reports.mjs'
import { NotTested, ProductFailure } from '../../scripts/team-smoke/lib/results.mjs'
import {
  mergeDrawn,
  parseDotSummary,
  readRenderedTrails,
  routeBounds,
  trailGapFindings,
  verifyWholeTrailDrawn,
  WHOLE_TRAIL_UI,
} from '../../scripts/team-smoke/lib/whole-trail.mjs'

/**
 * DON-338 / SAR-FIELD-002: in Breadcrumb dots mode a 10,000+ fix trail split,
 * because the line was removed and only the newest dot page was drawn. The
 * packaged team-smoke phases don-338-whole-trail and don-338-many-devices read
 * what the map draws and compare it with every stored fix. These tests pin the
 * comparison and the bounded waits, since the phase itself needs a packaged app.
 */

type Fix = { deviceId: string, lat: number, lon: number, time: number }
type Drawn = Record<string, { lines: number[][][], points: number[][] }>

const plan = createFixturePlan('field-trail-25k')
const stored: Fix[] = Array.from({ length: plan.fieldDevices[0].fixCount }, (_, index) => {
  const fix = fieldShapeFix(plan, 0, index)
  return { deviceId: fix.deviceId, lat: fix.lat, lon: fix.lon, time: Date.parse(fix.timestamp) }
})
const deviceId = stored[0].deviceId
const byTime = [...stored].sort((a, b) => a.time - b.time)
const wholeLine: Drawn = { [deviceId]: { lines: [byTime.map((fix) => [fix.lon, fix.lat])], points: [] } }
/** What the defect drew: no line, only the newest 10,000 dots. */
const newestPageOnly: Drawn = { [deviceId]: { lines: [], points: byTime.slice(-10_000).map((fix) => [fix.lon, fix.lat]) } }

/** A fake map exposing just what readRenderedTrails uses. */
function fakeMap(options: { layers: { id: string, type: string, hidden?: boolean }[], features: unknown[], loaded?: boolean }) {
  return {
    getStyle: () => ({ layers: options.layers }),
    getLayoutProperty: (id: string) => (options.layers.find((layer) => layer.id === id)?.hidden ? 'none' : 'visible'),
    queryRenderedFeatures: ({ layers }: { layers: string[] }) =>
      (options.features as { layer: string }[]).filter((feature) => layers.includes(feature.layer)),
    getCenter: () => ({ lat: 53.1 }),
    getZoom: () => 12,
    loaded: () => options.loaded ?? true,
    fitBounds: () => undefined,
  }
}

/** A fake Playwright page that runs page functions against a fake window. */
function fakePage(win: unknown) {
  return { evaluate: async (fn: (arg: unknown, win: unknown) => unknown, arg: unknown) => fn(arg, win) }
}

const patterns = { trailLayerPattern: WHOLE_TRAIL_UI.trailLayerPattern, coverageLayerPattern: WHOLE_TRAIL_UI.coverageLayerPattern }

describe('team-smoke whole-trail check [DON-338]', () => {
  it('reads the dots status in the current and the fixed wording', () => {
    expect(parseDotSummary('Exact fix inspection — showing 10,000 of 25,000 — 06:00 to 18:30')).toEqual({ shown: 10_000, total: 25_000 })
    expect(parseDotSummary('Dots show 10,000 of 25,000 exact fixes')).toEqual({ shown: 10_000, total: 25_000 })
    expect(parseDotSummary('Loading exact fixes')).toBeNull()
  })

  it('finds nothing missing when the whole route is drawn as one line, across the gap and the late block', () => {
    expect(trailGapFindings(wholeLine, stored, { layer: 'drawn trail' })).toEqual([])
  })

  it('reports the missing stretch when only the newest dot page is drawn, as in the field report', () => {
    const findings = trailGapFindings(newestPageOnly, stored, { names: { [deviceId]: 'Synthetic walker' }, layer: 'drawn trail' })
    expect(findings).toHaveLength(1)
    expect(findings[0].missing).toBeGreaterThanOrEqual(14_000)
    expect(findings[0].finding).toMatch(/^Synthetic walker: [\d,]+ of 25,000 stored fixes are not on the drawn trail \(/u)
    expect(findings[0].finding).toMatch(/from 06:00:03 to/u)
  })

  it('reports a device that is not drawn at all', () => {
    const findings = trailGapFindings({}, stored.slice(0, 100), { layer: 'drawn trail' })
    expect(findings[0].finding).toContain(`device ${deviceId}: 100 of 100`)
  })

  it('combines the live trail with the whole-history line', () => {
    const older = byTime.slice(0, 20_000).map((fix) => [fix.lon, fix.lat])
    const newer = byTime.slice(19_999).map((fix) => [fix.lon, fix.lat])
    const merged = mergeDrawn({ [deviceId]: { lines: [newer], points: [] } }, { [deviceId]: { lines: [older], points: [] } })
    expect(trailGapFindings(merged, stored, { layer: 'drawn trail' })).toEqual([])
  })

  it('reads only visible trail and coverage layers and skips device markers', () => {
    const map = fakeMap({
      layers: [
        { id: 'tracking-breadcrumbs-line', type: 'line' },
        { id: 'tracking-breadcrumbs-dots', type: 'circle', hidden: true },
        { id: 'tracking-devices-symbol', type: 'symbol' },
        { id: 'coverage-unassigned-1-line', type: 'line' },
        { id: 'basemap-roads', type: 'line' },
      ],
      features: [
        { layer: 'tracking-breadcrumbs-line', properties: { deviceId: '7001', featureKind: 'breadcrumbLine' }, geometry: { type: 'LineString', coordinates: [[-6.4, 53], [-6.39, 53.01]] } },
        { layer: 'tracking-breadcrumbs-line', properties: { deviceId: '7001', featureKind: 'device' }, geometry: { type: 'Point', coordinates: [-6.39, 53.01] } },
        { layer: 'tracking-breadcrumbs-dots', properties: { deviceId: '7001' }, geometry: { type: 'Point', coordinates: [-6.38, 53.02] } },
        { layer: 'coverage-unassigned-1-line', properties: { device_id: 7001 }, geometry: { type: 'MultiLineString', coordinates: [[[-6.4, 53], [-6.41, 52.99]]] } },
        { layer: 'basemap-roads', properties: { deviceId: '7001' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      ],
    })
    const read = readRenderedTrails(patterns, { __SARTRACKER_MAP__: map })
    expect(read?.trailLayers).toEqual(['tracking-breadcrumbs-line'])
    expect(read?.coverageLayers).toEqual(['coverage-unassigned-1-line'])
    expect(read?.trail['7001']).toEqual({ lines: [[[-6.4, 53], [-6.39, 53.01]]], points: [] })
    expect(read?.coverage['7001'].lines).toHaveLength(1)
    expect(readRenderedTrails(patterns, {})).toBeNull()
  })

  it('fails the check, naming the missing stretch, when the dots page hides the rest of the trail', async () => {
    const features = byTime.slice(-10_000).map((fix) => ({
      layer: 'tracking-breadcrumbs-dots', properties: { deviceId }, geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] },
    }))
    const page = fakePage({ __SARTRACKER_MAP__: fakeMap({ layers: [{ id: 'tracking-breadcrumbs-dots', type: 'circle' }], features }) })
    const result = verifyWholeTrailDrawn(page, stored, { step: 'Breadcrumb dots', settleTimeoutMs: 0, intervalMs: 1 })
    await expect(result).rejects.toBeInstanceOf(ProductFailure)
    await expect(result).rejects.toThrow(/^Breadcrumb dots: device 7001: [\d,]+ of 25,000 stored fixes are not on the drawn trail.*\[DON-338\]$/u)
  })

  it('passes when the whole line is drawn under the dots', async () => {
    const features = [
      { layer: 'tracking-breadcrumbs-line', properties: { deviceId }, geometry: { type: 'LineString', coordinates: wholeLine[deviceId].lines[0] } },
      ...byTime.slice(-10).map((fix) => ({ layer: 'tracking-breadcrumbs-dots', properties: { deviceId }, geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] } })),
    ]
    const page = fakePage({ __SARTRACKER_MAP__: fakeMap({
      layers: [{ id: 'tracking-breadcrumbs-line', type: 'line' }, { id: 'tracking-breadcrumbs-dots', type: 'circle' }], features,
    }) })
    await expect(verifyWholeTrailDrawn(page, stored, { step: 'Breadcrumb dots', settleTimeoutMs: 0 }))
      .resolves.toEqual({ devices: 1, fixes: 25_000, layers: ['tracking-breadcrumbs-line', 'tracking-breadcrumbs-dots'] })
  })

  it('is NOT TESTED, not a FAIL, when nothing is drawn on the control step', async () => {
    const page = fakePage({ __SARTRACKER_MAP__: fakeMap({ layers: [], features: [] }) })
    await expect(verifyWholeTrailDrawn(page, stored, { step: 'Solid line', settleTimeoutMs: 0, nothingDrawnIsNotTested: true }))
      .rejects.toBeInstanceOf(NotTested)
  })

  it('is NOT TESTED when there is no map handle', async () => {
    await expect(verifyWholeTrailDrawn(fakePage({}), stored, { step: 'Solid line', settleTimeoutMs: 0 }))
      .rejects.toThrow(/no map handle/u)
  })

  it('gives up quickly, NOT TESTED, when the page never answers', async () => {
    const hung = { evaluate: () => new Promise(() => undefined) }
    const startedAt = Date.now()
    await expect(verifyWholeTrailDrawn(hung, stored, { step: 'Breadcrumb dots', readTimeoutMs: 50 }))
      .rejects.toThrow(/did not answer within 0.05 s/u)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it('stops waiting for the map to settle and still reports what was drawn', async () => {
    const page = fakePage({ __SARTRACKER_MAP__: fakeMap({ layers: [{ id: 'tracking-breadcrumbs-dots', type: 'circle' }], features: [], loaded: false }) })
    await expect(verifyWholeTrailDrawn(page, stored.slice(0, 10), { step: 'Breadcrumb dots', settleTimeoutMs: 30, intervalMs: 5 }))
      .rejects.toThrow(/had not settled after 0 s/u)
  })

  it('refuses an empty seed as NOT TESTED', () => {
    expect(() => routeBounds([])).toThrow(NotTested)
  })

  it('registers both phases under a real checklist row with distinct ids', () => {
    const names = new Set(RELEASE_CHECKS.map((check: { name: string }) => check.name))
    const phases = teamReports.filter((check: { id: string }) => check.id.startsWith('don-338-'))
    expect(phases.map((check: { id: string }) => check.id)).toEqual(['don-338-whole-trail', 'don-338-many-devices'])
    for (const phase of phases) expect(names.has(phase.check)).toBe(true)
  })
})
