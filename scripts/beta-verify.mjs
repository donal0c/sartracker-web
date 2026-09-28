#!/usr/bin/env node
/**
 * Local pre-tag source check for a team beta.
 *
 * Runs the source gates of the tag-driven release workflow (lint, build,
 * correctness, strict responsiveness, browser-driver contract, Chromium E2E)
 * so failures surface before a tag is cut, and writes a JSON report to
 * tmp/beta-artifacts/. It does not package or smoke: those run on the exact
 * CI-built artifact per docs/release-checklist.md. The legacy Tauri backend is
 * not shipped and is tested only when it changes (`npm run test:backend`).
 *
 * Usage:
 *   node scripts/beta-verify.mjs                       # all steps
 *   node scripts/beta-verify.mjs --steps lint,build    # focused subset
 *   node scripts/beta-verify.mjs --report-dir <path>   # override report dir
 *
 * Exits non-zero when any executed step fails or any step is skipped.
 */

import { execSync, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ALL_BETA_STEPS,
  buildBetaReportFilename,
  findReleaseBlockingWorktreeChanges,
  parseBetaStepsFlag,
  summarizeBetaReport,
} from '../build/beta-verify-lib.js'

const scriptFile = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(scriptFile), '..')

const STEP_COMMANDS = {
  lint: ['npm', ['run', 'lint']],
  build: ['npm', ['run', 'build']],
  test: ['npm', ['run', 'test:correctness']],
  responsiveness: ['npm', ['run', 'test:responsiveness']],
  'browser-driver': ['npm', ['run', 'test:browser-driver']],
  'e2e-chromium': ['npm', ['run', 'test:e2e:chromium']],
}

const ALLOWED_UNTRACKED_EVIDENCE_PREFIXES = [
  '.playwright-mcp/',
  'output/',
  'team-feedback/',
  'tmp/',
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

  const skippedSteps = ALL_BETA_STEPS.filter((step) => !steps.includes(step))
  const worktreeStatusAtStart = readReleaseWorktreeStatus()
  const blockingWorktreeChanges = findReleaseBlockingWorktreeChanges(
    worktreeStatusAtStart,
    ALLOWED_UNTRACKED_EVIDENCE_PREFIXES,
  )
  const releaseWorktreeCleanAtStart = blockingWorktreeChanges.length === 0
  if (skippedSteps.length === 0 && !releaseWorktreeCleanAtStart) {
    throw new Error(
      'full beta verification requires a clean release worktree at start; commit or restore: ' +
        blockingWorktreeChanges.join(', '),
    )
  }
  const reportDir = path.resolve(projectRoot, args.reportDir ?? 'tmp/beta-artifacts')
  const startedAt = new Date()
  const versionInfo = await readVersionInfo()

  console.log('beta-verify: starting')
  console.log(`  version: ${versionInfo.version}`)
  console.log(`  build tag: ${versionInfo.buildTag}`)
  console.log(`  release worktree clean at start: ${releaseWorktreeCleanAtStart ? 'yes' : 'no'}`)
  console.log(`  steps: ${steps.join(', ') || '(none)'}`)
  if (skippedSteps.length > 0) {
    console.log(`  skipped via --steps: ${skippedSteps.join(', ')}`)
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
    releaseWorktreeCleanAtStart,
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
  const args = { steps: undefined, reportDir: undefined }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--steps') {
      args.steps = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--steps=')) {
      args.steps = arg.slice('--steps='.length)
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
      '  --report-dir <path>   Override the JSON report output directory',
      '  -h, --help            Print this help text',
    ].join('\n'),
  )
  process.exit(code)
}

function describeCommand(step) {
  const [bin, args] = STEP_COMMANDS[step]
  return [bin, ...args].join(' ')
}

async function runStep(step) {
  const [bin, args] = STEP_COMMANDS[step]
  const command = describeCommand(step)
  console.log(`▶ ${step}: ${command}`)
  const startedAt = Date.now()

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: projectRoot, stdio: 'inherit' })
    child.on('error', (error) => reject(error))
    child.on('close', (code) => resolve(code ?? 1))
  })

  const durationMs = Date.now() - startedAt
  const status = exitCode === 0 ? 'pass' : 'fail'

  console.log(`${status === 'pass' ? '✔' : '✖'} ${step} (${(durationMs / 1000).toFixed(2)}s)`)
  console.log('')

  return { step, command, status, exitCode, durationMs, notes: '' }
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

/**
 * Reads every worktree change. Only explicitly whitelisted local evidence
 * roots are ignored by the release gate.
 */
function readReleaseWorktreeStatus() {
  try {
    return execSync('git status --porcelain=v1 -z --untracked-files=all', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return 'git-status-unavailable'
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
