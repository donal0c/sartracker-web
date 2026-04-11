/** Traccar device as returned by the mock API. */
export type TraccarDevice = {
  readonly id: number
  readonly name: string
  readonly uniqueId: string
  readonly status: 'online' | 'offline' | 'unknown'
  readonly lastUpdate: string
  readonly category: string
}

/** Traccar position as returned by the mock API. */
export type TraccarPosition = {
  readonly id: number
  readonly deviceId: number
  readonly latitude: number
  readonly longitude: number
  readonly altitude: number
  readonly speed: number
  readonly fixTime: string
  readonly serverTime: string
  readonly valid: true
  readonly protocol: string
  readonly attributes: {
    readonly batteryLevel: number
    readonly distance: number
    readonly motion: boolean
  }
}

/** Internal route point with scenario-relative timing. */
export type RoutePoint = {
  readonly scenarioOffsetMs: number
  readonly latitude: number
  readonly longitude: number
  readonly altitude: number
  readonly speed: number
  readonly batteryLevel: number
  readonly distance: number
  readonly motion: boolean
}

/** Seed point parsed from the Glenagenty CSV. */
export type SeedPoint = {
  readonly latitude: number
  readonly longitude: number
  readonly altitude: number
  readonly speed: number
  readonly relativeMs: number
  readonly batteryLevel: number
  readonly distance: number
  readonly motion: boolean
}

/** Device definition with route generation metadata. */
export type DeviceDefinition = {
  readonly id: number
  readonly name: string
  readonly uniqueId: string
  readonly category: string
  readonly startOffsetMs: number
  readonly forceOffline?: boolean
  readonly goUnknownAfterMs?: number
}

/** Scenario configuration. */
export type ScenarioConfig = {
  readonly name: string
  readonly description: string
  readonly durationMs: number
  readonly speedMultiplier: number
  readonly startOffsetMs: number
  readonly loop: boolean
  readonly auth: {
    readonly email: string
    readonly password: string
    readonly token: string
  }
}
