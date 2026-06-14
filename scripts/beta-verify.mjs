#!/usr/bin/env node
/**
 * Beta verification gate.
 *
 * Runs the lint/build/test/test:backend/package/smoke chain that the Electron
 * beta release plan calls "Verification Before Sharing". On success it writes
 * a JSON evidence report to tmp/beta-artifacts/ that the agent cutting the
 * beta can attach to the release note.
 *
 * The script is intentionally cautious about heavy work:
 * - The `package` step runs `npm run electron:pack` which can
 *   take many minutes. Skip it with `--steps lint,build,test,test-backend`
 *   when iterating, but never skip it before sharing a beta.
 * - The `smoke` step is a manual checklist gate. The script prompts the
 *   operator to confirm each item rather than launching a GUI app headlessly.
 *
 * Usage:
 *   node scripts/beta-verify.mjs                       # full gate
 *   node scripts/beta-verify.mjs --steps lint,build    # focused subset
 *   node scripts/beta-verify.mjs --no-smoke            # skip manual smoke prompt
 *   node scripts/beta-verify.mjs --report-dir <path>   # override report dir
 *
 * The script exits non-zero whenever any executed step fails or when the
 * operator declines a smoke checklist item.
 */

import { execSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ALL_BETA_STEPS,
  buildBetaReportFilename,
  parseBetaStepsFlag,
  summarizeBetaReport,
} from '../build/beta-verify-lib.js'

const scriptFile = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(scriptFile), '..')

const STEP_COMMANDS = {
  lint: ['npm', ['run', 'lint']],
  build: ['npm', ['run', 'build']],
  test: ['npm', ['run', 'test']],
  'test-backend': ['npm', ['run', 'test:backend']],
  package: ['npm', ['run', 'electron:pack']],
  // smoke is handled in-process via a manual checklist; no shell command runs.
  smoke: ['__smoke__', []],
}

const SMOKE_CHECKLIST = [
  'Packaged app launches without crashing.',
  'Build/version is visible in the mast.',
  'A new mission can be started.',
  'Mission persists after closing and reopening the app.',
  'Tracking settings can be opened and saved.',
  'Diagnostics export/open works.',
]

main().catch((error) => {
  console.error(`beta-verify: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let steps
  try {
    steps = parseBetaStepsFlag(args.steps)
  } catch (error) {
    console.error(`beta-verify: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
    return
  }

  if (args.noSmoke) {
    steps = steps.filter((step) => step !== 'smoke')
  }

  const skippedSteps = ALL_BETA_STEPS.filter((step) => !steps.includes(step))
  const reportDir = path.resolve(projectRoot, args.reportDir ?? 'tmp/beta-artifacts')
  const startedAt = new Date()
  const versionInfo = await readVersionInfo()

  console.log('beta-verify: starting')
  console.log(`  version: ${versionInfo.version}`)
  console.log(`  build tag: ${versionInfo.buildTag}`)
  console.log(`  steps: ${steps.join(', ') || '(none)'}`)
  if (skippedSteps.length > 0) {
    console.log(`  skipped via --steps/--no-smoke: ${skippedSteps.join(', ')}`)
  }
  console.log('')

  const results = []
  let firstFailure = null

  for (const step of ALL_BETA_STEPS) {
    if (!steps.includes(step)) {
      results.push({
        step,
        command: describeCommand(step),
        status: 'skip',
        exitCode: null,
        durationMs: 0,
        notes: 'skipped via --steps',
      })
      continue
    }

    if (firstFailure !== null) {
      results.push({
        step,
        command: describeCommand(step),
        status: 'skip',
        exitCode: null,
        durationMs: 0,
        notes: `skipped after ${firstFailure} failed`,
      })
      continue
    }

    const result = await runStep(step)
    results.push(result)
    if (result.status === 'fail') {
      firstFailure = step
    }
  }

  const finishedAt = new Date()
  const report = {
    version: versionInfo.version,
    buildTag: versionInfo.buildTag,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    results,
  }

  const summary = summarizeBetaReport(report)
  console.log('')
  for (const line of summary.lines) {
    console.log(line)
  }
  if (summary.warning) {
    console.log('')
    console.log(`WARNING: ${summary.warning}`)
  }

  await mkdir(reportDir, { recursive: true })
  const filename = buildBetaReportFilename(versionInfo.version, versionInfo.buildTag, finishedAt)
  const reportPath = path.join(reportDir, filename)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('')
  console.log(`Report: ${path.relative(projectRoot, reportPath)}`)

  process.exit(summary.ok ? 0 : 1)
}

function parseArgs(argv) {
  const args = { steps: undefined, noSmoke: false, reportDir: undefined }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--steps') {
      args.steps = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--steps=')) {
      args.steps = arg.slice('--steps='.length)
    } else if (arg === '--no-smoke') {
      args.noSmoke = true
    } else if (arg === '--report-dir') {
      args.reportDir = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--report-dir=')) {
      args.reportDir = arg.slice('--report-dir='.length)
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0)
    } else {
      console.error(`beta-verify: unknown argument "${arg}"`)
      printUsageAndExit(2)
    }
  }

  return args
}

