import { getRenderableMapLabel, type OfficialMapId } from '../../lib/map-config'
import type { OfficialMapPackageSettings } from '../settings/settings-types'

export type PackageCategory = 'standard' | 'mission_area' | 'national'

export type PackageCategoryInfo = {
  readonly category: PackageCategory
  readonly label: string
  readonly tone: 'success' | 'warning' | 'neutral'
  readonly guidance: string
}

const TWO_GB = 2 * 1024 * 1024 * 1024
const FOUR_GB = 4 * 1024 * 1024 * 1024

/**
 * Classifies a package by size into standard, mission-area, or national.
 */
export function classifyPackageCategory(sizeBytes: number | undefined | null): PackageCategoryInfo {
  if (sizeBytes === undefined || sizeBytes === null || sizeBytes <= 0) {
    return {
      category: 'standard',
      label: 'Standard',
      tone: 'success',
      guidance: 'Standard operating-area package. Recommended for most operations.',
    }
  }

  if (sizeBytes >= FOUR_GB) {
    return {
      category: 'national',
      label: 'National',
      tone: 'warning',
      guidance:
        'Large package — prepare before a mission, not during one. ' +
        'Full-national Discovery maps require sufficient free disk space ' +
        'and should be prepared by an admin in advance.',
    }
  }

  if (sizeBytes >= TWO_GB) {
    return {
      category: 'mission_area',
      label: 'Mission Area',
      tone: 'neutral',
      guidance: 'Mission-area package — verify coverage matches the intended search area before deployment.',
    }
  }

  return {
    category: 'standard',
    label: 'Standard',
    tone: 'success',
    guidance: 'Standard operating-area package. Recommended for most operations.',
  }
}

export type ManifestCoverageStatus = 'covered' | 'outside' | 'unknown'

export type ManifestCoverageTone = 'success' | 'danger' | 'neutral'

export type PackageManifestBoundsDisplay = {
  readonly west: string
  readonly south: string
  readonly east: string
  readonly north: string
  readonly summary: string
}

export type PackageManifestEntry = {
  readonly id: string
  readonly mapLabel: string
  readonly mapId: OfficialMapId
  readonly status: OfficialMapPackageSettings['status']
  readonly sourceType: string
  readonly tileFormat: string
  readonly tileCount: number
  readonly minZoom: number | null
  readonly maxZoom: number | null
  readonly zoomRangeDisplay: string
  readonly sizeBytes: number | null
  readonly sizeDisplay: string
  readonly bounds: PackageManifestBoundsDisplay | null
  readonly createdAt: string
  readonly createdAtDisplay: string
  readonly verifiedAt: string
  readonly verifiedAtDisplay: string
  readonly statusMessage: string
}

export type PackageManifestCoverageCheck = {
  readonly packageId: string
  readonly status: ManifestCoverageStatus
  readonly tone: ManifestCoverageTone
  readonly label: string
  readonly detail: string
}

export type ReadinessCertificate = {
  readonly generatedAt: string
  readonly packageCount: number
  readonly readyCount: number
  readonly entries: readonly ReadinessCertificateEntry[]
  readonly reportText: string
}

export type ReadinessCertificateEntry = {
  readonly mapLabel: string
  readonly status: string
  readonly zoomRange: string
  readonly tileCount: string
  readonly tileFormat: string
  readonly size: string
  readonly bounds: string
  readonly createdAt: string
  readonly verifiedAt: string
}

/**
 * Builds a full manifest entry from a stored package settings record.
 * All fields are sanitized — no paths, credentials, or source URLs.
 */
export function buildPackageManifestEntry(
  packageSettings: OfficialMapPackageSettings,
): PackageManifestEntry {
  return {
    id: packageSettings.id,
    mapLabel: getRenderableMapLabel(packageSettings.mapId),
    mapId: packageSettings.mapId,
    status: packageSettings.status,
    sourceType: formatSourceType(packageSettings.sourceType),
    tileFormat: formatTileFormat(packageSettings.tileFormat),
    tileCount: packageSettings.tileCount,
    minZoom: packageSettings.minZoom,
    maxZoom: packageSettings.maxZoom,
    zoomRangeDisplay: formatZoomRangeDisplay(packageSettings.minZoom, packageSettings.maxZoom),
    sizeBytes: packageSettings.sizeBytes ?? null,
    sizeDisplay: formatSizeDisplay(packageSettings.sizeBytes),
    bounds: formatBoundsDisplay(packageSettings.bounds),
    createdAt: packageSettings.createdAt,
    createdAtDisplay: formatTimestampDisplay(packageSettings.createdAt),
    verifiedAt: packageSettings.verifiedAt,
    verifiedAtDisplay: formatTimestampDisplay(packageSettings.verifiedAt),
    statusMessage: packageSettings.message,
  }
}

/**
 * Checks whether a given viewport is covered by the package bounds.
 */
export function checkManifestCoverage(
  packageSettings: OfficialMapPackageSettings,
  viewBounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number },
): PackageManifestCoverageCheck {
  const mapLabel = getRenderableMapLabel(packageSettings.mapId)

  if (packageSettings.status !== 'ready') {
    return {
      packageId: packageSettings.id,
      status: 'unknown',
      tone: 'neutral',
      label: 'Package not ready',
      detail: `${mapLabel}: package is ${packageSettings.status}. Coverage cannot be verified.`,
    }
  }

  if (packageSettings.bounds === null) {
    return {
      packageId: packageSettings.id,
      status: 'unknown',
      tone: 'neutral',
      label: 'Bounds unknown',
      detail: `${mapLabel}: package bounds are not recorded. Coverage cannot be verified.`,
    }
  }

  const [west, south, east, north] = packageSettings.bounds
  const covered =
    viewBounds.west >= west &&
    viewBounds.east <= east &&
    viewBounds.south >= south &&
    viewBounds.north <= north

  if (covered) {
    return {
      packageId: packageSettings.id,
      status: 'covered',
      tone: 'success',
      label: 'View covered',
      detail: `${mapLabel}: the current operational area is fully inside this package.`,
    }
  }

  return {
    packageId: packageSettings.id,
    status: 'outside',
    tone: 'danger',
    label: 'View outside package',
    detail: `${mapLabel}: the current operational area extends beyond this package. Online fallback or a broader package is required.`,
  }
}

