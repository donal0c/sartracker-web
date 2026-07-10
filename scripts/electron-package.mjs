#!/usr/bin/env node

import { rmSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rebuildMarkerPaths = [
  path.join(projectRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', '.forge-meta'),
]

function removeElectronRebuildMarkers() {
  for (const markerPath of rebuildMarkerPaths) {
    rmSync(markerPath, { force: true })
  }
}

function runRequired(command, args) {
  const status = runOptional(command, args)
  if (status !== 0) {
    throw new CommandFailure(status)
  }
}

function runOptional(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  return result.status ?? 1
}

class CommandFailure extends Error {
  constructor(exitCode) {
    super(`Command failed with exit code ${exitCode}.`)
    this.exitCode = exitCode
  }
}

let exitCode = 0

try {
  runRequired('npm', ['run', 'build'])
  removeElectronRebuildMarkers()
  runRequired('npm', ['exec', '--', 'electron-builder', '--config', 'electron-builder.json', ...process.argv.slice(2)])
} catch (error) {
  exitCode = error instanceof CommandFailure ? error.exitCode : 1
} finally {
  const restore = runOptional('npm', ['rebuild', 'better-sqlite3'])
  if (restore !== 0 && exitCode === 0) {
    exitCode = restore
  }
}

process.exit(exitCode)
