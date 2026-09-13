import {
  getRenderableMapLabel,
  isOfficialMapId,
  type RenderableMapId,
} from '../../lib/map-config'
import type {
  OfficialMapPackageSettings,
  OfficialMapSettings,
} from '../settings/settings-types'

export type OfflineMapReadinessStatus = 'ready' | 'limited' | 'unavailable'

export type OfflineMapReadinessTone = 'neutral' | 'success' | 'warning' | 'danger'

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

export type OfficialMapReadinessInput = {
  readonly activeMapId: RenderableMapId
  readonly officialMaps: OfficialMapSettings
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

/**
 * Describes licensed official-map readiness from safe settings metadata only.
 */
export function describeOfficialMapReadiness(
  input: OfficialMapReadinessInput,
): OfflineMapReadiness {
  const mapLabel = getRenderableMapLabel(input.activeMapId)
  if (!isOfficialMapId(input.activeMapId)) {
    return {
      detail: `${mapLabel} is a public fallback map. Licensed official map packages are not active for this view.`,
      label: 'Public fallback only',
      status: 'limited',
      tone: 'neutral',
    }
  }

  const packages = input.officialMaps.packages.filter(
    (mapPackage) => mapPackage.mapId === input.activeMapId,
  )
  const readyPackage = packages.find((mapPackage) => mapPackage.status === 'ready')
  if (readyPackage !== undefined) {
    return describeReadyOfficialPackage(mapLabel, readyPackage)
  }

  const missingPackage = packages.find((mapPackage) => mapPackage.status === 'missing')
  if (missingPackage !== undefined) {
    return {
      detail: `${mapLabel}: the registered local package cannot be found. Reconnect or replace the local map package.`,
      label: 'Official map package missing',
      status: 'unavailable',
      tone: 'danger',
    }
  }

  const unreadablePackage = packages.find((mapPackage) => mapPackage.status === 'invalid')
  if (unreadablePackage !== undefined) {
    return {
      detail: `${mapLabel}: the registered local package is unreadable. Recheck the MBTiles package before field use.`,
      label: 'Official map package unreadable',
      status: 'unavailable',
      tone: 'danger',
    }
  }

  if (
    input.officialMaps.status === 'configured' &&
    input.officialMaps.availableSources.includes(input.activeMapId)
  ) {
    return {
      detail: `${mapLabel}: online MapGenie source is configured, but no local offline package is ready.`,
      label: 'Official online source configured',
      status: 'limited',
      tone: 'warning',
    }
  }

  return {
    detail: `${mapLabel}: no local official package or online official source is configured.`,
    label: 'Official maps unavailable',
    status: 'unavailable',
    tone: 'danger',
  }
}

function describeReadyOfficialPackage(
  mapLabel: string,
  mapPackage: OfficialMapPackageSettings,
): OfflineMapReadiness {
  if (!hasCurrentValidationAttestation(mapPackage)) {
    return {
      detail: `${mapLabel}: Official package requires validation. Check View before relying on this area.`,
      label: 'Official package requires validation',
      status: 'limited',
      tone: 'warning',
    }
  }

  return {
    detail: `${mapLabel}: Official package validated. Check View before relying on this area.`,
    label: 'Official package validated',
    status: 'limited',
    tone: 'warning',
  }
}

function hasCurrentValidationAttestation(mapPackage: OfficialMapPackageSettings): boolean {
  const attestation = mapPackage.attestation
  return (
    attestation?.version === 1 &&
    attestation.schemaVersion === 1 &&
    attestation.decoderPolicy === 'native-raster-256-or-512-opaque-v1' &&
    typeof attestation.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(attestation.sha256)
  )
}
