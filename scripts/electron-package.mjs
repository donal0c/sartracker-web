#!/usr/bin/env node

import { rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { capturePackageSource } from '../build/linux-package-source.js'
import { loadPackageToolchain } from '../build/linux-package-toolchain.js'

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
const inspectLinux = process.argv.includes('--linux') && !process.argv.includes('--dir')
if (inspectLinux && (process.platform !== 'linux' || process.arch !== 'x64')) {
  console.error('Linux installer qualification requires a Linux x64 host; use the Linux CI lane. No package build was started.')
  process.exit(1)
}

try {
  let sourceBefore
  if (inspectLinux) {
    rmSync(path.join(projectRoot, 'tmp/electron-validation-evidence/package-safety.json'), { force: true })
    loadPackageToolchain(JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')))
    sourceBefore = capturePackageSource(projectRoot)
  }
  runRequired('npm', ['run', 'build'])
  removeElectronRebuildMarkers()
  runRequired('npm', ['exec', '--', 'electron-builder', '--config', 'electron-builder.json', ...process.argv.slice(2)])
  if (inspectLinux) {
    runRequired(process.execPath, ['scripts/verify-linux-package.mjs', '--source-before', JSON.stringify(sourceBefore)])
  }
} catch (error) {
  console.error(`Electron packaging failed: ${error instanceof Error ? error.message : String(error)}`)
  exitCode = error instanceof CommandFailure ? error.exitCode : 1
} finally {
  const restore = runOptional('npm', ['rebuild', 'better-sqlite3'])
  if (restore !== 0 && exitCode === 0) {
    exitCode = restore
  }
}

process.exit(exitCode)
