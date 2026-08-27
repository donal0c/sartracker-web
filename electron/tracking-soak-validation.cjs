const MINIMUM_SOAK_INTERVAL_MS = 5
const MAXIMUM_SOAK_INTERVAL_MS = 1_000

/**
 * Applies an accelerated polling interval only inside an explicit isolated Electron profile.
 * Production and ordinary validation runs retain the normal five-second minimum.
 */
function applyTrackingSoakRuntimeOverride(runtimeSettings, options = {}) {
  const validationUserDataPath = String(options.validationUserDataPath ?? '').trim()
  if (validationUserDataPath === '' || options.intervalInput === undefined) {
    return runtimeSettings
  }

  const intervalMs = Number(options.intervalInput)
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < MINIMUM_SOAK_INTERVAL_MS ||
    intervalMs > MAXIMUM_SOAK_INTERVAL_MS
  ) {
    throw new Error(
      `Tracking soak poll interval must be an integer between ${MINIMUM_SOAK_INTERVAL_MS} and ${MAXIMUM_SOAK_INTERVAL_MS} ms.`,
    )
  }

  return {
    ...runtimeSettings,
    trackingPollIntervalMs: intervalMs,
    trackingMinimumPollIntervalMs: intervalMs,
    // The packaged soak compresses live polling by the same factor. Keep its
    // anti-entropy repair clock in that explicit validation profile too, or a
    // deliberately late historical fix can outlive the bounded CI job even
    // though production recovery remains correctly scheduled at five minutes.
    trackingHistoryAntiEntropyIntervalMs: intervalMs,
  }
}

module.exports = {
  applyTrackingSoakRuntimeOverride,
}
