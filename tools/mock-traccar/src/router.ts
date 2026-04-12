import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthManager } from './auth.js'
import type { PlaybackEngine } from './playback-engine.js'
import type { DeviceDefinition, RoutePoint } from './types.js'
import { getDeviceRoster } from './device-roster.js'
import type { PositionStore } from './position-store.js'

type RouterDeps = {
  readonly auth: AuthManager
  readonly engine: PlaybackEngine
  readonly positionStore: PositionStore
  readonly deviceDefinitions: readonly DeviceDefinition[]
  readonly routes: ReadonlyMap<number, RoutePoint[]>
}

/**
 * Creates the HTTP request handler with CORS support.
 */
export function createRouter(deps: RouterDeps) {
  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers on every response
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cookie, Accept')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie')

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const pathname = url.pathname

    // Health check — no auth required
    if (req.method === 'GET' && pathname === '/health') {
      const scenarioMs = deps.engine.getScenarioTimeMs()
      sendJson(res, {
        status: 'ok',
        scenarioTimeMs: scenarioMs,
        scenarioTimeFormatted: formatDuration(scenarioMs),
      })
      return
    }

    // POST /api/session — no auth required for login
    if (req.method === 'POST' && pathname === '/api/session') {
      handleSession(req, res, deps)
      return
    }

    // All other endpoints require auth
    if (!deps.auth.validateRequest(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    if (req.method === 'GET' && pathname === '/api/devices') {
      handleDevices(res, deps)
      return
    }

    if (req.method === 'GET' && pathname === '/api/positions') {
      handlePositions(url, res, deps)
      return
    }

    if (req.method === 'GET' && pathname === '/api/reports/route') {
      handlePositions(url, res, deps)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}

function handleSession(req: IncomingMessage, res: ServerResponse, deps: RouterDeps): void {
  let body = ''
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString()
  })
  req.on('end', () => {
    const params = new URLSearchParams(body)
    const email = params.get('email') ?? ''
    const password = params.get('password') ?? ''

    const sessionId = deps.auth.createSession(email, password)
    if (!sessionId) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid credentials' }))
      return
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `JSESSIONID=${sessionId}; Path=/; HttpOnly`,
    })
    res.end(JSON.stringify({ id: 1, email }))
  })
}

function handleDevices(res: ServerResponse, deps: RouterDeps): void {
  const devices = getDeviceRoster(deps.deviceDefinitions, deps.routes, deps.engine)
  sendJson(res, devices)
}

function handlePositions(url: URL, res: ServerResponse, deps: RouterDeps): void {
  const deviceIdParam = url.searchParams.get('deviceId')
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  // If deviceId + from + to are provided, return filtered history
  if (deviceIdParam && fromParam && toParam) {
    const deviceId = parseInt(deviceIdParam, 10)
    if (Number.isNaN(deviceId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid deviceId' }))
      return
    }

    const positions = deps.positionStore.getDevicePositions(deviceId, fromParam, toParam)
    sendJson(res, positions)
    return
  }

  // Otherwise return latest positions per device, excluding offline devices.
  // Real Traccar only returns positions for online/unknown devices.
  const roster = getDeviceRoster(deps.deviceDefinitions, deps.routes, deps.engine)
  const offlineDeviceIds = new Set(
    roster.filter((d) => d.status === 'offline').map((d) => d.id),
  )
  const positions = deps.positionStore
    .getLatestPositions()
    .filter((p) => !offlineDeviceIds.has(p.deviceId))
  sendJson(res, positions)
}

function sendJson(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}h ${minutes}m ${seconds}s`
}
