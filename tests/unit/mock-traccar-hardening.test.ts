/**
 * Tests for the 5 mock Traccar server hardening fixes:
 * 1. /health endpoint is public (no auth required)
 * 2. /api/positions excludes offline devices
 * 3. Route generation is deterministic (seeded PRNG)
 * 4. Playback timestamps use real-time spacing regardless of speed
 * 5. Team Delta goUnknownAfterMs aligns with route end time
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createRouter } from '../../tools/mock-traccar/src/router.js'
import { createAuthManager } from '../../tools/mock-traccar/src/auth.js'
import { createPlaybackEngine } from '../../tools/mock-traccar/src/playback-engine.js'
import { createPositionStore } from '../../tools/mock-traccar/src/position-store.js'
import {
  generateAllRoutes,
  DEVICE_DEFINITIONS,
} from '../../tools/mock-traccar/src/route-generator.js'
import { getDeviceRoster } from '../../tools/mock-traccar/src/device-roster.js'
import type { SeedPoint } from '../../tools/mock-traccar/src/types.js'

/** Minimal seed points for tests that need route generation. */
function createMinimalSeed(count: number = 50): SeedPoint[] {
  const points: SeedPoint[] = []
  for (let i = 0; i < count; i++) {
    points.push({
      latitude: 52.270 + i * 0.0001,
      longitude: -9.540 + i * 0.00005,
      altitude: 180 + i * 0.5,
      speed: 1.2 + (i % 5) * 0.3,
      relativeMs: i * 30_000,
      batteryLevel: 95 - i * 0.1,
      distance: 15 + i * 0.5,
      motion: i % 3 !== 0,
    })
  }
  return points
}

/** Create a playback engine frozen at a specific scenario time for testing. */
function createFrozenEngine(scenarioMs: number): ReturnType<typeof createPlaybackEngine> {
  const anchorDate = new Date(Date.now() - scenarioMs)
  return {
    getScenarioTimeMs: () => scenarioMs,
    getScenarioDate: (offsetMs: number) => new Date(anchorDate.getTime() + offsetMs),
    anchorDate,
    durationMs: 7_200_000,
  }
}

// ---------------------------------------------------------------------------
// Fix #1: /health endpoint is public (no auth)
// ---------------------------------------------------------------------------
describe('Fix #1: /health endpoint requires no auth', () => {
  let server: Server
  let baseUrl: string

  const seed = createMinimalSeed()
  const routes = generateAllRoutes(seed)
  const engine = createPlaybackEngine({
    speedMultiplier: 1,
    startOffsetMs: 0,
    durationMs: 7_200_000,
    loop: false,
  })
  const positionStore = createPositionStore(routes, engine)
  const auth = createAuthManager({
    email: 'admin@mock.local',
    password: 'mock',
    token: 'mock-bearer-token',
  })
  const handler = createRouter({
    auth,
    engine,
    positionStore,
    deviceDefinitions: DEVICE_DEFINITIONS,
    routes,
  })

  // Start server on random port
  const ready = new Promise<void>((resolve) => {
    server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr !== 'string') {
        baseUrl = `http://127.0.0.1:${addr.port}`
      }
      resolve()
    })
  })

  afterAll(() => {
    server?.close()
  })

  it('returns 200 from /health without any auth', async () => {
    await ready
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.scenarioTimeMs).toBe('number')
  })

  it('returns 401 from /api/devices without auth', async () => {
    await ready
    const res = await fetch(`${baseUrl}/api/devices`)
    expect(res.status).toBe(401)
  })

  it('returns 200 from /api/devices with valid basic auth', async () => {
    await ready
    const creds = Buffer.from('admin@mock.local:mock').toString('base64')
    const res = await fetch(`${baseUrl}/api/devices`, {
      headers: { Authorization: `Basic ${creds}` },
    })
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Fix #2: /api/positions excludes offline devices
// ---------------------------------------------------------------------------
describe('Fix #2: offline devices excluded from /api/positions', () => {
  let server: Server
  let baseUrl: string

  const seed = createMinimalSeed()
  const routes = generateAllRoutes(seed)
  // Freeze at T+10min — Team Echo (id 6) is forceOffline, its positions must not appear.
  // Team Delta (id 5) is still online at this point.
  const engine = createFrozenEngine(10 * 60 * 1000)
  const positionStore = createPositionStore(routes, engine)
  const auth = createAuthManager({
    email: 'admin@mock.local',
    password: 'mock',
    token: 'mock-bearer-token',
  })
  const handler = createRouter({
    auth,
    engine,
    positionStore,
    deviceDefinitions: DEVICE_DEFINITIONS,
    routes,
  })

  const ready = new Promise<void>((resolve) => {
    server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr !== 'string') {
        baseUrl = `http://127.0.0.1:${addr.port}`
      }
      resolve()
    })
  })

  afterAll(() => {
    server?.close()
  })

  it('does not return positions for offline device (Team Echo, id 6)', async () => {
    await ready
    const creds = Buffer.from('admin@mock.local:mock').toString('base64')
    const res = await fetch(`${baseUrl}/api/positions`, {
      headers: { Authorization: `Basic ${creds}` },
    })
    expect(res.status).toBe(200)
    const positions = await res.json() as Array<{ deviceId: number }>
    const echoPositions = positions.filter((p) => p.deviceId === 6)
    expect(echoPositions).toHaveLength(0)
  })

  it('still returns positions for online devices', async () => {
    await ready
    const creds = Buffer.from('admin@mock.local:mock').toString('base64')
    const res = await fetch(`${baseUrl}/api/positions`, {
      headers: { Authorization: `Basic ${creds}` },
    })
    const positions = await res.json() as Array<{ deviceId: number }>
    // EOC (1), Team Alpha (2), Team Delta (5) should have positions at T+10m
    const eocPositions = positions.filter((p) => p.deviceId === 1)
    expect(eocPositions.length).toBeGreaterThan(0)
    const alphaPositions = positions.filter((p) => p.deviceId === 2)
    expect(alphaPositions.length).toBeGreaterThan(0)
  })

  it('confirms Team Echo is offline in /api/devices roster', async () => {
    await ready
    const creds = Buffer.from('admin@mock.local:mock').toString('base64')
    const res = await fetch(`${baseUrl}/api/devices`, {
      headers: { Authorization: `Basic ${creds}` },
    })
    const devices = await res.json() as Array<{ id: number; status: string }>
    const echo = devices.find((d) => d.id === 6)
    expect(echo).toBeDefined()
    expect(echo!.status).toBe('offline')
  })
})

