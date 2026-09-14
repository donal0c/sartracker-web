#!/usr/bin/env node

// Independent terminal gate for the bounded Repair Train D packaged receipt.
// It intentionally reads only the receipt and never launches Electron.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { validateSmokeReceipt } from '../build/electron-repair-train-d-smoke-lib.js'

main().catch((error) => {
  console.error(`validate-electron-repair-train-d-smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Reads and validates the packaged smoke receipt as a separate CI process. */
async function main() {
  const receiptPath = parseArgs(process.argv.slice(2))
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  validateSmokeReceipt(receipt, {
    expectedSourceSha: process.env.EXPECTED_SOURCE_SHA,
    expectedSourceTree: process.env.EXPECTED_SOURCE_TREE,
    requireLinuxUnpacked: process.env.SARTRACKER_ELECTRON_REQUIRE_LINUX_UNPACKED === '1',
  })
  await assertEvidenceFiles(receipt)
  console.log(`Repair Train D packaged receipt validated: ${receiptPath}`)
}

/** Confirms the receipt's required screenshots are still present and regular. */
async function assertEvidenceFiles(receipt) {
  if (typeof receipt.evidenceDirectory !== 'string' || receipt.evidenceDirectory.trim() === '') {
    throw new Error('Packaged smoke receipt does not identify its evidence directory.')
  }
  const evidenceDirectory = path.resolve(receipt.evidenceDirectory)
  const screenshotPaths = [
    receipt.phases.aud08.progressScreenshot,
    receipt.phases.aud08.screenshot,
    receipt.phases.aud09.screenshot,
    receipt.phases.restart.screenshot,
  ]
  for (const screenshotPath of screenshotPaths) {
    const resolvedPath = typeof screenshotPath === 'string' ? path.resolve(screenshotPath) : null
    if (resolvedPath === null
      || !resolvedPath.startsWith(`${evidenceDirectory}${path.sep}`)
      || !(await isRegularFile(resolvedPath))) {
      throw new Error(`Packaged smoke evidence screenshot is missing: ${String(screenshotPath)}`)
    }
  }
}

/** Checks one evidence path without opening or mutating it. */
async function isRegularFile(filePath) {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

/** Parses the one required receipt path and rejects ambiguous invocations. */
function parseArgs(argv) {
  if (argv.length === 2 && argv[0] === '--receipt' && typeof argv[1] === 'string' && argv[1] !== '') {
    return path.resolve(argv[1])
  }
  throw new Error('Usage: node scripts/validate-electron-repair-train-d-smoke.mjs --receipt <receipt.json>')
}
