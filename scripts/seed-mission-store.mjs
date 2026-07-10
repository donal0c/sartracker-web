#!/usr/bin/env node

import path from 'node:path'

import {
  createFixturePlan,
  listFixturePresets,
  parseSeedMissionStoreArgs,
} from '../build/seed-mission-store-lib.js'
import { generateMissionStoreFixture } from '../build/seed-mission-store-runtime.js'

main().catch((error) => {
  console.error(`seed-mission-store: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Runs the deterministic mission-store fixture generator CLI. */
async function main() {
  const args = parseSeedMissionStoreArgs(process.argv.slice(2))
  if (args.listPresets) {
    for (const preset of listFixturePresets()) {
      const plan = createFixturePlan(preset)
      const target =
        plan.mode === 'target-size'
          ? `${formatBytes(plan.targetBytes)} target`
          : `${plan.durationDays} simulated days`
      console.log(`${preset.padEnd(12)} ${target}`)
    }
    return
  }

  const plan = createFixturePlan(args.preset)
  console.log(`seed-mission-store: preset=${plan.preset} mode=${plan.mode}`)
  console.log(`  output: ${path.resolve(args.outputPath)}`)
  if (args.copyToPath !== undefined) {
    console.log(`  copy-to: ${path.resolve(args.copyToPath)}`)
  }

  let lastProgressAt = 0
  let lastPercent = -1
  const result = await generateMissionStoreFixture({
    ...args,
    progress: (progress) => {
      const now = Date.now()
      const percent = calculatePercent(progress)
      if (now - lastProgressAt < 5_000 && percent < lastPercent + 5) {
        return
      }
      lastProgressAt = now
      lastPercent = percent
      const target =
        progress.targetBytes !== null
          ? `${formatBytes(progress.databaseBytes)} / ${formatBytes(progress.targetBytes)}`
          : `${progress.polls.toLocaleString()} / ${progress.targetPolls.toLocaleString()} polls`
      console.log(`  progress: ${target} (${percent.toFixed(1)}%)`)
    },
  })

  console.log(`seed-mission-store: ${result.reused ? 'reused verified cache' : 'generated'}`)
  console.log(`  database: ${result.outputPath}`)
  console.log(`  manifest: ${result.manifestPath}`)
  console.log(`  bytes: ${result.manifest.database.bytes.toLocaleString()}`)
  console.log(`  sha256: ${result.manifest.database.sha256}`)
  console.log(`  simulated days: ${result.manifest.workload.simulatedMissionDays}`)
  console.log(`  polls: ${result.manifest.workload.pollCount.toLocaleString()}`)
  console.log(`  positions: ${result.manifest.workload.realPositionRows.toLocaleString()}`)
  console.log(
    `  redundant telemetry rows: ${result.manifest.workload.redundantTelemetryRows.toLocaleString()}`,
  )
}

/** Calculates bounded progress for byte-size and duration presets. */
function calculatePercent(progress) {
  const numerator =
    progress.targetBytes !== null ? progress.databaseBytes : progress.polls
  const denominator =
    progress.targetBytes !== null ? progress.targetBytes : progress.targetPolls
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0
  }
  return Math.min(100, (numerator / denominator) * 100)
}

/** Formats byte counts for progress logs without adding a dependency. */
function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  }
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
}
