import type { PlaybackEngine } from './playback-engine.js'
import type { DeviceDefinition, RoutePoint, TraccarDevice } from './types.js'

/**
 * Returns the device roster with dynamic status and lastUpdate
 * computed from the current playback scenario time.
 */
export function getDeviceRoster(
  definitions: readonly DeviceDefinition[],
  routes: ReadonlyMap<number, RoutePoint[]>,
  engine: PlaybackEngine,
): TraccarDevice[] {
  const scenarioMs = engine.getScenarioTimeMs()

  return definitions.map((def) => {
    const route = routes.get(def.id)
    const lastVisiblePoint = getLastVisiblePoint(route, scenarioMs)

    const status = computeDeviceStatus(def, lastVisiblePoint, scenarioMs)
    const lastUpdate = computeLastUpdate(def, lastVisiblePoint, engine)

    return {
      id: def.id,
      name: def.name,
      uniqueId: def.uniqueId,
      status,
      lastUpdate,
      category: def.category,
    }
  })
}

function getLastVisiblePoint(
  route: RoutePoint[] | undefined,
  scenarioMs: number,
): RoutePoint | null {
  if (!route || route.length === 0) return null

  let last: RoutePoint | null = null
  for (const point of route) {
    if (point.scenarioOffsetMs <= scenarioMs) {
      last = point
    } else {
      break
    }
  }

  return last
}

function computeDeviceStatus(
  def: DeviceDefinition,
  lastPoint: RoutePoint | null,
  scenarioMs: number,
): 'online' | 'offline' | 'unknown' {
  if (def.forceOffline) return 'offline'

  if (!lastPoint) {
    // Device hasn't started yet — if before its start offset, show as unknown
    if (scenarioMs < def.startOffsetMs) return 'unknown'
    return 'offline'
  }

  const timeSinceLastPointMs = scenarioMs - lastPoint.scenarioOffsetMs

  // goUnknownAfterMs: device stops sending, transitions to unknown after its window
  if (def.goUnknownAfterMs !== undefined && lastPoint.scenarioOffsetMs >= def.goUnknownAfterMs) {
    // The device's last point was at the cutoff, and time has moved on
    if (timeSinceLastPointMs > 5 * 60 * 1000) return 'unknown'
    return 'online'
  }

  // Normal active device: online if recent, unknown if stale
  if (timeSinceLastPointMs > 60 * 60 * 1000) return 'offline'
  if (timeSinceLastPointMs > 5 * 60 * 1000) return 'unknown'
  return 'online'
}

function computeLastUpdate(
  def: DeviceDefinition,
  lastPoint: RoutePoint | null,
  engine: PlaybackEngine,
): string {
  if (def.forceOffline) {
    // Offline devices have old lastUpdate (24h before anchor)
    return new Date(engine.anchorDate.getTime() - 24 * 60 * 60 * 1000).toISOString()
  }

  if (!lastPoint) {
    return engine.anchorDate.toISOString()
  }

  return engine.getScenarioDate(lastPoint.scenarioOffsetMs).toISOString()
}
