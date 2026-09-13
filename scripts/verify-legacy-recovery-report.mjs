#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateLegacyRecoveryReport } from '../build/legacy-recovery-report-validation.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const reportPath = process.argv[2]
const expectedSourceSha = process.env.EXPECTED_SOURCE_SHA

if (!reportPath) {
  console.error('Usage: EXPECTED_SOURCE_SHA=<commit> node scripts/verify-legacy-recovery-report.mjs <report.json>')
  process.exitCode = 2
} else {
  try {
    const report = JSON.parse(await readFile(path.resolve(reportPath), 'utf8'))
    const failures = validateLegacyRecoveryReport(report, { expectedSourceSha, projectRoot })
    if (failures.length > 0) {
      for (const failure of failures) console.error(`legacy-recovery-report: ${failure}`)
      process.exitCode = 1
    } else {
      console.log(`legacy-recovery-report: valid (${path.resolve(reportPath)})`)
    }
  } catch (error) {
    console.error(`legacy-recovery-report: could not validate report: ${error.message}`)
    process.exitCode = 1
  }
}
