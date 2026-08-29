import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import Database from 'better-sqlite3'

import {
  buildFixtureManifest,
  createBreadcrumbProgrammeScenario,
  createDeterministicId,
  createFixturePlan,
  fixtureGeneratorVersionForPlan,
  fixtureManifestPath,
} from './seed-mission-store-lib.js'

const require = createRequire(import.meta.url)
const { CURRENT_SCHEMA_VERSION, createElectronMissionStore } = require('../electron/mission-store.cjs')

const FIXTURE_MISSION_ID = 'fixture-mission-000000000001'
const FIXTURE_MISSION_NAME = 'SYNTHETIC FIELD-SCALE VALIDATION MISSION'
const FIXTURE_START_MS = Date.parse('2026-01-01T00:00:00.000Z')
const DEFAULT_POLLS_PER_BATCH = 1_000

/**
 * Generates or reuses one deterministic field-scale mission-store fixture.
 * Generation happens in a throwaway sibling directory, so interruption never
 * mutates a previously verified cache entry.
 */
export async function generateMissionStoreFixture(options) {
  const plan = createFixturePlan(options.preset)
  const outputPath = path.resolve(options.outputPath)
  const manifestPath = fixtureManifestPath(outputPath)
  const progress = typeof options.progress === 'function' ? options.progress : () => undefined

  await recoverInterruptedFixtureReplacement(outputPath, manifestPath)

  if (!options.force) {
    const cached = await readVerifiedCachedFixture(outputPath, manifestPath, plan)
    if (cached !== null) {
      if (options.copyToPath !== undefined) {
        await copyFixtureAtomically(outputPath, manifestPath, options.copyToPath)
      }
      return { reused: true, outputPath, manifestPath, manifest: cached }
    }
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporaryRoot = await mkdtemp(path.join(path.dirname(outputPath), '.seed-mission-store-'))
  const temporaryDatabasePath = path.join(temporaryRoot, 'mission-store.sqlite')

  try {
    const store = createElectronMissionStore({
      userDataPath: temporaryRoot,
      readAdminRoster: async () => [],
    })
    store.close()

    const seedResult = seedDatabase({
      databasePath: temporaryDatabasePath,
      plan,
      progress,
      faultInjection: options.faultInjection,
    })

    const databaseBytes = (await stat(temporaryDatabasePath)).size
    const sha256 = await sha256File(temporaryDatabasePath)
    const manifest = buildFixtureManifest({
      plan: seedResult.effectivePlan,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      databaseBytes,
      sha256,
      rowCounts: seedResult.rowCounts,
      tableBytes: seedResult.tableBytes,
      ...(seedResult.scenario === undefined ? {} : { scenario: seedResult.scenario }),
    })
    const temporaryManifestPath = fixtureManifestPath(temporaryDatabasePath)
    await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await replaceFixturePair({
      temporaryDatabasePath,
      temporaryManifestPath,
      outputPath,
      manifestPath,
      faultInjection: options.faultInjection,
    })

    if (options.copyToPath !== undefined) {
      await copyFixtureAtomically(outputPath, manifestPath, options.copyToPath)
    }

    return { reused: false, outputPath, manifestPath, manifest }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

/** Seeds the real current schema using deterministic, explicitly synthetic records. */
function seedDatabase({ databasePath, plan, progress, faultInjection }) {
  if (plan.mode === 'breadcrumb-programme') {
    return seedBreadcrumbProgrammeDatabase({
      databasePath,
      plan,
      progress,
      faultInjection,
    })
  }
  const db = new Database(databasePath)
  db.pragma('journal_mode = OFF')
  db.pragma('synchronous = OFF')
  db.pragma('foreign_keys = ON')

  const counters = {
    polls: 0,
    positions: 0,
    missionEvents: 0,
    deviceCreatedEvents: 0,
    deviceUpdatedEvents: 0,
    positionRecordedEvents: 0,
    backupEvents: 0,
    restartCheckpointEvents: 0,
    operationalEvents: 0,
  }

  try {
    insertFixtureFoundation(db, plan, counters)
    const statements = prepareSeedStatements(db)
    const insertBatch = db.transaction((pollsInBatch) => {
      for (let offset = 0; offset < pollsInBatch; offset += 1) {
        insertSyntheticPoll({ db, statements, plan, counters })
      }
    })

    let batchCount = 0
    while (!isSeedComplete(db, plan, counters.polls)) {
      const pollsInBatch = pollsForNextBatch(plan, counters.polls)
      insertBatch(pollsInBatch)
      batchCount += 1
      progress({
        preset: plan.preset,
        polls: counters.polls,
        databaseBytes: databaseAllocatedBytes(db),
        targetBytes: plan.targetBytes,
        targetPolls: plan.pollCount,
      })

      if (faultInjection?.afterPollBatches === batchCount) {
        throw new Error('Injected fixture generation interruption after poll batch.')
      }
    }

    const integrityResult = db.pragma('integrity_check', { simple: true })
    if (integrityResult !== 'ok') {
      throw new Error(`Generated mission-store fixture failed integrity_check: ${integrityResult}`)
    }

    const tableBytes = readTableBytes(db)
    db.pragma('journal_mode = WAL')
    const actualDurationDays =
      (counters.polls * plan.pollIntervalMs) / (24 * 60 * 60 * 1000)

    return {
      effectivePlan: {
        ...plan,
        durationDays: plan.durationDays ?? actualDurationDays,
        pollCount: counters.polls,
        deviceUpdatedEventCount: counters.deviceUpdatedEvents,
        positionCount: counters.positions,
        positionRecordedEventCount: counters.positionRecordedEvents,
        backupEventCount: counters.backupEvents,
      },
      rowCounts: {
        missions: 1,
        devices: plan.deviceCount,
        positions: counters.positions,
        missionEvents: counters.missionEvents,
        deviceCreatedEvents: counters.deviceCreatedEvents,
        deviceUpdatedEvents: counters.deviceUpdatedEvents,
        positionRecordedEvents: counters.positionRecordedEvents,
        backupEvents: counters.backupEvents,
        restartCheckpointEvents: counters.restartCheckpointEvents,
        operationalEvents: counters.operationalEvents,
      },
      tableBytes,
    }
  } finally {
    db.close()
  }
}

/** Seeds one mission-model-aware BCP fixture without changing legacy preset emission. */
function seedBreadcrumbProgrammeDatabase({ databasePath, plan, progress, faultInjection }) {
  if (CURRENT_SCHEMA_VERSION !== 12) {
    throw new Error(
      `Breadcrumb programme fixtures require schema v12; current schema is v${CURRENT_SCHEMA_VERSION}.`,
    )
  }
  const db = new Database(databasePath)
  db.pragma('journal_mode = OFF')
  db.pragma('synchronous = OFF')
  db.pragma('foreign_keys = ON')
  const scenario = createBreadcrumbProgrammeScenario(plan)

  try {
    insertBreadcrumbProgrammeFoundation(db, plan, scenario)
    const insertPosition = db.prepare(`INSERT INTO positions (
        id, mission_id, device_id, source_position_id, name, lat, lon,
        altitude, speed, battery, accuracy, source, timestamp, data_origin,
        received_at, content_hash, source_kind, timestamp_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synthetic-fixture', ?, 'live', ?, ?, 'traccar_id', 'fix')`)
    const mainPositionCount = plan.positionCount - 12
    const positionBatch = db.transaction((fromIndex, toIndex) => {
      for (let index = fromIndex; index < toIndex; index += 1) {
        const row = breadcrumbProgrammePosition(plan, index)
        insertPosition.run(
          row.id,
          FIXTURE_MISSION_ID,
          row.deviceId,
          row.sourcePositionId,
          row.name,
          row.lat,
          row.lon,
          row.altitude,
          row.speed,
          row.battery,
          row.accuracy,
          row.timestamp,
          row.receivedAt,
          row.contentHash,
        )
      }
    })
    const batchSize = 10_000
    let batchCount = 0
    for (let index = 0; index < mainPositionCount; index += batchSize) {
      const toIndex = Math.min(index + batchSize, mainPositionCount)
      positionBatch(index, toIndex)
      batchCount += 1
      progress({
        preset: plan.preset,
        polls: Math.floor(toIndex / plan.activePositionDeviceCount),
        databaseBytes: databaseAllocatedBytes(db),
        targetBytes: null,
        targetPolls: plan.pollCount,
        positions: toIndex + 12,
        targetPositions: plan.positionCount,
      })
      if (faultInjection?.afterPollBatches === batchCount) {
        throw new Error('Injected fixture generation interruption after poll batch.')
      }
    }
    insertLegacyNoOutingPositions(db, insertPosition)
    insertBreadcrumbProgrammeAnomalies(db, scenario)
    assertBreadcrumbProgrammePositionScopeInvariants(
      db,
      FIXTURE_MISSION_ID,
      scenario.activeParticipantCount,
    )

    const integrityResult = db.pragma('integrity_check', { simple: true })
    if (integrityResult !== 'ok') {
      throw new Error(`Generated mission-store fixture failed integrity_check: ${integrityResult}`)
    }
    const rowCounts = readBreadcrumbProgrammeRowCounts(db)
    if (rowCounts.positions !== plan.positionCount) {
      throw new Error(
        `Breadcrumb programme fixture position count drifted: expected ${plan.positionCount}, got ${rowCounts.positions}.`,
      )
    }
    db.pragma('journal_mode = WAL')
    return {
      effectivePlan: plan,
      rowCounts,
      tableBytes: readAllDatabaseObjectBytes(db),
      scenario,
    }
  } finally {
    db.close()
  }
}

/** Inserts mission, outing, team, participant, membership, and checkpoint truth. */
function insertBreadcrumbProgrammeFoundation(db, plan, scenario) {
  const mainStart = new Date(FIXTURE_START_MS).toISOString()
  const legacyMissionId = 'fixture-mission-legacy-no-outings'
  const legacyStart = new Date(FIXTURE_START_MS - 24 * 60 * 60 * 1000).toISOString()
  const insertMission = db.prepare(`INSERT INTO missions
    (id, name, status, start_time, pause_time, finish_time, paused_seconds, notes, schema_version)
    VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?)`)
  const insertDevice = db.prepare(`INSERT INTO devices
    (id, mission_id, device_id, name, color, last_seen, status, group_id, unique_id)
    VALUES (?, ?, ?, ?, ?, ?, 'online', ?, ?)`)
  const insertTeam = db.prepare(`INSERT INTO mission_teams
    (id, mission_id, traccar_group_id, name, frozen_at) VALUES (?, ?, ?, ?, ?)`)
  const insertParticipant = db.prepare(`INSERT INTO mission_participants
    (id, mission_id, kind, traccar_device_id, mission_team_id, provenance,
     effective_from, added_at, added_by, removed_at, removed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const insertMembership = db.prepare(`INSERT INTO mission_group_membership_events
    (id, sequence, mission_id, mission_team_id, traccar_device_id, change, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const insertOuting = db.prepare(`INSERT INTO outings
    (id, mission_id, label, started_at, ended_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const insertCheckpoint = db.prepare(`INSERT INTO participant_backfill_checkpoints
    (mission_id, traccar_device_id, window_from, window_to, reconciled_until, completed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const insertEvent = db.prepare(`INSERT INTO mission_events
    (id, mission_id, event_type, timestamp, details_json) VALUES (?, ?, ?, ?, ?)`)

  const transaction = db.transaction(() => {
    insertMission.run(
      FIXTURE_MISSION_ID,
      FIXTURE_MISSION_NAME,
      'active',
      mainStart,
      null,
      'Synthetic BCP mission-model validation data only. Never use operationally.',
      CURRENT_SCHEMA_VERSION,
    )
    insertMission.run(
      legacyMissionId,
      'SYNTHETIC LEGACY NO-OUTING MISSION',
      'finished',
      legacyStart,
      mainStart,
      'Synthetic legacy evidence with no invented outing rows.',
      CURRENT_SCHEMA_VERSION,
    )
    let eventIndex = 0
    const addEvent = (missionId, type, timestamp, details) => {
      insertEvent.run(
        createDeterministicId('event', eventIndex),
        missionId,
        type,
        timestamp,
        JSON.stringify({ synthetic_fixture: true, ...details }),
      )
      eventIndex += 1
    }
    addEvent(FIXTURE_MISSION_ID, 'mission_created', mainStart, { preset: plan.preset })
    addEvent(legacyMissionId, 'mission_created', legacyStart, { legacy_no_outings: true })

    const groupByDeviceIndex = groupAssignments(scenario.groupSizes)
    const teamIds = scenario.groupSizes.map((_size, index) => createDeterministicId('team', index))
    for (let groupIndex = 0; groupIndex < scenario.groupSizes.length; groupIndex += 1) {
      if (groupIndex < scenario.groupSizes.length - 1) {
        insertTeam.run(
          teamIds[groupIndex],
          FIXTURE_MISSION_ID,
          programmeGroupId(groupIndex),
          `SYNTHETIC TEAM ${String(groupIndex + 1).padStart(2, '0')}`,
          mainStart,
        )
        insertParticipant.run(
          createDeterministicId('participant', groupIndex),
          FIXTURE_MISSION_ID,
          'group',
          null,
          teamIds[groupIndex],
          'explicit',
          mainStart,
          mainStart,
          'Synthetic coordinator',
          null,
          null,
        )
      }
    }
    for (let deviceIndex = 0; deviceIndex < plan.deviceCount; deviceIndex += 1) {
      const deviceId = programmeDeviceId(deviceIndex)
      const groupIndex = groupByDeviceIndex[deviceIndex]
      insertDevice.run(
        createDeterministicId('device-row', deviceIndex),
        FIXTURE_MISSION_ID,
        deviceId,
        programmeDeviceName(deviceIndex),
        syntheticDeviceColor(deviceIndex),
        mainStart,
        programmeGroupId(groupIndex),
        `synthetic-imei-${String(deviceIndex + 1).padStart(6, '0')}`,
      )
      if (groupIndex < scenario.groupSizes.length - 1) {
        insertMembership.run(
          createDeterministicId('membership', deviceIndex),
          deviceIndex + 1,
          FIXTURE_MISSION_ID,
          teamIds[groupIndex],
          deviceId,
          'member',
          mainStart,
        )
      }
    }

    const participantFixtures = [
      { deviceIndex: 99, provenance: 'legacy_auto', effectiveDay: 0, addedDay: 0 },
      { deviceIndex: 98, provenance: 'explicit', effectiveDay: 0, addedDay: 0 },
      { deviceIndex: 97, provenance: 'explicit', effectiveDay: 0, addedDay: 0, removedDay: 8 },
      { deviceIndex: 97, provenance: 'explicit', effectiveDay: 8, addedDay: 8 },
      { deviceIndex: 96, provenance: 'explicit', effectiveDay: 0, addedDay: 0 },
      { deviceIndex: 95, provenance: 'explicit', effectiveDay: 0, addedDay: 1 },
      { deviceIndex: 94, provenance: 'explicit', effectiveDay: 0, addedDay: 1 },
    ]
    for (let index = 0; index < participantFixtures.length; index += 1) {
      const fixture = participantFixtures[index]
      const effectiveFrom = isoDay(fixture.effectiveDay)
      const addedAt = isoDay(fixture.addedDay)
      const removedAt = fixture.removedDay === undefined ? null : isoDay(fixture.removedDay)
      insertParticipant.run(
        createDeterministicId('participant', 12 + index),
        FIXTURE_MISSION_ID,
        'device',
        programmeDeviceId(fixture.deviceIndex),
        null,
        fixture.provenance,
        effectiveFrom,
        addedAt,
        fixture.provenance === 'legacy_auto' ? null : 'Synthetic coordinator',
        removedAt,
        removedAt === null ? null : 'Synthetic coordinator',
      )
    }
    insertCheckpoint.run(
      FIXTURE_MISSION_ID,
      programmeDeviceId(95),
      isoDay(0),
      isoDay(1),
      isoDay(1),
      1,
      isoDay(1),
    )
    insertCheckpoint.run(
      FIXTURE_MISSION_ID,
      programmeDeviceId(94),
      isoDay(0),
      isoDay(1),
      new Date(FIXTURE_START_MS + 2 * 60 * 60 * 1000).toISOString(),
      0,
      isoDay(1),
    )

    const movedDeviceId = programmeDeviceId(0)
    const changeAt = isoDay(6)
    insertMembership.run(
      createDeterministicId('membership', 100),
      95,
      FIXTURE_MISSION_ID,
      teamIds[0],
      movedDeviceId,
      'left',
      changeAt,
    )
    insertMembership.run(
      createDeterministicId('membership', 101),
      96,
      FIXTURE_MISSION_ID,
      teamIds[1],
      movedDeviceId,
      'member',
      changeAt,
    )
    addEvent(FIXTURE_MISSION_ID, 'group_membership_changed', changeAt, {
      device_id: movedDeviceId,
      from_group: programmeGroupId(0),
      to_group: programmeGroupId(1),
    })

    for (let index = 0; index < scenario.outings.length; index += 1) {
      const outing = scenario.outings[index]
      insertOuting.run(
        outing.id,
        FIXTURE_MISSION_ID,
        outing.label,
        outing.startedAt,
        outing.endedAt,
        outing.startedAt,
        outing.endedAt,
      )
      addEvent(FIXTURE_MISSION_ID, 'outing_started', outing.startedAt, {
        outing_id: outing.id,
      })
      addEvent(FIXTURE_MISSION_ID, 'outing_ended', outing.endedAt, {
        outing_id: outing.id,
      })
    }
    for (const day of plan.restartCheckpointsDays) {
      addEvent(FIXTURE_MISSION_ID, 'fixture_restart_checkpoint', isoDay(day), {
        simulated_day: day,
        accumulated_position_count: Math.floor(plan.positionCount * day / plan.durationDays),
      })
    }

    const legacyDeviceId = 'synthetic-legacy-device-001'
    insertDevice.run(
      createDeterministicId('device-row', plan.deviceCount),
      legacyMissionId,
      legacyDeviceId,
      'SYNTHETIC LEGACY DEVICE',
      '#64748B',
      mainStart,
      null,
      'synthetic-legacy-imei-000001',
    )
    insertParticipant.run(
      createDeterministicId('participant', 19),
      legacyMissionId,
      'device',
      legacyDeviceId,
      null,
      'grandfathered',
      legacyStart,
      mainStart,
      null,
      null,
      null,
    )
    assertBreadcrumbProgrammeSelectionInvariants(db, FIXTURE_MISSION_ID)
  })
  transaction()
}

/** Rejects fixture-only participant states unreachable through the real selection API. */
export function assertBreadcrumbProgrammeSelectionInvariants(db, missionId) {
  const overlap = db.prepare(`WITH ranked_membership AS (
      SELECT mission_id, mission_team_id, traccar_device_id, change,
        ROW_NUMBER() OVER (
          PARTITION BY mission_id, mission_team_id, traccar_device_id
          ORDER BY observed_at DESC, sequence DESC
        ) AS rank
      FROM mission_group_membership_events
      WHERE mission_id = ?
    )
    SELECT direct.traccar_device_id
    FROM mission_participants AS direct
    INNER JOIN ranked_membership AS membership
      ON membership.mission_id = direct.mission_id
     AND membership.traccar_device_id = direct.traccar_device_id
     AND membership.rank = 1
     AND membership.change = 'member'
    INNER JOIN mission_participants AS selected_group
      ON selected_group.mission_id = membership.mission_id
     AND selected_group.mission_team_id = membership.mission_team_id
     AND selected_group.kind = 'group'
     AND selected_group.removed_at IS NULL
    WHERE direct.mission_id = ?
      AND direct.kind = 'device'
      AND direct.removed_at IS NULL
    LIMIT 1`).get(missionId, missionId)
  if (overlap !== undefined) {
    throw new Error(
      `Breadcrumb programme fixture has direct participant ${overlap.traccar_device_id} already covered by a selected group.`,
    )
  }
}

/** Rejects every fixture row that production flag-on participation would refuse. */
export function assertBreadcrumbProgrammePositionScopeInvariants(
  db,
  missionId,
  expectedActiveDeviceCount,
) {
  const participants = db.prepare(`SELECT kind, traccar_device_id, mission_team_id,
      effective_from, removed_at
    FROM mission_participants WHERE mission_id = ?`).all(missionId)
  const membershipEvents = db.prepare(`SELECT mission_team_id, traccar_device_id,
      change, observed_at, sequence
    FROM mission_group_membership_events WHERE mission_id = ?
    ORDER BY observed_at DESC, sequence DESC`).all(missionId)
  const directByDevice = new Map()
  const groupsByTeam = new Map()
  const eventsByDevice = new Map()
  for (const participant of participants) {
    const index = participant.kind === 'device' ? directByDevice : groupsByTeam
    const key = participant.kind === 'device'
      ? participant.traccar_device_id
      : participant.mission_team_id
    const values = index.get(key) ?? []
    values.push(participant)
    index.set(key, values)
  }
  for (const event of membershipEvents) {
    const values = eventsByDevice.get(event.traccar_device_id) ?? []
    values.push(event)
    eventsByDevice.set(event.traccar_device_id, values)
  }

  const includesAt = (deviceId, timestamp) => {
    if ((directByDevice.get(deviceId) ?? []).some((participant) =>
      participant.effective_from <= timestamp &&
      (participant.removed_at === null || timestamp < participant.removed_at))) return true
    const resolvedTeams = new Set()
    for (const event of eventsByDevice.get(deviceId) ?? []) {
      if (event.observed_at > timestamp || resolvedTeams.has(event.mission_team_id)) continue
      resolvedTeams.add(event.mission_team_id)
      if (
        event.change === 'member' &&
        (groupsByTeam.get(event.mission_team_id) ?? []).some((participant) =>
          participant.effective_from <= timestamp &&
          (participant.removed_at === null || timestamp < participant.removed_at))
      ) return true
    }
    return false
  }

  const positionedDeviceIds = new Set()
  for (const position of db.prepare(`SELECT device_id, timestamp FROM positions
    WHERE mission_id = ? ORDER BY device_id, timestamp`).iterate(missionId)) {
    positionedDeviceIds.add(position.device_id)
    if (!includesAt(position.device_id, position.timestamp)) {
      throw new Error(
        `Breadcrumb programme fixture position for ${position.device_id} at ${position.timestamp} is outside participation-at-fix-time.`,
      )
    }
  }
  if (positionedDeviceIds.size !== expectedActiveDeviceCount) {
    throw new Error(
      `Breadcrumb programme fixture expected ${expectedActiveDeviceCount} active positioned participants; found ${positionedDeviceIds.size}.`,
    )
  }
}

/** Returns one deterministic position row calibrated to the accepted field evidence. */
function breadcrumbProgrammePosition(plan, index) {
  const deviceIndex = index % plan.activePositionDeviceCount
  const pollIndex = Math.floor(index / plan.activePositionDeviceCount)
  const deviceId = programmeDeviceId(deviceIndex)
  const regularTimestampMs = FIXTURE_START_MS + pollIndex * plan.pollIntervalMs
  const lateInjection = index < 8
  const timestampMs = lateInjection
    ? Math.max(FIXTURE_START_MS, regularTimestampMs - 2 * 60 * 60 * 1000)
    : regularTimestampMs
  const position = programmeCoordinates(deviceIndex, pollIndex, plan.pollIntervalMs)
  const id = createDeterministicId('position', index)
  return {
    id,
    deviceId,
    sourcePositionId: `traccar-${String(index + 1).padStart(12, '0')}`,
    name: programmeDeviceName(deviceIndex),
    lat: position.lat,
    lon: position.lon,
    altitude: 100 + (deviceIndex % 30),
    speed: position.speed,
    battery: 95 - (pollIndex % 60),
    accuracy: programmeAccuracy(index),
    timestamp: new Date(timestampMs).toISOString(),
    receivedAt: new Date(regularTimestampMs + 2_000).toISOString(),
    contentHash: `fixture-content-${String(index).padStart(12, '0')}`,
  }
}

/** Returns exact generator rows as normalized fixes for deterministic policy tests. */
export function createBreadcrumbProgrammeCalibrationSample(
  preset,
  deviceIndex,
  fromPoll,
  toPoll,
) {
  const plan = createFixturePlan(preset)
  if (plan.mode !== 'breadcrumb-programme') {
    throw new Error('Calibration samples require a breadcrumb-programme preset.')
  }
  if (
    !Number.isSafeInteger(deviceIndex) || deviceIndex < 0 || deviceIndex >= plan.deviceCount ||
    !Number.isSafeInteger(fromPoll) || !Number.isSafeInteger(toPoll) ||
    fromPoll < 0 || toPoll <= fromPoll
  ) {
    throw new Error('Calibration sample bounds are invalid.')
  }
  const positions = []
  for (let pollIndex = fromPoll; pollIndex < toPoll; pollIndex += 1) {
    const row = breadcrumbProgrammePosition(
      plan,
      pollIndex * plan.activePositionDeviceCount + deviceIndex,
    )
    positions.push({
      id: row.id,
      device_id: row.deviceId,
      lat: row.lat,
      lon: row.lon,
      altitude: row.altitude,
      speed: row.speed,
      battery: row.battery,
      accuracy: row.accuracy,
      timestamp: row.timestamp,
      source: 'synthetic-fixture',
      data_origin: 'live',
      cache_age_seconds: null,
      device_cache_stale: false,
    })
  }
  return positions
}

function programmeCoordinates(deviceIndex, pollIndex, pollIntervalMs) {
  const groupOffset = Math.floor(deviceIndex / 9)
  const baseLat = 51.98 + groupOffset * 0.002
  const baseLon = -9.75 + (deviceIndex % 9) * 0.001
  const stationarySpanPolls = Math.ceil((20 * 60 * 1000) / pollIntervalMs) + 1
  const stationaryOffset = pollIndex - 1_000
  if (deviceIndex === 0 && stationaryOffset >= 0 && stationaryOffset <= stationarySpanPolls) {
    return { lat: baseLat, lon: baseLon, speed: 0 }
  }
  if (deviceIndex === 1 && stationaryOffset >= 0 && stationaryOffset <= stationarySpanPolls) {
    return { lat: baseLat + stationaryOffset * 0.00014, lon: baseLon, speed: 1.2 }
  }
  if (deviceIndex === 2 && stationaryOffset >= 0 && stationaryOffset <= Math.floor(stationarySpanPolls / 2)) {
    return { lat: baseLat + (stationaryOffset % 2) * 0.00002, lon: baseLon, speed: 0 }
  }
  if (deviceIndex === 3 && stationaryOffset >= 0 && stationaryOffset <= stationarySpanPolls) {
    if (stationaryOffset === Math.floor(stationarySpanPolls / 2)) {
      return { lat: baseLat + 0.0046, lon: baseLon, speed: 90 }
    }
    return { lat: baseLat, lon: baseLon, speed: 0 }
  }
  const cycle = pollIndex % 240
  const routeStep = cycle <= 120 ? cycle : 240 - cycle
  return {
    lat: baseLat + routeStep * 0.000305,
    lon: baseLon + ((pollIndex + deviceIndex) % 3 - 1) * 0.000005,
    speed: 4.5,
  }
}

function programmeAccuracy(index) {
  if (index % 997 === 0) return 80
  const bucket = index % 10
  if (bucket < 6) return 3.8
  if (bucket < 9) return 6
  return 10
}

function insertLegacyNoOutingPositions(db, insertPosition) {
  const missionId = 'fixture-mission-legacy-no-outings'
  const deviceId = 'synthetic-legacy-device-001'
  for (let index = 0; index < 12; index += 1) {
    const timestamp = new Date(FIXTURE_START_MS - (12 - index) * 60 * 60 * 1000).toISOString()
    const id = createDeterministicId('legacy-position', index)
    insertPosition.run(
      id,
      missionId,
      deviceId,
      `legacy-${String(index + 1).padStart(4, '0')}`,
      'SYNTHETIC LEGACY DEVICE',
      52 + index * 0.0003,
      -9.5,
      80,
      4,
      80,
      5,
      timestamp,
      timestamp,
      `fixture-legacy-content-${index}`,
    )
  }
}

function insertBreadcrumbProgrammeAnomalies(db, scenario) {
  const insert = db.prepare(`INSERT INTO ingest_anomalies (
      id, mission_id, kind, anomaly_key, device_id, source_position_id,
      reason_class, received_at, canonical_payload_json, created_at,
      first_seen_at, last_seen_at, occurrence_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const timestamp = isoDay(7)
  const rows = [
    ['conflict', 'same-source-different-content-1', 'synthetic-device-001', 'traccar-conflict-1', 'identity_conflict', 2],
    ['conflict', 'same-source-different-content-2', 'synthetic-device-002', 'traccar-conflict-2', 'identity_conflict', 3],
    ['rejected', 'invalid-latitude', 'synthetic-device-003', 'traccar-rejected-1', 'coordinate_out_of_range', 1],
    ['rejected', 'invalid-timestamp', 'synthetic-device-004', 'traccar-rejected-2', 'invalid_timestamp', 1],
    ['rejected', 'non-finite-coordinate', 'synthetic-device-005', 'traccar-rejected-3', 'coordinate_not_finite', 1],
  ]
  for (let index = 0; index < rows.length; index += 1) {
    const [kind, key, deviceId, sourceId, reason, occurrenceCount] = rows[index]
    insert.run(
      createDeterministicId('anomaly', index),
      FIXTURE_MISSION_ID,
      kind,
      key,
      deviceId,
      sourceId,
      reason,
      timestamp,
      JSON.stringify({ synthetic_fixture: true, injection: key }),
      timestamp,
      timestamp,
      timestamp,
      occurrenceCount,
    )
  }
  if (scenario.injections.conflicts !== 2 || scenario.injections.rejected !== 3) {
    throw new Error('Breadcrumb programme anomaly injection contract drifted.')
  }
}

function readBreadcrumbProgrammeRowCounts(db) {
  const count = (tableName) => Number(db.prepare(`SELECT COUNT(*) FROM ${tableName}`).pluck().get())
  const eventCount = (eventType) => Number(db.prepare(
    'SELECT COUNT(*) FROM mission_events WHERE event_type = ?',
  ).pluck().get(eventType))
  const missionEvents = count('mission_events')
  const restartCheckpointEvents = eventCount('fixture_restart_checkpoint')
  return {
    missions: count('missions'),
    devices: count('devices'),
    positions: count('positions'),
    missionEvents,
    deviceCreatedEvents: eventCount('device_created'),
    deviceUpdatedEvents: eventCount('device_updated'),
    positionRecordedEvents: eventCount('position_recorded'),
    backupEvents: eventCount('mission_backup_synced'),
    restartCheckpointEvents,
    operationalEvents: missionEvents,
    outings: count('outings'),
    missionTeams: count('mission_teams'),
    missionParticipants: count('mission_participants'),
    groupMembershipEvents: count('mission_group_membership_events'),
    participantBackfillCheckpoints: count('participant_backfill_checkpoints'),
    ingestAnomalies: count('ingest_anomalies'),
  }
}

function readAllDatabaseObjectBytes(db) {
  return Object.fromEntries(
    db.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY name')
      .all()
      .map((row) => [String(row.name), Number(row.bytes ?? 0)]),
  )
}

function groupAssignments(groupSizes) {
  const assignments = []
  for (let groupIndex = 0; groupIndex < groupSizes.length; groupIndex += 1) {
    for (let count = 0; count < groupSizes[groupIndex]; count += 1) assignments.push(groupIndex)
  }
  return assignments
}

function programmeDeviceId(index) {
  return `synthetic-device-${String(index + 1).padStart(3, '0')}`
}

function programmeDeviceName(index) {
  return `SYNTHETIC DEVICE ${String(index + 1).padStart(3, '0')}`
}

function programmeGroupId(index) {
  return `synthetic-group-${String(index + 1).padStart(3, '0')}`
}

function isoDay(day) {
  return new Date(FIXTURE_START_MS + day * 24 * 60 * 60 * 1000).toISOString()
}

/** Inserts the active mission, synthetic device roster, and initial operational events. */
function insertFixtureFoundation(db, plan, counters) {
  const startTime = new Date(FIXTURE_START_MS).toISOString()
  const insertMission = db.prepare(`INSERT INTO missions
    (id, name, status, start_time, pause_time, finish_time, paused_seconds, notes, schema_version)
    VALUES (?, ?, 'active', ?, NULL, NULL, 0, ?, ?)`)
  const insertDevice = db.prepare(`INSERT INTO devices
    (id, mission_id, device_id, name, color, last_seen, status)
    VALUES (?, ?, ?, ?, ?, ?, 'online')`)
  const insertEvent = db.prepare(`INSERT INTO mission_events
    (id, mission_id, event_type, timestamp, details_json)
    VALUES (?, ?, ?, ?, ?)`)

  const transaction = db.transaction(() => {
    insertMission.run(
      FIXTURE_MISSION_ID,
      FIXTURE_MISSION_NAME,
      startTime,
      'Synthetic validation data only. Never use for an operational incident.',
      CURRENT_SCHEMA_VERSION,
    )
    insertEvent.run(
      createDeterministicId('event', counters.missionEvents),
      FIXTURE_MISSION_ID,
      'mission_created',
      startTime,
      JSON.stringify({ synthetic_fixture: true, preset: plan.preset }),
    )
    counters.missionEvents += 1
    counters.operationalEvents += 1

    for (let index = 0; index < plan.deviceCount; index += 1) {
      const deviceId = syntheticDeviceId(index)
      insertDevice.run(
        createDeterministicId('device-row', index),
        FIXTURE_MISSION_ID,
        deviceId,
        `SYNTHETIC DEVICE ${String(index + 1).padStart(2, '0')}`,
        syntheticDeviceColor(index),
        startTime,
      )
      insertEvent.run(
        createDeterministicId('event', counters.missionEvents),
        FIXTURE_MISSION_ID,
        'device_created',
        startTime,
        JSON.stringify({
          synthetic_fixture: true,
          device_id: deviceId,
          name: `SYNTHETIC DEVICE ${String(index + 1).padStart(2, '0')}`,
          status: 'online',
          color: syntheticDeviceColor(index),
        }),
      )
      counters.missionEvents += 1
      counters.deviceCreatedEvents += 1
      counters.operationalEvents += 1
    }
  })
  transaction()
}

/** Prepares the statements reused by every synthetic tracking poll. */
function prepareSeedStatements(db) {
  return {
    insertEvent: db.prepare(`INSERT INTO mission_events
      (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, ?, ?, ?)`),
    insertPosition: db.prepare(`INSERT INTO positions
      (id, mission_id, device_id, name, lat, lon, altitude, speed, battery, accuracy, source, timestamp, data_origin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live')`),
    updateDevice: db.prepare(`UPDATE devices
      SET last_seen = ?, status = 'online'
      WHERE mission_id = ? AND device_id = ?`),
  }
}

/** Inserts one production-shaped tracking poll and its beta.11 write amplification. */
function insertSyntheticPoll({ statements, plan, counters }) {
  const pollNumber = counters.polls + 1
  const timestamp = new Date(FIXTURE_START_MS + pollNumber * plan.pollIntervalMs).toISOString()

  for (let deviceIndex = 0; deviceIndex < plan.deviceCount; deviceIndex += 1) {
    const deviceId = syntheticDeviceId(deviceIndex)
    statements.updateDevice.run(timestamp, FIXTURE_MISSION_ID, deviceId)
    statements.insertEvent.run(
      createDeterministicId('event', counters.missionEvents),
      FIXTURE_MISSION_ID,
      'device_updated',
      timestamp,
      JSON.stringify({
        synthetic_fixture: true,
        device_id: deviceId,
        name: `SYNTHETIC DEVICE ${String(deviceIndex + 1).padStart(2, '0')}`,
        status: 'online',
        color: syntheticDeviceColor(deviceIndex),
      }),
    )
    counters.missionEvents += 1
    counters.deviceUpdatedEvents += 1
  }

  for (
    let deviceIndex = 0;
    deviceIndex < plan.activePositionDeviceCount;
    deviceIndex += 1
  ) {
    const positionIndex = counters.positions
    const positionId = createDeterministicId('position', positionIndex)
    const deviceId = syntheticDeviceId(deviceIndex)
    const lat = deviceIndex * 0.0001 + (pollNumber % 100) * 0.000001
    const lon = -(deviceIndex * 0.0001 + (pollNumber % 100) * 0.000001)
    statements.insertPosition.run(
      positionId,
      FIXTURE_MISSION_ID,
      deviceId,
      `SYNTHETIC DEVICE ${String(deviceIndex + 1).padStart(2, '0')}`,
      lat,
      lon,
      100 + deviceIndex,
      4.5,
      90,
      5,
      'synthetic-fixture',
      timestamp,
    )
    statements.insertEvent.run(
      createDeterministicId('event', counters.missionEvents),
      FIXTURE_MISSION_ID,
      'position_recorded',
      timestamp,
      JSON.stringify({
        synthetic_fixture: true,
        position_id: positionId,
        device_id: deviceId,
        timestamp,
        data_origin: 'live',
        source: 'synthetic-fixture',
      }),
    )
    counters.positions += 1
    counters.missionEvents += 1
    counters.positionRecordedEvents += 1
  }

  const pollsPerBackup = Math.max(1, Math.round(plan.autosaveIntervalMs / plan.pollIntervalMs))
  if (pollNumber % pollsPerBackup === 0) {
    statements.insertEvent.run(
      createDeterministicId('event', counters.missionEvents),
      FIXTURE_MISSION_ID,
      'mission_backup_synced',
      timestamp,
      JSON.stringify({
        synthetic_fixture: true,
        backup_path: '[synthetic-fixture]/mission-store.backup.sqlite',
      }),
    )
    counters.missionEvents += 1
    counters.backupEvents += 1
  }

  const restartCheckpointDay = restartCheckpointDayForPoll(plan, pollNumber)
  if (restartCheckpointDay !== null) {
    statements.insertEvent.run(
      createDeterministicId('event', counters.missionEvents),
      FIXTURE_MISSION_ID,
      'fixture_restart_checkpoint',
      timestamp,
      JSON.stringify({
        synthetic_fixture: true,
        simulated_day: restartCheckpointDay,
        accumulated_poll_count: pollNumber,
        instruction: 'Restart packaged app without replacing this accumulated mission store.',
      }),
    )
    counters.missionEvents += 1
    counters.restartCheckpointEvents += 1
    counters.operationalEvents += 1
  }

  counters.polls = pollNumber
}

/** Returns the simulated restart day represented by an exact accumulated poll boundary. */
export function restartCheckpointDayForPoll(plan, pollNumber) {
  if (!Number.isSafeInteger(pollNumber) || pollNumber < 0) {
    return null
  }
  return (
    plan.restartCheckpointsDays.find(
      (day) =>
        pollNumber === Math.floor((day * 24 * 60 * 60 * 1000) / plan.pollIntervalMs),
    ) ?? null
  )
}

/** Returns true when either an exact duration or the requested allocated size is reached. */
function isSeedComplete(db, plan, completedPolls) {
  if (plan.mode === 'duration') {
    return completedPolls >= plan.pollCount
  }
  return completedPolls > 0 && databaseAllocatedBytes(db) >= plan.targetBytes
}

/** Chooses a bounded transaction size while preserving exact duration row counts. */
function pollsForNextBatch(plan, completedPolls) {
  const defaultBatch = plan.preset === 'small' ? 100 : DEFAULT_POLLS_PER_BATCH
  if (plan.mode !== 'duration') {
    return defaultBatch
  }
  return Math.min(defaultBatch, plan.pollCount - completedPolls)
}

/** Reads SQLite allocated bytes without scanning table contents. */
function databaseAllocatedBytes(db) {
  const pageCount = Number(db.pragma('page_count', { simple: true }))
  const pageSize = Number(db.pragma('page_size', { simple: true }))
  return pageCount * pageSize
}

/** Accounts for table/index bytes through SQLite's dbstat virtual table. */
function readTableBytes(db) {
  const bytes = {
    missions: 0,
    devices: 0,
    positions: 0,
    mission_events: 0,
    other: 0,
  }
  const rows = db
    .prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY name')
    .all()
  for (const row of rows) {
    const name = typeof row.name === 'string' ? row.name : ''
    const size = Number(row.bytes ?? 0)
    if (Object.hasOwn(bytes, name)) {
      bytes[name] += size
    } else if (name.startsWith('sqlite_autoindex_positions')) {
      bytes.positions += size
    } else if (name.startsWith('sqlite_autoindex_mission_events')) {
      bytes.mission_events += size
    } else if (name === 'idx_positions_mission_device_timestamp') {
      bytes.positions += size
    } else {
      bytes.other += size
    }
  }
  return bytes
}

/** Returns a stable synthetic tracker ID. */
function syntheticDeviceId(index) {
  return `synthetic-device-${String(index + 1).padStart(2, '0')}`
}

/** Returns a deterministic visible color for one synthetic tracker. */
function syntheticDeviceColor(index) {
  const colors = ['#2563EB', '#DC2626', '#16A34A', '#D97706', '#7C3AED', '#0891B2']
  return colors[index % colors.length]
}

/** Reads and verifies a compatible cached fixture, or returns null when none exists. */
async function readVerifiedCachedFixture(outputPath, manifestPath, plan) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    await stat(outputPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }

  if (
    manifest.generatorVersion !== fixtureGeneratorVersionForPlan(plan) ||
    manifest.preset !== plan.preset
  ) {
    throw new Error(
      `Cached mission-store fixture is incompatible with preset ${plan.preset}; rerun with --force.`,
    )
  }
  const actualSha256 = await sha256File(outputPath)
  if (actualSha256 !== manifest.database?.sha256) {
    throw new Error('Cached mission-store fixture checksum does not match its manifest.')
  }
  return manifest
}

/** Replaces the cached database and manifest after generation and validation complete. */
async function replaceFixturePair({
  temporaryDatabasePath,
  temporaryManifestPath,
  outputPath,
  manifestPath,
  faultInjection,
}) {
  const token = randomUUID()
  const nextDatabasePath = `${outputPath}.next-${token}`
  const nextManifestPath = `${manifestPath}.next-${token}`
  const previousDatabasePath = `${outputPath}.previous`
  const previousManifestPath = `${manifestPath}.previous`
  await copyFile(temporaryDatabasePath, nextDatabasePath)
  await copyFile(temporaryManifestPath, nextManifestPath)

  const hasExistingFixture = (await fileExists(outputPath)) && (await fileExists(manifestPath))
  try {
    if (hasExistingFixture) {
      await rm(previousDatabasePath, { force: true })
      await rm(previousManifestPath, { force: true })
      await copyFile(manifestPath, previousManifestPath)
      await rename(outputPath, previousDatabasePath)
    }
    await rename(nextDatabasePath, outputPath)
    if (faultInjection?.afterDatabaseSwap === true) {
      throw new Error('Injected fixture replacement interruption after database swap.')
    }
    await rename(nextManifestPath, manifestPath)
    await rm(previousDatabasePath, { force: true })
    await rm(previousManifestPath, { force: true })
  } catch (error) {
    if (hasExistingFixture && (await fileExists(previousDatabasePath))) {
      await rm(outputPath, { force: true })
      await rename(previousDatabasePath, outputPath)
      await copyFile(previousManifestPath, manifestPath)
      await rm(previousManifestPath, { force: true })
    }
    throw error
  } finally {
    await rm(nextDatabasePath, { force: true })
    await rm(nextManifestPath, { force: true })
  }
}

/**
 * Recovers a cache pair if the previous process stopped between the database and
 * manifest swaps. The old verified pair is retained until the new pair's checksum
 * can be proven, so a power loss cannot silently discard the known-good fixture.
 */
async function recoverInterruptedFixtureReplacement(outputPath, manifestPath) {
  const previousDatabasePath = `${outputPath}.previous`
  const previousManifestPath = `${manifestPath}.previous`
  const hasPreviousDatabase = await fileExists(previousDatabasePath)
  const hasPreviousManifest = await fileExists(previousManifestPath)
  if (!hasPreviousDatabase && !hasPreviousManifest) {
    return
  }
  if (!hasPreviousDatabase || !hasPreviousManifest) {
    throw new Error('Mission-store fixture replacement recovery files are incomplete.')
  }

  let currentPairIsValid = false
  if ((await fileExists(outputPath)) && (await fileExists(manifestPath))) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      currentPairIsValid = (await sha256File(outputPath)) === manifest.database?.sha256
    } catch {
      currentPairIsValid = false
    }
  }

  if (currentPairIsValid) {
    await rm(previousDatabasePath, { force: true })
    await rm(previousManifestPath, { force: true })
    return
  }

  await rm(outputPath, { force: true })
  await rm(manifestPath, { force: true })
  await rename(previousDatabasePath, outputPath)
  await rename(previousManifestPath, manifestPath)
}

/** Returns whether a filesystem path currently exists. */
async function fileExists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

/** Copies a verified cache entry into a throwaway run profile through atomic renames. */
async function copyFixtureAtomically(outputPath, manifestPath, copyToPath) {
  const destination = path.resolve(copyToPath)
  const destinationManifest = fixtureManifestPath(destination)
  await mkdir(path.dirname(destination), { recursive: true })
  const token = randomUUID()
  const temporaryDestination = `${destination}.tmp-${token}`
  const temporaryManifest = `${destinationManifest}.tmp-${token}`
  await copyFile(outputPath, temporaryDestination)
  await copyFile(manifestPath, temporaryManifest)
  try {
    await rename(temporaryDestination, destination)
    await rename(temporaryManifest, destinationManifest)
  } finally {
    await rm(temporaryDestination, { force: true })
    await rm(temporaryManifest, { force: true })
  }
}

/** Streams a SHA-256 digest so multi-GB fixtures never enter JavaScript memory. */
async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}
