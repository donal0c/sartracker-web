'use strict'

const path = require('node:path')

/** Relocates live paths and returns the exact fields to retain in the correction audit event. */
function rewriteAttachmentReferences(database, missionId, references) {
  if (!database.inTransaction) throw invalidAttachmentMappingError()
  const amendments = []
  for (const [key, targetPath] of references) {
    const separator = key.indexOf('\0')
    const kind = key.slice(0, separator)
    const referenceId = key.slice(separator + 1)
    let previous
    let replacement
    let changed
    if (kind === 'marker') {
      const row = database.prepare('SELECT attachment_path FROM markers WHERE id = ? AND mission_id = ?')
        .get(referenceId, missionId)
      if (typeof row?.attachment_path !== 'string' || row.attachment_path.length === 0) throw invalidAttachmentMappingError()
      previous = { attachment_path: row.attachment_path }
      replacement = { attachment_path: targetPath }
      changed = database.prepare('UPDATE markers SET attachment_path = ? WHERE id = ? AND mission_id = ?')
        .run(targetPath, referenceId, missionId)
    } else if (kind === 'marker_version') {
      const row = database.prepare(
        "SELECT state_json FROM mission_object_versions WHERE id = ? AND mission_id = ? AND object_type = 'marker'",
      ).get(referenceId, missionId)
      if (row === undefined) throw invalidAttachmentMappingError()
      const state = parsePlainJson(row.state_json)
      if (typeof state.attachment_path !== 'string' || state.attachment_path.length === 0) throw invalidAttachmentMappingError()
      previous = { attachment_path: state.attachment_path }
      replacement = { attachment_path: targetPath }
      state.attachment_path = targetPath
      changed = database.prepare('UPDATE mission_object_versions SET state_json = ? WHERE id = ? AND mission_id = ?')
        .run(JSON.stringify(state), referenceId, missionId)
    } else if (['marker_attachment_ingested', 'marker_created', 'marker_updated', 'marker_deleted'].includes(kind)) {
      const event = database.prepare(
        'SELECT details_json FROM mission_events WHERE id = ? AND mission_id = ? AND event_type = ?',
      ).get(referenceId, missionId, kind)
      if (event === undefined) throw invalidAttachmentMappingError()
      const details = parsePlainJson(event.details_json)
      if (typeof details.attachment_path !== 'string' || details.attachment_path.length === 0) throw invalidAttachmentMappingError()
      previous = { attachment_path: details.attachment_path }
      replacement = { attachment_path: targetPath }
      if (details.custody_version === 2) {
        if (typeof details.relative_path !== 'string') throw invalidAttachmentMappingError()
        previous.relative_path = details.relative_path
        replacement.relative_path = `missions/${missionId}/attachments/${path.basename(targetPath)}`
      }
      changed = database.prepare('UPDATE mission_events SET details_json = ? WHERE id = ? AND mission_id = ?')
        .run(JSON.stringify({ ...details, ...replacement }), referenceId, missionId)
    } else {
      throw invalidAttachmentMappingError()
    }
    if (changed.changes !== 1) throw invalidAttachmentMappingError()
    amendments.push({ referenceKind: kind, referenceId, previous, replacement })
  }
  return amendments
}

/** Parses one attachment-bearing row as a plain JSON object. */
function parsePlainJson(value) {
  let parsed
  try { parsed = JSON.parse(value) } catch { throw invalidAttachmentMappingError() }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidAttachmentMappingError()
  return parsed
}


/** Reports an invalid or missing restored attachment reference. */
function invalidAttachmentMappingError() {
  const error = new Error('Archive correction attachment reference is invalid or missing.')
  error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
  return error
}

module.exports = { rewriteAttachmentReferences }
