import type { MissionRuntimeState } from '../mission/mission-store'
import type { MissionGovernanceRuntimeState } from '../mission/start-mission-governance-runtime'
import type { AppSettings, RuntimeBootstrapSettings } from '../settings/settings-types'
import type { TrackingConnectionStatus, TrackingSnapshot } from '../tracking/tracking-types'
import type { Mission, MissionStoreInfo } from '../../infrastructure/mission-store/tauri-mission-store'
import type { DesktopRuntimeKind } from '../../lib/desktop-runtime'

type DependencySmoke = {
  readonly hasMapLibre: boolean
  readonly hasProj4: boolean
  readonly hasTurf: boolean
  readonly hasZustand: boolean
  readonly hasTerraDraw: boolean
}

type DiagnosticsRowTone = 'default' | 'success' | 'warning' | 'danger'

export type DiagnosticsRow = {
  readonly label: string
  readonly value: string
  readonly tone?: DiagnosticsRowTone
}

export type DiagnosticsRepairSummary = {
  readonly targetMissionId: string | null
  readonly targetMissionLabel: string
  readonly available: boolean
}

export type DiagnosticsSnapshot = {
  readonly generatedAt: string
  readonly reportFileName: string
  readonly missionOptions: readonly {
    readonly id: string
    readonly label: string
  }[]
  readonly summaryRows: readonly DiagnosticsRow[]
  readonly storageRows: readonly DiagnosticsRow[]
  readonly trackingRows: readonly DiagnosticsRow[]
  readonly configurationRows: readonly DiagnosticsRow[]
  readonly warnings: readonly string[]
  readonly repair: DiagnosticsRepairSummary
  readonly supportReport: string
}

type BuildDiagnosticsSnapshotInput = {
  readonly generatedAt: string
  readonly appVersion: string
  readonly runtimeKind: DesktopRuntimeKind
  readonly userAgent: string
  readonly dependencySmoke: DependencySmoke
  readonly settings: AppSettings
  readonly runtimeBootstrap: RuntimeBootstrapSettings
  readonly missionStoreInfo: MissionStoreInfo
  readonly missions: readonly Mission[]
  readonly missionRuntime: MissionRuntimeState
  readonly governanceRuntime: MissionGovernanceRuntimeState
  readonly trackingStatus: TrackingConnectionStatus
  readonly trackingSnapshot: TrackingSnapshot
  readonly layerCatalogState: {
    readonly missionId: string | null
    readonly loading: boolean
    readonly error: string | null
    readonly metadataEntryCount: number
  }
  readonly selectedMissionId: string | null
}

/**
 * Builds the diagnostics workspace state and operator-facing support report text.
 */