/**
 * Generates a sanitized readiness certificate suitable for export or sharing.
 * No private paths, credentials, source URLs, or tile contents are included.
 */
export function buildReadinessCertificate(
  packages: readonly OfficialMapPackageSettings[],
  generatedAt: string,
): ReadinessCertificate {
  const readyCount = packages.filter((p) => p.status === 'ready').length
  const entries: ReadinessCertificateEntry[] = packages.map((p) => ({
    mapLabel: getRenderableMapLabel(p.mapId),
    status: formatCertificateStatus(p.status),
    zoomRange: formatZoomRangeDisplay(p.minZoom, p.maxZoom),
    tileCount: p.tileCount > 0 ? p.tileCount.toLocaleString() : 'Unknown',
    tileFormat: formatTileFormat(p.tileFormat),
    size: formatSizeDisplay(p.sizeBytes),
    bounds: formatCertificateBounds(p.bounds),
    createdAt: formatTimestampDisplay(p.createdAt),
    verifiedAt: formatTimestampDisplay(p.verifiedAt),
  }))

  return {
    generatedAt,
    packageCount: packages.length,
    readyCount,
    entries,
    reportText: buildReadinessCertificateText(entries, generatedAt, packages.length, readyCount),
  }
}

function buildReadinessCertificateText(
  entries: readonly ReadinessCertificateEntry[],
  generatedAt: string,
  packageCount: number,
  readyCount: number,
): string {
  const lines: string[] = [
    'SAR Tracker — Official Map Readiness Certificate',
    `Generated: ${formatTimestampDisplay(generatedAt)}`,
    '',
    `Packages registered: ${packageCount}`,
    `Packages ready: ${readyCount}`,
    '',
    '---',
  ]

  if (entries.length === 0) {
    lines.push('', 'No official map packages are registered.')
  }

  for (const entry of entries) {
    lines.push(
      '',
      `Map: ${entry.mapLabel}`,
      `Status: ${entry.status}`,
      `Zoom range: ${entry.zoomRange}`,
      `Tile count: ${entry.tileCount}`,
      `Tile format: ${entry.tileFormat}`,
      `Package size: ${entry.size}`,
      `Coverage bounds: ${entry.bounds}`,
      `Created: ${entry.createdAt}`,
      `Verified: ${entry.verifiedAt}`,
    )
  }

  lines.push(
    '',
    '---',
    '',
    'This certificate confirms the registered official map packages at the time of generation.',
    'Verify coverage for your specific operational area using the in-app coverage check before deployment.',
    '',
    'SAFETY: This certificate does not guarantee coverage for any specific location.',
    'Always perform a live coverage check against the mission area before relying on offline maps.',
  )

  return lines.join('\n')
}

function formatSourceType(sourceType: string): string {
  if (sourceType === 'mbtiles') return 'MBTiles'
  return sourceType || 'Unknown'
}

function formatTileFormat(tileFormat: string): string {
  if (tileFormat === '') return 'Unknown'
  return tileFormat.toUpperCase()
}

function formatZoomRangeDisplay(minZoom: number | null, maxZoom: number | null): string {
  if (minZoom !== null && maxZoom !== null) {
    return `z${minZoom} – z${maxZoom}`
  }
  if (minZoom !== null) return `z${minZoom}+`
  if (maxZoom !== null) return `up to z${maxZoom}`
  return 'Unknown'
}

function formatSizeDisplay(sizeBytes: number | undefined | null): string {
  if (sizeBytes === undefined || sizeBytes === null || sizeBytes <= 0) {
    return 'Unknown'
  }

  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatBoundsDisplay(
  bounds: readonly [number, number, number, number] | null,
): PackageManifestBoundsDisplay | null {
  if (bounds === null) return null

  const [west, south, east, north] = bounds
  return {
    west: formatCoordinate(west, 'lon'),
    south: formatCoordinate(south, 'lat'),
    east: formatCoordinate(east, 'lon'),
    north: formatCoordinate(north, 'lat'),
    summary: `${formatCoordinate(south, 'lat')} to ${formatCoordinate(north, 'lat')}, ${formatCoordinate(west, 'lon')} to ${formatCoordinate(east, 'lon')}`,
  }
}

function formatCertificateBounds(bounds: readonly [number, number, number, number] | null): string {
  if (bounds === null) return 'Unknown'
  const display = formatBoundsDisplay(bounds)
  return display?.summary ?? 'Unknown'
}

function formatCoordinate(value: number, axis: 'lat' | 'lon'): string {
  const absValue = Math.abs(value)
  const degrees = absValue.toFixed(4)
  if (axis === 'lat') {
    return value >= 0 ? `${degrees}°N` : `${degrees}°S`
  }
  return value >= 0 ? `${degrees}°E` : `${degrees}°W`
}

function formatTimestampDisplay(timestamp: string): string {
  if (timestamp === '') return 'Not recorded'
  try {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return 'Invalid'
    return date.toLocaleString('en-IE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return 'Invalid'
  }
}

function formatCertificateStatus(status: OfficialMapPackageSettings['status']): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'missing':
      return 'Missing'
    case 'invalid':
      return 'Unreadable'
    case 'pending':
      return 'Pending validation'
  }
}
