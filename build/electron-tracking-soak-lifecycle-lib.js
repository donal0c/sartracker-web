const ownedProcessStops = new WeakMap()

/** Requests the packaged Electron app's real quit path and proves normal exit. */
export async function requestGracefulElectronQuit(mainInspector, child, timeoutMs) {
  if (
    mainInspector === null ||
    typeof mainInspector?.evaluate !== 'function' ||
    child === null ||
    typeof child !== 'object'
  ) {
    throw createLifecycleFailure(
      'graceful_app_quit_failed',
      'Tracking soak could not request a graceful Electron quit.',
    )
  }

  let requestFailed = false
  try {
    await mainInspector.evaluate("require('electron').app.quit(); 'quit_requested'")
  } catch {
    requestFailed = true
  }
  const exited = await waitForProcessExit(child, timeoutMs)
  const evidence = processExitEvidence(child, false)
  if (
    !exited ||
    !evidence.exited ||
    evidence.exitKind !== 'code' ||
    child.exitCode !== 0
  ) {
    throw createLifecycleFailure(
      'graceful_app_quit_failed',
      requestFailed
        ? 'Tracking soak could not confirm the Electron quit request.'
        : 'Tracking soak Electron quit did not complete normally.',
    )
  }
  return {
    ...evidence,
    graceful: true,
  }
}

/** Starts a run-owned macOS sleep inhibitor tied to the harness process. */
export async function startTrackingSoakSleepGuard(input) {
  if (input?.platform !== 'darwin') return createInactiveSleepGuard()
  if (
    !Number.isSafeInteger(input?.parentPid) ||
    input.parentPid < 1 ||
    typeof input?.spawnProcess !== 'function' ||
    !Number.isSafeInteger(input?.startupTimeoutMs) ||
    input.startupTimeoutMs < 1
  ) {
    throw createLifecycleFailure(
      'host_sleep_guard_unavailable',
      'Tracking soak sleep guard input is invalid.',
    )
  }
  let child
  try {
    child = input.spawnProcess(
      '/usr/bin/caffeinate',
      ['-dimsu', '-w', String(input.parentPid)],
      { stdio: 'ignore' },
    )
  } catch {
    throw createLifecycleFailure(
      'host_sleep_guard_unavailable',
      'Tracking soak sleep guard could not start.',
    )
  }
  if (child === null || typeof child !== 'object') {
    throw createLifecycleFailure(
      'host_sleep_guard_unavailable',
      'Tracking soak sleep guard could not start.',
    )
  }

  let started = false
  let stopped = false
  let earlyExit = false
  let forced = false
  let stopPromise
  const markExit = () => {
    if (!stopped) earlyExit = true
  }
  child.on('exit', markExit)
  child.on('error', markExit)
  try {
    await waitForSpawn(child, input.startupTimeoutMs)
  } catch {
    await stopOwnedProcess(child, {
      termTimeoutMs: 1_000,
      killTimeoutMs: 1_000,
    })
    throw createLifecycleFailure(
      'host_sleep_guard_unavailable',
      'Tracking soak sleep guard could not start.',
    )
  }
  started = true
  if (isProcessExited(child) || earlyExit) {
    throw createLifecycleFailure(
      'host_sleep_guard_unavailable',
      'Tracking soak sleep guard exited during startup.',
    )
  }

  const snapshot = () => ({
    required: true,
    started,
    active: started && !stopped && !earlyExit && !isProcessExited(child),
    earlyExit,
    stopped,
    forced,
  })
  return {
    assertHealthy: () => {
      if (stopped || earlyExit || isProcessExited(child)) {
        throw createLifecycleFailure(
          'host_sleep_guard_unavailable',
          'Tracking soak sleep guard exited before completion.',
        )
      }
    },
    snapshot,
    stop: () => {
      stopPromise ??= (async () => {
        const failedBeforeStop = earlyExit || isProcessExited(child)
        stopped = true
        const result = await stopOwnedProcess(child, {
          termTimeoutMs: 1_000,
          killTimeoutMs: 1_000,
        })
        forced = result.forced
        if (failedBeforeStop) {
          throw createLifecycleFailure(
            'host_sleep_guard_unavailable',
            'Tracking soak sleep guard exited before completion.',
          )
        }
        return snapshot()
      })()
      return stopPromise
    },
  }
}

