'use strict'

const SILENT_PHASE_OVERHEAD_MS = 60_000
const MIN_VALIDATION_BYTES_PER_SECOND = 4 * 1024 * 1024
const MAX_LEGACY_VALIDATION_WORK_BYTES = 24 * 1024 * 1024 * 1024

/**
 * Gives non-instrumentable SQLite work a deadline derived from exact input bytes.
 * Frame/table progress retains the ordinary sixty-second watchdog; this exception stays
 * finite and assumes a conservative supported-host floor of 4 MiB/s plus one minute.
 */
function deriveArchiveWorkloadWatchdogMs(progress, baselineMs) {
  if (!['validate', 'sqlite'].includes(progress?.phase)
    || progress.unit !== 'bytes'
    || !Number.isSafeInteger(progress.total)
    || progress.total < 1) return baselineMs
  const workloadMs = SILENT_PHASE_OVERHEAD_MS
    + Math.ceil(progress.total / MIN_VALIDATION_BYTES_PER_SECOND) * 1_000
  return Math.max(baselineMs, workloadMs)
}

module.exports = {
  MAX_LEGACY_VALIDATION_WORK_BYTES,
  deriveArchiveWorkloadWatchdogMs,
}
