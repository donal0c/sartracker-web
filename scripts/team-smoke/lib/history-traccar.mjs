/**
 * GET-only mock Traccar with known provider history from before a mission is
 * created, for the start-with-lookback part of the tracking check (DON-291).
 *
 * All times are relative to the mock start T0 and every fix is a pure function
 * of device and time, so a check can recompute exactly what the provider holds:
 * - one fix every 5 min from T0-60h (so there is history outside a 48 h window);
 * - one fix every second from T0-48h to T0-48h+5min, so the mission-start
 *   boundary falls inside a dense band and is checked to the second;
 * - history-only devices stop at T0-2h and never report a fresh fix, so live
 *   polling cannot mask a missing initial history;
 * - the walker continues live every 10 s after T0.
 * `setHistoryFailing(true)` answers 503 to history requests reaching before T0
 * while live requests keep working, to show the incomplete state.
 */

import { createServer } from 'node:http'

const HOUR = 3_600_000
const SPARSE_STEP_MS = 5 * 60_000
const LIVE_STEP_MS = 10_000
export const LOOKBACK_HOURS = 48

/** Devices served. `live: false` devices have history only. */
export const HISTORY_DEVICES = Object.freeze([
  { id: 11, name: 'History Hotel', lat: 51.95, lon: -9.72, live: false },
  { id: 12, name: 'Walker Juliet', lat: 51.955, lon: -9.715, live: true },
  { id: 13, name: 'Unselected Kilo', lat: 51.945, lon: -9.725, live: false },
  { id: 14, name: 'Late Lima', lat: 51.96, lon: -9.73, live: false },
])

/**
 * Starts the mock on 127.0.0.1.
 *
 * @returns {Promise<{url: string, t0: number, denseBand: {from: number, to: number}, fixesBetween: (deviceId: number, from: number, to: number) => object[], fixFor: (sourcePositionId: number) => object | null, setHistoryFailing: (failing: boolean) => void, historyRequestCount: (deviceId: number) => number, close: () => Promise<void>}>}
 */
export async function startHistoryTraccar() {
  const t0 = Math.floor(Date.now() / 1000) * 1000
  const historyStart = t0 - 60 * HOUR
  const denseBand = { from: t0 - LOOKBACK_HOURS * HOUR, to: t0 - LOOKBACK_HOURS * HOUR + 5 * 60_000 }
  const historyOnlyEnd = t0 - 2 * HOUR
  let historyFailing = false
  const historyRequests = new Map()

  /** Every provider fix time for the device up to T0, ascending and unique. */
  const historyTimes = (() => {
    const times = new Set()
    for (let time = historyStart; time <= t0; time += SPARSE_STEP_MS) times.add(time)
    for (let time = denseBand.from; time <= denseBand.to; time += 1000) times.add(time)
    return [...times].sort((a, b) => a - b)
  })()

  const makeFix = (device, index, time) => {
    const iso = new Date(time).toISOString()
    return {
      id: device.id * 1_000_000 + index,
      deviceId: device.id,
      latitude: +(device.lat + (index % 5000) * 0.00001).toFixed(7),
      longitude: +(device.lon + (index % 5000) * 0.00001).toFixed(7),
      altitude: 200, speed: 1, accuracy: 5,
      fixTime: iso, deviceTime: iso, serverTime: iso,
      valid: true, protocol: 'osmand', attributes: { batteryLevel: 80 },
    }
  }
  /** Static provider history per device, computed once with stable ids. */
  const historyByDevice = new Map(HISTORY_DEVICES.map((device) => {
    const end = device.live ? t0 : historyOnlyEnd
    return [device.id, historyTimes.filter((time) => time <= end).map((time, index) => makeFix(device, index, time))]
  }))
  const liveFix = (device, n) => makeFix(device, historyByDevice.get(device.id).length + n - 1, t0 + n * LIVE_STEP_MS)
  /** All fixes the device has up to `until`, with stable ids. */
  const fixesUntil = (device, until) => {
    const fixes = historyByDevice.get(device.id).filter((fix) => Date.parse(fix.fixTime) <= until)
    if (device.live) {
      for (let n = 1; t0 + n * LIVE_STEP_MS <= until; n += 1) fixes.push(liveFix(device, n))
    }
    return fixes
  }
  const deviceById = (id) => HISTORY_DEVICES.find((device) => device.id === id)
  const latest = (device) => fixesUntil(device, Date.now()).at(-1)

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
    if (url.pathname === '/api/server') return json(200, { version: '6.0-mock' })
    if (url.pathname === '/api/groups') return json(200, [{ id: 201, name: 'History Team', groupId: 0 }])
    if (url.pathname === '/api/devices') {
      return json(200, HISTORY_DEVICES.map((device) => ({
        id: device.id, name: device.name, uniqueId: `history-${device.id}`,
        status: device.live ? 'online' : 'offline',
        lastUpdate: latest(device).fixTime, positionId: latest(device).id,
        disabled: false, groupId: 201, category: 'person', attributes: {},
      })))
    }
    if (url.pathname === '/api/positions') {
      const deviceId = url.searchParams.get('deviceId')
      if (deviceId === null) return json(200, HISTORY_DEVICES.map(latest))
      const device = deviceById(Number(deviceId))
      if (device === undefined) return json(200, [])
      const from = Date.parse(url.searchParams.get('from') ?? '1970-01-01T00:00:00Z')
      const to = Date.parse(url.searchParams.get('to') ?? new Date().toISOString())
      historyRequests.set(device.id, (historyRequests.get(device.id) ?? 0) + 1)
      if (historyFailing && from < t0) return json(503, { error: 'synthetic history outage' })
      return json(200, fixesUntil(device, Date.now()).filter((fix) => {
        const time = Date.parse(fix.fixTime)
        return time >= from && time <= to
      }))
    }
    json(404, { error: 'not found' })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('History mock did not bind a port.')

  return {
    url: `http://127.0.0.1:${address.port}`,
    t0,
    denseBand,
    fixesBetween: (deviceId, from, to) => fixesUntil(deviceById(deviceId), to)
      .filter((fix) => Date.parse(fix.fixTime) >= from),
    fixFor(sourcePositionId) {
      const device = deviceById(Math.floor(sourcePositionId / 1_000_000))
      if (device === undefined) return null
      const index = sourcePositionId % 1_000_000
      const history = historyByDevice.get(device.id)
      if (index < history.length) return history[index]
      if (!device.live) return null
      const fix = liveFix(device, index - history.length + 1)
      return Date.parse(fix.fixTime) <= Date.now() ? fix : null
    },
    setHistoryFailing(value) {
      historyFailing = value
    },
    historyRequestCount: (deviceId) => historyRequests.get(deviceId) ?? 0,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
