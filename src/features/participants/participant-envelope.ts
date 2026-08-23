const SUPPORTED_ACTIVE_DEVICE_COUNT = 100

export type ParticipantEnvelopeAssessment = {
  readonly activeDeviceIds: readonly string[]
  readonly activeDeviceCount: number
  readonly warning: string | null
}

/** Warns beyond the qualified envelope while preserving every selected device. */
export function assessParticipantEnvelope(
  deviceIds: readonly string[],
): ParticipantEnvelopeAssessment {
  const activeDeviceIds = [...new Set(deviceIds)]
  return {
    activeDeviceIds,
    activeDeviceCount: activeDeviceIds.length,
    warning:
      activeDeviceIds.length > SUPPORTED_ACTIVE_DEVICE_COUNT
        ? `This mission has ${activeDeviceIds.length} active selected devices, beyond the supported and qualified envelope of 100. Performance and qualification guarantees do not extend past 100; all selected devices will still be included.`
        : null,
  }
}
