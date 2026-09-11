/**
 * Installs a self-contained timer inside packaged Electron main through its
 * inspector. Timer execution is independent of inspector request handling.
 * The final partial interval is retained so shutdown cannot hide a pending gap.
 */
export function installMainEventLoopProbe(root = globalThis) {
  const startedAtMs = root.performance.now()
  let previous = startedAtMs
  let samples = 0
  let maximumGapMs = 0
  let evidence = null

  /** Samples elapsed main-loop time independently of controller requests. */
  function sample() {
    const current = root.performance.now()
    maximumGapMs = Math.max(maximumGapMs, current - previous)
    previous = current
  }

  const timer = root.setInterval(() => { samples += 1; sample() }, 50)
  return {
    /** Stops once and includes the final unserviced interval in the maximum. */
    stop() {
      if (evidence === null) {
        root.clearInterval(timer)
        sample()
        evidence = {
          clock: 'main-performance-now', timeOriginMs: root.performance.timeOrigin,
          intervalMs: 50, startedAtMs, stoppedAtMs: previous, samples, maximumGapMs,
        }
      }
      return evidence
    },
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