export function buildDiagnosticsSnapshot(
  input: BuildDiagnosticsSnapshotInput,
): DiagnosticsSnapshot {
  const repairMission =
    resolveRepairMission(input.missions, input.selectedMissionId) ??
    input.missionRuntime.currentMission ??
    input.governanceRuntime.governanceMission ??
    undefined
  const reportFileName = `diagnostics-report-${safeTimestamp(input.generatedAt)}.txt`
  const warnings = collectWarnings(input)
  const officialMapStatus = input.settings.officialMaps?.status ?? 'not_configured'
  const officialMapPackageSummary = summarizeOfficialMapPackages(input.settings.officialMaps?.packages)
  const runtimeLabel = formatRuntimeLabel(input.runtimeKind)
  const summaryRows: readonly DiagnosticsRow[] = [
    {
      label: 'Runtime',
      value: runtimeLabel.summary,
    },
    { label: 'App version', value: input.appVersion },
    { label: 'Mission phase', value: input.missionRuntime.phase },
    { label: 'Tracking mode', value: input.trackingStatus.mode, tone: toneForTrackingMode(input.trackingStatus.mode) },
    { label: 'Open missions', value: String(input.missions.length) },
    { label: 'Generated', value: formatTimestamp(input.generatedAt) },
  ]
  const storageRows: readonly DiagnosticsRow[] = [
    { label: 'Schema version', value: String(input.missionStoreInfo.schema_version) },
    { label: 'Database path', value: input.missionStoreInfo.database_path },
    { label: 'Backup path', value: input.missionStoreInfo.backup_path },
    {
      label: 'Layer metadata entries',
      value: String(input.layerCatalogState.metadataEntryCount),
      tone: input.layerCatalogState.error === null ? 'default' : 'warning',
    },
  ]
  const trackingRows: readonly DiagnosticsRow[] = [
    { label: 'Provider', value: humanizeProvider(input.settings.dataSource.providerType) },
    {
      label: 'Provider status',
      value: input.runtimeBootstrap.trackingConfig === null ? 'not connected' : 'configured',
    },
    { label: 'Devices in snapshot', value: String(input.trackingSnapshot.devices.length) },
    { label: 'Current positions', value: String(input.trackingSnapshot.positions.length) },
    { label: 'Breadcrumb points', value: String(input.trackingSnapshot.breadcrumbs.length) },
    {
      label: 'Last success',
      value:
        input.trackingStatus.lastSuccessAt === null
          ? 'Never'
          : formatTimestamp(input.trackingStatus.lastSuccessAt),
    },
  ]
  const configurationRows: readonly DiagnosticsRow[] = [
    {
      label: 'Provider URL',
      value: redactProviderUrlCredentials(input.settings.dataSource.baseUrl) || 'Not configured',
    },
    { label: 'Auth mode', value: input.settings.dataSource.authMode },
    {
      label: 'Tracking cache',
      value: input.settings.dataSource.trackingCacheEnabled ? 'enabled' : 'disabled',
    },
    {
      label: 'Official maps',
      value: officialMapStatus.replaceAll('_', ' '),
      tone: officialMapStatus === 'configured' ? 'success' : 'warning',
    },
    {
      label: 'Official packages',
      value: officialMapPackageSummary,
      tone: officialMapPackageSummary.startsWith('0 ready') ? 'warning' : 'success',
    },
    {
      label: 'Autosave interval',
      value: `${Math.round(input.runtimeBootstrap.autosaveIntervalMs / 1000)} sec`,
    },
    {
      label: 'Tracking poll interval',
      value: `${Math.round(input.runtimeBootstrap.trackingPollIntervalMs / 1000)} sec`,
    },
    {
      label: 'Layer repair action',
      value: input.settings.advanced.repairLayerStructureAvailable ? 'available' : 'enabled in diagnostics',
    },
  ]

  return {
    generatedAt: input.generatedAt,
    reportFileName,
    missionOptions: input.missions.map((mission) => ({
      id: mission.id,
      label: `${mission.name} (${mission.status})`,
    })),
    summaryRows,
    storageRows,
    trackingRows,
    configurationRows,
    warnings,
    repair: {
      targetMissionId: repairMission?.id ?? null,
      targetMissionLabel:
        repairMission === undefined
          ? 'No mission available for repair'
          : `${repairMission.name} (${repairMission.status})`,
      available: repairMission !== undefined,
    },
    supportReport: buildSupportReport({
      ...input,
      reportFileName,
      warnings,
      repairMission,
    }),
  }
}

