#!/usr/bin/env node

import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildBreadcrumbPr6KillMatrixReport,
  captureArchiveKillMatrixBaseline,
  captureBreadcrumbPr6KillMatrixRepositoryState,
  parseBreadcrumbPr6KillMatrixArgs,
  resolveArchiveKillMatrixSelection,
  runArchiveKillCase,
} from '../build/breadcrumb-pr6-kill-matrix-lib.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const physicalProjectRoot = realpathSync(projectRoot)
const childPath = path.join(projectRoot, 'tests/fixtures/breadcrumb-pr6-kill-child.cjs')
const OWNERSHIP_MARKER = '.breadcrumb-pr6-kill-matrix-owned'
const MAX_PREPARE_OUTPUT_BYTES = 64 * 1024
const HARNESS_FILES = Object.freeze([
  'build/breadcrumb-pr6-kill-matrix-lib.js',
  'electron/mission-archive-ipc.cjs',
  'scripts/breadcrumb-pr6-kill-matrix.mjs',
  'tests/fixtures/breadcrumb-pr6-kill-child.cjs',
  'tests/unit/breadcrumb-pr6-kill-matrix-lib.test.ts',
])

/** Runs the real lifecycle matrix or an explicitly labelled protocol-only self-test. */
async function main() {
  const options = parseBreadcrumbPr6KillMatrixArgs(process.argv.slice(2))
  const selectedCases = resolveArchiveKillMatrixSelection(options.caseIds)
  const requestedReportPath = options.reportPath ?? path.join(
    mkdtempSync(path.join(tmpdir(), 'sartracker-breadcrumb-pr6-kill-report-')),
    'report.json',
  )
  const reportPath = resolvePhysicalReportPath(requestedReportPath)
  assertPhysicalReportContainment(reportPath, [physicalProjectRoot])
  const repositoryBefore = captureBreadcrumbPr6KillMatrixRepositoryState({
    projectRoot,
    harnessRelativePaths: HARNESS_FILES,
  })
  const work = createOwnedWorkRoot(options.workRoot)
  const startedAt = new Date().toISOString()
  const evidence = []
  try {
    const prohibitedReportRoots = options.keepWorkRoot
      ? [physicalProjectRoot]
      : [physicalProjectRoot, realpathSync(work.root)]
    assertPhysicalReportContainment(reportPath, prohibitedReportRoots)
    let baseline = null
    if (!options.protocolSelfTest) {
      await prepareFixture({
        cases: selectedCases,
        root: work.root,
        timeoutMs: options.timeoutMs,
      })
      baseline = captureArchiveKillMatrixBaseline({
        root: work.root,
        selectedCases,
      })
    }
    for (const definition of selectedCases) {
      const common = [
        '--case',
        definition.id,
        '--root',
        work.root,
      ]
      evidence.push(await runArchiveKillCase({
        caseDefinition: definition,
        childPath,
        cwd: projectRoot,
        runArgs: options.protocolSelfTest
          ? ['--action', 'protocol-run', ...common]
          : [
              '--action',
              'run',
              ...common,
              '--operation-id',
              definition.operationId,
            ],
        reconcileArgs: options.protocolSelfTest
          ? ['--action', 'protocol-reconcile', ...common]
          : [
              '--action',
              'reconcile',
              ...common,
              '--operation-id',
              definition.operationId,
            ],
        baseline: baseline?.cases[definition.id],
        protocolSelfTest: options.protocolSelfTest,
        timeoutMs: options.timeoutMs,
      }))
    }
    assertPhysicalReportContainment(reportPath, prohibitedReportRoots)
    const repositoryAfter = captureBreadcrumbPr6KillMatrixRepositoryState({
      projectRoot,
      harnessRelativePaths: HARNESS_FILES,
    })
    const report = Object.freeze({
      ...buildBreadcrumbPr6KillMatrixReport({
        caseEvidence: evidence,
        selectedCases,
        startedAt,
        completedAt: new Date().toISOString(),
        invocation: {
          caseIds: options.caseIds,
          keepWorkRoot: options.keepWorkRoot,
          protocolSelfTest: options.protocolSelfTest,
          reportPathExplicit: options.reportPath !== null,
          timeoutMs: options.timeoutMs,
          workRootExplicit: options.workRoot !== null,
        },
        repositoryBefore,
        repositoryAfter,
      }),
    })
    assertPhysicalReportContainment(reportPath, prohibitedReportRoots)
    writeReport(reportPath, report)
    process.stdout.write(`${JSON.stringify({
      verdict: report.verdict,
      caseCount: report.cases.length,
      protocolSelfTest: report.protocolSelfTest,
    })}\n`)
  } finally {
    if (!options.keepWorkRoot) removeOwnedWorkRoot(work.root)
  }
}

