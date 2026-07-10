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
  FIXTURE_GENERATOR_VERSION,
  buildFixtureManifest,
  createDeterministicId,
  createFixturePlan,
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
    const cached = await readVerifiedCachedFixture(outputPath, manifestPath, plan.preset)
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
async function readVerifiedCachedFixture(outputPath, manifestPath, preset) {
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

  if (manifest.generatorVersion !== FIXTURE_GENERATOR_VERSION || manifest.preset !== preset) {
    throw new Error(
      `Cached mission-store fixture is incompatible with preset ${preset}; rerun with --force.`,
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
