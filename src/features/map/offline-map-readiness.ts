export type OfflineMapReadinessStatus = 'ready' | 'limited' | 'unavailable'

export type OfflineMapReadinessTone = 'success' | 'warning' | 'danger'

export type OfflineMapReadinessInput = {
  readonly basemapLabel: string
  readonly cacheStorageSupported: boolean
  readonly online: boolean
  readonly serviceWorkerReady: boolean
  readonly serviceWorkerSupported: boolean
}

export type OfflineMapReadiness = {
  readonly detail: string
  readonly label: string
  readonly status: OfflineMapReadinessStatus
  readonly tone: OfflineMapReadinessTone
}

/**
 * Describes whether the current map can support explicit field-offline use.
 */
export function describeOfflineMapReadiness(
  input: OfflineMapReadinessInput,
): OfflineMapReadiness {
  if (!input.serviceWorkerSupported || !input.cacheStorageSupported) {
    return {
      detail: 'This browser cannot cache map tiles for field use.',
      label: 'Offline tiles unavailable',
      status: 'unavailable',
      tone: 'danger',
    }
  }

  if (!input.serviceWorkerReady) {
    return {
      detail: 'Keep network available until the tile cache worker controls the app.',
      label: 'Offline tiles arming',
      status: 'limited',
      tone: 'warning',
    }
  }

  if (!input.online) {
    return {
      detail: `${input.basemapLabel}: unviewed tiles may be blank or degraded.`,
      label: 'Offline: viewed tiles only',
      status: 'limited',
      tone: 'warning',
    }
  }

  return {
    detail: `${input.basemapLabel}: tiles viewed now are available offline.`,
    label: 'Viewed tiles cache ready',
    status: 'ready',
    tone: 'success',
  }
}
