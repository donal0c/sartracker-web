/**
 * GET-only mock Traccar shaped like a real team deployment, for the
 * team-mission scenario (1.2a).
 *
 * The earlier mocks serve two to four devices with default behaviour. Team
 * bugs appeared only with realistic state, so this mock serves about thirty
 * devices in flat Traccar groups plus ungrouped devices, with 60 hours of
 * provider history before the mock start T0:
 * - `walk`: a fix every 5 min before T0, then every 20 s live (moving);
 * - `still`: never moves; a 20 min heartbeat before and after T0 (stationary
 *   attention must flag it);
 * - `stale`: history stops 70 min before T0 and never resumes (stale >5 min);
 * - `history`: history stops 2 h before T0, no live fixes, so live polling
 *   cannot mask a missing initial backfill.
 * Every fix is a pure function of device and time, so the scenario can
 * recompute exactly what the provider holds and compare it with SQLite.
 * `setOffline(true)` answers 503 to every request (a full provider outage).
 * `holdBack(deviceId, from, to)` hides a device's fixes in a past window until
 * `releaseHeld()`, when they appear with serverTime at the release: a phone
 * that buffered its track without signal and uploads it late (DON-305).
 * Traccar filters positions by fixTime, so only a re-read finds them.
 */

import { createServer } from 'node:http'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const HISTORY_HOURS = 60
const HISTORY_STEP_MS = 5 * MINUTE
const WALK_LIVE_STEP_MS = 20_000
const HEARTBEAT_MS = 20 * MINUTE
const STALE_END_MS = 70 * MINUTE
const HISTORY_ONLY_END_MS = 2 * HOUR

/** Flat Traccar groups (teams). Nesting is an open question for the team. */
export const TEAM_GROUPS = Object.freeze([
  { id: 301, name: 'KMRT Hasty' },
  { id: 302, name: 'KMRT Search' },
  { id: 303, name: 'Visiting Team' },
  { id: 304, name: 'Unselected Team' },
])

