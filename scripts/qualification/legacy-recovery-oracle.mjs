import { createHash } from 'node:crypto'
import { canonicalJson } from './control-plane.mjs'

/** Compare every retained legacy marker against its exact migrated baseline without producer summaries. */
export function inspectLegacyMarkerCustody(database, missionId, expectedCount = 50000) {
  const markerHash = createHash('sha256')
  const versionHash = createHash('sha256')
  let count = 0
  const query = database.prepare("SELECT * FROM markers WHERE mission_id=? AND id LIKE 'legacy-marker-%' ORDER BY id")
  const versionQuery = database.prepare("SELECT * FROM mission_object_versions WHERE mission_id=? AND object_type='marker' AND object_id=? ORDER BY version_sequence")
  for (const marker of query.iterate(missionId)) {
    const versions = versionQuery.all(missionId,marker.id)
    if (versions.length !== 1) throw new Error('Legacy marker baseline is missing or duplicated.')
    const version = versions[0]
    if (version.operation !== 'legacy_baseline' || version.completeness !== 'legacy_baseline' || version.version_sequence !== 1
        || canonicalJson(JSON.parse(version.state_json)) !== canonicalJson({...marker,legacy_history_known:false,legacy_source_effective_at:marker.created_at})) throw new Error('Legacy marker baseline changed the original evidence.')
    markerHash.update(canonicalJson(marker)+'\n')
    versionHash.update(canonicalJson(version)+'\n')
    count++
  }
  if (count !== expectedCount) throw new Error('Legacy marker count differs from the fixed fixture.')
  return {count,markerSha256:markerHash.digest('hex'),baselineSha256:versionHash.digest('hex')}
}

/** Hash the ordered original rows before migration, using the same explicit canonical record framing. */
export function inspectLegacyMarkerSource(database, missionId) {
  const digest = createHash('sha256')
  let count = 0
  for (const marker of database.prepare("SELECT * FROM markers WHERE mission_id=? AND id LIKE 'legacy-marker-%' ORDER BY id").iterate(missionId)) {
    digest.update(canonicalJson(marker)+'\n'); count++
  }
  return {count,markerSha256:digest.digest('hex')}
}

/** Preserve the original GPS payload through migration while allowing separately audited provenance annotations. */
export function inspectLegacyPositionSource(database,missionId) {
  const digest = createHash('sha256')
  let count = 0
  const rows = database.prepare('SELECT id,mission_id,device_id,source_position_id,name,lat,lon,altitude,speed,battery,accuracy,source,timestamp,data_origin FROM positions WHERE mission_id=? ORDER BY id')
  for (const row of rows.iterate(missionId)) { digest.update(canonicalJson(row)+'\n'); count++ }
  return {count,sha256:digest.digest('hex')}
}
