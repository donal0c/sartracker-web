#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  buildArchiveLifecycleSmokeCiEnvironment,
  buildArchiveLifecycleSmokeCiRunnerArgs,
} from '../build/electron-archive-lifecycle-smoke-lib.js'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

main().catch((error) => {
  console.error(
    `electron-archive-lifecycle-smoke-ci: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})

/** Finds the unpacked executable and runs the exact-head packaged lifecycle proof. */
async function main() {
  const appPath = await findPackagedExecutable()
  const expectedHead = await readExactHead()
  const runnerArgs = buildArchiveLifecycleSmokeCiRunnerArgs({
    appPath,
    expectedHead,
    platform: process.platform,
    projectRoot,
  })
  const command = process.platform === 'linux' && !process.env.DISPLAY
    ? 'xvfb-run'
    : process.execPath
  const args = command === 'xvfb-run'
    ? ['-a', process.execPath, ...runnerArgs]
    : runnerArgs
  const environment = buildArchiveLifecycleSmokeCiEnvironment({
    environment: process.env,
    platform: process.platform,
  })
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: environment,
    })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`CI packaged archive-lifecycle smoke exited with code ${exitCode}.`)
  }
}

/** Reads the exact checked-out commit and rejects CI identity drift. */
async function readExactHead() {
  const result = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  const head = result.stdout.trim()
  if (!/^[0-9a-f]{40}$/u.test(head)) {
    throw new Error('The packaged archive-lifecycle checkout head is invalid.')
  }
  const workflowHead = process.env.EXPECTED_SOURCE_SHA
  if (workflowHead !== undefined && workflowHead !== '' && workflowHead !== head) {
    throw new Error('The packaged archive-lifecycle checkout does not match EXPECTED_SOURCE_SHA.')
  }
  return head
}

/** Locates the just-built unpacked Electron executable for this runner. */
async function findPackagedExecutable() {
  const architecture = os.arch() === 'arm64' ? 'arm64' : 'x64'
  const candidates = process.platform === 'darwin'
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
    if (await access(candidate).then(() => true).catch(() => false)) return candidate
  }
  throw new Error(
    `Could not find the packaged ${process.platform}/${architecture} Electron executable. Run the Electron pack step first.`,
  )
}