// ---------------------------------------------------------------------------
// Fix #3: route generation is deterministic (seeded PRNG)
// ---------------------------------------------------------------------------
describe('Fix #3: deterministic route generation', () => {
  const seed = createMinimalSeed()

  it('produces identical routes with the same RNG seed', () => {
    const routesA = generateAllRoutes(seed, 42)
    const routesB = generateAllRoutes(seed, 42)

    // Compare every route
    for (const [deviceId, routeA] of routesA) {
      const routeB = routesB.get(deviceId)
      expect(routeB).toBeDefined()
      expect(routeA).toHaveLength(routeB!.length)

      for (let i = 0; i < routeA.length; i++) {
        expect(routeA[i].latitude).toBe(routeB![i].latitude)
        expect(routeA[i].longitude).toBe(routeB![i].longitude)
        expect(routeA[i].altitude).toBe(routeB![i].altitude)
        expect(routeA[i].speed).toBe(routeB![i].speed)
      }
    }
  })

  it('produces different routes with different RNG seeds', () => {
    const routesA = generateAllRoutes(seed, 42)
    const routesC = generateAllRoutes(seed, 99)

    // EOC route (id 1) uses the RNG for jitter, so should differ
    const eocA = routesA.get(1)!
    const eocC = routesC.get(1)!
    expect(eocA).toHaveLength(eocC.length)

    // At least some points should differ in latitude (jitter-based)
    const differs = eocA.some((pt, i) => pt.latitude !== eocC[i].latitude)
    expect(differs).toBe(true)
  })

  it('default seed produces consistent results', () => {
    const routesA = generateAllRoutes(seed)
    const routesB = generateAllRoutes(seed)

    const eocA = routesA.get(1)!
    const eocB = routesB.get(1)!

    for (let i = 0; i < eocA.length; i++) {
      expect(eocA[i].latitude).toBe(eocB[i].latitude)
      expect(eocA[i].longitude).toBe(eocB[i].longitude)
    }
  })
})

