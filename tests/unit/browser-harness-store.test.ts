import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installBrowserHarnessApi } from '../../src/features/browser-validation/browser-harness-api'
import {
  getBrowserHarnessStore,
  readBrowserHarnessState,
  resetBrowserHarnessStore,
} from '../../src/features/browser-validation/browser-harness-store'

describe('browser harness position persistence', () => {
  beforeEach(() => {
    resetBrowserHarnessStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete window.__SARTRACKER_BROWSER_HARNESS__
    vi.restoreAllMocks()
  })

  it('mirrors adjacent backfill checkpoints when a participant reuses an effective time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Harness participant re-add',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const [initial] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '20' }],
      selected_by: 'Coordinator A',
    })
    const [initialCheckpoint] = await store.listParticipantBackfillCheckpoints(mission.id)
    await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: '20',
      window_from: initialCheckpoint!.window_from,
      window_to: initialCheckpoint!.window_to,
      reconciled_until: initialCheckpoint!.window_to,
      completed: true,
    })
    vi.setSystemTime(new Date('2026-08-20T11:00:00.000Z'))
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initial!.id,
      removed_by: 'Coordinator A',
    })
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
    await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'device',
      ref: '20',
      effective_from: '2026-08-20T08:00:00.000Z',
      confirmed_by: 'Coordinator A',
    })

    await expect(store.listParticipantBackfillCheckpoints(mission.id)).resolves.toEqual([
      expect.objectContaining({
        window_from: '2026-08-20T08:00:00.000Z',
        window_to: '2026-08-20T10:00:00.000Z',
        completed: 1,
      }),
      expect.objectContaining({
        window_from: '2026-08-20T10:00:00.000Z',
        window_to: '2026-08-20T12:00:00.000Z',
        completed: 0,
      }),
    ])
    expect((await store.listMissionParticipants(mission.id))[1]).toMatchObject({
      backfill_completed: 0,
    })
  })

  it('persists a bulk tracking batch with one bounded storage write', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Bulk Browser Harness Mission',
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockClear()

    const positions = await store.addPositionsBulk({
      mission_id: mission.id,
      positions: Array.from({ length: 3 }, (_, index) => ({
        device_id: 'team-1',
        source_position_id: `source-${index + 1}`,
        lat: 52 + index / 10_000,
        lon: -9 - index / 10_000,
        timestamp: new Date(Date.UTC(2026, 6, 29, 20, 0, index)).toISOString(),
        data_origin: 'live' as const,
      })),
    })

    expect(positions).toHaveLength(3)
    expect(readBrowserHarnessState().positions).toHaveLength(3)
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('applies the existing tracking retention cap to one large bulk batch', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Bulk Retention Mission',
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockClear()

    const positions = await store.addPositionsBulk({
      mission_id: mission.id,
      positions: Array.from({ length: 2_100 }, (_, index) => ({
        device_id: 'team-1',
        lat: 52 + index / 100_000,
        lon: -9 - index / 100_000,
        timestamp: new Date(Date.UTC(2026, 6, 29, 20, 0, index)).toISOString(),
        data_origin: 'live' as const,
      })),
    })

    const persistedState = readBrowserHarnessState()
    expect(positions).toHaveLength(2_100)
    expect(persistedState.positions).toHaveLength(2_000)
    expect(persistedState.positions[0]?.timestamp).toBe('2026-07-29T20:01:40.000Z')
    expect(persistedState.positions.at(-1)?.timestamp).toBe('2026-07-29T20:34:59.000Z')
    expect(
      persistedState.missionEvents.filter((event) => event.event_type === 'position_recorded'),
    ).toHaveLength(0)
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('injects a tracking snapshot through the bulk persistence boundary', async () => {
    const store = getBrowserHarnessStore()
    await store.createMission({ name: 'Injected Browser Harness Mission' })
    installBrowserHarnessApi()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockClear()
    const positions = Array.from({ length: 3 }, (_, index) => ({
      id: `tracking-${index + 1}`,
      device_id: 'team-1',
      lat: 52 + index / 10_000,
      lon: -9 - index / 10_000,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp: new Date(Date.UTC(2026, 6, 29, 20, 0, index)).toISOString(),
      source: 'traccar',
      data_origin: 'live' as const,
      cache_age_seconds: null,
      device_cache_stale: false,
    }))

    await window.__SARTRACKER_BROWSER_HARNESS__?.injectTrackingSnapshot({
      devices: [],
      positions: positions.slice(0, 1),
      breadcrumbs: positions.slice(1),
    })

    expect(readBrowserHarnessState().positions).toHaveLength(3)
    expect(setItem).toHaveBeenCalledTimes(1)
  })
})

