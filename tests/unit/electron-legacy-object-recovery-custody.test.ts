import { describe, expect, it } from 'vitest'

import {
  assertPostSettlementMarkerCustody,
} from '../../build/electron-legacy-object-recovery-custody.js'

const marker = {
  id: 'restart-marker',
  mission_id: 'mission-1',
  type: 'clue',
  name: 'After restart',
  description: 'Post-settlement mutation',
  lat: 52.1,
  lon: -9.5,
  irish_grid_e: 480000,
  irish_grid_n: 580000,
  created_at: '2026-09-13T10:00:00.000Z',
  updated_at: '2026-09-13T10:00:00.000Z',
  display_order: 0,
  subject_category: null,
  clue_type: null,
  confidence: null,
  found_by: null,
  hazard_type: null,
  severity: null,
  condition: null,
  treatment: null,
  evacuation_priority: null,
  label_size: null,
  updated_by: 'DON-254 probe',
  coordinator_ids: null,
  attachment_path: null,
}

const version = {
  id: 'version-1',
  mission_id: marker.mission_id,
  object_type: 'marker',
  object_id: marker.id,
  version_sequence: 1,
  operation: 'created',
  effective_at: marker.updated_at,
  recorded_at: marker.updated_at,
  completeness: 'complete',
  state_json: JSON.stringify(marker),
  actor: marker.updated_by,
  correlation_id: null,
  audit_event_id: 'event-1',
}

const audit = {
  id: 'event-1',
  mission_id: marker.mission_id,
  event_type: 'marker_created',
  timestamp: marker.updated_at,
  details_json: JSON.stringify({
    marker_id: marker.id,
    marker_type: marker.type,
    name: marker.name,
    display_order: marker.display_order,
    updated_by: marker.updated_by,
    coordinator_ids: null,
    attachment_path: null,
  }),
  recorded_at: '2026-09-13T10:00:00.001Z',
  recording_completeness: 'complete',
}

describe('packaged legacy recovery custody oracle', () => {
  it('accepts one complete created marker version linked to one audit event', () => {
    expect(assertPostSettlementMarkerCustody({
      missionId: marker.mission_id,
      marker,
      versions: [version],
      auditEvents: [audit],
    })).toMatchObject({ markerId: marker.id, auditEventId: audit.id })
  })

  it('rejects a version linked to the wrong audit event', () => {
    expect(() => assertPostSettlementMarkerCustody({
      missionId: marker.mission_id,
      marker,
      versions: [{ ...version, audit_event_id: 'different-event' }],
      auditEvents: [audit],
    })).toThrow(/wrong audit event/i)
  })

  it('rejects persisted state that differs from the marker projection', () => {
    expect(() => assertPostSettlementMarkerCustody({
      missionId: marker.mission_id,
      marker,
      versions: [{ ...version, state_json: JSON.stringify({ ...marker, name: 'Tampered' }) }],
      auditEvents: [audit],
    })).toThrow(/state does not match/i)
  })

  it.each([
    ['missing custody', []],
    ['duplicate custody', [version, { ...version, id: 'version-2' }]],
    ['wrong sequence', [{ ...version, version_sequence: 2 }]],
  ])('rejects %s', (_label, versions) => {
    expect(() => assertPostSettlementMarkerCustody({
      missionId: marker.mission_id,
      marker,
      versions,
      auditEvents: [audit],
    })).toThrow(/exactly one|version sequence|custody/i)
  })
})
