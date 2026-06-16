#!/usr/bin/env node

// Packaged-app smoke for the undecryptable-legacy-secret startup path.
//
// Seeds a throwaway userData with a beta.5-style keyring-encrypted
// secrets.json whose ciphertext cannot be decrypted on this session (locked or
// changed login keyring, copied profile state, stale ciphertext). Under the
// DON-177 app-owned credential model this is the legacy-migration failure
// case: migration cannot recover the secret, so the app must still reach the
// normal shell, leave tracking disabled with a clear warning, and let the
// operator re-enter the password/token in Settings. The legacy secrets.json is
// never modified. This must remain a release-blocking gate.

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UNDECRYPTABLE_SECRET_WARNING =
  'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  await mkdir(userDataDir, { recursive: true })
  await seedBadSecretUserData(userDataDir)

  const port = await findFreePort()
  const appLogPath = path.join(evidenceDir, 'electron-app.log')
  const appProcess = spawn(options.appPath, [
    `--remote-debugging-port=${port}`,
    '--ignore-gpu-blocklist',
    ...options.extraArgs,
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logChunks = []
  appProcess.stdout.on('data', (chunk) => logChunks.push(chunk))
  appProcess.stderr.on('data', (chunk) => logChunks.push(chunk))

  let browser
  try {
    await waitForCdp(port, appProcess)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ timeout: 45_000 })
    if (await page.getByText('Runtime startup failed').isVisible().catch(() => false)) {
      throw new Error('Runtime startup fault shell appeared for an undecryptable stored secret.')
    }

    await page.getByText(UNDECRYPTABLE_SECRET_WARNING).waitFor({ timeout: 15_000 })
    await page.screenshot({ path: path.join(evidenceDir, '01-bad-secret-started.png'), fullPage: true })

    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('settings-workspace').waitFor({ timeout: 15_000 })
    await page.getByTestId('settings-provider-secret').fill('replacement-secret')
    await page.screenshot({ path: path.join(evidenceDir, '02-settings-can-recover-secret.png'), fullPage: true })

    await writeJson(path.join(evidenceDir, 'summary.json'), {
      appPath: options.appPath,
      evidenceDir,
      result: 'pass',
      userDataDir,
      warning: UNDECRYPTABLE_SECRET_WARNING,
    })
  } finally {
    if (browser !== undefined) {
      await browser.close()
    }
    appProcess.kill()
    await writeFile(appLogPath, Buffer.concat(logChunks).toString('utf8'), 'utf8')
  }
}

async function seedBadSecretUserData(userDataDir) {
  await writeJson(path.join(userDataDir, 'settings.json'), {
    missionDefaults: {
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 30,
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 30,
      primaryMissionRoot: '',
      backupMissionRoot: '',
      coordinatorRoster: [],
      adminRoster: [],
    },
    dataSource: {
      providerType: 'traccar_http',
      baseUrl: 'https://kmrtsar.eu',
      authMode: 'basic',
      email: 'sean',
      autoConnect: true,
      trackingCacheEnabled: true,
      replayEnabled: false,
      replayStart: '',
      replayDurationHours: 4,
    },
    officialMaps: {
      sourceType: 'none',
      sourcePath: '',
      status: 'not_configured',
      username: '',
      availableSources: [],
      serviceCount: 0,
      message: 'Official maps are not configured.',
      packages: [],
    },
    weather: { links: [] },
  })
  await writeJson(path.join(userDataDir, 'secrets.json'), {
    basic: {
      encrypted: Buffer.from('not-valid-electron-safe-storage-ciphertext', 'utf8').toString('base64'),
    },
  })
}

async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Electron exited before CDP became available with code ${appProcess.exitCode}.`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        return
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Timed out waiting for Electron CDP on port ${port}.`)
}

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

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function parseArgs(args) {
  const options = {
    appPath: process.env.SMOKE_APP ?? '',
    evidenceDir: process.env.SMOKE_EVIDENCE ?? path.join(projectRoot, 'tmp', 'electron-bad-secret-smoke'),
    extraArgs: [],
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--app') {
      options.appPath = readArgValue(args, ++index, arg)
    } else if (arg === '--evidence-dir') {
      options.evidenceDir = readArgValue(args, ++index, arg)
    } else if (arg === '--app-arg') {
      options.extraArgs.push(readArgValue(args, ++index, arg, { allowFlagLikeValue: true }))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (options.appPath === '') {
    throw new Error('Pass --app or SMOKE_APP with the packaged Electron executable path.')
  }
  return options
}

function readArgValue(args, index, name, options = {}) {
  const value = args[index]
  if (value === undefined || (!options.allowFlagLikeValue && value.startsWith('--'))) {
    throw new Error(`${name} requires a value.`)
  }
  return value
}
