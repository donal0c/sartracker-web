/**
 * Checks durable reconciliation against the retained mission window using only
 * bounded mission, checkpoint and coverage-ledger metadata. Roster selection
 * cannot erase a checkpoint or a device already represented in saved coverage.
 */
function hasUnreconciledCoverageHistory(database, missionId, inventoryDeviceIds) {
  const mission = database.prepare('SELECT start_time, pause_time, finish_time FROM missions WHERE id = ?').get(missionId)
  if (mission === undefined) return true
  const checkpoints = database.prepare(`SELECT device_id, history_from, reconciled_until, requested_from, requested_until
    FROM tracking_history_checkpoints WHERE mission_id = ?`).all(missionId)
  const chunks = database.prepare(`SELECT device_id, min_ts, max_ts FROM coverage_chunks
    WHERE mission_id = ?`).all(missionId)
  const byDevice = new Map(checkpoints.map((checkpoint) => [checkpoint.device_id, checkpoint]))
  const deviceIds = new Set([...inventoryDeviceIds, ...byDevice.keys(), ...chunks.map((chunk) => chunk.device_id)])
  const windowStart = Date.parse(mission.start_time)
  const windowEnd = mission.finish_time ?? mission.pause_time
  if (!Number.isFinite(windowStart)) return true
  for (const deviceId of deviceIds) {
    const checkpoint = byDevice.get(deviceId)
    if (checkpoint === undefined) return true
    const from = Date.parse(checkpoint.history_from)
    const until = Date.parse(checkpoint.reconciled_until)
    const requestedUntil = Date.parse(checkpoint.requested_until)
    const requiredFrom = Date.parse(checkpoint.requested_from)
    const latestRetained = chunks.filter((chunk) => chunk.device_id === deviceId)
      .reduce((latest, chunk) => chunk.max_ts === null ? latest : Math.max(latest, Date.parse(chunk.max_ts)), requestedUntil)
    const requiredUntil = windowEnd === null ? latestRetained : Math.max(latestRetained, Date.parse(windowEnd))
    if (!Number.isFinite(requiredUntil) || !Number.isFinite(requiredFrom)) return true
    if (!Number.isFinite(from) || !Number.isFinite(until) || from > requiredFrom || until < requiredUntil) return true
  }
  return false
}

module.exports = { hasUnreconciledCoverageHistory }
