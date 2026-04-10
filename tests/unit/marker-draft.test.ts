import { describe, expect, it } from 'vitest'

import type { Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'
import {
  buildMarkerSaveInput,
  changeMarkerDraftType,
  createMarkerDraftAtCoordinate,
  createMarkerDraftFromMarker,
} from '../../src/features/markers/marker-draft'

const EXISTING_MARKER: Marker = {
  id: 'marker-1',
  mission_id: 'mission-1',
  type: 'clue',
  name: 'Boot print',
  description: 'Single print near stream',
  lat: 52.0599,
  lon: -9.5045,
  irish_grid_e: 496584,
  irish_grid_n: 591256,
  created_at: '2026-04-09T10:00:00.000Z',
  updated_at: '2026-04-09T10:10:00.000Z',
  display_order: 3,
  subject_category: null,
  clue_type: 'Footprint',
  confidence: 0.8,
  found_by: 'Team 2',
  hazard_type: null,
  severity: null,
  condition: null,
  treatment: null,
  evacuation_priority: null,
  updated_by: 'Ops Lead',
  coordinator_ids: 'C1, C2',
  attachment_path: '/tmp/missions/mission-1/attachments/boot-print.jpg',
}

describe('marker draft helpers', () => {
  it('creates a new draft with derived coordinate displays', () => {
    const draft = createMarkerDraftAtCoordinate(52.0599, -9.5045)

    expect(draft.type).toBe('ipp_lkp')
    expect(draft.coordinates.lat).toBe(52.0599)
    expect(draft.coordinates.lon).toBe(-9.5045)
    expect(draft.coordinates.wgs84Display).toContain('52.059900°N')
    expect(draft.coordinates.tm65GridRef).toMatch(/^[A-Z] \d{5} \d{5}$/)
    expect(draft.coordinates.irishGridE).toBeGreaterThan(400_000)
    expect(draft.coordinates.irishGridN).toBeGreaterThan(500_000)
  })

  it('rebuilds a draft from an existing persisted marker', () => {
    const draft = createMarkerDraftFromMarker(EXISTING_MARKER)

    expect(draft.id).toBe('marker-1')
    expect(draft.type).toBe('clue')
    expect(draft.name).toBe('Boot print')
    expect(draft.clueType).toBe('Footprint')
    expect(draft.confidence).toBe('Probable')
    expect(draft.foundBy).toBe('Team 2')
    expect(draft.updatedBy).toBe('Ops Lead')
    expect(draft.coordinatorIds).toBe('C1, C2')
    expect(draft.attachmentName).toBe('boot-print.jpg')
  })

  it('keeps shared fields while resetting irrelevant marker-specific fields on type change', () => {
    const changed = changeMarkerDraftType(
      {
        ...createMarkerDraftFromMarker(EXISTING_MARKER),
        treatment: 'Blanket',
      },
      'hazard',
    )

    expect(changed.type).toBe('hazard')
    expect(changed.name).toBe('Boot print')
    expect(changed.description).toBe('Single print near stream')
    expect(changed.clueType).toBe('')
    expect(changed.confidence).toBe('')
    expect(changed.foundBy).toBe('')
    expect(changed.severity).toBe('Medium')
  })

  it('builds a persistence payload with only relevant type-specific fields', () => {
    const draft = {
      ...createMarkerDraftAtCoordinate(52.0599, -9.5045),
      type: 'casualty' as const,
      name: 'Subject located',
      description: 'Sheltered near wall',
      condition: 'Injured - Conscious',
      treatment: 'Warm fluids',
      evacuationPriority: 'Urgent',
      foundBy: 'Alpha team',
    }

    const input = buildMarkerSaveInput({
      missionId: 'mission-1',
      displayOrder: 5,
      draft,
    })

    expect(input).toMatchObject({
      mission_id: 'mission-1',
      type: 'casualty',
      name: 'Subject located',
      display_order: 5,
      condition: 'Injured - Conscious',
      treatment: 'Warm fluids',
      evacuation_priority: 'Urgent',
      found_by: 'Alpha team',
      updated_by: null,
      coordinator_ids: null,
      attachment_path: null,
      clue_type: null,
      hazard_type: null,
      severity: null,
    })
  })

  it('normalizes audit metadata and attachments into the save payload', () => {
    const input = buildMarkerSaveInput({
      missionId: 'mission-1',
      displayOrder: 2,
      draft: {
        ...createMarkerDraftFromMarker(EXISTING_MARKER),
        updatedBy: '  Donal  ',
        coordinatorIds: ' Ops 1, Ops 2 ,, ',
      },
    })

    expect(input.updated_by).toBe('Donal')
    expect(input.coordinator_ids).toBe('Ops 1, Ops 2')
    expect(input.attachment_path).toBe('/tmp/missions/mission-1/attachments/boot-print.jpg')
  })

  it('rejects save attempts without a marker name', () => {
    expect(() =>
      buildMarkerSaveInput({
        missionId: 'mission-1',
        displayOrder: 1,
        draft: {
          ...createMarkerDraftAtCoordinate(52.0599, -9.5045),
          name: '   ',
        },
      }),
    ).toThrow(/Marker name is required/)
  })
})