describe('browser harness store', () => {
  beforeEach(() => {
    resetBrowserHarnessStore(false)
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists devices and positions for the active mission', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Harness Mission' })

    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'alpha',
      name: 'Alpha Team',
      color: '#38bdf8',
      status: 'online',
      last_seen: '2026-04-10T12:00:00.000Z',
    })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'alpha',
      lat: 52,
      lon: -9.7,
      timestamp: '2026-04-10T12:00:00.000Z',
      data_origin: 'live',
    })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'alpha',
      lat: 52.0002,
      lon: -9.7003,
      timestamp: '2026-04-10T12:05:00.000Z',
      data_origin: 'live',
    })

    expect(await store.getActiveMission()).toMatchObject({ id: mission.id, status: 'active' })
    expect(await store.listDevices(mission.id)).toHaveLength(1)
    expect(await store.listPositions(mission.id)).toHaveLength(2)

    const persistedState = readBrowserHarnessState()
    expect(persistedState.currentMissionId).toBe(mission.id)
    expect(persistedState.devices).toHaveLength(1)
    expect(persistedState.positions).toHaveLength(2)
    expect(persistedState.missionEvents.map((event) => event.event_type)).toContain('mission_created')
    expect(persistedState.missionEvents.map((event) => event.event_type)).not.toContain(
      'position_recorded',
    )
  })

  it('mirrors the audited half-open outing lifecycle for browser validation', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Outing Harness',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const first = await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 1',
      started_at: '2026-08-20T09:00:00.000Z',
    })
    await store.endOuting({
      mission_id: mission.id,
      outing_id: first.id,
      ended_at: '2026-08-20T11:00:00.000Z',
    })
    await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 2',
      started_at: '2026-08-20T11:00:00.000Z',
    })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'team-1',
      lat: 52,
      lon: -9,
      timestamp: '2026-08-20T11:00:00.000Z',
    })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'team-1',
      lat: 52,
      lon: -9,
      timestamp: '2026-08-20T08:30:00.000Z',
    })

    await expect(store.listOutings(mission.id)).resolves.toHaveLength(2)
    await expect(store.readOutingFixSummary({ missionId: mission.id })).resolves.toMatchObject({
      outings: [
        { outing_id: first.id, accepted_fix_count: 0 },
        { accepted_fix_count: 1 },
      ],
      unassigned_accepted_fix_count: 1,
      total_accepted_fix_count: 2,
    })
    expect(readBrowserHarnessState().missionEvents.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(['outing_started', 'outing_ended']),
    )
  })

  it('returns one bounded Mission Review audit page with the exact breadcrumb count', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Review Mission' })
    await store.addPosition({
      mission_id: mission.id,
      device_id: 'alpha',
      lat: 52,
      lon: -9.7,
      timestamp: '2026-08-22T18:00:00.000Z',
      data_origin: 'live',
    })

    await expect(store.readMissionReview({
      missionId: mission.id,
      includeTelemetry: false,
      auditLimit: 1,
    })).resolves.toEqual({
      auditEvents: [expect.objectContaining({ event_type: 'mission_created' })],
      breadcrumbCount: 1,
    })
  })

  it('caps browser-only tracking persistence so large breadcrumb imports do not exceed session storage', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Large Tracking Mission' })

    for (let index = 0; index < 2_100; index += 1) {
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'alpha',
        lat: 52 + index / 100_000,
        lon: -9.7 - index / 100_000,
        timestamp: new Date(Date.UTC(2026, 4, 15, 6, 0, index)).toISOString(),
        data_origin: 'live',
      })
    }

    const persistedState = readBrowserHarnessState()
    const recordedPositionEvents = persistedState.missionEvents.filter(
      (event) => event.event_type === 'position_recorded',
    )

    expect(persistedState.positions).toHaveLength(2_000)
    expect(recordedPositionEvents).toHaveLength(0)
    expect(persistedState.positions[0]?.timestamp).toBe('2026-05-15T06:01:40.000Z')
    expect(persistedState.positions.at(-1)?.timestamp).toBe('2026-05-15T06:34:59.000Z')
  }, 30_000)

  it('change-gates browser-harness device events while preserving last_seen [DON-245]', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Device Change Gate Mission' })
    const baseDevice = {
      mission_id: mission.id,
      device_id: 'alpha',
      name: 'Alpha Team',
      color: '#38bdf8',
      status: 'online',
    }

    await store.upsertDevice({ ...baseDevice, last_seen: '2026-07-10T12:00:00.000Z' })
    const lastSeenOnly = await store.upsertDevice({
      ...baseDevice,
      last_seen: '2026-07-10T12:00:05.000Z',
    })
    await store.upsertDevice({
      ...baseDevice,
      status: 'offline',
      last_seen: '2026-07-10T12:00:10.000Z',
    })

    expect(lastSeenOnly.last_seen).toBe('2026-07-10T12:00:05.000Z')
    const eventTypes = (await store.listMissionEvents(mission.id)).map(
      (event) => event.event_type,
    )
    expect(eventTypes.filter((type) => type === 'device_created')).toHaveLength(1)
    expect(eventTypes.filter((type) => type === 'device_updated')).toHaveLength(1)
  })

  it('mirrors participant selection, membership changes, and resumable backfill [DON-271]', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Participant Harness Mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const participants = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101', name: 'Kerry MRT', member_device_ids: ['11'],
      }],
      devices: [{ traccar_device_id: '20' }],
      selected_by: 'Coordinator A',
    })
    const teamId = participants.find((participant) => participant.kind === 'group')?.mission_team_id
    expect(teamId).toBeTruthy()
    expect((await store.listMissionParticipants(mission.id))
      .find((participant) => participant.kind === 'group')).toMatchObject({
        backfill_member_count: 1,
        backfill_completed_count: 0,
      })
    await store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [{
        mission_team_id: teamId ?? '', traccar_device_id: '12',
        change: 'member', observed_at: '2026-08-20T09:00:00.000Z',
      }],
    })
    const directCheckpoint = (await store.listParticipantBackfillCheckpoints(mission.id))
      .find((checkpoint) => checkpoint.traccar_device_id === '20')!
    await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: '20',
      window_from: directCheckpoint.window_from,
      window_to: directCheckpoint.window_to,
      reconciled_until: directCheckpoint.window_to,
      completed: true,
    })

    await expect(store.listMissionParticipants(mission.id)).resolves.toHaveLength(2)
    await expect(store.listGroupMembershipEvents(mission.id, teamId)).resolves.toEqual([
      expect.objectContaining({ traccar_device_id: '11', sequence: 1 }),
      expect.objectContaining({ traccar_device_id: '12', sequence: 2 }),
    ])
    await expect(store.listParticipantBackfillCheckpoints(mission.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ traccar_device_id: '11' }),
        expect.objectContaining({ traccar_device_id: '20', completed: 1 }),
      ]),
    )

    await expect(store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: '20',
      window_from: directCheckpoint.window_from,
      window_to: directCheckpoint.window_to,
      reconciled_until: directCheckpoint.window_from,
      completed: false,
    })).rejects.toThrow(/completion.*irreversible|cursor.*decrease/i)
  })

  it('mirrors direct-device backfill status, coverage claim, and finish fences', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser backfill finish fence',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '20' }],
      selected_by: 'Coordinator A',
    })

    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'device', traccar_device_id: '20', backfill_completed: 0,
      }),
    ])
    await store.readCoverageManifest(mission.id)
    await expect(store.readCoverageClaim({ missionId: mission.id, selectedKeys: [] }))
      .resolves.toMatchObject({
        databaseReady: false,
        blockers: expect.arrayContaining(['backfill_incomplete']),
      })
    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
    await expect(store.listMissions()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: mission.id, status: 'active' })]),
    )
    const [checkpoint] = await store.listParticipantBackfillCheckpoints(mission.id)
    await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: checkpoint!.traccar_device_id,
      window_from: checkpoint!.window_from,
      window_to: checkpoint!.window_to,
      reconciled_until: checkpoint!.window_to,
      completed: true,
    })

    await expect(store.readCoverageClaim({ missionId: mission.id, selectedKeys: [] }))
      .resolves.toMatchObject({ databaseReady: true, blockers: [] })
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
  })

  it('mirrors the active participant uniqueness backstops [DON-271]', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Participant Uniqueness Harness Mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })

    await expect(store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101', name: 'Kerry MRT', member_device_ids: ['11'],
      }],
      devices: [{ traccar_device_id: '11' }],
      selected_by: 'Coordinator A',
    })).rejects.toThrow(/device.*group|covered.*group|select.*once/i)
    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual([])

    const directSelection = {
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '20' }],
      selected_by: 'Coordinator A',
    }
    await store.selectMissionParticipants(directSelection)
    const [directParticipant] = await store.listMissionParticipants(mission.id)
    await expect(store.selectMissionParticipants(directSelection)).rejects.toThrow(/already active/i)
    await expect(store.listMissionParticipants(mission.id)).resolves.toHaveLength(1)

    const [checkpoint] = await store.listParticipantBackfillCheckpoints(mission.id)
    await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: checkpoint!.traccar_device_id,
      window_from: checkpoint!.window_from,
      window_to: checkpoint!.window_to,
      reconciled_until: checkpoint!.window_to,
      completed: true,
    })
    await store.finishMission(mission.id)
    await expect(store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: directParticipant!.id,
      removed_by: 'Coordinator A',
    })).rejects.toThrow(/finished.*read-only|finished mission/i)
    const groupMission = await store.createMission({
      name: 'Group-covered Harness Mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    await store.selectMissionParticipants({
      mission_id: groupMission.id,
      groups: [{
        traccar_group_id: '101', name: 'Kerry MRT', member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await expect(store.addMissionParticipant({
      mission_id: groupMission.id,
      kind: 'device', ref: '11', confirmed_by: 'Coordinator A',
    })).rejects.toThrow(/active.*group|covered.*group/i)

    for (const checkpoint of await store.listParticipantBackfillCheckpoints(groupMission.id)) {
      await store.upsertParticipantBackfillCheckpoint({
        mission_id: checkpoint.mission_id,
        traccar_device_id: checkpoint.traccar_device_id,
        window_from: checkpoint.window_from,
        window_to: checkpoint.window_to,
        reconciled_until: checkpoint.window_to,
        completed: true,
      })
    }
    await store.finishMission(groupMission.id)
    const directBeforeGroupMission = await store.createMission({
      name: 'Direct-before-group Harness Mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    await store.selectMissionParticipants({
      mission_id: directBeforeGroupMission.id,
      groups: [],
      devices: [{ traccar_device_id: '11' }],
      selected_by: 'Coordinator A',
    })
    await expect(store.addMissionParticipant({
      mission_id: directBeforeGroupMission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      },
      confirmed_by: 'Coordinator A',
    })).rejects.toThrow(/covers.*active.*individual|individual.*active.*group/i)
    await expect(store.listGroupMembershipEvents(directBeforeGroupMission.id)).resolves.toEqual([])
  })

  it('finalizes and unlocks a mission using the configured admin roster', async () => {
    window.localStorage.setItem(
      'sartracker:browser-settings',
      JSON.stringify({
        missionDefaults: {
          adminRoster: ['Ops Lead'],
        },
      }),
    )

    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Governance Mission' })
    await store.finishMission(mission.id)

    const finalized = await store.finalizeMission(mission.id)
    expect(finalized.mission.status).toBe('finalized')
    expect(finalized.archive.archive_path).toContain(`${mission.id}-archive.zip`)

    await expect(
      store.upsertMarker({
        mission_id: mission.id,
        type: 'clue',
        name: 'Blocked Marker',
        lat: 52,
        lon: -9.7,
        irish_grid_e: 496584,
        irish_grid_n: 591256,
        display_order: 1,
      }),
    ).rejects.toThrow(/Cannot write data to finished mission .* resume the mission or unlock it first/)

    const unlocked = await store.unlockFinalizedMission({
      mission_id: mission.id,
      admin_name: 'Ops Lead',
      reason: 'Need to correct mission notes',
    })
    expect(unlocked.status).toBe('finished')
    expect(await store.listMissionEvents(mission.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'mission_finalized' }),
        expect.objectContaining({ event_type: 'mission_unlocked' }),
      ]),
    )
  })

  it('keeps a browser evidence gap critical while allowing audited closure [DON-276]', async () => {
    window.localStorage.setItem(
      'sartracker:browser-settings',
      JSON.stringify({ missionDefaults: { adminRoster: ['Ops Lead'] } }),
    )
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Evidence Gap Mission' })
    await store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'renderer_pending_evidence_lost',
    })
    await store.finishMission(mission.id)

    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/evidence health/iu)
    await expect(store.acknowledgeIngestEvidenceLoss({
      mission_id: mission.id,
      admin_name: 'Ops Lead',
      reason: 'Known runtime loss reviewed.',
    })).resolves.toMatchObject({
      state: 'critical',
      acknowledgedLoss: { adminName: 'Ops Lead' },
    })
    await expect(store.finalizeMission(mission.id)).resolves.toMatchObject({
      mission: { status: 'finalized' },
    })
    await expect(store.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
    })
  })

  it('keeps a retained evidence gap in the browser coverage claim after reload [DON-276]', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Reloaded Evidence Gap Mission' })
    await store.recordIngestEvidenceLoss({
      mission_id: mission.id,
      reason: 'renderer_pending_evidence_lost',
    })

    resetBrowserHarnessStore(false)
    const restoredStore = getBrowserHarnessStore()

    await expect(restoredStore.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: [],
    })).resolves.toMatchObject({
      databaseReady: false,
      blockers: expect.arrayContaining(['ingest_health_degraded']),
    })
  })

  it('records opened paths for review workflows', async () => {
    const store = getBrowserHarnessStore()

    await store.openExternalPath('/tmp/review-archive.zip')

    expect(readBrowserHarnessState().openedPaths).toEqual(['/tmp/review-archive.zip'])
  })

  it('persists GPX imports and audit events for the active mission', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'GPX Mission' })

    await store.upsertGpxImport({
      mission_id: mission.id,
      source_path: '/tracks/alpha.gpx',
      file_name: 'alpha.gpx',
      display_name: 'Alpha Track',
      geometry_json: '{"type":"MultiLineString","coordinates":[]}',
      metadata_json: '{"trackCount":1,"pointCount":2}',
    })

    expect(await store.listGpxImports(mission.id)).toEqual([
      expect.objectContaining({
        source_path: '/tracks/alpha.gpx',
        display_name: 'Alpha Track',
      }),
    ])

    expect(readBrowserHarnessState().missionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'gpx_import_created' }),
      ]),
    )
  })

  it('rejects future replay time with the packaged-store contract [DON-278]', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Future Replay Mission' })

    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T10:00:00.001Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })).rejects.toThrow('Mission replay selected time cannot be in the future.')
  })

  it('filters historical GPX evidence by the outing assigned to its eligible revision [DON-278]', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Historical GPX Outing Mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const first = await store.createOuting({
      mission_id: mission.id,
      label: 'First outing',
      started_at: '2026-08-20T08:30:00.000Z',
    })
    await store.endOuting({
      mission_id: mission.id,
      outing_id: first.id,
      ended_at: '2026-08-20T10:00:00.000Z',
    })
    const second = await store.createOuting({
      mission_id: mission.id,
      label: 'Second outing',
      started_at: '2026-08-20T10:00:00.000Z',
    })
    const imported = await store.upsertGpxImport({
      mission_id: mission.id,
      source_path: '/tracks/historical-outing.gpx',
      file_name: 'historical-outing.gpx',
      display_name: 'Historical outing',
      geometry_json: '{"type":"MultiLineString","coordinates":[]}',
      content_sha256: 'a'.repeat(64),
      source_bytes_base64: 'PGdweCAvPg==',
      timing_class: 'fully_dated',
      outing_id: first.id,
      points: [{
        segment_index: 0,
        point_index: 0,
        track_name: 'Historical outing',
        lat: 52,
        lon: -9.7,
        elevation: null,
        timestamp: '2026-08-20T09:00:00.000Z',
      }],
    })
    vi.setSystemTime(new Date('2026-08-20T11:00:00.000Z'))
    await store.assignGpxImportToOuting({ import_id: imported.id, outing_id: second.id })

    const firstOutingReplay = await store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T10:30:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      outingIds: [first.id],
    })
    expect(firstOutingReplay).toMatchObject({
      totalTrackCount: 1,
      availableOutingIds: [first.id],
    })
    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T10:30:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      outingIds: [second.id],
    })).resolves.toMatchObject({ totalTrackCount: 0 })
  })

  it('excludes GPX evidence only after its recorded retirement time [DON-278]', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Historical GPX Retirement Mission' })
    const imported = await store.upsertGpxImport({
      mission_id: mission.id,
      source_path: '/tracks/retired.gpx',
      file_name: 'retired.gpx',
      display_name: 'Retired evidence',
      geometry_json: '{"type":"MultiLineString","coordinates":[]}',
      content_sha256: 'b'.repeat(64),
      source_bytes_base64: 'PGdweCAvPg==',
      timing_class: 'partially_dated',
      points: [
        {
          segment_index: 0,
          point_index: 0,
          track_name: 'Retired evidence',
          lat: 52,
          lon: -9.7,
          elevation: null,
          timestamp: '2026-08-20T09:00:00.000Z',
        },
        {
          segment_index: 0,
          point_index: 1,
          track_name: 'Retired evidence',
          lat: 52.01,
          lon: -9.71,
          elevation: null,
          timestamp: null,
        },
      ],
    })
    vi.setSystemTime(new Date('2026-08-20T11:00:00.000Z'))
    await store.deleteGpxImport(imported.id)

    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T10:30:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })).resolves.toMatchObject({
      totalTrackCount: 1,
      staticGpxPointCount: 1,
      staticGpxEvidence: [expect.objectContaining({ import_id: imported.id })],
    })
    await expect(store.readMissionReplay({
      missionId: mission.id,
      selectedTime: '2026-08-20T11:00:00.000Z',
      timezone: 'Europe/Dublin',
      trackLimit: 100,
    })).resolves.toMatchObject({
      totalTrackCount: 0,
      staticGpxPointCount: 0,
      staticGpxEvidence: [],
    })
  })

  it('mirrors strict timestamp and bounded Search Operations input [DON-279]', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-03T12:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Bounded Search Harness Mission',
      start_time: '2026-02-01T00:00:00Z',
    })
    const outing = await store.createOuting({
      mission_id: mission.id,
      label: 'Completed outing',
      started_at: '2026-02-02T00:00:00Z',
    })
    await store.endOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      ended_at: '2026-03-03T10:00:00Z',
    })
    await store.upsertDrawing({
      mission_id: mission.id,
      type: 'search_area',
      name: 'Area Alpha',
      display_order: 0,
      geometry_json: '{"type":"Polygon","coordinates":[]}',
    })
    const [area] = await store.listSearchAreas(mission.id)
    const assignment = await store.upsertSearchAssignment({
      mission_id: mission.id,
      search_area_id: area!.id,
      outing_id: outing.id,
      team_id: 'team-1',
      participant_ids: [],
      updated_by: 'Coordinator One',
    })
    const validPass = {
      mission_id: mission.id,
      search_area_id: area!.id,
      assignment_id: assignment.id,
      started_at: '2026-03-02T08:00:00Z',
      ended_at: '2026-03-02T09:00:00Z',
      outcome: 'partial',
      coordinator_name: 'Coordinator One',
      participant_ids: [],
      clue_ids: [],
      track_evidence_ids: [],
    }
    await expect(store.upsertSearchPass({
      ...validPass,
      started_at: '2026-02-30T08:00:00Z',
    })).rejects.toThrow(/pass start.*valid ISO8601/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      started_at: '2026-03-02T08:00:00',
    })).rejects.toThrow(/pass start.*valid ISO8601/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      notes: 'n'.repeat(2_001),
    })).rejects.toThrow(/notes.*2000 characters/i)
    await expect(store.upsertSearchPass({
      ...validPass,
      participant_ids: Array.from({ length: 201 }, (_, index) => `participant-${index}`),
    })).rejects.toThrow(/participant links.*at most 200/i)
    await expect(store.listSearchPasses(mission.id)).resolves.toEqual([])
  })

  it('persists helicopters per slot and records audit events', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Helicopter Mission' })

    await store.upsertHelicopter({
      mission_id: mission.id,
      slot_key: 'slot_4',
      call_sign: 'Air Corps 2',
      hex_id: '4CAE44',
      lat: 52.2,
      lon: -9.8,
      altitude: 1800,
      speed: 120,
      heading: 45,
      last_update: '2026-04-11T12:05:00.000Z',
    })

    expect(await store.listHelicopters(mission.id)).toEqual([
      expect.objectContaining({
        slot_key: 'slot_4',
        call_sign: 'Air Corps 2',
      }),
    ])

    expect(readBrowserHarnessState().missionEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'helicopter_created' }),
      ]),
    )
  })
})
