#!/usr/bin/env node

// Packaged-Electron map-freeze reproduction probe (DON-240).
//
// Drives a scripted serpentine pan across a real official-map package while measuring BOTH
// main-process and renderer responsiveness, then writes a verdict. Run it against two builds
// (beta.9 pre-hotfix vs the hotfix) on the SAME machine to prove — with numbers — whether the
// "Not Responding" pan hang is reproduced and removed, and which thread stalled.
//
// Usage:
//   node scripts/electron-map-freeze-probe.mjs \
//     --app /path/to/packaged/sartracker \
//     --package /path/to/reeks-standard-60km-z16.mbtiles \
//     --evidence output/beta9-map-freeze-probe/<build-label> \
//     --rows 8 --cols 8 -- --no-sandbox --ozone-platform=x11
//
// See docs/releases/beta9-map-freeze-repro-plan.md for the full A/B runbook.

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import {
  buildOfficialMapPackageSettings,
  buildSeedSettings,
  sanitizeEvidenceText,
} from '../build/electron-official-map-offline-smoke-lib.js'
import {
  buildFreezeVerdict,
  generateSerpentinePanPath,
  parseFreezeProbeArgs,
  summarizeResponsiveness,
} from '../build/electron-map-freeze-probe-lib.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main() {
  const options = parseFreezeProbeArgs(process.argv.slice(2))
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  await mkdir(userDataDir, { recursive: true })

  const packageSettings = buildOfficialMapPackageSettings({
    mapId: 'official_discovery_topo',
    packagePath: options.packagePath,
    now: new Date(),
  })
  await writeJson(path.join(userDataDir, 'settings.json'), buildSeedSettings(packageSettings))

  if (!Array.isArray(packageSettings.bounds)) {
    throw new Error('Package has no bounds metadata; cannot generate a pan path.')
  }
  const panPath = generateSerpentinePanPath(packageSettings.bounds, {
    rows: options.rows,
    cols: options.cols,
    zooms: [13, 14, 15, Math.min(16, packageSettings.maxZoom ?? 16)],
  })

  const env = {
    ...process.env,
    SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
  }
  if (options.blockNetwork) {
    env.SARTRACKER_ELECTRON_BLOCK_NETWORK = '1'
  }

  const port = await findFreePort()
  const appLogPath = path.join(evidenceDir, 'electron-app.log')
  const appProcess = spawn(options.appPath, [`--remote-debugging-port=${port}`, ...options.extraArgs], {
    cwd: projectRoot,
    env,
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
    const page = context.pages()[0] ?? (await context.waitForEvent('page'))

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })

    // Switch to the official package and settle on its centre before measuring.
    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId('basemap-btn-official_discovery_topo').click()
    await page.getByTestId('basemap-menu-toggle').waitFor({ state: 'visible' })
    await jumpTo(page, panPath[0].center, panPath[0].zoom)
    await page.waitForTimeout(2000)
    await page.screenshot({ path: path.join(evidenceDir, '01-package-loaded.png'), fullPage: true })

    await installResponsivenessProbe(page, options.probeIntervalMs)

    // Drive the sweep. easeTo animates, forcing a continuous stream of fresh tile requests.
    for (const waypoint of panPath) {
      await page.evaluate(
        ({ center, zoom, duration }) => {
          const map = window.__SARTRACKER_MAP__
          if (map === undefined) throw new Error('MapLibre instance is not available.')
          map.easeTo({ center, zoom, duration })
        },
        { center: waypoint.center, zoom: waypoint.zoom, duration: options.panDurationMs },
      )
      await page.waitForTimeout(options.panDurationMs + 40)
    }
    // Let any queued stall drain so the worst gap is captured.
    await page.waitForTimeout(1500)

    const samples = await collectResponsivenessProbe(page)
    await page.screenshot({ path: path.join(evidenceDir, '02-after-pan.png'), fullPage: true })

    const mainStats = summarizeResponsiveness(samples.mainRtt, 250)
    const rendererStats = summarizeResponsiveness(samples.rendererGaps, 250)
    const verdict = buildFreezeVerdict({ mainStats, rendererStats, freezeThresholdMs: 1000 })

    const report = {
      build: path.basename(options.appPath),
      platform: options.platform,
      packageBasename: path.basename(options.packagePath),
      packageTileCount: packageSettings.tileCount,
      packageZoom: [packageSettings.minZoom, packageSettings.maxZoom],
      panWaypoints: panPath.length,
      panDurationMs: options.panDurationMs,
      probeIntervalMs: options.probeIntervalMs,
      networkBlocked: options.blockNetwork,
      mainProcess: mainStats,
      renderer: rendererStats,
      verdict,
    }
    await writeJson(path.join(evidenceDir, 'freeze-probe-report.json'), report)

    console.log(
      `[freeze-probe] ${report.build}: frozen=${verdict.frozen} offender=${verdict.offender} ` +
        `worstStall=${verdict.worstStallMs.toFixed(0)}ms ` +
        `(main max=${mainStats.maxMs.toFixed(0)}ms p99=${mainStats.p99Ms.toFixed(0)}ms, ` +
        `renderer max=${rendererStats.maxMs.toFixed(0)}ms p99=${rendererStats.p99Ms.toFixed(0)}ms)`,
    )
  } finally {
    if (browser !== undefined) {
      await browser.close()
    }
    appProcess.kill()
    await writeFile(appLogPath, sanitizeEvidenceText(Buffer.concat(logChunks).toString('utf8')), 'utf8')
  }
}

/**
 * Installs an in-page collector for main-process IPC round-trip latency and renderer rAF drift.
 */
async function installResponsivenessProbe(page, probeIntervalMs) {
  await page.evaluate((intervalMs) => {
    const probe = { rendererGaps: [], mainRtt: [] }
    window.__FREEZE_PROBE__ = probe

    // Renderer thread: requestAnimationFrame drift. A blocked renderer main thread fires the
    // next frame late, so the gap over one ~16.7ms frame is the stall.
    let last = performance.now()
    const frame = (now) => {
      probe.rendererGaps.push(now - last)
      last = now
      window.requestAnimationFrame(frame)
    }
    window.requestAnimationFrame(frame)

    // Main process: fire a cheap read-only IPC on a fixed cadence and record round-trip. While
    // the main event loop is saturated (e.g. synchronous SQLite tile reads), the invoke is not
    // serviced until the loop frees, so the round-trip balloons.
    const bridge = window.sartrackerElectron
    setInterval(() => {
      const t0 = performance.now()
      Promise.resolve(bridge.loadSettings())
        .catch(() => {})
        .finally(() => probe.mainRtt.push(performance.now() - t0))
    }, intervalMs)
  }, probeIntervalMs)
}

async function collectResponsivenessProbe(page) {
  return page.evaluate(() => ({
    rendererGaps: window.__FREEZE_PROBE__?.rendererGaps ?? [],
    mainRtt: window.__FREEZE_PROBE__?.mainRtt ?? [],
  }))
}

async function jumpTo(page, center, zoom) {
  await page.evaluate(
    ({ center: nextCenter, zoom: nextZoom }) => {
      const map = window.__SARTRACKER_MAP__
      if (map === undefined) throw new Error('MapLibre instance is not available.')
      map.jumpTo({ center: nextCenter, zoom: nextZoom })
    },
    { center, zoom },
  )
}

async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Electron exited before CDP became available with code ${appProcess.exitCode}.`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Timed out waiting for the Electron remote-debugging port.')
}

async function findFreePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
