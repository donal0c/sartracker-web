/**
 * Installs a self-contained timer inside packaged Electron main through its
 * inspector. Timer execution is independent of inspector request handling.
 * The final partial interval is retained so shutdown cannot hide a pending gap.
 */
export function installMainEventLoopProbe(root = globalThis) {
  const monitor = createEventLoopMonitor(root)
  return Object.freeze({
    stop: monitor.stop,
    startPhase,
    measurePhase,
  })

  /** Starts an independently sampled operation interval with host timing. */
  function startPhase(name) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('Main phase timing requires a non-empty phase name.')
    }
    const processApi = root.process
    const cpuStarted = typeof processApi?.cpuUsage === 'function'
      ? processApi.cpuUsage()
      : null
    const resourceStarted = typeof processApi?.resourceUsage === 'function'
      ? processApi.resourceUsage()
      : null
    const schedulerStarted = readThreadSchedulerSnapshot(root)
    const startedAtMs = root.performance.now()
    const phaseMonitor = createEventLoopMonitor(root)
    let evidence = null

    return Object.freeze({ finish })

    /** Finalizes one phase exactly once and returns independent timing evidence. */
    function finish() {
      if (evidence !== null) return evidence
      const mainLoop = phaseMonitor.stop()
      const stoppedAtMs = root.performance.now()
      const cpuUsage = cpuStarted === null
        ? null
        : processApi.cpuUsage(cpuStarted)
      const resourceUsage = resourceStarted === null
        ? null
        : processApi.resourceUsage()
      const schedulerStopped = readThreadSchedulerSnapshot(root)
      evidence = Object.freeze({
        name,
        wallDurationMs: Math.max(0, stoppedAtMs - startedAtMs),
        processCpuMs: cpuUsage === null
          ? null
          : Object.freeze({
            user: cpuUsage.user / 1_000,
            system: cpuUsage.system / 1_000,
            total: (cpuUsage.user + cpuUsage.system) / 1_000,
          }),
        scheduler: makeSchedulerDelta(schedulerStarted, schedulerStopped, resourceStarted, resourceUsage),
        mainLoop,
      })
      return evidence
    }
  }

  /** Measures an operation, supporting both synchronous and asynchronous work. */
  function measurePhase(name, operation) {
    if (typeof operation !== 'function') {
      throw new Error('Main phase timing requires an operation.')
    }
    const phase = startPhase(name)
    let value
    try {
      value = operation()
    } catch (error) {
      phase.finish()
      throw error
    }
    if (value !== null && typeof value === 'object' && typeof value.then === 'function') {
      return Promise.resolve(value).then(
        (result) => ({ value: result, evidence: phase.finish() }),
        (error) => {
          phase.finish()
          throw error
        },
      )
    }
    return { value, evidence: phase.finish() }
  }

  /** Starts an independently sampled timer and retains its final partial interval. */
  function createEventLoopMonitor(monitorRoot) {
    const monitorStartedAtMs = monitorRoot.performance.now()
    let previous = monitorStartedAtMs
    let samples = 0
    let maximumGapMs = 0
    let evidence = null

    /** Samples elapsed main-loop time independently of controller requests. */
    function sample() {
      const current = monitorRoot.performance.now()
      maximumGapMs = Math.max(maximumGapMs, current - previous)
      previous = current
    }

    const timer = monitorRoot.setInterval(() => { samples += 1; sample() }, 50)
    return {
      /** Stops once and includes the final unserviced interval in the maximum. */
      stop() {
        if (evidence === null) {
          monitorRoot.clearInterval(timer)
          sample()
          evidence = {
            clock: 'main-performance-now', timeOriginMs: monitorRoot.performance.timeOrigin,
            intervalMs: 50, startedAtMs: monitorStartedAtMs, stoppedAtMs: previous,
            samples, maximumGapMs,
          }
        }
        return evidence
      },
    }
  }

  /** Reads the current Linux JavaScript thread's scheduler accounting when available. */
  function readThreadSchedulerSnapshot(snapshotRoot) {
    const snapshotProcess = snapshotRoot.process
    if (snapshotProcess?.platform !== 'linux') return Object.freeze({ status: 'not_linux' })
    try {
      const fileSystem = snapshotProcess.getBuiltinModule?.('fs')
      if (typeof fileSystem?.readFileSync !== 'function') {
        return Object.freeze({ status: 'unavailable', code: 'FS_MODULE_UNAVAILABLE' })
      }
      const schedulerAccounting = fileSystem.readFileSync(
        '/proc/sys/kernel/sched_schedstats',
        'utf8',
      ).trim()
      if (schedulerAccounting !== '1') {
        return Object.freeze({
          status: 'unavailable',
          code: schedulerAccounting === '0'
            ? 'SCHEDSTATS_DISABLED'
            : 'SCHEDSTATS_STATE_INVALID',
        })
      }
      const values = fileSystem.readFileSync('/proc/thread-self/schedstat', 'utf8')
        .trim()
        .split(/\s+/u)
        .slice(0, 3)
        .map(Number)
      if (values.length !== 3 || values.some((value) => !Number.isFinite(value) || value < 0)) {
        return Object.freeze({ status: 'unavailable', code: 'SCHEDSTAT_FORMAT_INVALID' })
      }
      return Object.freeze({
        status: 'measured',
        threadRuntimeNs: values[0],
        threadRunQueueWaitNs: values[1],
        threadTimeSlices: values[2],
      })
    } catch (error) {
      return Object.freeze({
        status: 'unavailable',
        code: typeof error?.code === 'string' ? error.code : 'SCHEDSTAT_READ_FAILED',
      })
    }
  }

  /** Combines main-thread scheduler and process context-switch snapshots. */
  function makeSchedulerDelta(start, end, resourceBefore, resourceAfter) {
    const contextSwitchDelta = (key) => {
      const before = resourceBefore?.[key]
      const after = resourceAfter?.[key]
      return Number.isFinite(before) && Number.isFinite(after)
        ? Math.max(0, after - before)
        : null
    }
    if (start.status !== 'measured' || end.status !== 'measured') {
      return Object.freeze({
        status: start.status !== 'measured' ? start.status : end.status,
        code: end.code ?? start.code ?? null,
        processVoluntaryContextSwitches: contextSwitchDelta('voluntaryContextSwitches'),
        processInvoluntaryContextSwitches: contextSwitchDelta('involuntaryContextSwitches'),
      })
    }
    return Object.freeze({
      status: 'measured',
      threadRuntimeMs: (end.threadRuntimeNs - start.threadRuntimeNs) / 1_000_000,
      threadRunQueueWaitMs: (end.threadRunQueueWaitNs - start.threadRunQueueWaitNs) / 1_000_000,
      threadTimeSlices: Math.max(0, end.threadTimeSlices - start.threadTimeSlices),
      processVoluntaryContextSwitches: contextSwitchDelta('voluntaryContextSwitches'),
      processInvoluntaryContextSwitches: contextSwitchDelta('involuntaryContextSwitches'),
    })
  }
}

