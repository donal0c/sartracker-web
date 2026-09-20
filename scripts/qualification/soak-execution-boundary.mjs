import path from 'node:path'
import { runOwnedProcess } from './owned-process.mjs'

const MAX_WORKER_OUTPUT_BYTES = 8 * 1024 * 1024
const WORKER_COMMAND_PADDING_MS = 30 * 1_000

/** Explicit preparation and retention allowance around the fixed producer budget. */
export const SOAK_WORKER_PREPARATION_RETENTION_ALLOWANCE_MS = 15 * 60 * 1_000

/** Schema transferred once from the parent controller to the owned worker. */
export const SOAK_WORKER_INPUT_SCHEMA = 'sartracker-soak-worker-input-v1'

/** Schema returned once by the owned worker to the parent controller. */
export const SOAK_WORKER_RESULT_SCHEMA = 'sartracker-soak-worker-result-v1'

const WORKER_FAILURE_CODES = new Set([
  'WORKER_INPUT_INVALID',
  'WORKER_INPUT_TOO_LARGE',
  'WORKER_EXECUTION_FAILED',
])

/** Compute the fixed outer deadline for one reviewed variant. */
export function soakWorkerTimeoutMs(variant) {
  if (variant === null || typeof variant !== 'object' || !Number.isSafeInteger(variant.timeoutMs) || variant.timeoutMs < 1) {
    throw new Error('Soak worker timeout requires a reviewed fixed variant.')
  }
  return variant.timeoutMs + WORKER_COMMAND_PADDING_MS + SOAK_WORKER_PREPARATION_RETENTION_ALLOWANCE_MS
}

/** Run the complete soak lifecycle inside one bounded owned Node worker. */
export async function runSoakExecutionWorker({ config, projectRoot, variant }) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) throw new Error('Soak worker project root must be absolute.')
  const input = Buffer.from(`${JSON.stringify({ schema: SOAK_WORKER_INPUT_SCHEMA, config })}\n`, 'utf8')
  const execution = await runOwnedProcess({
    file: process.execPath,
    args: [path.join(projectRoot, 'scripts', 'qualification', 'soak-execution-worker.mjs')],
    cwd: projectRoot,
    env: process.env,
    stdinBytes: input,
    timeoutMs: soakWorkerTimeoutMs(variant),
    maxOutputBytes: MAX_WORKER_OUTPUT_BYTES,
    cleanupTimeoutMs: 15_000,
    terminationGraceMs: 10_000,
  })
  return Object.freeze({ execution, worker: parseWorkerResult(execution.stdout) })
}

/** Parse exactly one bounded worker record without retaining arbitrary failures. */
function parseWorkerResult(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '' || stdout.trim().split(/\r?\n/u).length !== 1) {
    return { status: 'invalid', failureCode: 'WORKER_OUTPUT_INVALID', receipt: null }
  }
  let result
  try { result = JSON.parse(stdout.trim()) } catch { return { status: 'invalid', failureCode: 'WORKER_OUTPUT_INVALID', receipt: null } }
  if (result?.schema !== SOAK_WORKER_RESULT_SCHEMA || !['completed', 'failed'].includes(result.status)) {
    return { status: 'invalid', failureCode: 'WORKER_OUTPUT_INVALID', receipt: null }
  }
  if (result.status === 'completed' && result.receipt !== null && typeof result.receipt === 'object' && !Array.isArray(result.receipt)) {
    return { status: 'completed', failureCode: null, receipt: result.receipt }
  }
  if (result.status === 'failed' && WORKER_FAILURE_CODES.has(result.failureCode)) {
    return { status: 'failed', failureCode: result.failureCode, receipt: null }
  }
  return { status: 'invalid', failureCode: 'WORKER_OUTPUT_INVALID', receipt: null }
}
