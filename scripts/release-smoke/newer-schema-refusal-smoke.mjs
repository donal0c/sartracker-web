import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

import { fileSnapshotsMatch } from '../../build/release-smoke-lib.js'

const appPath = requiredEnvironment('SMOKE_APP')
const evidenceDir = requiredEnvironment('SMOKE_EVIDENCE')
const userDataDir = requiredEnvironment('SMOKE_USER_DATA')
const expectedAppSha256 = requiredEnvironment('SMOKE_EXPECTED_APP_SHA256')

await mkdir(evidenceDir, { recursive: true })
await assertFileSha256(appPath, expectedAppSha256)
const filesBefore = await snapshotMissionStoreFiles(userDataDir)
const port = await findFreePort()
const logs = []
const appProcess = spawn(
  appPath,
  [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--ozone-platform=x11',
    '--password-store=basic',
  ],
  {
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
appProcess.stdout.on('data', (chunk) => logs.push(chunk))
appProcess.stderr.on('data', (chunk) => logs.push(chunk))

let cdpAvailable = false
const deadline = Date.now() + 20_000
while (Date.now() < deadline && appProcess.exitCode === null) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    if (response.ok) {
      cdpAvailable = true
      break
    }
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}
appProcess.kill('SIGTERM')
await new Promise((resolve) => setTimeout(resolve, 1_000))
appProcess.kill('SIGKILL')

const logText = Buffer.concat(logs).toString('utf8')
await writeFile(path.join(evidenceDir, 'app.log'), logText, 'utf8')
const filesAfter = await snapshotMissionStoreFiles(userDataDir)
const filesUnchanged = fileSnapshotsMatch(filesBefore, filesAfter)
const expectedMessage =
  'Cannot open mission store created by newer mission store schema 6; this build supports schema 5.'
const result = {
  result: !cdpAvailable && logText.includes(expectedMessage) && filesUnchanged ? 'pass' : 'fail',
  appSha256: expectedAppSha256,
  cdpAvailable,
  processExitCode: appProcess.exitCode,
  expectedMessagePresent: logText.includes(expectedMessage),
  filesUnchanged,
  filesBefore,
  filesAfter,
}
await writeFile(
  path.join(evidenceDir, 'summary.json'),
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
)
if (result.result !== 'pass') {
  throw new Error(`Newer-schema refusal gate failed: ${JSON.stringify(result)}`)
}

/**
 * Reads one mandatory smoke environment variable.
 */
function requiredEnvironment(name) {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required.`)
  }
  return value
}

/**
 * Verifies that the executable under smoke is exactly the expected artifact.
 */
async function assertFileSha256(filePath, expectedSha256) {
  const actual = createHash('sha256').update(await readFile(filePath)).digest('hex')
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Smoke executable SHA-256 is ${actual}; expected ${expectedSha256}.`,
    )
  }
}

/**
 * Captures the full mission-store database, backup, and SQLite sidecar set.
 */
async function snapshotMissionStoreFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('mission-store'))
    .map((entry) => entry.name)
    .sort()
  const snapshot = {}
  for (const name of names) {
    const bytes = await readFile(path.join(directory, name))
    snapshot[name] = {
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }
  if (!Object.hasOwn(snapshot, 'mission-store.sqlite')) {
    throw new Error('Newer-schema refusal profile has no mission-store.sqlite.')
  }
  return snapshot
}

/**
 * Allocates an isolated local CDP port.
 */
async function findFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (typeof address !== 'object' || address === null) {
    throw new Error('Could not allocate a CDP port.')
  }
  return address.port
}
