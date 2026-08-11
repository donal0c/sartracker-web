import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  readCompactExactSoakMapEvidenceInRenderer,
} from '../../build/electron-tracking-soak-exact-renderer-proof-lib.js'

const originalBody = document.body.innerHTML

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = originalBody
  delete (window as unknown as { __SARTRACKER_MAP__?: unknown })
    .__SARTRACKER_MAP__
})

function installMap(exactFeatures: readonly unknown[]) {
  const sources = new Map([
    ['tracking-breadcrumb-dots-exact', {
      getData: async () => ({
        type: 'FeatureCollection',
        features: exactFeatures,
      }),
    }],
    ['tracking', {
      getData: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-9, 52] },
          properties: { featureKind: 'device' },
        }],
      }),
    }],
  ])
  ;(window as unknown as { __SARTRACKER_MAP__?: unknown }).__SARTRACKER_MAP__ = {
    getSource: (id: string) => sources.get(id),
  }
  document.body.innerHTML = `
    <p data-testid="exact-breadcrumb-dot-page-summary">
      Showing ${exactFeatures.length} exact fixes of 2 — 2026-08-10T00:00:00.000Z to 2026-08-10T00:00:05.000Z
    </p>
  `
}

function installBaselineBreadcrumbPoint() {
  const map = (window as unknown as {
    __SARTRACKER_MAP__: { getSource: (id: string) => unknown }
  }).__SARTRACKER_MAP__
  const exact = map.getSource('tracking-breadcrumb-dots-exact')
  ;(window as unknown as { __SARTRACKER_MAP__?: unknown }).__SARTRACKER_MAP__ = {
    getSource: (id: string) => id === 'tracking-breadcrumb-dots-exact'
      ? exact
      : {
          getData: async () => ({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-9, 52] },
              properties: { featureKind: 'breadcrumb' },
            }],
          }),
        },
  }
}

function exactFeature(input: {
  readonly sourcePositionId: string
  readonly deviceId: string
  readonly timestamp: string
  readonly lat: number
  readonly lon: number
}) {
  return {
    type: 'Feature',
    id: `${input.deviceId}:id:${input.sourcePositionId}`,
    geometry: { type: 'Point', coordinates: [input.lon, input.lat] },
    properties: {
      featureKind: 'breadcrumb',
      deviceId: input.deviceId,
      sourcePositionId: input.sourcePositionId,
      timestamp: input.timestamp,
    },
  }
}

