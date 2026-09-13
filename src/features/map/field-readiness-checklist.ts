import { getRenderableMapLabel, isOfficialMapId, type RenderableMapId } from '../../lib/map-config'
import type { OfficialMapPackageSettings, OfficialMapSettings } from '../settings/settings-types'
import { officialMapViewKey, type OfficialMapViewQualification } from './official-map-view-qualification'

export type FieldReadinessVerdict = 'ready' | 'not_ready'

export type FieldReadinessTone = 'success' | 'danger' | 'warning'

export type FieldReadinessCheckItem = {
  readonly id: string
  readonly label: string
  readonly passed: boolean
  readonly detail: string
}

export type FieldReadinessChecklist = {
  readonly verdict: FieldReadinessVerdict
  readonly tone: FieldReadinessTone
  readonly summaryLabel: string
  readonly summaryDetail: string
  readonly items: readonly FieldReadinessCheckItem[]
  readonly lastVerifiedAt: string | null
}

export type FieldReadinessInput = {
  readonly activeMapId: RenderableMapId
  readonly officialMaps: OfficialMapSettings
  readonly viewBounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number } | null
  readonly viewZoom?: number | undefined
  readonly qualification?: OfficialMapViewQualification | null | undefined
}

/**
 * Produces a consolidated field-readiness checklist for the active map configuration.
 * Returns a structured verdict with individual check items an operator can audit.
 */
export function buildFieldReadinessChecklist(input: FieldReadinessInput): FieldReadinessChecklist {
  const items: FieldReadinessCheckItem[] = []
  const mapLabel = getRenderableMapLabel(input.activeMapId)

  const packageCheck = checkPackageReady(input.activeMapId, input.officialMaps)
  items.push(packageCheck)

  const coverageCheck = checkViewCoverage(input)
  items.push(coverageCheck)

  const fallbackCheck = checkSourceFallback(input.activeMapId, input.officialMaps)
  items.push(fallbackCheck)

  const verifiedCheck = checkLastVerified(input.activeMapId, input.officialMaps)
  items.push(verifiedCheck)

  const allPassed = items.every((item) => item.passed)
  const criticalFailed = !packageCheck.passed

  const verdict: FieldReadinessVerdict = allPassed ? 'ready' : 'not_ready'
  const tone: FieldReadinessTone = allPassed ? 'success' : criticalFailed ? 'danger' : 'warning'

  return {
    verdict,
    tone,
    summaryLabel: allPassed
      ? 'Field ready'
      : criticalFailed
        ? 'Not field ready'
        : 'Partially ready',
    summaryDetail: allPassed
      ? `${mapLabel}: local tiles checked for this view at tile z${input.viewZoom}. Recheck after moving or changing maps; other areas and zooms are not certified.`
      : criticalFailed
        ? `${mapLabel}: no ready offline package. Import or reconnect before field deployment.`
        : `${mapLabel}: some checks did not pass. Review items below before relying on offline maps.`,
    items,
    lastVerifiedAt: getLastVerifiedAt(input.activeMapId, input.officialMaps),
  }
}

function checkPackageReady(
  activeMapId: RenderableMapId,
  officialMaps: OfficialMapSettings,
): FieldReadinessCheckItem {
  if (!isOfficialMapId(activeMapId)) {
    return {
      id: 'package_ready',
      label: 'Official package registered',
      passed: false,
      detail: 'Active map is a public fallback. Switch to an official map for field readiness.',
    }
  }

  const readyPackage = findReadyPackage(activeMapId, officialMaps)
  if (readyPackage !== undefined) {
    return {
      id: 'package_ready',
      label: 'Official package registered',
      passed: true,
      detail: `Local offline package is validated and ready.`,
    }
  }

  const anyPackage = officialMaps.packages.find((p) => p.mapId === activeMapId)
  if (anyPackage !== undefined) {
    const statusLabel = anyPackage.status === 'missing' ? 'missing' : anyPackage.status === 'invalid' ? 'unreadable' : 'pending'
    return {
      id: 'package_ready',
      label: 'Official package registered',
      passed: false,
      detail: `Package is registered but ${statusLabel}. Reconnect or replace the local package.`,
    }
  }

  return {
    id: 'package_ready',
    label: 'Official package registered',
    passed: false,
    detail: 'No official offline package is registered for this map.',
  }
}

