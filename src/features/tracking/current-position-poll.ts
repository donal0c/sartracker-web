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

type CurrentPositionPollOptions = {
  readonly rosterGraceMs?: number
  readonly setTimeout?: typeof globalThis.setTimeout
  readonly settleRosterGrace?: Promise<void>
}

/**
 * Fetches roster metadata and current positions independently so roster failure
 * cannot withhold a valid current-position publication.
 */
export async function fetchRosterAndCurrentPositions(
  client: CurrentPositionPollClient,
  lastKnownDevices: readonly NormalizedTrackingDevice[],
  options: CurrentPositionPollOptions = {},
): Promise<CurrentPositionPollResult> {
  const rosterPromise = Promise.resolve(
    client.getDevicesWithReport?.() ?? client.getDevices().then((accepted) => ({
      accepted,
      complete: true,
    })),
  )
  const positions = await client.getCurrentPositions()
  const rosterResult = await settleRosterWithinGrace(
    rosterPromise,
    options.rosterGraceMs ?? 50,
    options.setTimeout ?? globalThis.setTimeout,
    options.settleRosterGrace,
  )

  if (rosterResult.status === 'pending') {
    return {
      ...positions,
      devices: lastKnownDevices,
      rosterWarning: 'Current fixes loaded; refreshing device roster.',
      rosterFailure: null,
      rosterComplete: false,
    }
  }
  if (rosterResult.status === 'rejected') {
    return {
      ...positions,
      devices: lastKnownDevices,
      rosterWarning: ROSTER_UNAVAILABLE_WARNING,
      rosterFailure: rosterResult.reason,
      rosterComplete: false,
    }
  }

  return {
    ...positions,
    devices: rosterResult.value.accepted,
    rosterWarning: null,
    rosterFailure: null,
    rosterComplete: rosterResult.value.complete,
  }
}

/** Waits only the small metadata grace period; roster transport remains detached. */
async function settleRosterWithinGrace(
  roster: Promise<DeviceRosterNormalizationResult>,
  graceMs: number,
  scheduleTimeout: typeof globalThis.setTimeout,
  settleRosterGrace?: Promise<void>,
): Promise<
  | { readonly status: 'fulfilled'; readonly value: DeviceRosterNormalizationResult }
  | { readonly status: 'rejected'; readonly reason: unknown }
  | { readonly status: 'pending' }
> {
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null
  const grace = new Promise<{ readonly status: 'pending' }>((resolve) => {
    timer = scheduleTimeout(() => resolve({ status: 'pending' }), graceMs)
  })
  const settled = roster.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  )
  const forced = settleRosterGrace?.then(() => ({ status: 'pending' as const }))
  const result = await Promise.race(
    forced === undefined ? [settled, grace] : [settled, grace, forced],
  )
  if (timer !== null) globalThis.clearTimeout(timer)
  return result
}
