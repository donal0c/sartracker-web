import { describe, expect, it } from 'vitest'

import { createParticipationScope } from '../../src/features/participants/participation-scope'
import type {
  GroupMembershipEvent,
  MissionParticipant,
  ParticipantBackfillCheckpoint,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('participation scope [DON-271]', () => {
  it('evaluates direct participant windows at each fix timestamp', () => {
    const scope = createParticipationScope({
      participants: [participant({
        traccar_device_id: '11',
        effective_from: '2026-08-20T09:00:00.000Z',
        removed_at: '2026-08-20T11:00:00.000Z',
      })],
      membershipEvents: [],
    })

    expect(scope.includesAt('11', '2026-08-20T08:59:59.999Z')).toBe(false)
    expect(scope.includesAt('11', '2026-08-20T09:00:00.000Z')).toBe(true)
    expect(scope.includesAt('11', '2026-08-20T10:59:59.999Z')).toBe(true)
    expect(scope.includesAt('11', '2026-08-20T11:00:00.000Z')).toBe(false)
  })

  it('auto-follows selected group membership only from observation time', () => {
    const scope = createParticipationScope({
      participants: [participant({
        id: 'participant-group', kind: 'group', traccar_device_id: null,
        mission_team_id: 'team-101', effective_from: '2026-08-20T08:00:00.000Z',
      })],
      membershipEvents: [
        membership({ change: 'member', observed_at: '2026-08-20T09:00:00.000Z' }),
        membership({ change: 'left', observed_at: '2026-08-20T10:00:00.000Z' }),
      ],
    })

    expect(scope.includesAt('12', '2026-08-20T08:59:59.999Z')).toBe(false)
    expect(scope.includesAt('12', '2026-08-20T09:00:00.000Z')).toBe(true)
    expect(scope.includesAt('12', '2026-08-20T10:00:00.000Z')).toBe(false)
  })

  it('filters mission evidence and map state without hiding selected live positions', () => {
    const scope = createParticipationScope({
      participants: [participant({ traccar_device_id: '11' })],
      membershipEvents: [],
    })
    const snapshot = {
      devices: [device('11'), device('99')],
      positions: [position('11'), position('99')],
      breadcrumbs: [position('11'), position('99')],
      rawBreadcrumbsForPersistence: [position('11'), position('99')],
    }

    expect(scope.filterSnapshot(snapshot)).toMatchObject({
      devices: [{ device_id: '11' }],
      positions: [{ device_id: '11' }],
      breadcrumbs: [{ device_id: '11' }],
      rawBreadcrumbsForPersistence: [{ device_id: '11' }],
    })
  })

  it('keeps a selected participant current position visible when its fix predates selection', () => {
    const scope = createParticipationScope({
      participants: [participant({
        traccar_device_id: '11',
        effective_from: '2026-08-20T14:00:00.000Z',
        added_at: '2026-08-20T14:00:00.000Z',
      })],
      membershipEvents: [],
    })
    const staleCurrentPosition = position('11', '2026-08-20T13:47:00.000Z')

    expect(scope.filterSnapshot({
      devices: [device('11')],
      positions: [staleCurrentPosition],
      breadcrumbs: [staleCurrentPosition],
      rawBreadcrumbsForPersistence: [staleCurrentPosition],
    }, '2026-08-20T14:00:00.000Z')).toMatchObject({
      devices: [{ device_id: '11' }],
      positions: [{ device_id: '11', timestamp: '2026-08-20T13:47:00.000Z' }],
      breadcrumbs: [],
      rawBreadcrumbsForPersistence: [],
    })
  })

  it('keeps a newly observed group member current position visible without backdating evidence', () => {
    const scope = createParticipationScope({
      participants: [participant({
        id: 'participant-group', kind: 'group', traccar_device_id: null,
        mission_team_id: 'team-101', effective_from: '2026-08-20T08:00:00.000Z',
      })],
      membershipEvents: [membership({
        traccar_device_id: '12', change: 'member', observed_at: '2026-08-20T14:00:00.000Z',
      })],
    })
    const staleCurrentPosition = position('12', '2026-08-20T13:47:00.000Z')

    expect(scope.filterSnapshot({
      devices: [device('12')],
      positions: [staleCurrentPosition],
      breadcrumbs: [staleCurrentPosition],
      rawBreadcrumbsForPersistence: [staleCurrentPosition],
    }, '2026-08-20T14:00:00.000Z')).toMatchObject({
      devices: [{ device_id: '12' }],
      positions: [{ device_id: '12', timestamp: '2026-08-20T13:47:00.000Z' }],
      breadcrumbs: [],
      rawBreadcrumbsForPersistence: [],
    })
  })

  it('admits a confirmed group member through its bounded effective-from backfill window', () => {
    const scope = createParticipationScope({
      participants: [participant({
        id: 'participant-group', kind: 'group', traccar_device_id: null,
        mission_team_id: 'team-101', effective_from: '2026-08-20T09:00:00.000Z',
        added_at: '2026-08-20T11:00:00.000Z',
      })],
      membershipEvents: [membership({
        traccar_device_id: '12', observed_at: '2026-08-20T11:00:00.000Z',
      })],
      backfillCheckpoints: [checkpoint({
        traccar_device_id: '12',
        window_from: '2026-08-20T09:00:00.000Z',
        window_to: '2026-08-20T11:00:00.000Z',
      })],
    })

    expect(scope.includesAt('12', '2026-08-20T09:30:00.000Z')).toBe(true)
    expect(scope.includesAt('12', '2026-08-20T08:59:59.999Z')).toBe(false)
  })

  it('keeps the last accepted pre-removal current marker until it becomes stale', () => {
    const scope = createParticipationScope({
      participants: [participant({
        traccar_device_id: '11', removed_at: '2026-08-20T11:00:00.000Z',
      })],
      membershipEvents: [],
    })
    const lastAccepted = position('11', '2026-08-20T10:59:00.000Z')
    const postRemoval = position('11', '2026-08-20T11:01:00.000Z')

    expect(scope.filterSnapshot({
      devices: [device('11')], positions: [lastAccepted], breadcrumbs: [],
    }, '2026-08-20T11:05:00.000Z').positions).toEqual([lastAccepted])
    expect(scope.filterSnapshot({
      devices: [device('11')], positions: [postRemoval], breadcrumbs: [],
    }, '2026-08-20T11:05:00.000Z').positions).toEqual([])
    expect(scope.filterSnapshot({
      devices: [device('11')],
      positions: [{ ...lastAccepted, device_cache_stale: true }],
      breadcrumbs: [],
    }, '2026-08-20T11:05:00.000Z').positions).toEqual([])
  })

  it('uses persisted membership sequence for equal-time append ordering', () => {
    const scope = createParticipationScope({
      participants: [participant({
        id: 'participant-group', kind: 'group', traccar_device_id: null,
        mission_team_id: 'team-101', effective_from: '2026-08-20T08:00:00.000Z',
      })],
      membershipEvents: [
        membership({ id: 'z-member', change: 'member', sequence: 1 }),
        membership({ id: 'a-left', change: 'left', sequence: 2 }),
      ],
    })

    expect(scope.includesAt('12', '2026-08-20T09:00:00.000Z')).toBe(false)
  })

  it('indexes participant windows by device instead of scanning the mission roster per fix', () => {
    let participantIdentityReads = 0
    const participants = Array.from({ length: 100 }, (_, index) => new Proxy(
      participant({ id: `participant-${index}`, traccar_device_id: String(index) }),
      {
        get(target, property, receiver) {
          if (property === 'kind' || property === 'traccar_device_id') {
            participantIdentityReads += 1
          }
          return Reflect.get(target, property, receiver)
        },
      },
    ))
    const scope = createParticipationScope({ participants, membershipEvents: [] })
    participantIdentityReads = 0

    expect(scope.includesAt('99', '2026-08-20T09:30:00.000Z')).toBe(true)
    expect(participantIdentityReads).toBeLessThanOrEqual(2)
  })
})

function participant(overrides: Partial<MissionParticipant> = {}): MissionParticipant {
  return {
    id: 'participant-11', mission_id: 'mission-1', kind: 'device',
    traccar_device_id: '11', mission_team_id: null, traccar_group_id: null,
    team_name: null, provenance: 'explicit', effective_from: '2026-08-20T08:00:00.000Z',
    added_at: '2026-08-20T08:00:00.000Z', added_by: 'Coordinator',
    removed_at: null, removed_by: null, ...overrides,
  }
}

function membership(
  overrides: Partial<GroupMembershipEvent> & { readonly sequence?: number } = {},
): GroupMembershipEvent {
  return {
    id: 'membership-1', mission_id: 'mission-1', mission_team_id: 'team-101',
    traccar_device_id: '12', change: 'member', observed_at: '2026-08-20T09:00:00.000Z',
    ...overrides,
  }
}

function checkpoint(
  overrides: Partial<ParticipantBackfillCheckpoint> = {},
): ParticipantBackfillCheckpoint {
  return {
    mission_id: 'mission-1', traccar_device_id: '12',
    window_from: '2026-08-20T09:00:00.000Z',
    window_to: '2026-08-20T11:00:00.000Z',
    reconciled_until: '2026-08-20T09:00:00.000Z', completed: 0,
    updated_at: '2026-08-20T11:00:00.000Z', ...overrides,
  }
}

function device(deviceId: string) {
  return {
    device_id: deviceId, name: `Device ${deviceId}`, status: 'online' as const,
    last_seen: null, unique_id: null, category: null, group_id: null,
  }
}

function position(deviceId: string, timestamp = '2026-08-20T09:30:00.000Z') {
  return {
    id: `position-${deviceId}`, device_id: deviceId, lat: 52, lon: -9,
    altitude: null, speed: null, battery: null, accuracy: null,
    timestamp, source: null,
    data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false,
  }
}
