/**
 * Real-time mock Traccar provider for the team smoke (GET-only API).
 *
 * Fixes are generated every 10 s from the mock's start time, so a mission
 * started after the mock accepts them as current. (The older
 * tools/mock-traccar replay server emits historical times, which a fresh
 * mission rejects; do not use it for these checks.) Every fix is a pure
 * function of device and index, so a check can recompute exactly what the
 * provider served and compare it with SQLite.
 */

import { createServer } from 'node:http'

const STEP_MS = 10_000

/** Devices served by the mock. `stale` has one fix an hour old. */
export const MOCK_DEVICES = Object.freeze([
  { id: 1, name: 'Walker Alpha', mode: 'walk', lat: 51.97, lon: -9.7, dLat: 0.00008, dLon: 0.00011 },
  { id: 2, name: 'Walker Bravo', mode: 'walk', lat: 51.965, lon: -9.69, dLat: 0.0001, dLon: -0.00006 },
  { id: 3, name: 'Stationary Charlie', mode: 'still', lat: 51.975, lon: -9.705 },
  { id: 4, name: 'Stale Delta', mode: 'stale', lat: 51.96, lon: -9.71 },
])

/**
 * A vehicle on a road, served only when `roadVehicle` is set: every fix is
 * about 50 m from the last (5 m/s every 10 s), well above the 20 m a breadcrumb
 * trail needs to treat consecutive fixes as separate points [DON-328].
 */
export const ROAD_DEVICE = Object.freeze({ id: 5, name: 'Road Echo', mode: 'walk', lat: 51.95, lon: -9.72, dLat: 0.0004, dLon: 0.0003 })

/**
 * Starts the mock on 127.0.0.1.
 *
 * `holdDevice` models one phone losing signal: that device serves nothing
 * newer while the others stay live; `releaseDevice` uploads the held stretch
 * with its original fix times, as a phone does when signal returns [DON-316].
 *
 * @param {{port?: number, now?: () => number, roadVehicle?: boolean}} [options]
 * @returns {Promise<{url: string, startMs: number, fixFor: (sourcePositionId: number) => {deviceId: number, latitude: number, longitude: number, fixTime: string} | null, latestIndex: () => number, latestIndexFor: (deviceId: number) => number, holdDevice: (deviceId: number) => void, releaseDevice: (deviceId: number) => void, setOffline: (offline: boolean) => void, close: () => Promise<void>}>}
 */
export async function startMockTraccar({ port = 0, now = Date.now, roadVehicle = false } = {}) {
  const devices = roadVehicle ? [...MOCK_DEVICES, ROAD_DEVICE] : MOCK_DEVICES
  const startMs = now()
  let offline = false
  /** Device id → last index served while its phone has no signal. */
  const held = new Map()

  const fixAt = (device, index) => {
    const time = device.mode === 'stale' ? startMs - 3_600_000 : startMs + index * STEP_MS
    const wiggle = Math.sin(index / 5) * 0.00005
    const walking = device.mode === 'walk'
    const iso = new Date(time).toISOString()
    return {
      id: device.id * 1_000_000 + index,
      deviceId: device.id,
      latitude: +(walking ? device.lat + index * device.dLat + wiggle : device.lat).toFixed(7),
      longitude: +(walking ? device.lon + index * device.dLon - wiggle : device.lon).toFixed(7),
      altitude: 200,
      speed: walking ? 1.4 : 0,
      accuracy: 5,
      fixTime: iso,
      deviceTime: iso,
      serverTime: iso,
      valid: true,
      protocol: 'osmand',
      attributes: { batteryLevel: 80 },
    }
  }
  const latestIndex = () => Math.floor((now() - startMs) / STEP_MS)
  const servedIndex = (device) => (device.mode === 'stale' ? 0 : held.get(device.id) ?? latestIndex())
  const latestFor = (device) => fixAt(device, servedIndex(device))

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
    if (url.pathname === '/api/groups') return json(200, [{ id: 101, name: 'Mock Team', groupId: 0 }])
    if (url.pathname === '/api/devices') {
      return json(200, devices.map((device) => ({
        id: device.id,
        name: device.name,
        uniqueId: `mock-${device.id}`,
        status: device.mode === 'stale' ? 'offline' : 'online',
        lastUpdate: latestFor(device).fixTime,
        positionId: latestFor(device).id,
        disabled: false,
        groupId: 101,
        category: 'person',
        attributes: {},
      })))
    }
    if (url.pathname === '/api/positions') {
      const deviceId = url.searchParams.get('deviceId')
      if (deviceId === null) return json(200, devices.map(latestFor))
      const device = devices.find((candidate) => candidate.id === Number(deviceId))
      if (device === undefined) return json(200, [])
      const from = Date.parse(url.searchParams.get('from') ?? '1970-01-01T00:00:00Z')
      const to = Date.parse(url.searchParams.get('to') ?? new Date(now()).toISOString())
      const last = servedIndex(device)
      const fixes = []
      for (let index = 0; index <= last; index += 1) {
        const fix = fixAt(device, index)
        const time = Date.parse(fix.fixTime)
        if (time >= from && time <= to) fixes.push(fix)
      }
      return json(200, fixes)
    }
    json(404, { error: 'not found' })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('Mock Traccar did not bind a port.')

  return {
    url: `http://127.0.0.1:${address.port}`,
    startMs,
    latestIndex,
    latestIndexFor(deviceId) {
      const device = devices.find((candidate) => candidate.id === deviceId)
      if (device === undefined) throw new Error(`Mock device ${deviceId} does not exist.`)
      return servedIndex(device)
    },
    holdDevice(deviceId) {
      held.set(deviceId, latestIndex())
    },
    releaseDevice(deviceId) {
      held.delete(deviceId)
    },
    firstIndexAtOrAfter(time) {
      if (!Number.isFinite(time)) throw new Error('Mission start time is missing or invalid.')
      return Math.max(0, Math.ceil((time - startMs) / STEP_MS))
    },
    setOffline(value) {
      offline = value
    },
    fixFor(sourcePositionId) {
      const device = devices.find((candidate) => candidate.id === Math.floor(sourcePositionId / 1_000_000))
      return device === undefined ? null : fixAt(device, sourcePositionId % 1_000_000)
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