describe('renderer-side exact source fingerprint [DON-260]', () => {
  it('returns only a bounded canonical digest/range without transferring rows or coordinates', async () => {
    const rows = [
      {
        sourcePositionId: '1001',
        deviceId: 'device-private-a',
        timestamp: '2026-08-10T00:00:00.000Z',
        lat: 52.123456,
        lon: -9.123456,
      },
      {
        sourcePositionId: '1002',
        deviceId: 'device-private-b',
        timestamp: '2026-08-10T00:00:05.000Z',
        lat: 52.123556,
        lon: -9.123556,
      },
    ]
    installMap(rows.map(exactFeature))
    const expectedSha256 = createHash('sha256')
      .update(rows.map((row) => `${JSON.stringify([
        row.sourcePositionId,
        row.deviceId,
        row.timestamp,
        row.lat,
        row.lon,
      ])}\n`).join(''))
      .digest('hex')

    const evidence = await readCompactExactSoakMapEvidenceInRenderer()

    expect(evidence).toMatchObject({
      source: {
        valid: true,
        positionCount: 2,
        sha256: expectedSha256,
        range: {
          positionCount: 2,
          fromTimestamp: rows[0]!.timestamp,
          toTimestamp: rows[1]!.timestamp,
          firstSourcePositionId: '1001',
          lastSourcePositionId: '1002',
        },
      },
      operator: {
        valid: true,
        pagePositionCount: 2,
        totalPositionCount: 2,
      },
      baselineBreadcrumbPointCount: 0,
      loading: false,
      unavailable: false,
    })
    expect(evidence.sampledAtEpochMs).toBeGreaterThan(0)
    expect(evidence.fingerprintDurationMs).toBeGreaterThanOrEqual(0)
    const serialized = JSON.stringify(evidence)
    expect(serialized.length).toBeLessThan(2_000)
    expect(serialized).not.toMatch(
      /device-private|52\.123|-9\.123|coordinates|features/iu,
    )
  })

  it('fails closed to bounded evidence for a conflicting literal feature identity', async () => {
    const feature = exactFeature({
      sourcePositionId: '1001',
      deviceId: 'device-private-a',
      timestamp: '2026-08-10T00:00:00.000Z',
      lat: 52.123456,
      lon: -9.123456,
    })
    installMap([{ ...feature, id: 'wrong-private-identity' }])

    const evidence = await readCompactExactSoakMapEvidenceInRenderer()

    expect(evidence.source).toMatchObject({ valid: false, sha256: null })
    expect(JSON.stringify(evidence)).not.toMatch(
      /wrong-private|device-private|52\.123|-9\.123/iu,
    )
  })

  it('changes the digest for every identity/time/coordinate/order mutation', async () => {
    const rows = [
      {
        sourcePositionId: '1001',
        deviceId: '1',
        timestamp: '2026-08-10T00:00:00.000Z',
        lat: 52.1,
        lon: -9.1,
      },
      {
        sourcePositionId: '1002',
        deviceId: '2',
        timestamp: '2026-08-10T00:00:05.000Z',
        lat: 52.2,
        lon: -9.2,
      },
    ]
    installMap(rows.map(exactFeature))
    const original = await readCompactExactSoakMapEvidenceInRenderer()
    const mutations = [
      [{ ...rows[0]!, sourcePositionId: '1003' }, rows[1]!],
      [{ ...rows[0]!, deviceId: '3' }, rows[1]!],
      [{ ...rows[0]!, timestamp: '2026-08-10T00:00:01.000Z' }, rows[1]!],
      [{ ...rows[0]!, lat: 52.100001 }, rows[1]!],
      [{ ...rows[0]!, lon: -9.100001 }, rows[1]!],
      [rows[1]!, rows[0]!],
    ]
    for (const mutation of mutations) {
      installMap(mutation.map(exactFeature))
      const changed = await readCompactExactSoakMapEvidenceInRenderer()
      expect(changed.source.valid).toBe(true)
      expect(changed.source.sha256).not.toBe(original.source.sha256)
    }
  })

  it('fails closed on invalid timestamps/coordinates and exposes baseline breadcrumb Points', async () => {
    const valid = {
      sourcePositionId: '1001',
      deviceId: 'device-private-a',
      timestamp: '2026-08-10T00:00:00.000Z',
      lat: 52.123456,
      lon: -9.123456,
    }
    for (const invalid of [
      { ...valid, timestamp: '2026-08-10 00:00:00' },
      { ...valid, lat: 91 },
      { ...valid, lon: Number.POSITIVE_INFINITY },
    ]) {
      installMap([exactFeature(invalid)])
      const evidence = await readCompactExactSoakMapEvidenceInRenderer()
      expect(evidence.source).toMatchObject({ valid: false, sha256: null })
      expect(JSON.stringify(evidence)).not.toMatch(
        /device-private|52\.123|-9\.123|Infinity/iu,
      )
    }

    installMap([exactFeature(valid)])
    installBaselineBreadcrumbPoint()
    const baseline = await readCompactExactSoakMapEvidenceInRenderer()
    expect(baseline.baselineBreadcrumbPointCount).toBe(1)
  })

  it('is a standalone proof canonicalizer with no production query or selector imports', () => {
    const source = readFileSync(
      'build/electron-tracking-soak-exact-renderer-proof-lib.js',
      'utf8',
    )
    expect(source).not.toMatch(
      /breadcrumb-dot-query|breadcrumb-query|mission-store|exact-breadcrumb-dot-controller/iu,
    )
  })

  it('survives the same body-only serialization boundary used by Playwright', async () => {
    installMap([exactFeature({
      sourcePositionId: '1001',
      deviceId: '1',
      timestamp: '2026-08-10T00:00:00.000Z',
      lat: 52.1,
      lon: -9.1,
    })])
    const serialized = Function(
      `return (${readCompactExactSoakMapEvidenceInRenderer.toString()})`,
    )() as () => Promise<{ source: { valid: boolean } }>

    await expect(serialized()).resolves.toMatchObject({
      source: { valid: true },
    })
  })

  it('timestamps exact-source resolution without waiting for a deferred baseline source', async () => {
    const feature = exactFeature({
      sourcePositionId: '1001',
      deviceId: '1',
      timestamp: '2026-08-10T00:00:00.000Z',
      lat: 52.1,
      lon: -9.1,
    })
    let now = 1_100
    let releaseBaseline!: () => void
    const baseline = new Promise((resolve) => {
      releaseBaseline = () => {
        now = 9_000
        resolve({ type: 'FeatureCollection', features: [] })
      }
    })
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    ;(window as unknown as { __SARTRACKER_MAP__?: unknown }).__SARTRACKER_MAP__ = {
      getSource: (id: string) => id === 'tracking-breadcrumb-dots-exact'
        ? {
            getData: async () => ({
              type: 'FeatureCollection',
              features: [feature],
            }),
          }
        : { getData: () => baseline },
    }
    document.body.innerHTML = `
      <p data-testid="exact-breadcrumb-dot-page-summary">
        Showing 1 exact fixes of 1 — 2026-08-10T00:00:00.000Z to 2026-08-10T00:00:00.000Z
      </p>
    `

    const pending = readCompactExactSoakMapEvidenceInRenderer()
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseBaseline()

    await expect(pending).resolves.toMatchObject({ sampledAtEpochMs: 1_100 })
  })
})
