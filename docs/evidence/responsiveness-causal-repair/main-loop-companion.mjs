#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) =>
  [process.argv[index * 2 + 2], process.argv[index * 2 + 3]]))
const port = Number(args['--port'])
const durationMs = Number(args['--duration-ms'] ?? 600000)
const output = args['--output'] ?? args['--outputpath']
if (!Number.isInteger(port) || port < 1 || port > 65535 || !output
  || !Number.isFinite(durationMs) || durationMs < 1 || durationMs > 21600000) {
  throw new Error('Usage: --port PORT --output FILE [--duration-ms 600000]')
}
const sourcePath = fileURLToPath(import.meta.url)
const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex')
const startedAtUnixMs = Date.now()
const launches = []
let stopping = false
let stopReason = 'duration_elapsed'
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; stopReason = signal })
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs only inside the inspected main process; snapshots never reset its timer. */
function installProbe() {
  const startedAtMs = performance.now()
  const installedAtMainWallMs = Date.now()
  let previous = startedAtMs
  let samples = 0
  let maximumGapMs = 0
  let maximumGapWindow = null
  const breaches = []
  let breachCount = 0
  const timer = setInterval(() => {
    const current = performance.now()
    const gapMs = current - previous
    samples += 1
    if (gapMs > maximumGapMs) {
      maximumGapMs = gapMs
      maximumGapWindow = { fromMs: previous, toMs: current }
    }
    if (gapMs >= 200) {
      breachCount += 1
      breaches.push({ fromMs: previous, toMs: current, gapMs })
      if (breaches.length > 64) breaches.shift()
    }
    previous = current
  }, 50)
  timer.unref?.()
  return {
    snapshot: () => ({ clock: 'main-performance-now', intervalMs: 50,
      timeOriginMs: performance.timeOrigin, installedAtMainWallMs, startedAtMs,
      sampledUntilMs: previous, readAtMs: performance.now(), samples,
      maximumGapMs, maximumGapWindow, breachCount, breaches: [...breaches],
      finalTailCollected: false }),
    dispose: () => clearInterval(timer),
  }
}

/** Opens one bounded inspector connection and correlates each evaluation response. */
async function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 0
  let closed = false
  socket.addEventListener('close', () => {
    closed = true
    for (const request of pending.values()) request.reject(new Error('Inspector disconnected'))
    pending.clear()
  })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data))
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error || message.result?.exceptionDetails) request.reject(new Error('Inspector evaluation failed'))
    else request.resolve(message.result?.result?.value)
  })
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Inspector connect timed out')), 1500)
      socket.addEventListener('open', () => { clearTimeout(deadline); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(deadline); reject(new Error('Inspector connect failed')) }, { once: true })
    })
  } catch (error) { socket.close(); throw error }
  return {
    get closed() { return closed },
    close: () => socket.close(),
    evaluate: (expression) => new Promise((resolve, reject) => {
      if (closed) { reject(new Error('Inspector disconnected')); return }
      const id = ++nextId
      const deadline = setTimeout(() => { pending.delete(id); reject(new Error('Inspector evaluation timed out')) }, 1500)
      pending.set(id, {
        resolve: (value) => { clearTimeout(deadline); resolve(value) },
        reject: (error) => { clearTimeout(deadline); reject(error) },
      })
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    }),
  }
}

/** Persists cumulative lower-bound observations, never a qualified pass. */
async function save() {
  const observedBreach = launches.some((launch) => launch.latestSnapshot?.maximumGapMs >= 200)
  const report = {
    evidenceKind: 'separate diagnostic companion; unchanged workload verdict remains separate',
    sourcePath, sourceSha256, port, startedAtUnixMs, updatedAtUnixMs: Date.now(), stopReason,
    verdict: observedBreach ? 'observed_main_loop_breach' : 'no_breach_observed_in_available_samples',
    qualifiedPass: false,
    limitation: 'Snapshots omit the final unserviced interval and any time before installation or after disconnection. All-small samples are only a diagnostic lower bound. Compare installation times with workload mission/recovery phases.',
    launches,
  }
  await mkdir(path.dirname(path.resolve(output)), { recursive: true })
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
}

await save()
try {
  while (!stopping && Date.now() - startedAtUnixMs < durationMs) {
    let target
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(750) })
      target = (await response.json()).find((entry) => entry.webSocketDebuggerUrl)
    } catch { /* No application is expected between launches. */ }
    if (!target) {
      const previous = launches.at(-1)
      if (previous && !previous.disconnectedTail) {
        previous.disconnectedTail = true
        previous.targetUnavailableAtUnixMs = Date.now()
        await save()
      }
      await delay(100)
      continue
    }
    let inspector
    let launch
    try {
      inspector = await connect(target.webSocketDebuggerUrl)
      const installationRequestedAtUnixMs = Date.now()
      const snapshot = await inspector.evaluate(`(() => {
        globalThis.__SARTRACKER_MAIN_LOOP_COMPANION__ ??= (${installProbe.toString()})();
        return globalThis.__SARTRACKER_MAIN_LOOP_COMPANION__.snapshot();
      })()`)
      if (!Number.isFinite(snapshot?.timeOriginMs)) throw new Error('Invalid timer installation')
      launch = launches.find((entry) => entry.targetId === target.id && entry.timeOriginMs === snapshot.timeOriginMs)
      if (!launch) {
        const previous = launches.at(-1)
        if (previous) previous.disconnectedTail = true
        launch = { targetId: target.id, timeOriginMs: snapshot.timeOriginMs,
          installationRequestedAtUnixMs, installationConfirmedAtUnixMs: Date.now(),
          installedAtMainWallMs: snapshot.installedAtMainWallMs,
          finalTailCollected: false, disconnectedTail: false, connectionCount: 0,
          snapshotCount: 0, discardedSnapshotCount: 0, snapshots: [], errors: [] }
        launches.push(launch)
      }
      launch.connectionCount += 1
      launch.latestSnapshot = snapshot
      launch.snapshotCount += 1
      launch.snapshots.push({ receivedAtUnixMs: Date.now(), ...snapshot })
      if (launch.snapshots.length > 600) { launch.snapshots.shift(); launch.discardedSnapshotCount += 1 }
      if (inspector.closed) launch.disconnectedTail = true
    } catch (error) {
      if (launch) {
        launch.disconnectedTail = true
        launch.errors.push({ atUnixMs: Date.now(), message: error.message })
        if (launch.errors.length > 16) launch.errors.shift()
      }
    } finally {
      if (launch) launch.connectionEndedAtUnixMs = Date.now()
      // Do not hold the debugger across application shutdown or between samples.
      // The unreferenced main timer remains independent of these connections.
      inspector?.close()
      await save()
    }
    if (!stopping) await delay(1000)
  }
} finally {
  await save()
}
