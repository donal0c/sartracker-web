import assert from 'node:assert/strict'

const MARKER_AUDIT_EVENT_TYPES = new Set([
  'marker_created',
  'marker_updated',
  'marker_deleted',
])

/**
 * Verifies the complete immutable custody and audit identity of one marker
 * created after legacy recovery has settled.
 *
 * The caller supplies rows read from the current marker projection,
 * mission_object_versions, and mission_events tables. Keeping this oracle
 * independent from SQLite makes its rejection controls usable without a
 * packaged Electron run.
 */
export function assertPostSettlementMarkerCustody(input) {
  const missionId = input?.missionId
  const marker = input?.marker
  assert.ok(typeof missionId === 'string' && missionId.length > 0, 'Mutation mission identity is required.')
  assert.ok(marker !== null && typeof marker === 'object', 'Post-settlement marker projection is missing.')
  assert.equal(marker.mission_id, missionId, 'Post-settlement marker mission changed.')
  assert.ok(typeof marker.id === 'string' && marker.id.length > 0, 'Post-settlement marker identity is missing.')

  const versions = input?.versions
  assert.ok(Array.isArray(versions), 'Post-settlement marker custody rows are missing.')
  assert.equal(versions.length, 1, 'Post-settlement marker custody must contain exactly one version.')
  const [version] = versions
  assert.equal(version.mission_id, missionId, 'Post-settlement version mission changed.')
  assert.equal(version.object_type, 'marker', 'Post-settlement custody object type changed.')
  assert.equal(version.object_id, marker.id, 'Post-settlement custody points at the wrong marker.')
  assert.equal(Number(version.version_sequence), 1, 'Post-settlement marker version sequence changed.')
  assert.equal(version.operation, 'created', 'Post-settlement marker operation changed.')
  assert.equal(version.completeness, 'complete', 'Post-settlement marker custody is incomplete.')
  assert.equal(version.effective_at, marker.updated_at, 'Post-settlement effective time differs from the projection.')
  assert.equal(version.recorded_at, marker.updated_at, 'Post-settlement recorded time differs from the projection.')
  assert.equal(version.actor, marker.updated_by ?? null, 'Post-settlement version actor differs from the projection.')
  assert.ok(typeof version.audit_event_id === 'string' && version.audit_event_id.length > 0,
    'Post-settlement marker version has no audit identity.')
  const state = parseJson(version.state_json, 'Post-settlement marker state')
  assert.deepEqual(state, marker, 'Post-settlement marker state does not match its projection.')

  const auditEvents = input?.auditEvents
  assert.ok(Array.isArray(auditEvents), 'Post-settlement marker audit rows are missing.')
  const markerAuditEvents = auditEvents.filter((event) => {
    if (event?.mission_id !== missionId || !MARKER_AUDIT_EVENT_TYPES.has(event.event_type)) return false
    const details = parseJson(event.details_json, 'Post-settlement marker audit details')
    return details?.marker_id === marker.id
  })
  assert.equal(markerAuditEvents.length, 1, 'Post-settlement marker audit must contain exactly one event.')
  const [audit] = markerAuditEvents
  assert.equal(audit.id, version.audit_event_id, 'Post-settlement custody points at the wrong audit event.')
  assert.equal(audit.event_type, 'marker_created', 'Post-settlement marker audit operation changed.')
  assert.equal(audit.timestamp, marker.updated_at, 'Post-settlement audit time differs from the projection.')
  assert.equal(audit.recording_completeness, 'complete', 'Post-settlement marker audit is incomplete.')
  const details = parseJson(audit.details_json, 'Post-settlement marker audit details')
  assert.deepEqual(details, markerAuditDetails(marker), 'Post-settlement marker audit details changed.')

  return {
    markerId: marker.id,
    versionId: version.id,
    versionSequence: Number(version.version_sequence),
    operation: version.operation,
    completeness: version.completeness,
    auditEventId: audit.id,
    auditEventType: audit.event_type,
    stateMatchesProjection: true,
    auditMatchesProjection: true,
  }
}

/** Builds the exact marker audit payload emitted by the production upsert. */
function markerAuditDetails(marker) {
  return {
    marker_id: marker.id,
    marker_type: marker.type,
    name: marker.name,
    display_order: marker.display_order,
    updated_by: marker.updated_by ?? null,
    coordinator_ids: marker.coordinator_ids ?? null,
    attachment_path: marker.attachment_path ?? null,
  }
}

/** Parses a persisted JSON field while retaining a phase-specific failure. */
function parseJson(value, label) {
  assert.equal(typeof value, 'string', `${label} is missing.`)
  try {
    return JSON.parse(value)
  } catch (error) {
    assert.fail(`${label} is not valid JSON: ${error.message}`)
  }
}
