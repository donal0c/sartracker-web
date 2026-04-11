import type { DeviceDefinition, RoutePoint, SeedPoint } from './types.js'

/** All device definitions for the Glenagenty rescue scenario. */
export const DEVICE_DEFINITIONS: readonly DeviceDefinition[] = [
  {
    id: 1,
    name: 'EOC',
    uniqueId: 'sar_eoc_001',
    category: 'person',
    startOffsetMs: 0,
  },
  {
    id: 2,
    name: 'Team Alpha',
    uniqueId: 'sar_alpha_002',
    category: 'person',
    startOffsetMs: 0,
  },
  {
    id: 3,
    name: 'Team Bravo',
    uniqueId: 'sar_bravo_003',
    category: 'person',
    startOffsetMs: 8 * 60 * 1000,
  },
  {
    id: 4,
    name: 'Team Charlie',
    uniqueId: 'sar_charlie_004',
    category: 'person',
    startOffsetMs: 22 * 60 * 1000,
  },
  {
    id: 5,
    name: 'Team Delta',
    uniqueId: 'sar_delta_005',
    category: 'person',
    startOffsetMs: 0,
    goUnknownAfterMs: 20 * 60 * 1000,
  },
  {
    id: 6,
    name: 'Team Echo',
    uniqueId: 'sar_echo_006',
    category: 'person',
    startOffsetMs: 0,
    forceOffline: true,
  },
  {
    id: 7,
    name: 'Medic 1',
    uniqueId: 'sar_medic_007',
    category: 'person',
    startOffsetMs: 35 * 60 * 1000,
  },
  {
    id: 8,
    name: 'Hill Party 2',
    uniqueId: 'sar_hillparty_008',
    category: 'person',
    startOffsetMs: 12 * 60 * 1000,
  },
]

/**
 * Generates all device routes from the seed CSV points.
 * Returns a map of deviceId → RoutePoint[].
 */
export function generateAllRoutes(seed: readonly SeedPoint[]): Map<number, RoutePoint[]> {
  const routes = new Map<number, RoutePoint[]>()

  routes.set(1, generateEocRoute())
  routes.set(2, generateTeamAlphaRoute(seed))
  routes.set(3, generateTeamBravoRoute(seed))
  routes.set(4, generateTeamCharlieRoute(seed))
  routes.set(5, generateTeamDeltaRoute(seed))
  // Device 6 (Team Echo) has no route — offline only
  routes.set(7, generateMedicRoute())
  routes.set(8, generateHillPartyRoute(seed))

  return routes
}

/** EOC: stationary at the car park with GPS jitter. ~120 points over 2h at 30s intervals. */
function generateEocRoute(): RoutePoint[] {
  const baseLat = 52.2704
  const baseLon = -9.5456
  const points: RoutePoint[] = []
  const intervalMs = 30_000
  const count = 240 // 2 hours at 30s intervals

  for (let i = 0; i < count; i++) {
    const jitterLat = (Math.random() - 0.5) * 0.00006
    const jitterLon = (Math.random() - 0.5) * 0.00006

    points.push({
      scenarioOffsetMs: i * intervalMs,
      latitude: baseLat + jitterLat,
      longitude: baseLon + jitterLon,
      altitude: 175 + (Math.random() - 0.5) * 4,
      speed: Math.random() * 0.2,
      batteryLevel: 95 - i * 0.02,
      distance: Math.random() * 3,
      motion: false,
    })
  }

  return points
}

/** Team Alpha: full Glenagenty CSV as-is. */
function generateTeamAlphaRoute(seed: readonly SeedPoint[]): RoutePoint[] {
  return seed.map((pt) => ({
    scenarioOffsetMs: pt.relativeMs,
    latitude: pt.latitude,
    longitude: pt.longitude,
    altitude: pt.altitude,
    speed: pt.speed,
    batteryLevel: pt.batteryLevel,
    distance: pt.distance,
    motion: pt.motion,
  }))
}

/** Team Bravo: reversed route, +0.002 lat offset, every 2nd point. */
function generateTeamBravoRoute(seed: readonly SeedPoint[]): RoutePoint[] {
  const reversed = [...seed].reverse()
  const sampled = reversed.filter((_, i) => i % 2 === 0)
  const startOffset = DEVICE_DEFINITIONS.find((d) => d.id === 3)!.startOffsetMs

  return sampled.map((pt, i) => ({
    scenarioOffsetMs: startOffset + i * 40_000, // ~40s intervals for 2x spaced
    latitude: pt.latitude + 0.002,
    longitude: pt.longitude,
    altitude: pt.altitude + 15,
    speed: pt.speed * 0.9,
    batteryLevel: 97 - i * 0.06,
    distance: pt.distance,
    motion: pt.speed > 0.3,
  }))
}

