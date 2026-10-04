import type {
  NormalizedTrackingDevice,
  NormalizedTraccarGroup,
} from '../tracking/tracking-types'

/** One fresh read of the groups and devices the tracking account may see. */
export type ParticipantCatalogue = {
  readonly groups: readonly NormalizedTraccarGroup[]
  readonly devices: readonly NormalizedTrackingDevice[]
  /** False when the device list was cut short by rejected rows. */
  readonly rosterComplete: boolean
}

/**
 * Reads the authorised Traccar catalogue on demand. It resolves `null` when
 * the connection, runtime or provider changed while the read was in flight,
 * so the answer can no longer be trusted. It never enrols anyone.
 */
export type ParticipantCatalogueSource = () => Promise<ParticipantCatalogue | null>
