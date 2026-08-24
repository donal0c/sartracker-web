import type {
  CurrentPositionNormalizationResult,
  DeviceRosterNormalizationResult,
} from './traccar-client'
import type {
  NormalizedTrackingDevice,
} from './tracking-types'

export const ROSTER_UNAVAILABLE_WARNING =
  'DEVICE ROSTER UNAVAILABLE — current fixes are using last-known device details.'

type CurrentPositionPollClient = {
  readonly getDevices: () => Promise<readonly NormalizedTrackingDevice[]>
  readonly getDevicesWithReport?: () => Promise<DeviceRosterNormalizationResult>
  readonly getCurrentPositions: () => Promise<CurrentPositionNormalizationResult>
}

export type CurrentPositionPollResult = CurrentPositionNormalizationResult & {
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly rosterWarning: string | null
  readonly rosterFailure: unknown | null
  readonly rosterComplete: boolean
}

/**
 * Fetches roster metadata and current positions independently so roster failure
 * cannot withhold a valid current-position publication.
 */
export async function fetchRosterAndCurrentPositions(
  client: CurrentPositionPollClient,
  lastKnownDevices: readonly NormalizedTrackingDevice[],
): Promise<CurrentPositionPollResult> {
  const [rosterResult, positionsResult] = await Promise.allSettled([
    client.getDevicesWithReport?.() ?? client.getDevices().then((accepted) => ({
      accepted,
      complete: true,
    })),
    client.getCurrentPositions(),
  ])

  if (positionsResult.status === 'rejected') {
    throw positionsResult.reason
  }

  if (rosterResult.status === 'rejected') {
    return {
      ...positionsResult.value,
      devices: lastKnownDevices,
      rosterWarning: ROSTER_UNAVAILABLE_WARNING,
      rosterFailure: rosterResult.reason,
      rosterComplete: false,
    }
  }

  return {
    ...positionsResult.value,
    devices: rosterResult.value.accepted,
    rosterWarning: null,
    rosterFailure: null,
    rosterComplete: rosterResult.value.complete,
  }
}
