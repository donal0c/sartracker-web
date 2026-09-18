import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type Completion = {
  readonly workerThreadId: number
  readonly checkpoint: {
    readonly busy: number | null
    readonly log: number | null
    readonly checkpointed: number | null
    readonly completed: boolean
    readonly warning?: string
    readonly walSidecarBytes: number
  }
}
type Outcome = { readonly value: Completion } | { readonly error: unknown }

/** Observes the caller's loop until production reports completion and physical exit.
 * The deadline bounds observation, not OS termination of blocked native code;
 * the mission store remains responsible for its production worker's teardown.
 */
export async function observeLegacyRecoveryCompletion(completion: Promise<unknown>, timeoutMs = 50_000) {
  let previous = performance.now()
  let maximumHeartbeatGapMs = 0
  /** Measures only elapsed time; no SQLite, CPU or GC instrumentation runs here. */
  function sample() {
    const now = performance.now()
    maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, now - previous)
    previous = now
  }
  const heartbeat = setInterval(sample, 10)
  let deadline: ReturnType<typeof setTimeout> | undefined
  let outcome: Outcome
  try {
    const value = await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`Legacy recovery completion timed out after ${timeoutMs}ms.`)), timeoutMs)
      }),
    ])
    if (typeof value !== 'object' || value === null || !('workerThreadId' in value)
      || !Number.isSafeInteger(value.workerThreadId) || Number(value.workerThreadId) <= 0
      || ('stopped' in value && value.stopped !== undefined)) {
      throw new Error('Legacy recovery did not report a valid worker completion.')
    }
    const candidate = value as Record<string, unknown>
    if (typeof candidate.checkpoint !== 'object' || candidate.checkpoint === null) {
      throw new Error('Legacy recovery did not report a WAL checkpoint receipt.')
    }
    const checkpoint = candidate.checkpoint as Record<string, unknown>
    const checkpointError = validateCheckpoint(checkpoint)
    if (checkpointError !== null) throw new Error(checkpointError)
    outcome = {
      value: {
        workerThreadId: Number(value.workerThreadId),
        checkpoint: checkpoint as Completion['checkpoint'],
      },
    }
  } catch (error) {
    outcome = { error }
  } finally {
    clearInterval(heartbeat)
    // A completion microtask can run before the overdue interval callback.
    // Include that final unserviced interval in the same strict maximum.
    sample()
    clearTimeout(deadline)
  }
  return { outcome, maximumHeartbeatGapMs }
}

/** Validates the production completion contract without coercing malformed values into zero. */
function validateCheckpoint(checkpoint: Record<string, unknown>): string | null {
  const { validateLegacyEvidenceBackfillCheckpoint } = require('../../electron/legacy-evidence-backfill-checkpoint.cjs') as {
    validateLegacyEvidenceBackfillCheckpoint(
      value: unknown,
      walSidecarBytes: unknown,
      options?: { readonly requireComplete?: boolean },
    ): string | null
  }
  return validateLegacyEvidenceBackfillCheckpoint(
    checkpoint,
    checkpoint.walSidecarBytes,
    { requireComplete: false },
  )
}