/** Team Charlie: middle section (pts 100-250) with -0.003 lon offset. */
function generateTeamCharlieRoute(seed: readonly SeedPoint[]): RoutePoint[] {
  const section = seed.slice(100, 250)
  const startOffset = DEVICE_DEFINITIONS.find((d) => d.id === 4)!.startOffsetMs

  return section.map((pt, i) => ({
    scenarioOffsetMs: startOffset + i * 25_000, // ~25s intervals
    latitude: pt.latitude,
    longitude: pt.longitude - 0.003,
    altitude: pt.altitude + 20,
    speed: pt.speed * 1.1,
    batteryLevel: 96 - i * 0.04,
    distance: pt.distance,
    motion: pt.speed > 0.3,
  }))
}

/** Team Delta: first 40 pts with -0.003 lat offset. Stops early to become "unknown". */
function generateTeamDeltaRoute(seed: readonly SeedPoint[]): RoutePoint[] {
  const section = seed.slice(0, 40)

  return section.map((pt, i) => ({
    scenarioOffsetMs: i * 30_000, // 30s intervals, ~20 minutes of data
    latitude: pt.latitude - 0.003,
    longitude: pt.longitude,
    altitude: pt.altitude - 10,
    speed: pt.speed * 0.8,
    batteryLevel: 42 - i * 0.3,
    distance: pt.distance,
    motion: pt.speed > 0.3,
  }))
}

/** Medic 1: relocate from EOC to casualty site, then stationary. */
function generateMedicRoute(): RoutePoint[] {
  const startOffset = DEVICE_DEFINITIONS.find((d) => d.id === 7)!.startOffsetMs
  const points: RoutePoint[] = []

  // Phase 1: 10 points moving from EOC toward casualty site
  const startLat = 52.2704
  const startLon = -9.5456
  const endLat = 52.268
  const endLon = -9.535

  for (let i = 0; i < 10; i++) {
    const t = i / 9
    points.push({
      scenarioOffsetMs: startOffset + i * 60_000, // 1 min intervals during relocation
      latitude: startLat + (endLat - startLat) * t,
      longitude: startLon + (endLon - startLon) * t,
      altitude: 175 + t * 40,
      speed: 2.5 + Math.random() * 1.0,
      batteryLevel: 88 - i * 0.5,
      distance: 25 + Math.random() * 10,
      motion: true,
    })
  }

  // Phase 2: stationary at casualty site for 90 more points (~45 min)
  for (let i = 0; i < 90; i++) {
    points.push({
      scenarioOffsetMs: startOffset + (10 + i) * 30_000,
      latitude: endLat + (Math.random() - 0.5) * 0.00004,
      longitude: endLon + (Math.random() - 0.5) * 0.00004,
      altitude: 215 + (Math.random() - 0.5) * 3,
      speed: Math.random() * 0.15,
      batteryLevel: 83 - i * 0.03,
      distance: Math.random() * 2,
      motion: false,
    })
  }

  return points
}

/** Hill Party 2: section of seed with +0.001 lat and a deliberate 7-min gap. */
function generateHillPartyRoute(seed: readonly SeedPoint[]): RoutePoint[] {
  const section = seed.slice(50, 180)
  const startOffset = DEVICE_DEFINITIONS.find((d) => d.id === 8)!.startOffsetMs
  const gapAfterIndex = 60 // Insert gap after the 60th point
  const gapDurationMs = 7 * 60 * 1000 // 7 minutes

  const points: RoutePoint[] = []
  let cumulativeMs = 0

  for (let i = 0; i < section.length; i++) {
    const pt = section[i]
    const intervalMs = i === 0 ? 0 : 25_000

    if (i === gapAfterIndex + 1) {
      // Insert the 7-minute gap
      cumulativeMs += gapDurationMs
    } else {
      cumulativeMs += intervalMs
    }

    points.push({
      scenarioOffsetMs: startOffset + cumulativeMs,
      latitude: pt.latitude + 0.001,
      longitude: pt.longitude,
      altitude: pt.altitude + 5,
      speed: pt.speed * 0.7,
      batteryLevel: 91 - i * 0.05,
      distance: pt.distance,
      motion: pt.speed > 0.3,
    })
  }

  return points
}
