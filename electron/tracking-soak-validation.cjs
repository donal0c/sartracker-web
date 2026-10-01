const MINIMUM_SOAK_INTERVAL_MS = 5
const MAXIMUM_SOAK_INTERVAL_MS = 1_000
// Production polls every 30 s and sweeps every 5 min.
const SOAK_POLLS_PER_SWEEP = 10

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
    // The packaged soak compresses live polling, so its anti-entropy repair
    // clock is compressed by the same factor. It keeps production's ratio of
    // one sweep per ten polls (5 min / 30 s); a sweep on every poll measured
    // ten times production's sweep load [DON-267, DON-310].
    trackingHistoryAntiEntropyIntervalMs: intervalMs * SOAK_POLLS_PER_SWEEP,
  }
}

module.exports = {
  applyTrackingSoakRuntimeOverride,
}
