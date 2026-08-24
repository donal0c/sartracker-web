import type { CoverageManifest } from '../../infrastructure/mission-store/tauri-mission-store'
import type { NormalizedTrackingDevice } from '../tracking/tracking-types'
import { coveragePeriodKey } from '../tracking/coverage-filter-store'

export type CoverageCatalogInput = {
  readonly devices: readonly {
    readonly deviceId: string
    readonly label: string
    readonly visible: boolean
  }[]
  readonly periods: readonly {
    readonly periodKey: string
    readonly label: string
    readonly visible: boolean
  }[]
}

/**
 * Projects only manifest-authorized devices into renderer coverage controls.
 * Discovery data may supply a label but can never add a coverage identity.
 */
export function buildCoverageCatalogInput(
  manifest: CoverageManifest,
  discoveredDevices: readonly NormalizedTrackingDevice[],
  omittedDeviceIds: readonly string[],
  omittedPeriodKeys: readonly string[],
): CoverageCatalogInput {
  const deviceLabels = new Map(
    discoveredDevices.map((device) => [device.device_id, device.name]),
  )
  const deviceIds = [...new Set(manifest.chunks.map((chunk) => chunk.key.device_id))]
  const outingLabels = new Map(manifest.outings.map((outing) => [outing.id, outing.label]))
  const periodKeys = [...new Set(manifest.chunks.map((chunk) => coveragePeriodKey(chunk.key)))]
  return {
    devices: deviceIds.map((deviceId) => ({
      deviceId,
      label: deviceLabels.get(deviceId) ?? deviceId,
      visible: !omittedDeviceIds.includes(deviceId),
    })),
    periods: periodKeys.map((periodKey) => {
      const [kind, id = ''] = periodKey.split('\u0000')
      return {
        periodKey,
        label: kind === 'unassigned' ? 'Outside outings' : outingLabels.get(id) ?? 'Outing',
        visible: !omittedPeriodKeys.includes(periodKey),
      }
    }),
  }
}