function printUsageAndExit(code) {
  console.log(
    [
      'Usage: node scripts/beta-verify.mjs [options]',
      '',
      'Options:',
      '  --steps <list>        Comma-separated subset of: ' + ALL_BETA_STEPS.join(', '),
      '  --no-smoke            Skip the manual smoke checklist prompt',
      '  --report-dir <path>   Override the JSON report output directory',
      '  -h, --help            Print this help text',
    ].join('\n'),
  )
  process.exit(code)
}

function describeCommand(step) {
  if (step === 'smoke') {
    return 'manual smoke checklist'
  }
  const [bin, args] = STEP_COMMANDS[step]
  return [bin, ...args].join(' ')
}

async function runStep(step) {
  if (step === 'smoke') {
    return runSmokeChecklist()
  }

  const [bin, args] = STEP_COMMANDS[step]
  const command = describeCommand(step)
  console.log(`▶ ${step}: ${command}`)
  const startedAt = Date.now()

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: projectRoot, stdio: 'inherit' })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => resolve(code ?? 0))
  })

  const durationMs = Date.now() - startedAt
  const status = exitCode === 0 ? 'pass' : 'fail'

  console.log(`${status === 'pass' ? '✔' : '✖'} ${step} (${(durationMs / 1000).toFixed(2)}s)`)
  console.log('')

  return { step, command, status, exitCode, durationMs, notes: '' }
}

async function runSmokeChecklist() {
  const command = describeCommand('smoke')
  console.log(`▶ smoke: ${command}`)
  console.log('  Confirm each item by typing y, or n to fail. Anything else cancels.')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const startedAt = Date.now()
  const failed = []

  try {
    for (let index = 0; index < SMOKE_CHECKLIST.length; index += 1) {
      const item = SMOKE_CHECKLIST[index]
      const answer = (await rl.question(`  ${index + 1}. ${item} [y/n] `)).trim().toLowerCase()
      if (answer === 'y') {
        continue
      }
      if (answer === 'n') {
        failed.push(item)
        continue
      }
      throw new Error(`smoke checklist cancelled at item ${index + 1}`)
    }
  } finally {
    rl.close()
  }

  const durationMs = Date.now() - startedAt
  const status = failed.length === 0 ? 'pass' : 'fail'
  const notes = failed.length === 0 ? '' : `failed items: ${failed.join('; ')}`

  console.log(`${status === 'pass' ? '✔' : '✖'} smoke (${(durationMs / 1000).toFixed(2)}s)`)
  console.log('')

  return {
    step: 'smoke',
    command,
    status,
    exitCode: status === 'pass' ? 0 : 1,
    durationMs,
    notes,
  }
}

async function readVersionInfo() {
  const packageJsonPath = path.resolve(projectRoot, 'package.json')
  let version = '0.0.0'
  try {
    const raw = await readFile(packageJsonPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed?.version === 'string' && parsed.version.trim() !== '') {
      version = parsed.version.trim()
    }
  } catch {
    // Leave version at the safe default; the report still records the run.
  }

  const runNumber = process.env.GITHUB_RUN_NUMBER ?? process.env.GITHUB_RUN_ID
  const envSha = process.env.GITHUB_SHA
  const gitSha = readGitSha()
  const sha = firstNonEmpty(envSha, gitSha)
  const buildTag = sha ? (runNumber ? `run.${runNumber}.sha.${sha}` : `sha.${sha}`) : 'local'

  return { version, buildTag }
}

function readGitSha() {
  try {
    return execSync('git rev-parse --short=12 HEAD', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return ''
}
