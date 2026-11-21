import type { AppSettingsDraft } from './settings-types'

/** Adds a just-imported package as pending until the next save validates it. */
export function addPendingOfficialMapPackage(input: {
  readonly packages: AppSettingsDraft['officialMaps']['packages']
  readonly packagePath: string
  readonly message: string
  readonly sizeBytes: number
}): AppSettingsDraft['officialMaps']['packages'] {
  const normalizedPath = input.packagePath.trim()
  if (normalizedPath === '') {
    return input.packages
  }

  const pendingPackage: AppSettingsDraft['officialMaps']['packages'][number] = {
    id: 'official_discovery_topo-pending',
    sourceType: 'mbtiles',
    mapId: 'official_discovery_topo',
    packagePath: normalizedPath,
    status: 'pending',
    bounds: null,
    minZoom: null,
    maxZoom: null,
    tileCount: 0,
    tileFormat: '',
    sizeBytes: input.sizeBytes,
    createdAt: '',
    verifiedAt: '',
    message: `${input.message} Pending validation after save.`,
  }

  return [
    ...input.packages.filter(
      (mapPackage) =>
        mapPackage.mapId !== pendingPackage.mapId ||
        mapPackage.packagePath !== pendingPackage.packagePath,
    ),
    pendingPackage,
  ]
}

/** Words for the configured official map source status. */
export function formatOfficialMapStatus(status: AppSettingsDraft['officialMaps']['status']): string {
  switch (status) {
    case 'configured':
      return 'Configured'
    case 'missing':
      return 'Missing'
    case 'invalid':
      return 'Invalid'
    default:
      return 'Not configured'
  }
}
