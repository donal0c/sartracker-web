// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { TEAM_DEVICES, TEAM_GROUPS, startTeamTraccar } from '../../scripts/team-smoke/lib/team-traccar.mjs'

type Fix = { id: number, deviceId: number, latitude: number, longitude: number, fixTime: string }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const mocks: { close: () => Promise<void> }[] = []

afterEach(async () => {
  for (const mock of mocks.splice(0)) await mock.close()
})

/** Starts the mock with a controllable clock. */
async function start(offsetMs = 0) {
  let now = Date.parse('2026-09-29T12:00:00.000Z')
  const mock = await startTeamTraccar({ now: () => now })
  mocks.push(mock)
  now += offsetMs
  return {
    mock,
    advance: (ms: number) => { now += ms },
    get: async (path: string) => {
      const response = await fetch(`${mock.url}${path}`)
      return { status: response.status, body: await response.json() as unknown }
    },
  }
}

const devicesOfKind = (kind: string) => TEAM_DEVICES.filter((device) => device.kind === kind)

describe('team-mission mock Traccar (1.2a)', () => {
  it('models the team envelope: about 30 devices across flat groups plus ungrouped devices', () => {
    expect(TEAM_DEVICES.length).toBeGreaterThanOrEqual(25)
    expect(new Set(TEAM_DEVICES.map((device) => device.id)).size).toBe(TEAM_DEVICES.length)
    for (const kind of ['walk', 'still', 'stale', 'history']) expect(devicesOfKind(kind).length).toBeGreaterThan(0)
    expect(TEAM_GROUPS.length).toBeGreaterThanOrEqual(3)
    expect(TEAM_DEVICES.some((device) => device.groupId === 0)).toBe(true)
  })

  it('serves groups and devices with their group membership over GET', async () => {
    const { get } = await start()
    const groups = await get('/api/groups')
    const devices = await get('/api/devices')
    expect(groups.body).toEqual(TEAM_GROUPS.map((group) => expect.objectContaining({ id: group.id, name: group.name })))
    expect((devices.body as { id: number, groupId: number }[]).map((device) => [device.id, device.groupId]))
      .toEqual(TEAM_DEVICES.map((device) => [device.id, device.groupId]))
  })

  it('answers a history window exactly as the oracle computes it', async () => {
    const { mock, advance, get } = await start()
    advance(3 * MINUTE)
    const walker = devicesOfKind('walk')[0]!
    const from = mock.t0 - 49 * HOUR
    const to = mock.t0 + 2 * MINUTE
    const served = (await get(`/api/positions?deviceId=${walker.id}&from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`)).body as Fix[]
    expect(served).toEqual(mock.fixesBetween(walker.id, from, to))
    expect(served.length).toBeGreaterThan(500)
    for (const fix of served) expect(mock.fixFor(fix.id)).toEqual(fix)
  })

  it('keeps stationary devices still with a 20-minute heartbeat, and stale devices silent', async () => {
    const { mock, advance } = await start()
    advance(45 * MINUTE)
    const still = devicesOfKind('still')[0]!
    const recent = mock.fixesBetween(still.id, mock.t0 - 2 * HOUR, mock.now())
    expect(new Set(recent.map((fix) => `${fix.latitude},${fix.longitude}`)).size).toBe(1)
    const gaps = recent.slice(1).map((fix, index) => Date.parse(fix.fixTime) - Date.parse(recent[index]!.fixTime))
    expect(new Set(gaps)).toEqual(new Set([20 * MINUTE]))
    const stale = devicesOfKind('stale')[0]!
    const last = mock.fixesBetween(stale.id, mock.t0 - 60 * HOUR, mock.now()).at(-1)!
    expect(mock.now() - Date.parse(last.fixTime)).toBeGreaterThan(60 * MINUTE)
    const history = devicesOfKind('history')[0]!
    expect(mock.fixesBetween(history.id, mock.t0 - 2 * HOUR + 1, mock.now())).toEqual([])
  })

  it('moves walkers live after start and serves their latest fix in the current-positions list', async () => {
    const { mock, advance, get } = await start()
    const walker = devicesOfKind('walk')[0]!
    advance(2 * MINUTE)
    const live = mock.fixesBetween(walker.id, mock.t0 + 1, mock.now())
    expect(live.length).toBe(6)
    const current = (await get('/api/positions')).body as Fix[]
    expect(current.find((fix) => fix.deviceId === walker.id)).toEqual(live.at(-1))
  })

  it('returns 503 to every request during an outage', async () => {
    const { mock, get } = await start()
    mock.setOffline(true)
    expect((await get('/api/devices')).status).toBe(503)
    expect((await get('/api/positions')).status).toBe(503)
    mock.setOffline(false)
    expect((await get('/api/devices')).status).toBe(200)
  })
})

describe('team-mission fix verification (1.2a)', () => {
  it('accepts an exact per-device copy and rejects leaks, gaps, early fixes and wrong coordinates', async () => {
    const { verifyTeamFixes } = await import('../../scripts/team-smoke/checks/team-mission.mjs')
    const { mock, advance } = await start()
    advance(10 * MINUTE)
    const walker = devicesOfKind('walk')[0]!
    const late = devicesOfKind('walk')[1]!
    const unselected = devicesOfKind('walk')[2]!
    const missionStart = mock.t0 - 48 * HOUR
    const lateFrom = mock.t0 + 2 * MINUTE
    const until = mock.now()
    const stored = (id: number, from: number) => mock.fixesBetween(id, from, until)
      .map((fix: Fix) => ({ sourcePositionId: fix.id, lat: fix.latitude, lon: fix.longitude, time: Date.parse(fix.fixTime) }))
    const exact = [...stored(walker.id, missionStart), ...stored(late.id, lateFrom)]
    const options = { starts: { [walker.id]: missionStart, [late.id]: lateFrom }, excluded: [unselected.id], until, tailToleranceMs: 0 }

    expect(verifyTeamFixes(mock, exact, options)[walker.id]).toMatchObject({ stored: expect.any(Number) })
    expect(() => verifyTeamFixes(mock, [...exact, ...stored(unselected.id, missionStart)], options)).toThrow(/never selected/)
    expect(() => verifyTeamFixes(mock, exact.slice(1), options)).toThrow(/missing/)
    expect(() => verifyTeamFixes(mock, [...stored(late.id, lateFrom - 5 * MINUTE), ...stored(walker.id, missionStart)], options)).toThrow(/predate/)
    expect(() => verifyTeamFixes(mock, [{ ...exact[0]!, lat: exact[0]!.lat + 0.001 }, ...exact.slice(1)], options)).toThrow(/differ/)
  })
})
