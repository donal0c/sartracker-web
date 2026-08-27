#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { generateMissionStoreFixture } from '../build/seed-mission-store-runtime.js'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../electron/mission-store.cjs')
const Database = require('better-sqlite3')
const { encodeReplayTrackCursor } = require('../electron/mission-replay-query.cjs')
const FIXTURE_MISSION_ID = 'fixture-mission-000000000001'
const MAIN_DISPATCH_HARD_GATE_MS = 200
const REPLAY_SEEK_GATE_MS = 1_000
// The 2m preset is an explicit renderer-rejection/headroom probe, not the normal mission envelope.
const HEADROOM_REPLAY_SEEK_GATE_MS = 2_000

main().catch((error) => {
  console.error(`breadcrumb-pr5-qualification: ${error instanceof Error ? error.stack : String(error)}`)
  process.exitCode = 1
})

/** Qualifies replay, GPX import, restart equality, and live-read responsiveness at field scale. */
async function main() {
  const preset = readPreset(process.argv.slice(2))
  const projectRoot = process.cwd()
  const fixtureRoot = path.join(projectRoot, 'tmp', 'breadcrumb-fixtures')
  const evidenceRoot = path.join(projectRoot, 'tmp', 'breadcrumb-pr5-evidence')
  const fixturePath = path.join(fixtureRoot, `${preset}-v5.sqlite`)
  await mkdir(fixtureRoot, { recursive: true })
  await mkdir(evidenceRoot, { recursive: true })
  const runRoot = await mkdtemp(path.join(evidenceRoot, `${preset}-`))
  const userDataPath = path.join(runRoot, 'user-data')
  const runDatabasePath = path.join(userDataPath, 'mission-store.sqlite')
  await mkdir(userDataPath, { recursive: true })

  try {
    const fixture = await generateMissionStoreFixture({
      preset,
      outputPath: fixturePath,
      force: true,
      progress: (progress) => {
        if (Number(progress.positions ?? 0) % 200_000 === 0) {
          console.log(`breadcrumb-pr5-qualification: seeded ${Number(progress.positions ?? 0).toLocaleString()} positions`)
        }
      },
    })
    await copyFile(fixturePath, runDatabasePath)
    const sourceHash = sha256(await readFile(fixturePath))
    if (sourceHash !== fixture.manifest.database.sha256) {
      throw new Error('Qualification fixture digest does not match its manifest.')
    }

    const gpxPath = path.join(runRoot, 'qualification.gpx')
    const gpxPointCount = 50_000
    await writeFile(gpxPath, qualificationGpx(gpxPointCount), 'utf8')
    let heartbeat = startEventLoopHeartbeat()
    const initialOpenStarted = performance.now()
    let store = createElectronMissionStore({ userDataPath, readAdminRoster: async () => [] })
    const initialOpenMs = performance.now() - initialOpenStarted
    try {
      const importStarted = performance.now()
      const importPromise = store.importGpxEvidencePaths({
        missionId: FIXTURE_MISSION_ID,
        paths: [gpxPath],
      })
      const importDispatchMs = performance.now() - importStarted
      const currentWritesDuringImportPromise = measureCurrentPositionWritesDuringImport(
        store,
        importPromise,
        readQualificationDeviceId(runDatabasePath),
      )
      const liveReadDuringImport = await measure(() => store.latestPositions(FIXTURE_MISSION_ID))
      const importResult = await importPromise
      const currentWritesDuringImport = await currentWritesDuringImportPromise
      const importTotalMs = performance.now() - importStarted

      const selectedTime = new Date().toISOString()
      const replayStarted = performance.now()
      const replayPromise = store.readMissionReplay({
        missionId: FIXTURE_MISSION_ID,
        selectedTime,
        timezone: 'Europe/Dublin',
        trackLimit: 1_000,
      }, `qualification-${preset}-first`)
      const replayDispatchMs = performance.now() - replayStarted
      const liveReadDuringReplay = await measure(() => store.latestPositions(FIXTURE_MISSION_ID))
      const replay = await replayPromise
      const replaySeekMs = performance.now() - replayStarted
      const firstPhaseEventLoopMaxGapMs = heartbeat.stop()
      const latePageAnchor = readLatePageAnchor(
        runDatabasePath,
        fixture.manifest.workload.realPositionRows,
        selectedTime,
      )
      heartbeat = startEventLoopHeartbeat()
      const latePageCursor = encodeReplayTrackCursor(
        'after', latePageAnchor.offset, latePageAnchor,
      )
      const latePageReplay = await measure(() => store.readMissionReplayTrackChunk({
        missionId: FIXTURE_MISSION_ID,
        selectedTime,
        timezone: 'Europe/Dublin',
        trackLimit: 1_000,
        cursor: latePageCursor,
      }, `qualification-${preset}-late-page`))

      await store.prepareClose()
      store.close()
      const restartStarted = performance.now()
      store = createElectronMissionStore({ userDataPath, readAdminRoster: async () => [] })
      const restartOpenMs = performance.now() - restartStarted
      const replayAfterRestart = await measure(() => store.readMissionReplay({
        missionId: FIXTURE_MISSION_ID,
        selectedTime,
        timezone: 'Europe/Dublin',
        trackLimit: 1_000,
      }, `qualification-${preset}-restart`))

      const equality = replay.totalTrackCount === replayAfterRestart.value.totalTrackCount
        && replay.staticGpxPointCount === replayAfterRestart.value.staticGpxPointCount
        && replay.tracks.map((row) => row.evidence_id).join('\n')
          === replayAfterRestart.value.tracks.map((row) => row.evidence_id).join('\n')
      const replaySeekGateMs = preset === 'bcp-2m'
        ? HEADROOM_REPLAY_SEEK_GATE_MS
        : REPLAY_SEEK_GATE_MS
      const eventLoopMaxGapMs = Math.max(firstPhaseEventLoopMaxGapMs, heartbeat.stop())
      const result = {
        schema: 'sartracker-breadcrumb-pr5-qualification-v1',
        generatedAt: new Date().toISOString(),
        machine: {
          hostname: os.hostname(),
          platform: process.platform,
          architecture: process.arch,
          release: os.release(),
          cpuCount: os.cpus().length,
          node: process.version,
        },
        flags: {
          preset,
          qualification: fixture.manifest.scenario.qualification,
          trackLimit: 1_000,
          timezone: 'Europe/Dublin',
        },
        fixture: {
          generatorVersion: fixture.manifest.generatorVersion,
          sha256: fixture.manifest.database.sha256,
          bytes: fixture.manifest.database.bytes,
          positions: fixture.manifest.workload.realPositionRows,
        },
        import: {
          gpxPointCount,
          dispatchMs: round(importDispatchMs),
          totalMs: round(importTotalMs),
          boundedResultBytes: Buffer.byteLength(JSON.stringify(importResult)),
          currentWritesDuringReceiptRetention: currentWritesDuringImport,
          result: importResult,
        },
        replay: {
          dispatchMs: round(replayDispatchMs),
          seekMs: round(replaySeekMs),
          totalTrackCount: replay.totalTrackCount,
          returnedTrackCount: replay.tracks.length,
          staticGpxPointCount: replay.staticGpxPointCount,
          nextCursor: replay.nextCursor,
          latePage: {
            seekMs: round(latePageReplay.durationMs),
            requestedOffset: latePageAnchor.offset,
            returnedOffset: Number(latePageReplay.value.trackCursor),
            returnedTrackCount: latePageReplay.value.tracks.length,
          },
        },
        liveReadDuringImport: summarizeRead(liveReadDuringImport),
        liveReadDuringReplay: summarizeRead(liveReadDuringReplay),
        eventLoopMaxGapMs: round(eventLoopMaxGapMs),
        initialOpenMs: round(initialOpenMs),
        restart: {
          openMs: round(restartOpenMs),
          replaySeekMs: round(replayAfterRestart.durationMs),
          exactFirstPageEquality: equality,
        },
        gates: {
          mainDispatchHardGateMs: MAIN_DISPATCH_HARD_GATE_MS,
          replaySeekGateMs,
          passed: importDispatchMs < MAIN_DISPATCH_HARD_GATE_MS
            && replayDispatchMs < MAIN_DISPATCH_HARD_GATE_MS
            && initialOpenMs < MAIN_DISPATCH_HARD_GATE_MS
            && restartOpenMs < MAIN_DISPATCH_HARD_GATE_MS
            && replaySeekMs <= replaySeekGateMs
            && latePageReplay.durationMs <= replaySeekGateMs
            && Number(latePageReplay.value.trackCursor) === latePageAnchor.offset
            && latePageReplay.value.tracks.length > 0
            && replayAfterRestart.durationMs <= replaySeekGateMs
            && liveReadDuringImport.durationMs < MAIN_DISPATCH_HARD_GATE_MS
            && currentWritesDuringImport.count > 0
            && currentWritesDuringImport.maxMs < MAIN_DISPATCH_HARD_GATE_MS
            && liveReadDuringReplay.durationMs < MAIN_DISPATCH_HARD_GATE_MS
            && eventLoopMaxGapMs < MAIN_DISPATCH_HARD_GATE_MS
            && equality,
        },
      }
      const outputPath = path.join(evidenceRoot, `${preset}.json`)
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
      if (!result.gates.passed) throw new Error(`Qualification gates failed: ${JSON.stringify(result)}`)
      console.log(JSON.stringify({ outputPath, ...result }, null, 2))
    } finally {
      const eventLoopMaxGapMs = heartbeat.stop()
      if (eventLoopMaxGapMs >= MAIN_DISPATCH_HARD_GATE_MS) process.exitCode = 1
      await store.prepareClose()
      store.close()
    }
  } finally {
    await rm(runRoot, { recursive: true, force: true })
  }
}

