#!/usr/bin/env node
/**
 * Team smoke runner: runs the automatable release-checklist checks against an
 * exact, already-built artifact and prints the release-note table.
 *
 * It never builds anything. The product is identified only by artifact
 * SHA-256; this tool records its own git commit separately, so a tool fix is
 * re-run against the same bytes without rebuilding the app.
 *
 *   node scripts/team-smoke/run.mjs --deb <file> --appimage <file> --sha256sums <file> \
 *     [--app <executable>] [--previous-profile <dir>] [--only id,id] --out <dir>
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { RELEASE_CHECKS } from '../../build/release-checklist.js'
import identity from './checks/identity.mjs'
import startup from './checks/startup.mjs'
import tracking from './checks/tracking.mjs'
import upgrade from './checks/upgrade.mjs'
import workflows from './checks/workflows.mjs'
import teamMission from './checks/team-mission.mjs'
import { completedCheck, NotTested, ProductFailure, renderResultTable } from './lib/results.mjs'

const CHECKS = [...identity, ...startup, ...upgrade, ...tracking, ...workflows, ...teamMission]
const CHECK_TIMEOUT_MS = 15 * 60_000
const INSTALLED_DEB_APP = '/opt/SAR Tracker Electron Validation/sartracker-web'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const options = parseArgs(process.argv.slice(2))
for (const check of CHECKS) {
  if (!RELEASE_CHECKS.some((entry) => entry.name === check.check)) {
    throw new Error(`team-smoke check ${check.id} names unknown checklist row "${check.check}".`)
  }
}
const selected = options.only === undefined ? CHECKS : CHECKS.filter((check) => options.only.includes(check.id))
if (selected.length === 0) throw new Error(`--only matched no checks. Known: ${CHECKS.map((c) => c.id).join(', ')}.`)
ensureDisplay()

await mkdir(options.out, { recursive: true })
const product = {}
for (const [key, file] of [['appImage', options.appImage], ['deb', options.deb], ['app', options.app]]) {
  if (file !== undefined && existsSync(file)) {
    product[key] = { file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') }
  }
}
const tool = {
  commit: git(['rev-parse', 'HEAD']),
  dirty: git(['status', '--porcelain', '--', 'scripts/team-smoke', 'build/release-checklist.js']) !== '',
}
console.log(`team-smoke tool ${tool.commit}${tool.dirty ? ' (uncommitted changes)' : ''}`)
console.log(`app under test: ${options.app}${product.app ? ` sha256 ${product.app.sha256}` : ''}; launch args: ${options.appArgs.join(' ') || '(none)'}`)

// A stray async error from a driven app (for example a dialog on a closing
// window) must not kill the whole run. It fails the current check as a tool
// error and the run continues.
let strayError = null
process.on('unhandledRejection', (error) => {
  strayError = error
})
process.on('uncaughtException', (error) => {
  strayError = error
})

const results = new Map()
const records = []
for (const check of selected) {
  const runDir = path.join(options.out, check.id)
  await mkdir(runDir, { recursive: true })
  const ctx = { app: options.app, appArgs: options.appArgs, runDir, options, running: new Set(), cleanups: [] }
  const started = Date.now()
  let row
  strayError = null
  try {
    const evidence = await withTimeout(check.run(ctx), check.timeoutMs ?? CHECK_TIMEOUT_MS, check.id)
    if (strayError !== null) throw strayError
    row = completedCheck(check, evidence)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof ProductFailure) row = { result: 'FAIL', evidence: message }
    else if (error instanceof NotTested) row = { result: 'NOT TESTED', evidence: message }
    else row = { result: 'NOT TESTED', evidence: `Tool error (not a product result): ${message.split('\n')[0]}` }
  } finally {
    for (const app of ctx.running) await app.kill()
    for (const cleanup of ctx.cleanups) await cleanup().catch(() => {})
  }
  row.evidence = `${row.evidence} [team-smoke ${check.id}]`
  const previous = results.get(check.check)
  // Two tools may feed one row: the worse result wins and both are kept.
  const rank = { FAIL: 3, 'NOT TESTED': 2, PASS: 1 }
  if (previous === undefined || rank[row.result] > rank[previous.result]) {
    results.set(check.check, previous === undefined ? row : { result: row.result, evidence: `${row.evidence}; ${previous.evidence}` })
  } else {
    previous.evidence = `${previous.evidence}; ${row.evidence}`
  }
  records.push({ id: check.id, check: check.check, ...row, seconds: Math.round((Date.now() - started) / 1000) })
  console.log(`${row.result.padEnd(10)} ${check.id} (${Math.round((Date.now() - started) / 1000)} s): ${row.evidence}`)
}

const checksShown = options.only === undefined ? RELEASE_CHECKS : RELEASE_CHECKS.filter((entry) => results.has(entry.name))
const table = renderResultTable(checksShown, results)
await writeFile(path.join(options.out, 'results.md'), `${table}\n`)
await writeFile(path.join(options.out, 'results.json'), `${JSON.stringify({ tool, product, appArgs: options.appArgs, finishedAt: new Date().toISOString(), records }, null, 2)}\n`)
console.log(`\n${table}\n\nWritten to ${path.join(options.out, 'results.md')}`)

/** Parses the command line. */
function parseArgs(argv) {
  const parsed = { appArgs: [] }
  const value = (index) => {
    if (argv[index + 1] === undefined) throw new Error(`${argv[index]} needs a value.`)
    return path.resolve(argv[index + 1])
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--deb') parsed.deb = value(index++)
    else if (arg === '--appimage') parsed.appImage = value(index++)
    else if (arg === '--sha256sums') parsed.sha256sums = value(index++)
    else if (arg === '--app') parsed.app = value(index++)
    else if (arg === '--previous-profile') parsed.previousProfile = value(index++)
    else if (arg === '--out') parsed.out = value(index++)
    else if (arg === '--only') parsed.only = argv[++index].split(',')
    else if (arg === '--app-arg') parsed.appArgs.push(argv[++index])
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/team-smoke/run.mjs --out <dir> [--deb <file>] [--appimage <file>]\n'
        + '  [--sha256sums <file>] [--app <executable>] [--app-arg <arg>]... [--previous-profile <dir>]\n'
        + `  [--only <id,id>]\nChecks: ${CHECKS.map((check) => check.id).join(', ')}. See scripts/team-smoke/README.md.`)
      process.exit(0)
    } else throw new Error(`Unknown argument ${arg}. See scripts/team-smoke/README.md.`)
  }
  if (parsed.out === undefined) throw new Error('--out <dir> is required.')
  if (parsed.app === undefined) {
    if (existsSync(INSTALLED_DEB_APP)) parsed.app = INSTALLED_DEB_APP
    else if (parsed.appImage !== undefined) {
      parsed.app = parsed.appImage
      parsed.appArgs.push('--no-sandbox')
    } else throw new Error('Pass --app, install the .deb, or pass --appimage.')
  }
  return parsed
}

/** Runs git in the tool checkout and returns trimmed output. */
function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/** On a Linux desktop session reached over SSH, borrow the logged-in display. */
function ensureDisplay() {
  if (process.platform !== 'linux' || process.env.DISPLAY !== undefined) return
  const runtime = `/run/user/${process.getuid?.()}`
  const auth = existsSync(runtime) ? readdirSync(runtime).find((name) => name.startsWith('.mutter-Xwaylandauth.')) : undefined
  if (auth === undefined) throw new Error('No DISPLAY. Log in to the desktop or export DISPLAY/XAUTHORITY.')
  process.env.DISPLAY = ':0'
  process.env.XAUTHORITY = path.join(runtime, auth)
}

/** Rejects if a check runs past its budget; the runner then cleans up its processes. */
function withTimeout(promise, ms, id) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${id} exceeded ${ms / 60_000} min`)), ms)
    }),
  ])
}
