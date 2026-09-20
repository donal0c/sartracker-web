import { createHash } from 'node:crypto'

/** Independently stream the fixed Traccar fixture in event-time order, bounded by recorded knowledge. */
export function createReplayScaleOracle(database, missionId, selectedTime) {
  if (!Number.isFinite(Date.parse(selectedTime))) throw new Error('Replay selected time is invalid.')
  const parameters = [missionId, selectedTime, selectedTime, selectedTime]
  const predicate = "mission_id=? AND timestamp_source='fix' AND timestamp<=? AND received_at<=? AND COALESCE(timestamp_provenance_recorded_at,received_at)<=?"
  const count = database.prepare(`SELECT COUNT(*) AS count FROM positions WHERE ${predicate}`).get(...parameters).count
  const iterator = database.prepare(`SELECT * FROM positions WHERE ${predicate} ORDER BY timestamp,received_at,id`).iterate(...parameters)
  const digest = createHash('sha256')
  let observed = 0
  let closed = false
  return {
    expectedCount: count,
    /** Check every delivered point against the next independent SQLite source row. */
    accept(result) {
      if (closed || result?.missionId !== missionId || result.selectedTime !== selectedTime
          || result.totalTrackCount !== count || !Array.isArray(result.tracks) || result.tracks.length > 1000) throw new Error('Replay scale page identity or bound differs.')
      for (const point of result.tracks) {
        const next = iterator.next()
        const row = next.value
        if (next.done || point.evidence_id !== row.id || point.track_id !== row.device_id
            || point.effective_at !== row.timestamp || point.recorded_at !== row.received_at
            || point.lat !== row.lat || point.lon !== row.lon || point.elevation !== row.altitude
            || point.accuracy !== row.accuracy || point.source_type !== 'traccar_fix'
            || point.time_authority !== 'fixTime' || point.completeness !== 'complete') throw new Error('Replay scale point differs from transaction-time source truth.')
        digest.update(JSON.stringify([row.id,row.device_id,row.timestamp,row.received_at,row.lat,row.lon,row.altitude,row.accuracy]) + '\n')
        observed++
      }
    },
    /** Require exact exhaustion, including the empty-before-knowledge lane. */
    finish() {
      if (closed || observed !== count || !iterator.next().done) throw new Error('Replay scale source was omitted or repeated.')
      closed = true
      iterator.return()
      return { count: observed, sha256: digest.digest('hex') }
    },
    /** Release the SQLite iterator after a failed page. */
    close() { if (!closed) { closed = true; iterator.return() } },
  }
}