/** Reads one indexed near-tail anchor outside the measured real-worker late-page seek. */
function readLatePageAnchor(databasePath, positionCount, selectedTime) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const anchorIndex = Math.floor(positionCount * 0.9)
    const anchorId = `fixture-position-${String(anchorIndex).padStart(12, '0')}`
    const row = database.prepare(`SELECT id AS evidence_id, timestamp AS effective_at,
        received_at AS recorded_at, 0 AS source_order, id AS stable_order
      FROM positions WHERE mission_id = ? AND id = ? AND timestamp_source = 'fix'
        AND received_at IS NOT NULL`).get(FIXTURE_MISSION_ID, anchorId)
    if (row === undefined) throw new Error('Qualification fixture has no late replay anchor.')
    const positionOffset = Number(database.prepare(`SELECT COUNT(*) AS count
      FROM positions
      WHERE mission_id = ? AND timestamp_source = 'fix' AND received_at IS NOT NULL
        AND received_at <= ? AND timestamp <= ? AND (
          timestamp < ? OR
          (timestamp = ? AND received_at < ?) OR
          (timestamp = ? AND received_at = ? AND id <= ?)
        )`).get(
      FIXTURE_MISSION_ID,
      selectedTime,
      selectedTime,
      row.effective_at,
      row.effective_at,
      row.recorded_at,
      row.effective_at,
      row.recorded_at,
      row.evidence_id,
    )?.count ?? 0)
    const gpxOffset = Number(database.prepare(`WITH eligible_gpx AS (
        SELECT revisions.*,
          ROW_NUMBER() OVER (
            PARTITION BY revisions.import_id
            ORDER BY revisions.recorded_at DESC, revisions.revision_sequence DESC
          ) AS replay_rank
        FROM gpx_import_revisions AS revisions
        WHERE revisions.mission_id = ? AND revisions.import_state = 'complete'
          AND revisions.recorded_at <= ?
      )
      SELECT COUNT(*) AS count FROM eligible_gpx
      JOIN gpx_evidence_points AS points
        ON points.import_id = eligible_gpx.import_id
        AND points.revision_sequence = eligible_gpx.revision_sequence
      WHERE eligible_gpx.replay_rank = 1 AND points.source_time IS NOT NULL
        AND points.source_time <= ? AND (
          points.source_time < ? OR
          (points.source_time = ? AND eligible_gpx.recorded_at < ?)
        )`).get(
      FIXTURE_MISSION_ID,
      selectedTime,
      selectedTime,
      row.effective_at,
      row.effective_at,
      row.recorded_at,
    )?.count ?? 0)
    return { ...row, offset: positionOffset + gpxOffset }
  } finally {
    database.close()
  }
}

