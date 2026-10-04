// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import {
  distanceMetres, markerBehindFindings, readMarkerFixes, requireRoadSpeedFixes,
} from '../../scripts/team-smoke/lib/marker-fix.mjs'
import { NotTested } from '../../scripts/team-smoke/lib/results.mjs'
import { ROAD_DEVICE, startMockTraccar } from '../../scripts/team-smoke/lib/mock-traccar.mjs'

type Fix = { id: number, deviceId: number, latitude: number, longitude: number, fixTime: string }

const T0 = Date.parse('2026-10-04T12:00:00.000Z')
const names = { 1: 'Walker Alpha', 5: 'Road Echo' }
const marker = (device: number, index: number, atMs: number) => ({
  deviceId: String(device), sourcePositionId: String(device * 1_000_000 + index), timestamp: new Date(atMs).toISOString(),
})
const stored = (device: number, index: number, time: number, lat = 51.95, lon = -9.72) => ({
  sourcePositionId: device * 1_000_000 + index, lat, lon, time,
})

describe('marker-at-newest-fix findings [DON-328]', () => {
  it('passes when every marker is at, or within one poll of, its newest stored fix', () => {
    const fixes = [stored(1, 1, T0), stored(1, 2, T0 + 30_000), stored(5, 3, T0 + 30_000)]
    expect(markerBehindFindings([marker(1, 2, T0 + 30_000), marker(5, 3, T0 + 30_000)], fixes, { names })).toEqual([])
    expect(markerBehindFindings([marker(1, 1, T0)], [stored(1, 1, T0), stored(1, 4, T0 + 30_000)], { names })).toEqual([])
  })

  it('fails loudly when a marker trails the end of its trail by more than one poll', () => {
    const findings = markerBehindFindings([marker(1, 1, T0)], [stored(1, 1, T0), stored(1, 9, T0 + 31_000)], { names })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('Walker Alpha')
    expect(findings[0]).toContain('behind the end of its trail')
    expect(findings[0]).toContain('31 s ahead')
  })

  it('fails when a device with stored fixes has no marker at all', () => {
    const findings = markerBehindFindings([marker(1, 1, T0)], [stored(1, 1, T0), stored(5, 1, T0)], { names })
    expect(findings).toEqual([expect.stringContaining('Road Echo has recorded fixes')])
  })

  it('falls back to the device id when the marker source id does not carry the provider id', () => {
    const odd = { deviceId: '5', sourcePositionId: 'abc', timestamp: new Date(T0).toISOString() }
    expect(markerBehindFindings([odd], [stored(5, 1, T0)], { names })).toEqual([])
  })
})

describe('readMarkerFixes', () => {
  const win = (data: unknown) => ({ __SARTRACKER_MAP__: { getSource: () => ({ serialize: () => ({ data }) }) } })
  it('returns only device features, and null when the source cannot be read', () => {
    const features = [
      { properties: { featureKind: 'device', deviceId: '1', sourcePositionId: '1000002', timestamp: 'a' } },
      { properties: { featureKind: 'breadcrumb' } },
    ]
    expect(readMarkerFixes(win({ features }))).toEqual([{ deviceId: '1', sourcePositionId: '1000002', timestamp: 'a' }])
    expect(readMarkerFixes(win('https://example.invalid/data.json'))).toBeNull()
    expect(readMarkerFixes({})).toBeNull()
  })
})

describe('road-speed fixture [DON-328]', () => {
  const mocks: { close: () => Promise<void> }[] = []
  afterEach(async () => {
    for (const mock of mocks.splice(0)) await mock.close()
  })

  it('serves a road vehicle only when asked, with fixes at least 20 m apart', async () => {
    let now = T0
    const plain = await startMockTraccar({ now: () => now })
    const road = await startMockTraccar({ now: () => now, roadVehicle: true })
    mocks.push(plain, road)
    now += 60_000
    const ids = async (url: string) => ((await (await fetch(`${url}/api/devices`)).json()) as { id: number }[]).map((device) => device.id)
    expect(await ids(plain.url)).not.toContain(ROAD_DEVICE.id)
    expect(await ids(road.url)).toContain(ROAD_DEVICE.id)

    const fixes = (await (await fetch(`${road.url}/api/positions?deviceId=${ROAD_DEVICE.id}&from=2026-10-04T00:00:00Z&to=2026-10-05T00:00:00Z`)).json()) as Fix[]
    expect(fixes.length).toBe(7)
    for (let index = 1; index < fixes.length; index += 1) {
      const a = { lat: fixes[index - 1]!.latitude, lon: fixes[index - 1]!.longitude }
      const b = { lat: fixes[index]!.latitude, lon: fixes[index]!.longitude }
      expect(distanceMetres(a, b)).toBeGreaterThanOrEqual(20)
    }
    requireRoadSpeedFixes(fixes.map((fix) => ({ sourcePositionId: fix.id, lat: fix.latitude, lon: fix.longitude, time: Date.parse(fix.fixTime) })), ROAD_DEVICE.id)
  })

  it('treats too few or too close fixes as missing evidence, never a product result', () => {
    expect(() => requireRoadSpeedFixes([stored(5, 1, T0)], 5)).toThrow(NotTested)
    const crawling = [0, 1, 2, 3].map((index) => stored(5, index, T0 + index * 10_000, 51.95 + index * 0.00001))
    expect(() => requireRoadSpeedFixes(crawling, 5)).toThrow(/moved only/u)
  })
})
