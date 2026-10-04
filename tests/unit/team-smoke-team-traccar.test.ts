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

  it('holds a buffered burst back until the phone uploads it late, with serverTime after fixTime [DON-305]', async () => {
    const { mock, advance, get } = await start()
    const walker = devicesOfKind('walk')[0]!
    const from = mock.t0 - 5 * HOUR
    const to = mock.t0 - HOUR
    const window = `deviceId=${walker.id}&from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`
    const everything = mock.fixesBetween(walker.id, from, to)
    const burst = mock.holdBack(walker.id, from + 30 * MINUTE, to - 30 * MINUTE)
    expect(burst.length).toBeGreaterThan(20)

    const before = (await get(`/api/positions?${window}`)).body as Fix[]
    expect(before.length).toBe(everything.length - burst.length)
    expect(before.some((fix) => burst.includes(fix.id))).toBe(false)
    expect(mock.fixesBetween(walker.id, from, to).length).toBe(before.length)

    advance(10 * MINUTE)
    const uploadedAt = mock.now()
    mock.releaseHeld()
    const after = (await get(`/api/positions?${window}`)).body as (Fix & { serverTime: string })[]
    expect(after.map((fix) => fix.id)).toEqual(everything.map((fix) => fix.id))
    const late = after.filter((fix) => burst.includes(fix.id))
    expect(late.every((fix) => Date.parse(fix.serverTime) === uploadedAt && Date.parse(fix.fixTime) < uploadedAt - HOUR)).toBe(true)
    for (const fix of after) expect(mock.fixFor(fix.id)).toEqual(fix)
  })
})

describe('one blank roster for a group (DON-300 item 8)', () => {
  type Device = { id: number, groupId: number }
  type Position = { deviceId: number }

  it('omits the group from exactly one device listing and its latest positions until the next listing', async () => {
    const { mock, get } = await start()
    const hasty = TEAM_DEVICES.filter((device) => device.groupId === 301).map((device) => device.id)
    const listed = async () => ((await get('/api/devices')).body as Device[]).map((device) => device.id)
    const latest = async () => ((await get('/api/positions')).body as Position[]).map((fix) => fix.deviceId)

    mock.blankGroupForOneRoster(301)
    expect(mock.rosterBlip()).toEqual({ blankListings: 0, fullListingsAfter: 0 })
    expect(await listed()).not.toEqual(expect.arrayContaining([hasty[0]]))
    expect(await latest()).not.toEqual(expect.arrayContaining([hasty[0]]))
    expect(mock.rosterBlip()).toEqual({ blankListings: 1, fullListingsAfter: 0 })

    expect(await listed()).toEqual(expect.arrayContaining(hasty))
    expect(await latest()).toEqual(expect.arrayContaining(hasty))
    await listed()
    expect(mock.rosterBlip()).toEqual({ blankListings: 1, fullListingsAfter: 2 })
  })
})

describe('a group created while the app runs (DON-330)', () => {
  type Group = { id: number, name: string }
  type Device = { id: number, name: string, groupId: number }

  it('can start with KMRT only and then serve a new group, its device, history and live fixes', async () => {
    let now = Date.parse('2026-10-04T12:00:00.000Z')
    const mock = await startTeamTraccar({ now: () => now, groupIds: [301] })
    mocks.push(mock)
    const get = async (path: string) => (await fetch(`${mock.url}${path}`)).json() as Promise<unknown>

    expect((await get('/api/groups') as Group[]).map((group) => group.name)).toEqual(['KMRT Hasty'])
    const before = await get('/api/devices') as Device[]
    expect(before.length).toBeGreaterThan(0)
    expect(before.every((device) => device.groupId === 301)).toBe(true)

    mock.addGroup({ id: 305, name: 'Miscellaneous' }, [{ id: 3051, name: 'Misc Alpha', lat: 51.93, lon: -9.7 }])

    expect((await get('/api/groups') as Group[]).map((group) => group.name)).toEqual(['KMRT Hasty', 'Miscellaneous'])
    const after = await get('/api/devices') as Device[]
    expect(after.filter((device) => device.groupId === 305)).toEqual([expect.objectContaining({ id: 3051, name: 'Misc Alpha' })])
    expect(after.length).toBe(before.length + 1)
    now += 60_000
    const fixes = await get(`/api/positions?deviceId=3051&from=${new Date(now - 10 * 60_000).toISOString()}`) as { id: number }[]
    expect(fixes.length).toBeGreaterThan(0)
    expect(fixes.every((fix) => mock.fixFor(fix.id) !== null)).toBe(true)
  })
})