function checkViewCoverage(input: FieldReadinessInput): FieldReadinessCheckItem {
  const {activeMapId, officialMaps, viewBounds, viewZoom, qualification} = input
  if (viewBounds === null) {
    return {
      id: 'view_covered',
      label: 'Current view covered',
      passed: false,
      detail: 'Map view is not available. Open the map and check coverage.',
    }
  }

  const readyPackage = findReadyPackage(activeMapId, officialMaps)
  if (readyPackage === undefined || readyPackage.bounds === null) {
    return {
      id: 'view_covered',
      label: 'Current view covered',
      passed: false,
      detail: 'No ready package with known bounds to check against.',
    }
  }

  const [west, south, east, north] = readyPackage.bounds
  const boundsCovered =
    viewBounds.west >= west &&
    viewBounds.east <= east &&
    viewBounds.south >= south &&
    viewBounds.north <= north
  const covered = boundsCovered && isOfficialMapId(activeMapId) && viewZoom !== undefined &&
    qualification?.status === 'complete' && qualification.totalTiles > 0 &&
    qualification.usableTiles === qualification.totalTiles &&
    officialMapViewKey(qualification) === officialMapViewKey({mapId: activeMapId, bounds: viewBounds, zoom: viewZoom}) &&
    qualification.packageIdentities.length > 0 && qualification.packageIdentities.every(identity =>
      officialMaps.packages.some(mapPackage => mapPackage.id === identity.id && mapPackage.status === 'ready' &&
        mapPackage.attestation?.sha256 === identity.sha256))

  return {
    id: 'view_covered',
    label: 'Current view covered',
    passed: covered,
    detail: covered
      ? qualification.message
      : !boundsCovered ? 'The visible area extends beyond the offline package. Pan to the mission area or use a broader package.' :
        'Use Check View to verify actual local tiles for the current area and zoom. Saved bounds alone do not prove coverage.',
  }
}

function checkSourceFallback(
  activeMapId: RenderableMapId,
  officialMaps: OfficialMapSettings,
): FieldReadinessCheckItem {
  const hasReadyPackage = findReadyPackage(activeMapId, officialMaps) !== undefined
  const hasOnlineSource =
    officialMaps.status === 'configured' &&
    officialMaps.availableSources.includes(activeMapId as OfficialMapPackageSettings['mapId'])

  if (hasReadyPackage && hasOnlineSource) {
    return {
      id: 'source_fallback',
      label: 'Fallback source available',
      passed: true,
      detail: 'Online MapGenie source is configured as fallback if the local package does not cover an area.',
    }
  }

  if (hasReadyPackage && !hasOnlineSource) {
    return {
      id: 'source_fallback',
      label: 'Fallback source available',
      passed: true,
      detail: 'Offline package is ready. Online fallback is not configured but is not required when the package covers the mission area.',
    }
  }

  if (!hasReadyPackage && hasOnlineSource) {
    return {
      id: 'source_fallback',
      label: 'Fallback source available',
      passed: false,
      detail: 'Online source is configured but no offline package is ready. Network-dependent maps are not field-safe.',
    }
  }

  return {
    id: 'source_fallback',
    label: 'Fallback source available',
    passed: false,
    detail: 'No offline package or online source is available. Import a package or configure the MapGenie source.',
  }
}

function checkLastVerified(
  activeMapId: RenderableMapId,
  officialMaps: OfficialMapSettings,
): FieldReadinessCheckItem {
  const readyPackage = findReadyPackage(activeMapId, officialMaps)
  if (readyPackage === undefined) {
    return {
      id: 'last_verified',
      label: 'Recently verified',
      passed: false,
      detail: 'No ready package to verify.',
    }
  }

  if (readyPackage.verifiedAt === '') {
    return {
      id: 'last_verified',
      label: 'Recently verified',
      passed: false,
      detail: 'Package has not been verified. Save Settings to re-validate.',
    }
  }

  return {
    id: 'last_verified',
    label: 'Recently verified',
    passed: true,
    detail: `Last verified: ${formatVerifiedTimestamp(readyPackage.verifiedAt)}.`,
  }
}

function findReadyPackage(
  activeMapId: RenderableMapId,
  officialMaps: OfficialMapSettings,
): OfficialMapPackageSettings | undefined {
  return officialMaps.packages.find(
    (p) => p.mapId === activeMapId && p.status === 'ready',
  )
}

function getLastVerifiedAt(
  activeMapId: RenderableMapId,
  officialMaps: OfficialMapSettings,
): string | null {
  const readyPackage = findReadyPackage(activeMapId, officialMaps)
  if (readyPackage === undefined || readyPackage.verifiedAt === '') return null
  return readyPackage.verifiedAt
}

function formatVerifiedTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleString('en-IE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return 'Unknown'
  }
}