/** Runs the one real archive setup child before any destructive kill cases. */
async function prepareFixture({ cases, root, timeoutMs }) {
  const args = [
    childPath,
    '--action',
    'prepare',
    '--root',
    root,
    '--cases',
    cases.map((entry) => entry.id).join(','),
  ]
  const result = await runBoundedChild(args, timeoutMs)
  let message
  try { message = JSON.parse(result.stdout.trim()) } catch {
    throw new Error('Archive kill-matrix preparation emitted invalid evidence.')
  }
  if (message?.type !== 'prepared' || message.protocolVersion !== 2
    || !Number.isSafeInteger(message.createMissionCount)
    || typeof message.verifiedFixture !== 'boolean'
    || Object.keys(message).sort().join(',')
      !== 'createMissionCount,protocolVersion,type,verifiedFixture') {
    throw new Error('Archive kill-matrix preparation returned unsupported evidence.')
  }
}

/** Runs one non-kill preparation child with bounded output and a hard deadline. */
function runBoundedChild(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    let outputBytes = 0
    let failed = null
    const timeout = setTimeout(() => {
      failed ??= new Error('Archive kill-matrix preparation timed out.')
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_PREPARE_OUTPUT_BYTES) {
        failed ??= new Error('Archive kill-matrix preparation output exceeded its bound.')
        child.kill('SIGKILL')
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', () => undefined)
    child.once('error', () => {
      failed ??= new Error('Archive kill-matrix preparation could not start.')
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      if (failed !== null) reject(failed)
      else if (code !== 0 || signal !== null) {
        reject(new Error('Archive kill-matrix preparation failed safely.'))
      } else {
        resolve({ stdout: Buffer.concat(stdout).toString('utf8') })
      }
    })
  })
}

/** Allocates one empty, marked, mode-0700 work root safe for exact cleanup. */
function createOwnedWorkRoot(requestedRoot) {
  const root = requestedRoot
    ?? mkdtempSync(path.join(tmpdir(), 'sartracker-breadcrumb-pr6-kill-'))
  assertNarrowWorkRoot(root)
  if (requestedRoot !== null) {
    if (existsSync(root) && readdirSync(root).length > 0) {
      throw new Error('Archive kill-matrix work root must be absent or empty.')
    }
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Archive kill-matrix work root is unsafe.')
  }
  chmodSync(root, 0o700)
  writeFileSync(path.join(root, OWNERSHIP_MARKER), 'owned\n', { mode: 0o600, flag: 'wx' })
  return Object.freeze({ root })
}

/** Deletes only a narrow directory bearing this runner's exact ownership marker. */
function removeOwnedWorkRoot(root) {
  assertNarrowWorkRoot(root)
  const marker = path.join(root, OWNERSHIP_MARKER)
  if (!existsSync(marker) || lstatSync(marker).isSymbolicLink()) {
    throw new Error('Archive kill-matrix work root lost its ownership marker.')
  }
  rmSync(root, { recursive: true, force: false, maxRetries: 5, retryDelay: 50 })
}

/** Rejects broad or authority-bearing deletion targets before any work begins. */
function assertNarrowWorkRoot(root) {
  const resolved = path.resolve(root)
  const prohibited = new Set([
    path.parse(resolved).root,
    path.resolve(process.env.HOME ?? path.parse(resolved).root),
    projectRoot,
  ])
  if (!path.isAbsolute(root) || resolved !== root || prohibited.has(resolved)
    || resolved.split(path.sep).filter(Boolean).length < 3) {
    throw new Error('Archive kill-matrix work root is too broad.')
  }
}

/** Writes one new mode-0600 JSON report without overwriting prior proof. */
function writeReport(reportPath, report) {
  if (existsSync(reportPath)) {
    throw new Error('Archive kill-matrix report already exists.')
  }
  const temporaryPath = `${reportPath}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  renameSync(temporaryPath, reportPath)
  chmodSync(reportPath, 0o600)
}

/** Resolves an existing report parent so writes never traverse an unchecked alias. */
function resolvePhysicalReportPath(reportPath) {
  const name = path.basename(reportPath)
  if (name.length < 1 || name === '.' || name === '..') {
    throw new Error('Archive kill-matrix report filename is invalid.')
  }
  let physicalParent
  try {
    physicalParent = realpathSync(path.dirname(reportPath))
  } catch {
    throw new Error('Archive kill-matrix report parent must already exist safely.')
  }
  const stat = lstatSync(physicalParent)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Archive kill-matrix report parent is unsafe.')
  }
  return path.join(physicalParent, name)
}

/** Revalidates the physical destination against every authority-bearing root. */
function assertPhysicalReportContainment(reportPath, prohibitedRoots) {
  if (resolvePhysicalReportPath(reportPath) !== reportPath) {
    throw new Error('Archive kill-matrix report destination changed during qualification.')
  }
  if (prohibitedRoots.some((root) => isPathInside(reportPath, root))) {
    throw new Error('Archive kill-matrix report destination is authority-bearing.')
  }
}

/** Returns true when one canonical path is equal to or below another. */
function isPathInside(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`)
}

await main().catch(() => {
  process.stderr.write('Breadcrumb PR6 kill-matrix qualification failed safely.\n')
  process.exitCode = 1
})