/** Reads one deterministic device identity for live-write contention proof. */
function readQualificationDeviceId(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const row = database.prepare(`SELECT device_id FROM devices
      WHERE mission_id = ? ORDER BY device_id ASC LIMIT 1`).get(FIXTURE_MISSION_ID)
    if (row === undefined) throw new Error('Qualification fixture has no current-position device.')
    return row.device_id
  } finally {
    database.close()
  }
}

/** Continuously writes current fixes while the import retains and parses its large source. */
async function measureCurrentPositionWritesDuringImport(store, importPromise, deviceId) {
  let importSettled = false
  void Promise.resolve(importPromise).then(
    () => { importSettled = true },
    () => { importSettled = true },
  )
  const durations = []
  for (let index = 0; index < 10_000 && (!importSettled || durations.length === 0); index += 1) {
    const timestamp = new Date(Date.now() + index).toISOString()
    const started = performance.now()
    await store.addPosition({
      mission_id: FIXTURE_MISSION_ID,
      device_id: deviceId,
      source_position_id: `qualification-live-${index}`,
      lat: 53.1 + index / 100_000_000,
      lon: -6.1 - index / 100_000_000,
      timestamp,
      timestamp_source: 'fix',
      data_origin: 'live',
    })
    durations.push(performance.now() - started)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  const ordered = [...durations].sort((left, right) => left - right)
  return {
    count: durations.length,
    maxMs: round(Math.max(...durations)),
    p95Ms: round(ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0),
  }
}

function readPreset(args) {
  const preset = args.find((argument) => argument.startsWith('--preset='))?.slice('--preset='.length)
    ?? 'bcp-960k'
  if (!['bcp-960k', 'bcp-2m'].includes(preset)) {
    throw new Error('Preset must be bcp-960k or bcp-2m.')
  }
  return preset
}

async function measure(operation) {
  const started = performance.now()
  const value = await operation()
  return { value, durationMs: performance.now() - started }
}

function summarizeRead(read) {
  return { durationMs: round(read.durationMs), rowCount: Array.isArray(read.value) ? read.value.length : null }
}

function startEventLoopHeartbeat() {
  let stopped = false
  let last = performance.now()
  let maxGap = 0
  const timer = setInterval(() => {
    const current = performance.now()
    maxGap = Math.max(maxGap, current - last)
    last = current
  }, 10)
  return {
    stop() {
      if (!stopped) clearInterval(timer)
      stopped = true
      return maxGap
    },
  }
}

function qualificationGpx(pointCount) {
  const points = []
  for (let index = 0; index < pointCount; index += 1) {
    const lat = (53.1 + index / 100_000_000).toFixed(7)
    const lon = (-6.1 - index / 100_000_000).toFixed(7)
    const time = new Date(Date.UTC(2026, 0, 2, 12, 0, 0, index)).toISOString()
    points.push(`<trkpt lat="${lat}" lon="${lon}"><ele>${120 + index % 30}</ele><time>${time}</time></trkpt>`)
  }
  points.push('<trkpt lat="53.2000000" lon="-6.2000000"><ele>121</ele></trkpt>')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SAR Tracker qualification"><trk><name>PR5 qualification</name><trkseg>${points.join('')}</trkseg></trk></gpx>\n`
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function round(value) {
  return Math.round(value * 100) / 100
}
