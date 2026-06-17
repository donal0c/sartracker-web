import type {
  AppSettings,
  AppSettingsDraft,
  RuntimeBootstrapSettings,
} from '../features/settings/settings-types'
import type { GpxImportFileInput } from '../features/gpx/start-gpx-runtime'
import type { LayerCatalogStore } from '../infrastructure/layer-catalog-store/tauri-layer-catalog-store'
import type { MissionStore } from '../infrastructure/mission-store/tauri-mission-store'

export type ElectronTraccarHttpRequest = {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string | null
  readonly timeoutMs: number | null
}

export type ElectronTraccarHttpResponse = {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
}

export type ElectronOfficialMapTileResponse = {
  readonly contentType: string
  readonly bytesBase64: string
}

export type CrashRecoveryCrash = {
  readonly ts: string
  readonly kind: string
  readonly summary: string
  readonly detail?: string
}

export type CrashRecoveryState = {
  readonly uncleanShutdown: boolean
  readonly lastCrash: CrashRecoveryCrash | null
}

export type SupportBundleTimeFrame = {
  readonly incidentAt: string
  readonly beforeMinutes: number
  readonly afterMinutes: number
}

export type SupportBundleExportOptions = {
  readonly timeFrame?: SupportBundleTimeFrame
}

export type SarTrackerElectronBridge = {
  readonly loadAppSettings: () => Promise<AppSettings>
  readonly saveAppSettings: (input: AppSettingsDraft) => Promise<AppSettings>
  readonly testTrackingConnection?: (input: AppSettingsDraft) => Promise<{
    readonly ok: boolean
    readonly message: string
  }>
  readonly loadRuntimeBootstrapSettings: (
    forceConnect: boolean,
  ) => Promise<RuntimeBootstrapSettings>
  readonly readTrackingCache: () => Promise<string | null>
  readonly writeTrackingCache: (contents: string) => Promise<string>
  readonly exportDiagnosticsReport: (input: {
    readonly fileName: string
    readonly contents: string
  }) => Promise<string>
  readonly exportSupportBundle?: (input: {
    readonly fileName: string
    readonly contents: string
    readonly timeFrame?: SupportBundleTimeFrame
  }) => Promise<string>
  readonly readCrashRecoveryState?: () => Promise<CrashRecoveryState>
  readonly chooseGpxFilePaths: () => Promise<readonly string[]>
  readonly chooseGpxDirectoryPath: () => Promise<string | null>
  readonly chooseOfficialMapSourceFilePath?: () => Promise<string | null>
  readonly chooseOfficialMapPackagePath?: () => Promise<string | null>
  readonly importOfficialMapPackage?: (input: {
    readonly sourcePath: string
    readonly mapId: string
  }) => Promise<{
    readonly packagePath: string
    readonly sizeBytes: number
    readonly replacedExisting: boolean
    readonly message: string
  }>
  readonly readGpxFiles: (
    paths: readonly string[],
  ) => Promise<readonly GpxImportFileInput[]>
  readonly listGpxDirectoryFiles: (
    directoryPath: string,
  ) => Promise<readonly GpxImportFileInput[]>
  readonly ingestMarkerAttachment: (input: {
    readonly missionId: string
    readonly fileName: string
    readonly bytesBase64: string
  }) => Promise<string>
  readonly openExternalPath: (path: string) => Promise<void>
  readonly openExternalUrl?: (url: string) => Promise<void>
  readonly fetchOfficialMapTile?: (url: string) => Promise<ElectronOfficialMapTileResponse>
  readonly missionStore: MissionStore
  readonly layerCatalogStore: LayerCatalogStore
  readonly traccarHttpRequest: (
    input: ElectronTraccarHttpRequest,
  ) => Promise<ElectronTraccarHttpResponse>
}

declare global {
  interface Window {
    readonly sartrackerElectron?: SarTrackerElectronBridge
  }
}
