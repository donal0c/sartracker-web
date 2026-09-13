import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  assertPostSettlementMarkerCustody,
} from '../../build/electron-legacy-object-recovery-custody.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  prepare(sql: string): {
    all(...parameters: readonly unknown[]): readonly Record<string, unknown>[]
    get(...parameters: readonly unknown[]): Record<string, unknown> | undefined
  }
  close(): void
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (input: { readonly userDataPath: string }) => {
    readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
    readonly upsertMarker: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly prepareClose: () => Promise<void>
    readonly close: () => void
  }
}

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
  retired_at: null,
  retired_by: null,
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

  it('rejects legacy-baseline completeness on a post-settlement version', () => {
    expect(() => assertPostSettlementMarkerCustody({
      missionId: marker.mission_id,
      marker,
      versions: [{ ...version, completeness: 'legacy_baseline' }],
      auditEvents: [audit],
    })).toThrow(/custody is incomplete/i)
  })

  it('rejects legacy-baseline completeness on a post-settlement audit event', () => {
    expect(() => assertPostSettlementMarkerCustody({
      missionId: marker.mission_id,
      marker,
      versions: [version],
      auditEvents: [{ ...audit, recording_completeness: 'legacy_baseline' }],
    })).toThrow(/audit is incomplete/i)
  })

  it('checks a real mission-store marker and audit payload through the independent oracle', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'don254-custody-contract-'))
    let store: ReturnType<typeof createElectronMissionStore> | undefined
    try {
      store = createElectronMissionStore({ userDataPath })
      const mission = await store.createMission({ name: 'Custody oracle contract mission' })
      const created = await store.upsertMarker({
        mission_id: mission.id,
        type: marker.type,
        name: marker.name,
        description: marker.description,
        lat: marker.lat,
        lon: marker.lon,
        irish_grid_e: marker.irish_grid_e,
        irish_grid_n: marker.irish_grid_n,
        display_order: marker.display_order,
        updated_by: marker.updated_by,
      })
      await store.prepareClose()
      store.close()
      store = undefined

      const database = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        const markerRow = database.prepare(
          'SELECT * FROM markers WHERE mission_id = ? AND id = ?',
        ).get(mission.id, created.id)
        const versions = database.prepare(`SELECT * FROM mission_object_versions
          WHERE mission_id = ? AND object_type = 'marker' AND object_id = ?`).all(mission.id, created.id)
        const auditEvents = database.prepare(`SELECT * FROM mission_events
          WHERE mission_id = ? AND event_type IN ('marker_created', 'marker_updated', 'marker_deleted')`).all(mission.id)

        expect(assertPostSettlementMarkerCustody({
          missionId: mission.id,
          marker: markerRow,
          versions,
          auditEvents,
        })).toMatchObject({ markerId: created.id, auditEventType: 'marker_created' })
      } finally {
        database.close()
      }
    } finally {
      if (store !== undefined) {
        await store.prepareClose().catch(() => undefined)
        store.close()
      }
      await rm(userDataPath, { recursive: true, force: true })
    }
  })

  it.each([
    ['missing custody', [], /exactly one version/iu],
    ['duplicate custody', [version, { ...version, id: 'version-2' }], /exactly one version/iu],
    ['wrong sequence', [{ ...version, version_sequence: 2 }], /version sequence changed/iu],
  ])('rejects %s', (_label, versions, expectedError) => {
    expect(() => assertPostSettlementMarkerCustody({
      missionId: marker.mission_id,
      marker,
      versions,
      auditEvents: [audit],
    })).toThrow(expectedError)
  })
})
