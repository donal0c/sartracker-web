'use strict'

/**
 * Coalesces normalized device observations inside the caller's existing SQLite
 * transaction. Call record only where the original ingest path updates devices,
 * then flush before completing the transaction. This owns no durable state.
 */
function createBulkDeviceObservationWriter(writeObservation) {
  const pending = new Map()

  /** Writes and removes one pending observation, leaving other devices alone. */
  function flushDevice(deviceId) {
    const timestamp = pending.get(deviceId)
    if (timestamp !== undefined) {
      writeObservation(deviceId, timestamp)
      pending.delete(deviceId)
    }
  }

  /** Retains the newest canonical UTC timestamp without changing SQL date semantics. */
  function record(deviceId, timestamp) {
    // SQLite julianday cannot compare expanded ISO years. Preserve the original
    // per-device write order around those accepted dates, including NULL state.
    if (!/^\d{4}-/u.test(timestamp)) {
      flushDevice(deviceId)
      writeObservation(deviceId, timestamp)
      return
    }
    const previous = pending.get(deviceId)
    if (previous === undefined || timestamp > previous) pending.set(deviceId, timestamp)
  }

  /** Publishes pending observations through the caller's unchanged UPDATE statement. */
  function flush() {
    for (const deviceId of pending.keys()) flushDevice(deviceId)
  }

  return { record, flush }
}

module.exports = { createBulkDeviceObservationWriter }
