/**
 * Profile summaries for the tracking soak [DON-313, DON-324].
 *
 * A main-process CPU profile over the startup catch-up names the synchronous
 * work behind main-thread stalls; a renderer sampling heap profile over a
 * checkpoint drain names the functions that allocate. Heap snapshots were the
 * earlier plan, but they show only retained objects, and the box soak (2 Oct
 * 2026) showed the growth is allocation churn over a small retained floor.
 * Summaries keep file basenames only, never local paths.
 */

const NOT_FUNCTIONS = new Set(['(root)', '(idle)'])

/**
 * Reduces a script URL to its file name (no directories, query or scheme path).
 *
 * @param {string} url
 * @returns {string}
 */
function fileOf(url) {
  const withoutQuery = String(url ?? '').split(/[?#]/u)[0]
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1)
}

/** Keys a call frame by function, file and 1-based line. */
function frameKey(callFrame) {
  const functionName = callFrame.functionName === '' ? '(anonymous)' : callFrame.functionName
  return { functionName, file: fileOf(callFrame.url), line: (callFrame.lineNumber ?? 0) + 1 }
}

/** Rounds to one decimal place. */
const tenth = (value) => Math.round(value * 10) / 10
/** Rounds a share to three decimal places. */
const shareOf = (part, whole) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 1000)

/**
 * Ranks the functions of a CDP `Profiler.Profile` by self time. Each sample is
 * credited with the time delta recorded for it.
 *
 * @param {{nodes: {id: number, callFrame: object}[], samples?: number[], timeDeltas?: number[]}} profile
 * @param {{top?: number}} [options]
 * @returns {{sampledMs: number, idleMs: number, top: {functionName: string, file: string, line: number, selfMs: number, share: number}[]}}
 */
export function summarizeCpuProfile(profile, { top = 25 } = {}) {
  const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]))
  const selfMicros = new Map()
  let sampledMicros = 0
  let idleMicros = 0
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  for (let index = 0; index < samples.length; index += 1) {
    const micros = Math.max(0, deltas[index] ?? 0)
    sampledMicros += micros
    const callFrame = frames.get(samples[index])
    if (callFrame === undefined) continue
    if (callFrame.functionName === '(idle)') {
      idleMicros += micros
      continue
    }
    if (NOT_FUNCTIONS.has(callFrame.functionName)) continue
    const key = frameKey(callFrame)
    const id = `${key.functionName}\u0000${key.file}\u0000${key.line}`
    const entry = selfMicros.get(id) ?? { ...key, micros: 0 }
    entry.micros += micros
    selfMicros.set(id, entry)
  }
  const sampledMs = tenth(sampledMicros / 1000)
  return {
    sampledMs,
    idleMs: tenth(idleMicros / 1000),
    top: [...selfMicros.values()]
      .sort((left, right) => right.micros - left.micros)
      .slice(0, top)
      .map(({ micros, ...key }) => ({ ...key, selfMs: tenth(micros / 1000), share: shareOf(micros, sampledMicros) })),
  }
}

/**
 * Ranks the allocating functions of a CDP `HeapProfiler.SamplingHeapProfile`
 * by sampled self size.
 *
 * @param {{head: {callFrame: object, selfSize: number, children?: object[]}}} profile
 * @param {{top?: number}} [options]
 * @returns {{sampledBytes: number, top: {functionName: string, file: string, line: number, selfBytes: number, share: number}[]}}
 */
export function summarizeSamplingHeapProfile(profile, { top = 25 } = {}) {
  const selfBytes = new Map()
  let sampledBytes = 0
  const pending = [profile.head]
  while (pending.length > 0) {
    const node = pending.pop()
    if (node === undefined || node === null) continue
    pending.push(...(node.children ?? []))
    const bytes = Math.max(0, node.selfSize ?? 0)
    if (bytes === 0 || NOT_FUNCTIONS.has(node.callFrame?.functionName)) continue
    sampledBytes += bytes
    const key = frameKey(node.callFrame)
    const id = `${key.functionName}\u0000${key.file}\u0000${key.line}`
    const entry = selfBytes.get(id) ?? { ...key, bytes: 0 }
    entry.bytes += bytes
    selfBytes.set(id, entry)
  }
  return {
    sampledBytes,
    top: [...selfBytes.values()]
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, top)
      .map(({ bytes, ...key }) => ({ ...key, selfBytes: bytes, share: shareOf(bytes, sampledBytes) })),
  }
}

/**
 * Starts a CDP profiler, waits `durationMs` (or until `signal` aborts), stops
 * it and returns the profile. A failure is reported, never thrown: profiling
 * is diagnostic and must not fail the soak.
 *
 * @param {{send: (method: string, params?: object) => Promise<any>, start: (string | [string, object])[],
 *   stop: string, durationMs: number, signal?: AbortSignal}} options
 * @returns {Promise<{ok: true, profile: object} | {ok: false, reason: string}>}
 */
export async function runTimedProfile({ send, start, stop, durationMs, signal }) {
  let startAttempted = false
  try {
    for (const step of start) {
      startAttempted = true
      const [method, params] = Array.isArray(step) ? step : [step, undefined]
      await send(method, params)
    }
    await new Promise((resolve) => {
      if (signal?.aborted) { resolve(); return }
      const timer = setTimeout(resolve, durationMs)
      // A diagnostic wait must never keep the soak process alive on its own.
      timer.unref?.()
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    const result = await send(stop)
    return { ok: true, profile: result?.profile }
  } catch (error) {
    // A start that failed here (often a timeout) may still have taken effect;
    // stop it so no profiler keeps running through the measurements.
    if (startAttempted) await Promise.resolve().then(() => send(stop)).catch(() => undefined)
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Rejects when `promise` has not settled within `timeoutMs`, so a profiler
 * command against an unresponsive target can never hold the soak. A late
 * failure of `promise` is already handled by the race.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} label
 * @returns {Promise<T>}
 */
export function withDeadline(promise, timeoutMs, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs)
    timer.unref?.()
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}
