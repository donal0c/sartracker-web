import { executeSoakVariantInProcess } from './soak-adapter.mjs'

const MAX_INPUT_BYTES = 16 * 1024 * 1024
const INPUT_SCHEMA = 'sartracker-soak-worker-input-v1'
const RESULT_SCHEMA = 'sartracker-soak-worker-result-v1'

/** Read one bounded JSON worker configuration from stdin. */
async function readWorkerInput() {
  const chunks = []
  let total = 0
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > MAX_INPUT_BYTES) throw new Error('worker input too large')
    chunks.push(bytes)
  }
  if (total === 0) throw new Error('worker input missing')
  const input = JSON.parse(Buffer.concat(chunks, total).toString('utf8'))
  if (input?.schema !== INPUT_SCHEMA || input.config === undefined) throw new Error('worker input schema invalid')
  return input.config
}

/** Write one bounded worker result record and keep failures code-only. */
function writeResult(result) {
  process.stdout.write(`${JSON.stringify({ schema: RESULT_SCHEMA, ...result })}\n`)
}

try {
  const config = await readWorkerInput()
  const receipt = await executeSoakVariantInProcess(config)
  writeResult({ status: 'completed', receipt })
} catch {
  writeResult({ status: 'failed', failureCode: 'WORKER_EXECUTION_FAILED', receipt: null })
  process.exitCode = 1
}