/** @type {readonly {id: number, name: string, groupId: number, kind: 'walk' | 'still' | 'stale' | 'history', lat: number, lon: number}[]} */
export const TEAM_DEVICES = Object.freeze([
  ...team(301, 'Hasty', ['walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'still', 'stale'], 51.99, -9.74),
  ...team(302, 'Search', ['walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'still', 'history'], 51.975, -9.72),
  ...team(303, 'Visitor', ['walk', 'walk', 'walk', 'walk', 'history'], 51.96, -9.7),
  ...team(304, 'Other', ['walk', 'walk', 'walk', 'walk'], 51.95, -9.76),
  { id: 401, name: 'Dog Handler', groupId: 0, kind: 'walk', lat: 51.985, lon: -9.705 },
  { id: 402, name: 'Late Joiner', groupId: 0, kind: 'walk', lat: 51.97, lon: -9.745 },
  { id: 403, name: 'Drone Operator', groupId: 0, kind: 'history', lat: 51.965, lon: -9.735 },
].map((device) => Object.freeze(device)))

/** Builds one team's devices with ids groupId*10+n. */
function team(groupId, label, kinds, lat, lon) {
  const phonetic = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel']
  return kinds.map((kind, index) => ({
    id: groupId * 10 + index + 1,
    name: `${label} ${phonetic[index]}`,
    groupId,
    kind,
    lat: lat + index * 0.002,
    lon: lon + index * 0.003,
  }))
}

/**
 * Starts the mock on 127.0.0.1.
 *
 * @param {{now?: () => number}} [options] clock, injectable for tests
 */
export async function startTeamTraccar({ now = Date.now } = {}) {
  const t0 = Math.floor(now() / 1000) * 1000
  const historyStart = t0 - HISTORY_HOURS * HOUR
  let offline = false
  /** Held-back fixes by id; the value is the upload (server) time, or null while held. */
  const heldFixes = new Map()

  /** Fix times up to and including T0, per device kind. */
  const historyTimes = (device) => {
    const step = device.kind === 'still' ? HEARTBEAT_MS : HISTORY_STEP_MS
    const end = device.kind === 'stale' ? t0 - STALE_END_MS
      : device.kind === 'history' ? t0 - HISTORY_ONLY_END_MS : t0
    const times = []
    for (let time = t0; time >= historyStart; time -= step) if (time <= end) times.push(time)
    return times.reverse()
  }
  const historyByDevice = new Map(TEAM_DEVICES.map((device) => [device.id, historyTimes(device)]))
  const liveStep = (device) => device.kind === 'walk' ? WALK_LIVE_STEP_MS
    : device.kind === 'still' ? HEARTBEAT_MS : null

  /** Deterministic position: walkers loop within a few hundred metres, others stay put. */
  const positionAt = (device, time) => {
    if (device.kind !== 'walk') return { latitude: device.lat, longitude: device.lon }
    const minutes = (time - historyStart) / MINUTE
    const phase = device.id / 7
    return {
      latitude: +(device.lat + 0.003 * Math.sin(minutes / 30 + phase)).toFixed(7),
      longitude: +(device.lon + 0.004 * Math.cos(minutes / 40 + phase)).toFixed(7),
    }
  }
  const makeFix = (device, index, time) => {
    const iso = new Date(time).toISOString()
    const id = device.id * 1_000_000 + index
    const uploadedAt = heldFixes.get(id)
    return {
      id,
      deviceId: device.id,
      ...positionAt(device, time),
      altitude: 300, speed: device.kind === 'walk' ? 1.2 : 0, accuracy: 5,
      fixTime: iso, deviceTime: iso,
      serverTime: typeof uploadedAt === 'number' ? new Date(uploadedAt).toISOString() : iso,
      valid: true, protocol: 'osmand', attributes: { batteryLevel: 70 },
    }
  }
  /** Time of fix `index`, or null when that fix does not exist (yet). */
  const timeAt = (device, index) => {
    const history = historyByDevice.get(device.id)
    if (index < history.length) return history[index]
    const step = liveStep(device)
    if (step === null) return null
    const time = t0 + (index - history.length + 1) * step
    return time <= now() ? time : null
  }
  const deviceById = (id) => TEAM_DEVICES.find((device) => device.id === id)

  /** Every fix the provider holds for the device with fix time in [from, to]. */
  const fixesBetween = (deviceId, from, to) => {
    const device = deviceById(deviceId)
    if (device === undefined) return []
    const fixes = []
    for (let index = 0; ; index += 1) {
      const time = timeAt(device, index)
      if (time === null || time > to) break
      if (time >= from && heldFixes.get(device.id * 1_000_000 + index) !== null) fixes.push(makeFix(device, index, time))
    }
    return fixes
  }
  const latest = (device) => fixesBetween(device.id, historyStart, now()).at(-1)

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://mock')
    const json = (status, value) => {
      const body = JSON.stringify(value)
      response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      response.end(body)
    }
    if (request.method === 'POST' && url.pathname === '/api/session') {
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'JSESSIONID=smoke; Path=/' })
      response.end('{}')
      return
    }
    if (request.method !== 'GET') return json(405, { error: 'GET only' })
    if (offline) return json(503, { error: 'synthetic outage' })
    if (url.pathname === '/api/server') return json(200, { version: '6.0-mock' })
    if (url.pathname === '/api/groups') {
      return json(200, TEAM_GROUPS.map((group) => ({ id: group.id, name: group.name, groupId: 0 })))
    }
    if (url.pathname === '/api/devices') {
      return json(200, TEAM_DEVICES.map((device) => {
        const fix = latest(device)
        return {
          id: device.id, name: device.name, uniqueId: `team-${device.id}`,
          status: device.kind === 'walk' || device.kind === 'still' ? 'online' : 'offline',
          lastUpdate: fix.fixTime, positionId: fix.id,
          disabled: false, groupId: device.groupId, category: 'person', attributes: {},
        }
      }))
    }
    if (url.pathname === '/api/positions') {
      const deviceId = url.searchParams.get('deviceId')
      if (deviceId === null) return json(200, TEAM_DEVICES.map(latest))
      const from = Date.parse(url.searchParams.get('from') ?? '1970-01-01T00:00:00Z')
      const to = Date.parse(url.searchParams.get('to') ?? new Date(now()).toISOString())
      return json(200, fixesBetween(Number(deviceId), from, Math.min(to, now())))
    }
    json(404, { error: 'not found' })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('Team mock did not bind a port.')

  return {
    url: `http://127.0.0.1:${address.port}`,
    t0,
    now,
    fixesBetween,
    /** Recomputes the fix the provider served for a stored source position id. */
    fixFor(sourcePositionId) {
      const device = deviceById(Math.floor(sourcePositionId / 1_000_000))
      if (device === undefined) return null
      const index = sourcePositionId % 1_000_000
      const time = timeAt(device, index)
      return time === null ? null : makeFix(device, index, time)
    },
    setOffline(value) {
      offline = value
    },
    /**
     * Hides a device's existing fixes with fix time in [from, to] until
     * `releaseHeld()`. Returns the held source position ids.
     */
    holdBack(deviceId, from, to) {
      const held = fixesBetween(deviceId, from, to).map((fix) => fix.id)
      for (const id of held) heldFixes.set(id, null)
      return held
    },
    /** Uploads every held fix now: it becomes visible with serverTime = now. */
    releaseHeld() {
      const uploadedAt = now()
      for (const [id, value] of heldFixes) if (value === null) heldFixes.set(id, uploadedAt)
      return uploadedAt
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