/** Stops one owned child exactly once with signal-aware bounded escalation. */
export function stopOwnedProcess(child, options) {
  const existing = ownedProcessStops.get(child)
  if (existing !== undefined) return existing
  const completion = (async () => {
    if (isProcessExited(child)) return processExitEvidence(child, false)
    child.kill('SIGTERM')
    if (await waitForProcessExit(child, options?.termTimeoutMs)) {
      const evidence = processExitEvidence(child, false)
      if (evidence.exited) return evidence
    }
    if (!isProcessExited(child)) child.kill('SIGKILL')
    await waitForProcessExit(child, options?.killTimeoutMs)
    const evidence = processExitEvidence(child, true)
    if (!evidence.exited) {
      throw createLifecycleFailure(
        'owned_process_cleanup_failed',
        'Tracking soak owned process did not exit after forced cleanup.',
      )
    }
    return evidence
  })()
  ownedProcessStops.set(child, completion)
  return completion
}

/** Runs one cleanup operation inside a hard deadline and never throws. */
export async function runCleanupStep(operation, timeoutMs) {
  if (typeof operation !== 'function') return false
  const boundedTimeout = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : 1
  try {
    const timedOut = Symbol('cleanup_timeout')
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => setTimeout(() => resolve(timedOut), boundedTimeout)),
    ])
    return result !== timedOut
  } catch {
    return false
  }
}

/** Waits for the child spawn event without retaining raw spawn errors. */
function waitForSpawn(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(reject), timeoutMs)
    const onSpawn = () => finish(resolve)
    const onFailure = () => finish(reject)
    const finish = (settle) => {
      clearTimeout(timeout)
      child.off('spawn', onSpawn)
      child.off('error', onFailure)
      child.off('exit', onFailure)
      settle()
    }
    child.once('spawn', onSpawn)
    child.once('error', onFailure)
    child.once('exit', onFailure)
  })
}

/** Resolves true on code or signal exit, false at the bounded deadline. */
function waitForProcessExit(child, timeoutMs) {
  if (isProcessExited(child)) return Promise.resolve(true)
  const boundedTimeout = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : 1
  return new Promise((resolve) => {
    const timeout = setTimeout(() => finish(false), boundedTimeout)
    const onExit = () => finish(true)
    const finish = (exited) => {
      clearTimeout(timeout)
      child.off('exit', onExit)
      resolve(exited || isProcessExited(child))
    }
    child.once('exit', onExit)
  })
}

/** Returns whether Node has observed either normal or signal termination. */
function isProcessExited(child) {
  return child?.exitCode !== null || child?.signalCode !== null
}

/** Builds bounded process-exit evidence. */
function processExitEvidence(child, forced) {
  return {
    exited: isProcessExited(child),
    exitKind: child?.exitCode !== null
      ? 'code'
      : child?.signalCode !== null
        ? 'signal'
        : 'unknown',
    forced,
  }
}

/** Creates the non-Darwin no-op guard. */
function createInactiveSleepGuard() {
  return {
    assertHealthy: () => undefined,
    snapshot: () => ({
      required: false,
      started: false,
      active: false,
      earlyExit: false,
      stopped: true,
      forced: false,
    }),
    stop: async () => undefined,
  }
}

/** Creates a static lifecycle failure without a raw child-process payload. */
function createLifecycleFailure(failureClass, message) {
  const error = new Error(message)
  error.trackingSoakLifecycleFailure = { failureClass }
  return error
}