// ---------------------------------------------------------------------------
// Fix #4: playback timestamps use real-time spacing regardless of speed
// ---------------------------------------------------------------------------
describe('Fix #4: timestamp spacing independent of playback speed', () => {
  it('getScenarioDate produces same timestamps at 1x and 10x speed', () => {
    // Create two engines with different speeds but same start
    const engine1x = createPlaybackEngine({
      speedMultiplier: 1,
      startOffsetMs: 0,
      durationMs: 7_200_000,
      loop: false,
    })
    const engine10x = createPlaybackEngine({
      speedMultiplier: 10,
      startOffsetMs: 0,
      durationMs: 7_200_000,
      loop: false,
    })

    // For the same scenario offset, both engines should produce timestamps
    // that are the same distance apart (real-time spacing).
    const offset0 = 0
    const offset10min = 10 * 60 * 1000
    const offset30min = 30 * 60 * 1000

    const date1x_0 = engine1x.getScenarioDate(offset0)
    const date1x_10 = engine1x.getScenarioDate(offset10min)
    const date1x_30 = engine1x.getScenarioDate(offset30min)

    const date10x_0 = engine10x.getScenarioDate(offset0)
    const date10x_10 = engine10x.getScenarioDate(offset10min)
    const date10x_30 = engine10x.getScenarioDate(offset30min)

    // The spacing between timestamps should be the same regardless of speed
    const gap1x = date1x_10.getTime() - date1x_0.getTime()
    const gap10x = date10x_10.getTime() - date10x_0.getTime()
    expect(gap1x).toBe(offset10min) // 10 minutes apart
    expect(gap10x).toBe(offset10min) // also 10 minutes apart

    const gap1x_30 = date1x_30.getTime() - date1x_0.getTime()
    const gap10x_30 = date10x_30.getTime() - date10x_0.getTime()
    expect(gap1x_30).toBe(offset30min)
    expect(gap10x_30).toBe(offset30min)
  })

  it('breadcrumb gap of 7 minutes is preserved at 10x speed', () => {
    const engine = createPlaybackEngine({
      speedMultiplier: 10,
      startOffsetMs: 0,
      durationMs: 7_200_000,
      loop: false,
    })

    const beforeGap = 20 * 60 * 1000 // 20 min into scenario
    const afterGap = 27 * 60 * 1000 // 27 min (7 min later)

    const dateBefore = engine.getScenarioDate(beforeGap)
    const dateAfter = engine.getScenarioDate(afterGap)

    const gapMs = dateAfter.getTime() - dateBefore.getTime()
    expect(gapMs).toBe(7 * 60 * 1000) // exactly 7 minutes
  })
})

// ---------------------------------------------------------------------------
// Fix #5: Team Delta goUnknownAfterMs aligns with route end time
// ---------------------------------------------------------------------------
describe('Fix #5: Team Delta timing alignment', () => {
  const seed = createMinimalSeed()
  const routes = generateAllRoutes(seed)
  const deltaRoute = routes.get(5)!
  const deltaDef = DEVICE_DEFINITIONS.find((d) => d.id === 5)!

  it('goUnknownAfterMs matches the last route point offset', () => {
    const lastPoint = deltaRoute[deltaRoute.length - 1]
    expect(deltaDef.goUnknownAfterMs).toBe(lastPoint.scenarioOffsetMs)
  })

  it('Team Delta is online before route ends', () => {
    // At T+15min, Delta still has route points and should be online
    const engine = createFrozenEngine(15 * 60 * 1000)
    const roster = getDeviceRoster(DEVICE_DEFINITIONS, routes, engine)
    const delta = roster.find((d) => d.id === 5)!
    expect(delta.status).toBe('online')
  })

  it('Team Delta is still online right at route end', () => {
    // At the last route point time, Delta should still be online
    const lastPointMs = deltaRoute[deltaRoute.length - 1].scenarioOffsetMs
    const engine = createFrozenEngine(lastPointMs)
    const roster = getDeviceRoster(DEVICE_DEFINITIONS, routes, engine)
    const delta = roster.find((d) => d.id === 5)!
    expect(delta.status).toBe('online')
  })

  it('Team Delta becomes unknown after 5+ minutes past route end', () => {
    const lastPointMs = deltaRoute[deltaRoute.length - 1].scenarioOffsetMs
    // 5 min + 1s after last point
    const engine = createFrozenEngine(lastPointMs + 5 * 60 * 1000 + 1000)
    const roster = getDeviceRoster(DEVICE_DEFINITIONS, routes, engine)
    const delta = roster.find((d) => d.id === 5)!
    expect(delta.status).toBe('unknown')
  })

  it('Team Delta stays unknown (does not go offline) even after 1 hour', () => {
    // With goUnknownAfterMs set, the device stays in online/unknown cycle,
    // never transitioning to offline — it's still "out there"
    const lastPointMs = deltaRoute[deltaRoute.length - 1].scenarioOffsetMs
    const engine = createFrozenEngine(lastPointMs + 90 * 60 * 1000) // 90 min later
    const roster = getDeviceRoster(DEVICE_DEFINITIONS, routes, engine)
    const delta = roster.find((d) => d.id === 5)!
    expect(delta.status).toBe('unknown')
  })
})