/** Collects through a main-loop turn, failing within a bounded controller deadline. */
export async function collectMainEventLoopEvidence(mainInspector, timeoutMs = 5_000) {
  let deadline
  try {
    const result = await Promise.race([
      mainInspector.evaluate('new Promise((resolve) => setTimeout(() => resolve(globalThis.__SARTRACKER_MAIN_EVENT_LOOP_PROBE__.stop()), 0))', { awaitPromise: true }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Main timer collection timed out.')), timeoutMs) }),
    ])
    return result?.result?.value ?? null
  } catch {
    return { error: 'main_timer_collection_failed' }
  } finally {
    clearTimeout(deadline)
  }
}

/** Rejects missing, invalid or >=200 ms main timer evidence on any launch. */
export function validateMainEventLoopEvidence(launches, expectedLaunches) {
  if (!Array.isArray(launches) || launches.length !== expectedLaunches) {
    return ['Independent main-loop evidence is missing for one or more launches.']
  }
  const failures = []
  for (const [index, evidence] of launches.entries()) {
    if (!evidence || evidence.intervalMs !== 50
      || !Number.isSafeInteger(evidence.samples) || evidence.samples < 1
      || !Number.isFinite(evidence.startedAtMs) || !Number.isFinite(evidence.stoppedAtMs)
      || evidence.stoppedAtMs <= evidence.startedAtMs
      || !Number.isFinite(evidence.maximumGapMs) || evidence.maximumGapMs < 0) {
      failures.push(`Independent main-loop evidence for launch ${index + 1} is missing or invalid.`)
    } else if (evidence.maximumGapMs >= 200) {
      failures.push(`Independent main-loop maximum ${evidence.maximumGapMs}ms on launch ${index + 1} reached the 200ms stall threshold.`)
    }
  }
  return failures
}

/** Validates phase identity, timing, scheduler evidence and the unchanged 200ms gate. */
export function validateMainPhaseEvidence(phases, expectedNames, hostPlatform) {
  if (!Array.isArray(phases) || !Array.isArray(expectedNames)
      || phases.length !== expectedNames.length) {
    return ['Per-operation main timing evidence is missing or duplicated.']
  }
  const failures = []
  for (const [index, phase] of phases.entries()) {
    const label = expectedNames[index]
    if (!phase || phase.name !== label) {
      failures.push(`Per-operation timing phase ${index + 1} does not match ${label}.`)
      continue
    }
    if (!Number.isFinite(phase.wallDurationMs) || phase.wallDurationMs < 0) {
      failures.push(`${label} wall duration is missing or invalid.`)
    }
    const cpu = phase.processCpuMs
    if (!cpu || !['user', 'system', 'total'].every((key) =>
      Number.isFinite(cpu[key]) && cpu[key] >= 0,
    )) {
      failures.push(`${label} process CPU timing is missing or invalid.`)
    }
    const scheduler = phase.scheduler
    if (!scheduler) {
      failures.push(`${label} scheduler timing status is missing.`)
    } else if (scheduler.status === 'measured') {
      if (!['threadRuntimeMs', 'threadRunQueueWaitMs', 'threadTimeSlices']
        .every((key) => Number.isFinite(scheduler[key]) && scheduler[key] >= 0)) {
        failures.push(`${label} Linux scheduler deltas are invalid.`)
      }
      if (!['processVoluntaryContextSwitches', 'processInvoluntaryContextSwitches']
        .every((key) => scheduler[key] === null
          || (Number.isSafeInteger(scheduler[key]) && scheduler[key] >= 0))) {
        failures.push(`${label} context-switch deltas are invalid.`)
      }
    } else if (hostPlatform === 'linux'
        && (scheduler.status !== 'unavailable'
          || typeof scheduler.code !== 'string'
          || scheduler.code.trim() === '')) {
      // Scheduler counters refine attribution; the independent 200 ms main-loop
      // gate remains authoritative when the kernel does not expose them.
      failures.push(`${label} Linux scheduler timing is neither measured nor explicitly unavailable.`)
    } else if (hostPlatform !== 'linux' && scheduler.status !== 'not_linux') {
      failures.push(`${label} non-Linux scheduler status is inconsistent with the host.`)
    }
    const mainLoop = phase.mainLoop
    if (!mainLoop || mainLoop.intervalMs !== 50
        || !Number.isSafeInteger(mainLoop.samples) || mainLoop.samples < 0
        || !Number.isFinite(mainLoop.startedAtMs) || !Number.isFinite(mainLoop.stoppedAtMs)
        || mainLoop.stoppedAtMs <= mainLoop.startedAtMs
        || !Number.isFinite(mainLoop.maximumGapMs) || mainLoop.maximumGapMs < 0) {
      failures.push(`${label} main-loop phase evidence is invalid.`)
    } else if (mainLoop.maximumGapMs >= 200) {
      failures.push(`${label} main-loop phase reached the unchanged 200ms stall threshold.`)
    }
  }
  return failures
}