function buildSupportReport(
  input: BuildDiagnosticsSnapshotInput & {
    readonly reportFileName: string
    readonly warnings: readonly string[]
    readonly repairMission: Mission | undefined
  },
): string {
  const missionName = input.missionRuntime.currentMission?.name ?? 'none'
  const governanceMission = input.governanceRuntime.governanceMission?.name ?? 'none'
  const officialMapStatus = input.settings.officialMaps?.status ?? 'not_configured'
  const officialMapSourceType = input.settings.officialMaps?.sourceType ?? 'none'
  const officialMapServiceCount = input.settings.officialMaps?.serviceCount ?? 0
  const officialMapPackages = formatOfficialMapPackageReport(input.settings.officialMaps?.packages)

  return [
    'Diagnostics Report',
    `generated at: ${input.generatedAt}`,
    `report file: ${input.reportFileName}`,
    '',
    '[environment]',
    `runtime: ${formatRuntimeLabel(input.runtimeKind).report}`,
    `app version: ${input.appVersion}`,
    `user agent: ${input.userAgent}`,
    `dependencies: maplibre=${booleanWord(input.dependencySmoke.hasMapLibre)}, proj4=${booleanWord(input.dependencySmoke.hasProj4)}, turf=${booleanWord(input.dependencySmoke.hasTurf)}, zustand=${booleanWord(input.dependencySmoke.hasZustand)}, terradraw=${booleanWord(input.dependencySmoke.hasTerraDraw)}`,
    '',
    '[mission]',
    `phase: ${input.missionRuntime.phase}`,
    `current mission: ${missionName}`,
    `governance mission: ${governanceMission}`,
    `total missions: ${input.missions.length}`,
    `repair target: ${input.repairMission?.name ?? 'unavailable'}`,
    '',
    '[storage]',
    `schema version: ${input.missionStoreInfo.schema_version}`,
    `database path: ${input.missionStoreInfo.database_path}`,
    `backup path: ${input.missionStoreInfo.backup_path}`,
    `layer metadata entries: ${input.layerCatalogState.metadataEntryCount}`,
    `layer catalog state: ${input.layerCatalogState.error ?? 'healthy'}`,
    '',
    '[configuration]',
    `provider type: ${input.settings.dataSource.providerType}`,
    `provider url: ${redactProviderUrlCredentials(input.settings.dataSource.baseUrl) || 'not configured'}`,
    `auth mode: ${input.settings.dataSource.authMode}`,
    `auto connect: ${booleanWord(input.settings.dataSource.autoConnect)}`,
    `tracking cache: ${booleanWord(input.settings.dataSource.trackingCacheEnabled)}`,
    `official maps: ${officialMapStatus.replaceAll('_', ' ')}`,
    `official map source type: ${officialMapSourceType}`,
    `official map services: ${officialMapServiceCount}`,
    ...officialMapPackages,
    `runtime tracking configured: ${booleanWord(input.runtimeBootstrap.trackingConfig !== null)}`,
    `autosave interval ms: ${input.runtimeBootstrap.autosaveIntervalMs}`,
    `tracking poll interval ms: ${input.runtimeBootstrap.trackingPollIntervalMs}`,
    '',
    '[tracking]',
    `tracking mode: ${input.trackingStatus.mode}`,
    `consecutive failures: ${input.trackingStatus.consecutiveFailures}`,
    `last success: ${input.trackingStatus.lastSuccessAt ?? 'never'}`,
    `warning: ${input.trackingStatus.warning ?? 'none'}`,
    `devices in snapshot: ${input.trackingSnapshot.devices.length}`,
    `positions in snapshot: ${input.trackingSnapshot.positions.length}`,
    `breadcrumbs in snapshot: ${input.trackingSnapshot.breadcrumbs.length}`,
    ...formatBreadcrumbMetadataReport(input.trackingSnapshot.breadcrumbMetadata),
    '',
    '[warnings]',
    ...(input.warnings.length === 0 ? ['none'] : input.warnings),
  ].join('\n')
}

function summarizeOfficialMapPackages(
  input: AppSettings['officialMaps']['packages'] | undefined,
): string {
  const packages = Array.isArray(input) ? input : []
  const readyCount = packages.filter((mapPackage) => mapPackage.status === 'ready').length
  return `${readyCount} ready / ${packages.length} registered`
}

function formatOfficialMapPackageReport(
  input: AppSettings['officialMaps']['packages'] | undefined,
): readonly string[] {
  const packages = Array.isArray(input) ? input : []
  const readyCount = packages.filter((mapPackage) => mapPackage.status === 'ready').length
  return [
    `official map packages: ${packages.length}`,
    `official map packages ready: ${readyCount}`,
    ...packages.map((mapPackage, index) => formatOfficialMapPackageLine(mapPackage, index + 1)),
  ]
}

function formatOfficialMapPackageLine(
  mapPackage: AppSettings['officialMaps']['packages'][number],
  index: number,
): string {
  return [
    `official map package ${index}:`,
    mapPackage.mapId,
    mapPackage.status,
    mapPackage.sourceType,
    formatPackageZoomRange(mapPackage),
    mapPackage.tileCount > 0 ? `tiles=${mapPackage.tileCount}` : '',
    mapPackage.sizeBytes !== undefined && mapPackage.sizeBytes > 0 ? `size=${mapPackage.sizeBytes}` : '',
    mapPackage.tileFormat !== '' ? `format=${mapPackage.tileFormat}` : '',
  ].filter((value) => value !== '').join(' ')
}

