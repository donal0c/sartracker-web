/**
 * Launches the packaged app under test with an isolated profile and drives it
 * over the Chrome DevTools Protocol, exactly as an installed build runs.
 *
 * Every launch gets its own profile directory under the run directory, so a
 * smoke never touches an operator's real profile. Each app is started in its
 * own process group so the runner can always clean up renderer and GPU
 * children, including after a deliberate SIGKILL of the main process.
 */

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

import { chromium } from 'playwright'

import { expectProduct } from './results.mjs'

const CDP_TIMEOUT_MS = 45_000
const SHELL_TIMEOUT_MS = 90_000

/** Starts an owned child and rejects spawn failures before exposing a PID to cleanup. */
async function startChild(ctx, { profile, label, port, env = {} }) {
  const log = createWriteStream(path.join(ctx.runDir, `${label}.log`), { flags: 'a' })
  const child = spawn(ctx.app, [`--remote-debugging-port=${port}`, ...ctx.appArgs], {
    detached: true,
    env: { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profile, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  child.once('close', () => log.end())
  await new Promise((resolve, reject) => {
    child.once('error', (error) => { log.end(); reject(error) })
    child.once('spawn', () => {
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
        reject(new Error('Spawn returned no valid owned process ID.'))
      } else resolve()
    })
  })
  return child
}

/**
 * @typedef {Object} SmokeContext
 * @property {string} app packaged executable under test
 * @property {string[]} appArgs extra arguments (for example `--no-sandbox` for an AppImage)
 * @property {string} runDir directory for this check's profiles, logs and screenshots
 * @property {Set<RunningApp>} running apps to clean up when the check ends
 */

/**
 * @typedef {Object} RunningApp
 * @property {number} pid main process id
 * @property {number} port DevTools port; an app relaunch reuses it
 * @property {import('playwright').Page} page
 * @property {Promise<number | null>} exited resolves with the exit code
 * @property {() => boolean} alive
 * @property {(name: string) => Promise<string>} shot saves a screenshot, returns its path
 * @property {(signal?: NodeJS.Signals) => Promise<void>} stop signals the main process and waits for exit
 * @property {() => Promise<void>} kill kills the whole process group
 */

/**
 * Starts the app on a profile and connects to its first window.
 *
 * @param {SmokeContext} ctx
 * @param {{profile: string, label: string, waitForShell?: boolean, env?: Record<string, string>}} options
 * @returns {Promise<RunningApp>}
 */
export async function launchApp(ctx, { profile, label, waitForShell = true, env = {} }) {
  await mkdir(profile, { recursive: true })
  const port = await freePort()
  const child = await startChild(ctx, { profile, label, port, env })
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
  let running = true
  void exited.then(() => {
    running = false
  })

  /** @type {RunningApp} */
  const handle = {
    pid: child.pid,
    port,
    page: /** @type {any} */ (null),
    exited,
    alive: () => running,
    async shot(name) {
      const file = path.join(ctx.runDir, `${label}-${name}.png`)
      await handle.page.screenshot({ path: file })
      return file
    },
    async stop(signal = 'SIGTERM') {
      if (running) process.kill(handle.pid, signal)
      await Promise.race([exited, delay(30_000)])
      await handle.kill()
    },
    async kill() {
      try {
        process.kill(-handle.pid, 'SIGKILL')
      } catch {
        // The group has already exited.
      }
      ctx.running.delete(handle)
    },
  }
  ctx.running.add(handle)

  await waitForCdp(port, () => running)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  handle.page = await firstAppPage(browser)
  // The app itself never asks before closing (window X drains and quits; Donal
  // confirmed on 13.5). Accept any unexpected page dialog so it cannot hang a run.
  handle.page.on('dialog', (dialog) => {
    void dialog.accept().catch(() => {})
  })
  if (waitForShell) {
    await handle.page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: SHELL_TIMEOUT_MS })
    await delay(1500)
    const fault = await handle.page.getByText('Runtime startup failed').isVisible().catch(() => false)
    expectProduct(!fault, `${label}: the runtime fault shell appeared instead of the app.`)
  }
  return handle
}

/**
 * Waits for the app window and reports whether the process exited without
 * ever showing one (a silent exit from the operator's point of view).
 *
 * @param {SmokeContext} ctx
 * @param {{profile: string, label: string, timeoutMs?: number}} options
 * @returns {Promise<{window: boolean, bodyText: string, exitCode: number | null}>}
 */
export async function observeStartup(ctx, { profile, label, timeoutMs = 30_000 }) {
  const port = await freePort()
  const child = await startChild(ctx, { profile, label, port })
  let exitCode = /** @type {number | null | undefined} */ (undefined)
  child.once('exit', (code) => {
    exitCode = code
  })
  const deadline = Date.now() + timeoutMs
  let bodyText = ''
  let window = false
  try {
    while (Date.now() < deadline && exitCode === undefined) {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])
      if (pages.some((entry) => entry.type === 'page' && !entry.url.startsWith('devtools'))) {
        window = true
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
        const page = await firstAppPage(browser)
        await delay(5000)
        bodyText = await page.locator('body').innerText().catch(() => '')
        await page.screenshot({ path: path.join(ctx.runDir, `${label}.png`) })
        break
      }
      await delay(500)
    }
  } finally {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // Already exited.
    }
  }
  return { window, bodyText, exitCode: exitCode ?? null }
}

/**
 * Returns the first non-DevTools page of the app, waiting for it if needed.
 *
 * @param {import('playwright').Browser} browser
 * @returns {Promise<import('playwright').Page>}
 */
async function firstAppPage(browser) {
  const deadline = Date.now() + CDP_TIMEOUT_MS
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages())
      .find((candidate) => !candidate.url().startsWith('devtools'))
    if (page !== undefined) return page
    await delay(250)
  }
  throw new Error('The app opened no window over CDP.')
}

/** Waits until the DevTools endpoint answers, failing if the app exits first. */
async function waitForCdp(port, isRunning) {
  const deadline = Date.now() + CDP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!isRunning()) throw new Error('The app exited before its DevTools endpoint became available.')
    const ok = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false)
    if (ok) return
    await delay(300)
  }
  throw new Error(`Timed out waiting for the app's DevTools endpoint on port ${port}.`)
}

/** Allocates a free loopback TCP port. */
export async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (typeof address !== 'object' || address === null) throw new Error('Could not allocate a port.')
  return address.port
}

/** Resolves after `ms` milliseconds. */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
