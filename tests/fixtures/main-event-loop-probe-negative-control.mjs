import { Worker } from 'node:worker_threads'
import { installMainEventLoopProbe, validateMainEventLoopEvidence } from '../../build/main-event-loop-probe.js'

const gate = new Int32Array(new SharedArrayBuffer(4))
const worker = new Worker(`
  const { parentPort, workerData } = require('node:worker_threads')
  const { Session } = require('node:inspector')
  const gate = new Int32Array(workerData)
  const session = new Session()
  session.connectToMainThread()
  const keepAlive = setInterval(() => {}, 1_000)
  parentPort.postMessage({ ready: true })
  Atomics.wait(gate, 0, 0)
  const start = performance.now()
  session.post('Runtime.evaluate', { expression: 'performance.now()', returnByValue: true }, (error, result) => {
    parentPort.postMessage({ inspectorRoundTripMs: performance.now() - start, mainEvaluatedAtMs: result?.result?.value, error: error?.message ?? null })
    session.disconnect()
    clearInterval(keepAlive)
  })
`, { eval: true, workerData: gate.buffer })
let resolveReady
let resolveResult
const ready = new Promise((resolve) => { resolveReady = resolve })
const result = new Promise((resolve) => { resolveResult = resolve })
worker.on('message', (message) => {
  if (message.ready) resolveReady()
  else resolveResult(message)
})
worker.on('error', (error) => { console.error(error); process.exitCode = 1 })
await ready
const probe = installMainEventLoopProbe()
await new Promise((resolve) => setTimeout(resolve, 60))
const blockStartedAtMs = performance.now()
Atomics.store(gate, 0, 1)
Atomics.notify(gate, 0)
while (performance.now() - blockStartedAtMs < 350) { /* Deliberate main-thread block. */ }
const blockEndedAtMs = performance.now()
await new Promise((resolve) => setTimeout(resolve, 60))
const mainEventLoop = probe.stop()
const inspector = await result
const failureReasons = validateMainEventLoopEvidence([mainEventLoop], 1)
console.log(JSON.stringify({ mainEventLoop, ...inspector, blockStartedAtMs, blockEndedAtMs, failureReasons }))
await worker.terminate()
