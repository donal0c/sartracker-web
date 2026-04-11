import type { PlaybackEngine } from './playback-engine.js'
import type { RoutePoint, TraccarPosition } from './types.js'

/**
 * Provides time-filtered position queries against the pre-generated route data.
 */
export type PositionStore = {
  /** Latest position per online device at the current scenario time. */
  readonly getLatestPositions: () => TraccarPosition[]
  /** Filtered position history for a specific device within a time range. */
  readonly getDevicePositions: (
    deviceId: number,
    fromIso: string,
    toIso: string,
  ) => TraccarPosition[]
}

export function createPositionStore(
  routes: ReadonlyMap<number, RoutePoint[]>,
  engine: PlaybackEngine,
): PositionStore {
  return {
    getLatestPositions(): TraccarPosition[] {
      const scenarioMs = engine.getScenarioTimeMs()
      const result: TraccarPosition[] = []

      for (const [deviceId, route] of routes) {
        const lastPoint = getLastVisiblePoint(route, scenarioMs)
        if (lastPoint) {
          result.push(
            routePointToPosition(lastPoint, deviceId, engine),
          )
        }
      }

      return result
    },

    getDevicePositions(deviceId: number, fromIso: string, toIso: string): TraccarPosition[] {
      const route = routes.get(deviceId)
      if (!route) return []

      const scenarioMs = engine.getScenarioTimeMs()
      const fromDate = new Date(fromIso)
      const toDate = new Date(toIso)

      const result: TraccarPosition[] = []

      for (const point of route) {
        if (point.scenarioOffsetMs > scenarioMs) break

        const pointDate = engine.getScenarioDate(point.scenarioOffsetMs)
        if (pointDate >= fromDate && pointDate <= toDate) {
          result.push(routePointToPosition(point, deviceId, engine))
        }
      }

      return result
    },
  }
}

function getLastVisiblePoint(
  route: RoutePoint[],
  scenarioMs: number,
): RoutePoint | null {
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

function routePointToPosition(
  point: RoutePoint,
  deviceId: number,
  engine: PlaybackEngine,
): TraccarPosition {
  const fixDate = engine.getScenarioDate(point.scenarioOffsetMs)
  const positionId = deviceId * 100_000 + Math.trunc(point.scenarioOffsetMs / 1000)

  return {
    id: positionId,
    deviceId,
    latitude: point.latitude,
    longitude: point.longitude,
    altitude: point.altitude,
    speed: point.speed,
    fixTime: fixDate.toISOString(),
    serverTime: new Date(fixDate.getTime() + 1000).toISOString(),
    valid: true,
    protocol: 'osmand',
    attributes: {
      batteryLevel: Math.round(point.batteryLevel * 10) / 10,
      distance: Math.round(point.distance * 100) / 100,
      motion: point.motion,
    },
  }
}