function formatPackageZoomRange(
  mapPackage: AppSettings['officialMaps']['packages'][number],
): string {
  if (mapPackage.minZoom !== null && mapPackage.maxZoom !== null) {
    return `z${mapPackage.minZoom}-z${mapPackage.maxZoom}`
  }
  return ''
}

function collectWarnings(input: BuildDiagnosticsSnapshotInput): readonly string[] {
  const warnings: string[] = []

  if (input.trackingStatus.warning !== null) {
    warnings.push(input.trackingStatus.warning)
  }
  if (input.layerCatalogState.error !== null) {
    warnings.push(input.layerCatalogState.error)
  }
  if (!input.dependencySmoke.hasTerraDraw) {
    warnings.push('Terra Draw dependency smoke failed.')
  }
  if (input.runtimeBootstrap.trackingConfig === null && input.settings.dataSource.providerType === 'traccar_http') {
    warnings.push('Tracking provider is configured but runtime tracking is not connected.')
  }
  const truncatedBreadcrumbDeviceCount =
    input.trackingSnapshot.breadcrumbMetadata?.deviceBudgets.filter((budget) => budget.truncated)
      .length ?? 0
  if (truncatedBreadcrumbDeviceCount > 0) {
    warnings.push(
      `Breadcrumb history is render-budgeted for ${truncatedBreadcrumbDeviceCount} device${truncatedBreadcrumbDeviceCount === 1 ? '' : 's'}; exported diagnostics include per-device counts.`,
    )
  }

  return warnings
}

function formatBreadcrumbMetadataReport(
  metadata: TrackingSnapshot['breadcrumbMetadata'],
): readonly string[] {
  if (metadata === undefined) {
    return []
  }

  return [
    `breadcrumb render retained: ${metadata.totalRetained} of ${metadata.totalObserved}`,
    ...metadata.deviceBudgets.map((budget) =>
      [
        `breadcrumb device ${budget.deviceId}:`,
        `retained=${budget.retained}`,
        `total=${budget.total}`,
        `first=${budget.firstTimestamp ?? 'none'}`,
        `last=${budget.lastTimestamp ?? 'none'}`,
        `truncated=${budget.truncated ? 'yes' : 'no'}`,
      ].join(' '),
    ),
  ]
}

function resolveRepairMission(
  missions: readonly Mission[],
  selectedMissionId: string | null,
): Mission | undefined {
  if (selectedMissionId !== null) {
    const selectedMission = missions.find((mission) => mission.id === selectedMissionId)
    if (selectedMission !== undefined && selectedMission.status !== 'finalized') {
      return selectedMission
    }
  }

  return missions.find((mission) => mission.status !== 'finalized')
}

function toneForTrackingMode(mode: TrackingConnectionStatus['mode']): DiagnosticsRowTone {
  switch (mode) {
    case 'online':
      return 'success'
    case 'offline':
      return 'danger'
    default:
      return 'warning'
  }
}

function humanizeProvider(providerType: AppSettings['dataSource']['providerType']): string {
  return providerType === 'traccar_http' ? 'Traccar HTTP' : 'None'
}

function formatRuntimeLabel(runtimeKind: DesktopRuntimeKind): {
  readonly summary: string
  readonly report: string
} {
  switch (runtimeKind) {
    case 'electron':
      return { summary: 'Electron desktop', report: 'electron desktop' }
    case 'tauri':
      return { summary: 'Tauri desktop', report: 'tauri desktop' }
    case 'browser':
      return { summary: 'Browser validation', report: 'browser validation' }
  }
}

function booleanWord(value: boolean): string {
  return value ? 'yes' : 'no'
}

function safeTimestamp(value: string): string {
  return value.replaceAll(':', '-').replaceAll('.', '-')
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString()
}

/**
 * Redacts accidental userinfo in provider URLs without changing host/path context.
 */
function redactProviderUrlCredentials(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') {
    return ''
  }

  return trimmed.replace(/\b(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
}
