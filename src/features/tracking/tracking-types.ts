export type TrackingDeviceStatus = 'online' | 'offline' | 'unknown'

export type TrackingDataOrigin = 'live' | 'cache'

export type NormalizedTrackingDevice = {
  readonly device_id: string
  readonly name: string
  readonly status: TrackingDeviceStatus
  readonly last_seen: string | null
  readonly unique_id: string | null
  readonly category: string | null
}

export type NormalizedTrackingPosition = {
  readonly id: string
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly altitude: number | null
  /** Speed normalized from Traccar API knots into kilometres per hour. */
  readonly speed: number | null
  readonly battery: number | null
  readonly accuracy: number | null
  readonly timestamp: string
  readonly source: string | null
  readonly data_origin: TrackingDataOrigin
  readonly cache_age_seconds: number | null
  readonly device_cache_stale: boolean
}

export type BreadcrumbDeviceBudget = {
  readonly deviceId: string
  readonly retained: number
  readonly total: number
  readonly firstTimestamp: string | null
  readonly lastTimestamp: string | null
  readonly truncated: boolean
}

export type BreadcrumbSnapshotMetadata = {
  readonly totalRetained: number
  readonly totalObserved: number
  readonly deviceBudgets: readonly BreadcrumbDeviceBudget[]
}

export type TrackingSnapshot = {
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly breadcrumbs: readonly NormalizedTrackingPosition[]
  readonly rawBreadcrumbsForPersistence?: readonly NormalizedTrackingPosition[] | undefined
  readonly breadcrumbMetadata?: BreadcrumbSnapshotMetadata | undefined
}

export type TrackingConnectionStatus = {
  readonly mode: 'idle' | 'online' | 'offline'
  readonly consecutiveFailures: number
  readonly recovered: boolean
  readonly lastSuccessAt: string | null
  readonly warning: string | null
}
