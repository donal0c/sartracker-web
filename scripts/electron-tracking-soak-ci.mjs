#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

main().catch((error) => {
  console.error(`electron-tracking-soak-ci: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Finds the just-built unpacked executable and runs the deterministic CI profile. */
async function main() {
  const appPath = await findPackagedExecutable()
  const runnerArgs = [
    path.join(projectRoot, 'scripts', 'electron-tracking-soak.mjs'),
    '--app',
    appPath,
    '--profile',
    'ci',
    '--evidence',
    path.join(projectRoot, 'tmp', 'beta-artifacts', 'tracking-soak-ci'),
  ]
  const command = process.platform === 'linux' && !process.env.DISPLAY ? 'xvfb-run' : process.execPath
  const args = command === 'xvfb-run' ? ['-a', process.execPath, ...runnerArgs] : runnerArgs
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`CI packaged tracking soak exited with code ${exitCode}.`)
  }
}

async function findPackagedExecutable() {
  const architecture = os.arch() === 'arm64' ? 'arm64' : 'x64'
  const candidates =
    process.platform === 'darwin'
      ? [
          path.join(
            projectRoot,
            'tmp',
            'electron-dist',
            `mac-${architecture}`,
            'SAR Tracker Electron Validation.app',
            'Contents',
            'MacOS',
            'SAR Tracker Electron Validation',
          ),
        ]
      : process.platform === 'linux'
        ? [path.join(projectRoot, 'tmp', 'electron-dist', 'linux-unpacked', 'sartracker-web')]
        : []

  for (const candidate of candidates) {
    if (await access(candidate).then(() => true).catch(() => false)) {
      return candidate
    }
  }
  throw new Error(
    `Could not find the packaged ${process.platform}/${architecture} Electron executable. Run npm run electron:pack first.`,
  )
}
