#!/usr/bin/env node

// Writes the machine-readable evidence for a default-off Train D workflow run.
// This receipt deliberately records a non-qualification result; it cannot be
// mistaken for the strict packaged smoke receipt produced when the input is true.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

main().catch((error) => {
  console.error(
    `record-electron-repair-train-d-deferred: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})

/** Writes one explicit default-off Train D qualification receipt atomically. */
async function main() {
  const outputPath = parseArgs(process.argv.slice(2))
  const receipt = createDeferredReceipt(process.env)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.tmp-${process.pid}`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporaryPath, outputPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
  console.log(JSON.stringify({ outputPath, result: receipt.result, status: receipt.status }))
}

/** Creates a non-pass receipt without accepting caller-provided qualification state. */
function createDeferredReceipt(environment) {
  const expectedSourceSha = nullableEnvironment(environment.EXPECTED_SOURCE_SHA)
  const expectedSourceTree = nullableEnvironment(environment.EXPECTED_SOURCE_TREE)
  return {
    schema: 'sartracker-electron-repair-train-d-qualification-v1',
    status: 'not-run',
    result: 'not-run',
    qualification: 'deferred',
    runRequested: false,
    releaseHold: true,
    reason: {
      code: 'packaged_smoke_not_requested',
      message: 'The strict packaged Train D smoke requires manual workflow_dispatch input run_repair_train_d_smoke=true.',
    },
    trigger: {
      event: nullableEnvironment(environment.GITHUB_EVENT_NAME),
      input: 'run_repair_train_d_smoke',
      default: false,
      requested: false,
    },
    source: {
      expectedSourceSha,
      expectedSourceTree,
      bindingStatus: expectedSourceSha !== null && expectedSourceTree !== null
        ? 'available'
        : 'unavailable',
    },
    run: {
      workflow: nullableEnvironment(environment.GITHUB_WORKFLOW),
      ref: nullableEnvironment(environment.GITHUB_REF),
      id: nullableEnvironment(environment.GITHUB_RUN_ID),
      attempt: nullableEnvironment(environment.GITHUB_RUN_ATTEMPT),
    },
    recordedAt: new Date().toISOString(),
  }
}

/** Converts absent or blank CI metadata to null without inventing provenance. */
function nullableEnvironment(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Parses exactly one output path and rejects ambiguous invocations. */
function parseArgs(argv) {
  if (argv.length === 2 && argv[0] === '--output'
    && typeof argv[1] === 'string' && argv[1] !== '') {
    return path.resolve(argv[1])
  }
  throw new Error(
    'Usage: node scripts/record-electron-repair-train-d-deferred.mjs --output <receipt.json>',
  )
}
