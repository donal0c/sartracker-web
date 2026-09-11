#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installSQLiteCausalProbe } from './sqlite-causal-probe.mjs'

const args = Object.fromEntries(Array.from({ length: (process.argv.length - 2) / 2 }, (_, index) =>
  [process.argv[index * 2 + 2], process.argv[index * 2 + 3]]))
const port = Number(args['--port'])
const durationMs = Number(args['--duration-ms'] ?? 600000)
const output = args['--output'] ?? args['--outputpath']
const profileMs = Number(args['--profile-ms'] ?? 55000)
if (!Number.isInteger(port) || port < 1 || port > 65535 || !output
  || !Number.isFinite(durationMs) || durationMs < 1 || durationMs > 21600000) {
  throw new Error('Usage: --port PORT --output FILE [--duration-ms 600000]')
}
if (!Number.isFinite(profileMs) || profileMs < 100 || profileMs > 55000) throw new Error('Profile window must be 100..55000 ms')
const sourcePath = fileURLToPath(import.meta.url)
const sourceSha256 = createHash('sha256').update(await readFile(sourcePath)).digest('hex')
const sqliteProbeSha256 = createHash('sha256').update(await readFile(new URL('./sqlite-causal-probe.mjs', import.meta.url))).digest('hex')
const startedAtUnixMs = Date.now()
const launches = []
const profileTasks = new Set()
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
  let shutdownRequested = false
  socket.addEventListener('close', () => {
    closed = true
    for (const request of pending.values()) request.reject(new Error('Inspector disconnected'))
    pending.clear()
  })
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data))
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.args?.some(
      (arg) => arg.value === '__SAR_SQL_PROFILE_SHUTDOWN__')) shutdownRequested = true
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error || message.result?.exceptionDetails) request.reject(new Error('Inspector evaluation failed'))
    else request.resolve(message.result)
  })
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Inspector connect timed out')), 1500)
      socket.addEventListener('open', () => { clearTimeout(deadline); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(deadline); reject(new Error('Inspector connect failed')) }, { once: true })
    })
  } catch (error) { socket.close(); throw error }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
      if (closed) { reject(new Error('Inspector disconnected')); return }
      const id = ++nextId
      const deadline = setTimeout(() => { pending.delete(id); reject(new Error('Inspector evaluation timed out')) }, 1500)
      pending.set(id, {
        resolve: (value) => { clearTimeout(deadline); resolve(value) },
        reject: (error) => { clearTimeout(deadline); reject(error) },
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  return {
    get closed() { return closed },
    get shutdownRequested() { return shutdownRequested },
    close: () => socket.close(),
    send,
    evaluate: async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value,
  }
}

/** Profiles one bounded launch window and always relinquishes the debugger on shutdown. */
async function profileLaunch(target, launch) {
  let inspector
  let profilerStarted = false
  const prefix = path.join(path.dirname(path.resolve(output)), `main-launch-${launch.number}`)
  launch.profile = { complete: false, cpuProfileComplete: false, sqliteSnapshotComplete: false,
    requestedWindowMs: profileMs, startedAtUnixMs: Date.now(),
    endReason: 'not_started', sqliteProbeSha256, cpuProfilePath: null, sqlitePath: `${prefix}-sqlite.json` }
  try {
    inspector = await connect(target.webSocketDebuggerUrl)
    await inspector.send('Runtime.enable')
    await inspector.evaluate(`(() => {
      if (globalThis.__SAR_SQL_PROFILE_SHUTDOWN_HOOK__) return;
      const notify = () => console.log('__SAR_SQL_PROFILE_SHUTDOWN__');
      let app;
      try {
        const require = process.getBuiltinModule('module').createRequire(process.env.SAR_SQLITE_DIAGNOSTIC_PACKAGE ?? (process.resourcesPath + '/app.asar/package.json'));
        app = require('electron').app;
        app?.once('before-quit', notify);
      } catch {}
      process.once('exit', notify);
      globalThis.__SAR_SQL_PROFILE_SHUTDOWN_HOOK__ = () => {
        app?.removeListener('before-quit', notify); process.removeListener('exit', notify);
        delete globalThis.__SAR_SQL_PROFILE_SHUTDOWN_HOOK__;
      };
    })()`)
    try {
      launch.profile.sqliteInstallation = await inspector.evaluate(`(${installSQLiteCausalProbe.toString()})(${profileMs})`)
    } catch (error) { launch.profile.sqliteInstallationError = error.message }
    launch.profile.anchorBefore = await inspector.evaluate('({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin, wallMs: Date.now() })')
    await inspector.send('Profiler.enable')
    await inspector.send('Profiler.setSamplingInterval', { interval: 1000 })
    await inspector.send('Profiler.start')
    profilerStarted = true
    launch.profile.anchorAfter = await inspector.evaluate('({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin, wallMs: Date.now() })')
    const deadline = Date.now() + profileMs
    let nextSnapshot = 0
    let afterTransactionSequence = 0
    let afterReadSequence = 0
    let retainedTransactions = []
    let retainedSlowReads = []
    while (!stopping && !inspector.closed && !inspector.shutdownRequested && Date.now() < deadline) {
      if (Date.now() >= nextSnapshot) {
        const sqlite = await inspector.evaluate(`globalThis.__SARTRACKER_SQLITE_CAUSAL_PROBE__?.snapshot(${afterTransactionSequence}, ${afterReadSequence})`)
        if (sqlite) {
          retainedTransactions = [...retainedTransactions, ...sqlite.transactions].slice(-4096)
          retainedSlowReads = [...retainedSlowReads, ...sqlite.slowReads].slice(-1024)
          afterTransactionSequence = sqlite.completedTransactionCount
          afterReadSequence = sqlite.slowReadCount
          await writeFile(`${prefix}-sqlite.json`, `${JSON.stringify({ diagnosticOnly: true, complete: false,
            collection: 'incremental main snapshots every two seconds; bounded controller accumulation',
            ...sqlite, transactions: retainedTransactions, slowReads: retainedSlowReads }, null, 2)}\n`)
        }
        nextSnapshot = Date.now() + 2000
      }
      await delay(100)
    }
    launch.profile.endReason = inspector.closed ? 'target_disconnected' : inspector.shutdownRequested
      ? 'application_shutdown' : stopping ? 'companion_stopped' : 'window_complete'
    if (!inspector.closed) {
      const result = await inspector.send('Profiler.stop')
      profilerStarted = false
      await writeFile(`${prefix}.cpuprofile`, JSON.stringify(result.profile))
      launch.profile.cpuProfilePath = `${prefix}.cpuprofile`
      launch.profile.cpuProfileComplete = true
      launch.profile.finalSqliteCollectionStartedAtUnixMs = Date.now()
      const sqlite = await inspector.evaluate('globalThis.__SARTRACKER_SQLITE_CAUSAL_PROBE__?.stop()')
      launch.profile.finalSqliteCollectionEndedAtUnixMs = Date.now()
      if (sqlite) {
        await writeFile(`${prefix}-sqlite.json`, `${JSON.stringify({ diagnosticOnly: true, complete: true, ...sqlite }, null, 2)}\n`)
        launch.profile.sqliteSnapshotComplete = true
        launch.profile.complete = true
      }
    }
  } catch (error) {
    launch.profile.error = error.message
    launch.profile.endReason = inspector?.closed ? 'target_disconnected'
      : inspector?.shutdownRequested ? 'application_shutdown' : 'collection_failed'
  } finally {
    if (inspector && !inspector.closed) {
      if (profilerStarted) await inspector.send('Profiler.stop').catch(() => undefined)
      await inspector.evaluate('globalThis.__SARTRACKER_SQLITE_CAUSAL_PROBE__?.stop(); globalThis.__SAR_SQL_PROFILE_SHUTDOWN_HOOK__?.(); true').catch(() => undefined)
    }
    inspector?.close()
    launch.profile.endedAtUnixMs = Date.now()
    await writeFile(`${prefix}-profile-anchor.json`, `${JSON.stringify(launch.profile, null, 2)}\n`)
  }
}

/** Persists cumulative lower-bound observations, never a qualified pass. */
async function save() {
  const observedBreach = launches.some((launch) => launch.latestSnapshot?.maximumGapMs >= 200)
  const report = {
    evidenceKind: 'separate diagnostic companion; unchanged workload verdict remains separate',
    sourcePath, sourceSha256, sqliteProbeSha256, profileMs, port, startedAtUnixMs, updatedAtUnixMs: Date.now(), stopReason,
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
        launch = { number: launches.length + 1, targetId: target.id, timeOriginMs: snapshot.timeOriginMs,
          installationRequestedAtUnixMs, installationConfirmedAtUnixMs: Date.now(),
          installedAtMainWallMs: snapshot.installedAtMainWallMs,
          finalTailCollected: false, disconnectedTail: false, connectionCount: 0,
          snapshotCount: 0, discardedSnapshotCount: 0, snapshots: [], errors: [] }
        launches.push(launch)
        const task = profileLaunch(target, launch)
        profileTasks.add(task)
        void task.then(() => profileTasks.delete(task), () => profileTasks.delete(task))
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
  stopping = true
  await Promise.allSettled([...profileTasks])
  await save()
}
