import { describe, expect, it } from 'vitest'

import { createOperationalPositionRetention } from '../../src/features/participants/operational-position-retention'
import { createParticipationScope } from '../../src/features/participants/participation-scope'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

const DEVICE: NormalizedTrackingDevice = {
  device_id: 'device-1',
  name: 'Alpha',
  status: 'online',
  last_seen: '2026-04-06T10:59:00.000Z',
  unique_id: 'alpha-1',
  category: null,
  group_id: null,
}

const POSITION: NormalizedTrackingPosition = {
  id: 'position-1',
  device_id: DEVICE.device_id,
  lat: 52,
  lon: -9,
  altitude: null,
  speed: null,
  battery: null,
  accuracy: null,
  timestamp: '2026-04-06T10:59:00.000Z',
  timestamp_source: 'fix',
  fix_time_unverified: false,
  source: 'traccar',
  data_origin: 'live',
  cache_age_seconds: null,
  device_cache_stale: false,
}

const FIRST_SNAPSHOT: TrackingSnapshot = {
  devices: [DEVICE],
  positions: [POSITION],
  breadcrumbs: [POSITION],
  rawBreadcrumbsForPersistence: [POSITION],
}

const EMPTY_SNAPSHOT: TrackingSnapshot = {
  devices: [],
  positions: [],
  breadcrumbs: [],
  rawBreadcrumbsForPersistence: [],
}

const REMOVED_PARTICIPANT_SCOPE = createParticipationScope({
  participants: [{
    id: 'participant-1',
    mission_id: 'mission-1',
    kind: 'device',
    traccar_device_id: DEVICE.device_id,
    mission_team_id: null,
    traccar_group_id: null,
    team_name: null,
    provenance: 'explicit',
    effective_from: '2026-04-06T09:00:00.000Z',
    added_at: '2026-04-06T09:00:00.000Z',
    added_by: 'Coordinator',
    removed_at: '2026-04-06T11:00:00.000Z',
    removed_by: 'Coordinator',
  }],
  membershipEvents: [],
})

const ACTIVE_PARTICIPANT_SCOPE = createParticipationScope({
  participants: [{
    id: 'participant-1',
    mission_id: 'mission-1',
    kind: 'device',
    traccar_device_id: DEVICE.device_id,
    mission_team_id: null,
    traccar_group_id: null,
    team_name: null,
    provenance: 'explicit',
    effective_from: '2026-04-06T09:00:00.000Z',
    added_at: '2026-04-06T09:00:00.000Z',
    added_by: 'Coordinator',
    removed_at: null,
    removed_by: null,
  }],
  membershipEvents: [],
})

