#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import {
  buildOfficialMapPackageSettings,
  buildSafeEvidenceSummary,
  buildSeedSettings,
  findFirstMbtilesTile,
  sanitizeEvidenceText,
} from '../build/electron-official-map-offline-smoke-lib.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  await mkdir(userDataDir, { recursive: true })

  const packageSettings = buildOfficialMapPackageSettings({
    mapId: 'official_discovery_topo',
    packagePath: options.packagePath,
    now: new Date(),
  })
  const seedSettings = buildSeedSettings(packageSettings)
  await writeJson(path.join(userDataDir, 'settings.json'), seedSettings)

  const tile = findFirstMbtilesTile(options.packagePath)
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
    await page.screenshot({ path: path.join(evidenceDir, '01-packaged-app-launched.png'), fullPage: true })

    const tileResponse = await page.evaluate(async ({ z, x, y }) => {
      const bridge = window.sartrackerElectron
      if (bridge === undefined) {
        throw new Error('Electron bridge is not available.')
      }
      return bridge.fetchOfficialMapTile(
        `sartracker-official-map://tile/official_discovery_topo/${z}/${x}/${y}.png`,
      )
    }, tile)
    const tileBytes = Buffer.from(tileResponse.bytesBase64, 'base64').length
    await writeFile(path.join(evidenceDir, 'local-official-tile.bin'), Buffer.from(tileResponse.bytesBase64, 'base64'))

    const blockedNetwork = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/sartracker-network-block-probe', { cache: 'no-store' })
        return false
      } catch {
        return true
      }
    })
    if (!blockedNetwork) {
      throw new Error('Network block probe unexpectedly reached HTTPS.')
    }

    await selectDiscoveryMap(page)
    await jumpToPackageCenter(page, packageSettings)
    await page.screenshot({ path: path.join(evidenceDir, '02-discovery-offline-package.png'), fullPage: true })

    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId('check-offline-map-coverage').click()
    await page.getByTestId('basemap-offline-coverage').getByText(/inside official offline/i).waitFor({
      timeout: 15_000,
    })
    const readinessText = await page.getByTestId('basemap-status-section').innerText()
    await page.screenshot({ path: path.join(evidenceDir, '03-offline-readiness-inside.png'), fullPage: true })

    await jumpOutsidePackage(page)
    await page.getByTestId('check-offline-map-coverage').click()
    await page.getByTestId('basemap-offline-coverage').getByText(/outside official offline/i).waitFor({
      timeout: 15_000,
    })
    const outsideText = await page.getByTestId('basemap-offline-coverage').innerText()
    await page.screenshot({ path: path.join(evidenceDir, '04-offline-readiness-outside.png'), fullPage: true })

    await page.getByTestId('open-settings-workspace').click()
    await page.getByTestId('official-map-package-status').waitFor()
    const packageStatusText = await page.getByTestId('official-map-package-status').innerText()
    await page.screenshot({ path: path.join(evidenceDir, '05-settings-package-status.png'), fullPage: true })
    await page.getByTestId('workspace-close-btn').click()

    await page.getByTestId('open-diagnostics-workspace').click()
    await page.getByTestId('diagnostics-workspace').waitFor()
    await page.getByTestId('diagnostics-export-report').click()
    await page.getByTestId('diagnostics-export-path').waitFor({ timeout: 20_000 })
    const diagnosticsPath = await page.getByTestId('diagnostics-export-path').innerText()
    const diagnosticsReport = await readFile(diagnosticsPath.trim(), 'utf8')
    await writeFile(
      path.join(evidenceDir, 'diagnostics-report-sanitized.txt'),
      sanitizeEvidenceText(diagnosticsReport),
      'utf8',
    )
    await page.screenshot({ path: path.join(evidenceDir, '06-diagnostics-exported.png'), fullPage: true })

    const summary = buildSafeEvidenceSummary({
      appPath: options.appPath,
      diagnosticsReport,
      packagePath: options.packagePath,
      platform: options.platform,
      tile,
      tileBytes,
    })
    await writeJson(path.join(evidenceDir, 'summary.json'), {
      ...summary,
      blockedNetwork,
      packageStatusText: sanitizeEvidenceText(packageStatusText),
      readinessText: sanitizeEvidenceText(readinessText),
      outsideText: sanitizeEvidenceText(outsideText),
      evidenceDir,
    })
  } finally {
    if (browser !== undefined) {
      await browser.close()
    }
    appProcess.kill()
    await writeFile(appLogPath, sanitizeEvidenceText(Buffer.concat(logChunks).toString('utf8')), 'utf8')
  }
}

async function selectDiscoveryMap(page) {
  await page.getByTestId('basemap-menu-toggle').click()
  await page.getByTestId('basemap-btn-official_discovery_topo').click()
  await page.getByTestId('basemap-menu-toggle').waitFor({ state: 'visible' })
}

async function jumpToPackageCenter(page, packageSettings) {
  const center = boundsCenter(packageSettings.bounds)
  const zoom = Math.min(12, packageSettings.maxZoom ?? 12)
  await page.evaluate(({ center: nextCenter, zoom: nextZoom }) => {
    const map = window.__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('MapLibre instance is not available.')
    }
    map.jumpTo({ center: nextCenter, zoom: nextZoom })
  }, { center, zoom })
  await page.waitForTimeout(2500)
}

async function jumpOutsidePackage(page) {
  await page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('MapLibre instance is not available.')
    }
    map.jumpTo({ center: [-6.2603, 53.3498], zoom: 15 })
  })
  await page.waitForTimeout(1000)
}

function boundsCenter(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    throw new Error('Official map package bounds are required for offline coverage smoke.')
  }
  const [west, south, east, north] = bounds
  return [(west + east) / 2, (south + north) / 2]
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
    appPath: '',
    evidenceDir: path.join(projectRoot, 'tmp', 'don107-official-map-offline-smoke'),
    extraArgs: [],
    packagePath: '',
    platform: process.platform,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--app') {
      options.appPath = readArgValue(args, ++index, arg)
    } else if (arg === '--package') {
      options.packagePath = readArgValue(args, ++index, arg)
    } else if (arg === '--evidence-dir') {
      options.evidenceDir = readArgValue(args, ++index, arg)
    } else if (arg === '--platform') {
      options.platform = readArgValue(args, ++index, arg)
    } else if (arg === '--app-arg') {
      options.extraArgs.push(readArgValue(args, ++index, arg, { allowFlagLikeValue: true }))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (options.appPath === '') {
    throw new Error('Pass --app with the packaged Electron executable path.')
  }
  if (options.packagePath === '') {
    throw new Error('Pass --package with the local MBTiles package path.')
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
