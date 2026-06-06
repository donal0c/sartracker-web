import type {
  OfficialMapId,
} from '../../lib/map-config'
import type { OfficialMapSourceStatus } from './official-map-source'

export type CoordinateDisplayMode = 'wgs84_first' | 'tm65_first'

export type TrackingProviderType = 'none' | 'traccar_http'

export type TrackingAuthMode = 'basic' | 'bearer'

export type MissionDefaultsSettings = {
  readonly autoRefreshEnabled: boolean
  readonly autoRefreshIntervalSeconds: number
  readonly autoSaveEnabled: boolean
  readonly autoSaveIntervalSeconds: number
  readonly primaryMissionRoot: string
  readonly backupMissionRoot: string
  readonly coordinatorRoster: readonly string[]
  readonly adminRoster: readonly string[]
}

export type DataSourceSettings = {
  readonly providerType: TrackingProviderType
  readonly baseUrl: string
  readonly authMode: TrackingAuthMode
  readonly email: string
  readonly autoConnect: boolean
  readonly trackingCacheEnabled: boolean
  readonly replayEnabled: boolean
  readonly replayStart: string
  readonly replayDurationHours: number
  readonly secretPresent: boolean
}

export type AdvancedSettings = {
  readonly repairLayerStructureAvailable: boolean
}

export type WeatherLinkSettings = {
  readonly name: string
  readonly url: string
}

export type WeatherSettings = {
  readonly links: readonly WeatherLinkSettings[]
}

export type OfficialMapSourceType = 'none' | 'mapgenie_file'

export type OfficialMapPackageSourceType = 'mbtiles'

export type OfficialMapPackageStatus = 'ready' | 'missing' | 'invalid' | 'pending'

export type OfficialMapPackageSettings = {
  readonly id: string
  readonly sourceType: OfficialMapPackageSourceType
  readonly mapId: OfficialMapId
  readonly packagePath: string
  readonly status: OfficialMapPackageStatus
  readonly bounds: readonly [number, number, number, number] | null
  readonly minZoom: number | null
  readonly maxZoom: number | null
  readonly tileCount: number
  readonly tileFormat: string
  readonly createdAt: string
  readonly verifiedAt: string
  readonly message: string
}

export type OfficialMapSettings = {
  readonly sourceType: OfficialMapSourceType
  readonly sourcePath: string
  readonly status: OfficialMapSourceStatus
  readonly username: string
  readonly availableSources: readonly OfficialMapId[]
  readonly serviceCount: number
  readonly message: string
  readonly packages: readonly OfficialMapPackageSettings[]
}

export type AppSettings = {
  readonly missionDefaults: MissionDefaultsSettings
  readonly dataSource: DataSourceSettings
  readonly officialMaps: OfficialMapSettings
  readonly weather: WeatherSettings
  readonly advanced: AdvancedSettings
}

export type AppSettingsDraft = {
  readonly missionDefaults: MissionDefaultsSettings
  readonly dataSource: DataSourceSettings & {
    readonly secretInput: string
    readonly clearSecret: boolean
  }
  readonly officialMaps: OfficialMapSettings
  readonly weather: {
    readonly links: readonly WeatherLinkSettings[]
  }
}

export type RuntimeBootstrapSettings = {
  readonly autosaveEnabled: boolean
  readonly autosaveIntervalMs: number
  readonly trackingPollIntervalMs: number
  readonly trackingCacheEnabled: boolean
  readonly trackingConfig: {
    readonly baseUrl: string
    readonly email?: string
    readonly password?: string
    readonly token?: string
  } | null
  readonly trackingDisabledReason?: string
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  missionDefaults: {
    autoRefreshEnabled: true,
    autoRefreshIntervalSeconds: 30,
    autoSaveEnabled: true,
    autoSaveIntervalSeconds: 30,
    primaryMissionRoot: '',
    backupMissionRoot: '',
    coordinatorRoster: [],
    adminRoster: [],
  },
  dataSource: {
    providerType: 'none',
    baseUrl: '',
    authMode: 'basic',
    email: '',
    autoConnect: true,
    trackingCacheEnabled: true,
    replayEnabled: false,
    replayStart: '',
    replayDurationHours: 4,
    secretPresent: false,
  },
  officialMaps: {
    sourceType: 'none',
    sourcePath: '',
    status: 'not_configured',
    username: '',
    availableSources: [],
    serviceCount: 0,
    message: 'Official maps are not configured.',
    packages: [],
  },
  weather: {
    links: [],
  },
  advanced: {
    repairLayerStructureAvailable: false,
  },
}

export function createSettingsDraft(settings: AppSettings): AppSettingsDraft {
  const officialMaps = {
    ...DEFAULT_APP_SETTINGS.officialMaps,
    ...settings.officialMaps,
    availableSources: [...(settings.officialMaps?.availableSources ?? [])],
    packages: [...(settings.officialMaps?.packages ?? [])],
  }

  return {
    missionDefaults: {
      ...settings.missionDefaults,
      coordinatorRoster: [...settings.missionDefaults.coordinatorRoster],
      adminRoster: [...settings.missionDefaults.adminRoster],
    },
    dataSource: {
      ...settings.dataSource,
      secretInput: '',
      clearSecret: false,
    },
    officialMaps: {
      ...officialMaps,
    },
    weather: {
      links: [...settings.weather.links],
    },
  }
}
