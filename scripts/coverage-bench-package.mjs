#!/usr/bin/env node

import { rmSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rebuildMarker = path.join(
  projectRoot,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  '.forge-meta',
)

let exitCode = 0
try {
  runRequired('npm', ['run', 'coverage:bench:renderer'])
  rmSync(rebuildMarker, { force: true })
  runRequired('npm', [
    'exec',
    '--',
    'electron-builder',
    '--config',
    'tools/coverage-renderer-bench/electron-builder.json',
    '--dir',
  ])
} catch (error) {
  exitCode = error instanceof CommandFailure ? error.exitCode : 1
} finally {
  const restore = run('npm', ['rebuild', 'better-sqlite3'])
  if (restore !== 0 && exitCode === 0) exitCode = restore
}

process.exit(exitCode)

/** Runs one required packaging command. */
function runRequired(command, args) {
  const status = run(command, args)
  if (status !== 0) throw new CommandFailure(status)
}

/** Runs one command with inherited evidence output. */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' })
  return result.status ?? 1
}

class CommandFailure extends Error {
  /** Creates a packaging failure with the original process status. */
  constructor(exitCode) {
    super(`Coverage benchmark packaging failed with exit code ${exitCode}.`)
    this.exitCode = exitCode
  }
}
