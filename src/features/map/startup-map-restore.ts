import {
  DEFAULT_BASEMAP_ID,
  getRenderableMapLabel,
  isOfficialMapId,
  type OfficialMapId,
  type RenderableMapId,
} from '../../lib/map-config'
import type { OfficialMapSettings } from '../settings/settings-types'

export type StartupMapRestore =
  | { readonly kind: 'none' }
  | { readonly kind: 'restore'; readonly mapId: OfficialMapId }
  | { readonly kind: 'unavailable'; readonly mapId: OfficialMapId; readonly message: string }

/**
 * Decides whether startup may restore the operator's stored official map.
 * Only a local package verified ready at this launch is restored, because
 * field use is often off-network. Anything else falls back visibly to the
 * online default with the reason, never silently [DON-304].
 */
export function resolveStartupMapRestore(input: {
  readonly storedMapId: RenderableMapId | null
  readonly officialMaps: OfficialMapSettings | null
}): StartupMapRestore {
  const { storedMapId } = input
  if (storedMapId === null || !isOfficialMapId(storedMapId)) {
    return { kind: 'none' }
  }

  const unavailable = (reason: string): StartupMapRestore => ({
    kind: 'unavailable',
    mapId: storedMapId,
    message: `${getRenderableMapLabel(storedMapId)} unavailable: ${reason} — showing `
      + `${getRenderableMapLabel(DEFAULT_BASEMAP_ID)}. Fix it in Settings, then choose it again from Maps.`,
  })

  if (input.officialMaps === null) {
    return unavailable('map settings could not be read')
  }
  const packages = input.officialMaps.packages.filter((mapPackage) => mapPackage.mapId === storedMapId)
  if (packages.some((mapPackage) => mapPackage.status === 'ready')) {
    return { kind: 'restore', mapId: storedMapId }
  }
  if (packages.some((mapPackage) => mapPackage.status === 'missing')) {
    return unavailable('its offline package cannot be found')
  }
  if (packages.some((mapPackage) => mapPackage.status === 'invalid')) {
    return unavailable('its offline package is unreadable or changed')
  }
  return unavailable('no verified offline package')
}
