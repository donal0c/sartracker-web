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
const FIXTURE_MISSION_ID = 'fixture-mission-000000000001'
const MAIN_DISPATCH_HARD_GATE_MS = 200
const REPLAY_SEEK_GATE_MS = 1_000
const HEADROOM_REPLAY_SEEK_GATE_MS = 5_000

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
      force: false,
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
    await writeFile(gpxPath, qualificationGpx(), 'utf8')
    let store = createElectronMissionStore({ userDataPath, readAdminRoster: async () => [] })
    const heartbeat = startEventLoopHeartbeat()
    try {
      const importStarted = performance.now()
      const importPromise = store.importGpxEvidencePaths({
        missionId: FIXTURE_MISSION_ID,
        paths: [gpxPath],
      })
      const importDispatchMs = performance.now() - importStarted
      const liveReadDuringImport = await measure(() => store.latestPositions(FIXTURE_MISSION_ID))
      const importResult = await importPromise
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
          dispatchMs: round(importDispatchMs),
          totalMs: round(importTotalMs),
          boundedResultBytes: Buffer.byteLength(JSON.stringify(importResult)),
          result: importResult,
        },
        replay: {
          dispatchMs: round(replayDispatchMs),
          seekMs: round(replaySeekMs),
          totalTrackCount: replay.totalTrackCount,
          returnedTrackCount: replay.tracks.length,
          staticGpxPointCount: replay.staticGpxPointCount,
          nextCursor: replay.nextCursor,
        },
        liveReadDuringImport: summarizeRead(liveReadDuringImport),
        liveReadDuringReplay: summarizeRead(liveReadDuringReplay),
        eventLoopMaxGapMs: round(heartbeat.stop()),
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
            && replaySeekMs <= replaySeekGateMs
            && replayAfterRestart.durationMs <= replaySeekGateMs
            && liveReadDuringImport.durationMs < MAIN_DISPATCH_HARD_GATE_MS
            && liveReadDuringReplay.durationMs < MAIN_DISPATCH_HARD_GATE_MS
            && equality,
        },
      }
      const outputPath = path.join(evidenceRoot, `${preset}.json`)
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
      if (!result.gates.passed) throw new Error(`Qualification gates failed: ${JSON.stringify(result)}`)
      console.log(JSON.stringify({ outputPath, ...result }, null, 2))
    } finally {
      heartbeat.stop()
      store.close()
    }
  } finally {
    await rm(runRoot, { recursive: true, force: true })
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

function qualificationGpx() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="SAR Tracker qualification"><trk><name>PR5 qualification</name><trkseg><trkpt lat="53.1001" lon="-6.1001"><ele>120</ele><time>2026-01-02T12:00:00.000Z</time></trkpt><trkpt lat="53.1002" lon="-6.1002"><ele>121</ele></trkpt></trkseg></trk></gpx>\n`
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function round(value) {
  return Math.round(value * 100) / 100
}
