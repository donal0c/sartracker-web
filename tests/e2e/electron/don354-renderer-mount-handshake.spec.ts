import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

/**
 * DON-354: the real main process, preload and renderer run the startup mount
 * handshake. Electron's load events only prove the HTML arrived; the window is
 * revealed only after the renderer's first screen commits and signals through
 * the preload. A missing entry script never signals, so startup must end at
 * the visible fault screen, log the stage, and exit nonzero.
 *
 * It runs against the packaged app (SARTRACKER_PACKAGED_APP), whose
 * better-sqlite3 is built for Electron: an unpackaged checkout's native module
 * is built for Node, so the real main process cannot open its mission store.
 * CI's packaged Linux checks set it; elsewhere the spec is skipped.
 */

const packagedApp = process.env.SARTRACKER_PACKAGED_APP
test.skip(packagedApp === undefined || packagedApp.trim() === '',
  'Needs SARTRACKER_PACKAGED_APP: the packaged app with an Electron-built SQLite module.')

/** One runtime-log line: the writer spreads an entry's fields beside ts, level and event. */
type RuntimeLogEntry = { readonly event?: string, readonly [field: string]: unknown }

/** Reads the profile's JSON-lines runtime log; missing file reads as empty. */
async function readRuntimeLog(profile: string): Promise<RuntimeLogEntry[]> {
  const text = await readFile(path.join(profile, 'logs', 'runtime.log'), 'utf8').catch(() => '')
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as RuntimeLogEntry)
}

/**
 * Launches the packaged main process with an isolated profile. Without a
 * renderer URL it loads its own packaged renderer, as the team's install does.
 */
async function launch(profile: string, rendererUrl?: string): Promise<ElectronApplication> {
  const env: Record<string, string> = { ...process.env as Record<string, string>, SARTRACKER_ELECTRON_USER_DATA_PATH: profile }
  delete env.ELECTRON_RENDERER_URL
  if (rendererUrl !== undefined) env.ELECTRON_RENDERER_URL = rendererUrl
  return electron.launch({ executablePath: packagedApp!, args: [], env })
}

let profile: string

test.beforeEach(async () => {
  profile = await mkdtemp(path.join(os.tmpdir(), 'sartracker-don354-'))
})

test.afterEach(async () => {
  await rm(profile, { recursive: true, force: true })
})

test('reveals the window once the packaged renderer signals its first screen [DON-354]', async () => {
  test.setTimeout(120_000)
  const app = await launch(profile)
  try {
    const window = await app.firstWindow()
    await window.waitForSelector('[data-testid="runtime-booting-shell"], [data-testid="app-shell"]')
    await expect.poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible() }))),
      { timeout: 20_000 },
    ).toEqual([expect.objectContaining({ visible: true })])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()))
      .not.toBe('SAR Tracker could not start')
    expect((await readRuntimeLog(profile)).filter((entry) => entry.event === 'startup_failure')).toEqual([])
  } finally {
    await app.close()
  }
})

test('ends at the visible fault screen, logged, with a nonzero exit when the entry script is missing [DON-354]', async () => {
  test.setTimeout(120_000)
  // HTML arrives, but its entry script does not: nothing can mount.
  const server: Server = createServer((request, response) => {
    if (request.url === '/' || request.url?.startsWith('/?') === true) {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/index-missing.js"></script></body></html>')
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const app = await launch(profile, `http://127.0.0.1:${port}/`)
  const exitCode = new Promise<number | null>((resolve) => app.process().once('exit', (code) => resolve(code)))
  try {
    const faultWindow = await app.waitForEvent('window', {
      predicate: async (candidate) => (await candidate.title().catch(() => '')) === 'SAR Tracker could not start'
        || (await candidate.textContent('body').catch(() => ''))?.includes('map screen did not start') === true,
      timeout: 40_000,
    })
    await expect(faultWindow.locator('body')).toContainText('map screen did not start', { timeout: 10_000 })
    await expect(faultWindow.locator('body')).toContainText('No mission-data damage was confirmed')
    // The blank operational window was never revealed.
    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => w.getTitle()))
    expect(visible).toEqual(['SAR Tracker could not start'])
    await expect.poll(async () => (await readRuntimeLog(profile)).find((entry) => entry.event === 'startup_failure'), { timeout: 10_000 })
      .toMatchObject({ level: 'error', name: 'StartupTimeoutError', stage: 'map screen start' })

    // Dismissing the fault screen ends the process with a failure code.
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.close()
    })
    await expect(exitCode).resolves.not.toBe(0)
  } finally {
    await app.close().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