describe('operational position retention', () => {
  it('keeps a marker whose fix time is ahead of a slow laptop clock when a later poll omits the device [DON-349 M-06]', () => {
    // The laptop clock is three minutes slow, so every fix looks future-dated.
    // That is labelled, not a reason to drop the marker or its warning.
    const retention = createOperationalPositionRetention()
    const aheadOfClock: NormalizedTrackingPosition = { ...POSITION, device_cache_stale: true, fix_time_ahead_of_clock: true }
    const first = retention.apply({ ...FIRST_SNAPSHOT, positions: [aheadOfClock] },
      ACTIVE_PARTICIPANT_SCOPE, new Date('2026-04-06T10:56:00.000Z'), 'mission-1')
    expect(first.positions).toEqual([expect.objectContaining({ fix_time_ahead_of_clock: true })])

    const omitted = retention.apply({ ...EMPTY_SNAPSHOT, devices: [DEVICE] }, ACTIVE_PARTICIPANT_SCOPE,
      new Date('2026-04-06T10:56:05.000Z'), 'mission-1')

    expect(omitted.positions).toEqual([expect.objectContaining({
      device_id: DEVICE.device_id,
      device_cache_stale: true,
      fix_time_ahead_of_clock: true,
    })])
    expect(omitted.devices.map((device) => device.device_id)).toEqual([DEVICE.device_id])
  })

  it('keeps the clock warning on a retained marker whose newest breadcrumb is ahead of the clock [DON-349 M-06 review]', () => {
    // The current fix is on time, but the device's newest breadcrumb is five
    // minutes ahead. Marker selection draws that breadcrumb, so the retained
    // position must keep the warning when a later poll omits the current row.
    const retention = createOperationalPositionRetention()
    const futureBreadcrumb: NormalizedTrackingPosition = {
      ...POSITION,
      id: 'breadcrumb-future',
      timestamp: '2026-04-06T11:05:00.000Z',
    }
    const observedAt = new Date('2026-04-06T11:00:00.000Z')
    retention.apply({ ...FIRST_SNAPSHOT, breadcrumbs: [POSITION, futureBreadcrumb] },
      ACTIVE_PARTICIPANT_SCOPE, observedAt, 'mission-1')

    const omitted = retention.apply({ ...EMPTY_SNAPSHOT, devices: [DEVICE], breadcrumbs: [POSITION, futureBreadcrumb] },
      ACTIVE_PARTICIPANT_SCOPE, new Date('2026-04-06T11:00:05.000Z'), 'mission-1')

    expect(omitted.positions).toEqual([expect.objectContaining({
      device_id: DEVICE.device_id,
      fix_time_ahead_of_clock: true,
    })])
  })

  it('advances retained cache age and expires by cache age after an omitted current row [DON-267]', () => {
    const retention = createOperationalPositionRetention()
    const observedAt = new Date('2026-04-06T11:00:00.000Z')
    retention.apply({ ...FIRST_SNAPSHOT, positions: [{ ...POSITION, data_origin: 'cache', cache_age_seconds: 240 }] },
      REMOVED_PARTICIPANT_SCOPE, observedAt, 'mission-1')
    const retained = retention.apply(EMPTY_SNAPSHOT, REMOVED_PARTICIPANT_SCOPE,
      new Date('2026-04-06T11:00:30.000Z'), 'mission-1')
    expect(retained.positions).toEqual([expect.objectContaining({ data_origin: 'cache', cache_age_seconds: 270 })])
    const expired = retention.apply(EMPTY_SNAPSHOT, REMOVED_PARTICIPANT_SCOPE,
      new Date('2026-04-06T11:01:01.000Z'), 'mission-1')
    expect(expired.positions).toEqual([])
  })
  it('keeps a removed participant last accepted marker when a later poll omits it', () => {
    const retention = createOperationalPositionRetention()

    retention.apply(
      FIRST_SNAPSHOT,
      REMOVED_PARTICIPANT_SCOPE,
      new Date('2026-04-06T11:00:00.000Z'),
      'mission-1',
    )
    const later = retention.apply(
      EMPTY_SNAPSHOT,
      REMOVED_PARTICIPANT_SCOPE,
      new Date('2026-04-06T11:02:00.000Z'),
      'mission-1',
    )

    expect(later.devices).toEqual([DEVICE])
    expect(later.positions).toEqual([POSITION])
  })

  it('drops retained markers after the stale threshold', () => {
    const retention = createOperationalPositionRetention()

    retention.apply(
      FIRST_SNAPSHOT,
      REMOVED_PARTICIPANT_SCOPE,
      new Date('2026-04-06T11:00:00.000Z'),
      'mission-1',
    )
    const later = retention.apply(
      EMPTY_SNAPSHOT,
      REMOVED_PARTICIPANT_SCOPE,
      new Date('2026-04-06T11:05:01.000Z'),
      'mission-1',
    )

    expect(later.devices).toEqual([])
    expect(later.positions).toEqual([])
  })

  it('never carries a retained marker into another mission', () => {
    const retention = createOperationalPositionRetention()

    retention.apply(
      FIRST_SNAPSHOT,
      REMOVED_PARTICIPANT_SCOPE,
      new Date('2026-04-06T11:00:00.000Z'),
      'mission-1',
    )
    const nextMission = retention.apply(
      EMPTY_SNAPSHOT,
      REMOVED_PARTICIPANT_SCOPE,
      new Date('2026-04-06T11:02:00.000Z'),
      'mission-2',
    )

    expect(nextMission.devices).toEqual([])
    expect(nextMission.positions).toEqual([])
  })
})
