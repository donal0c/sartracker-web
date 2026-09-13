// Run serially: node --experimental-strip-types docs/evidence/legacy-object-recovery/claude-remediation/real-main-stall-control.mjs
import assert from 'node:assert/strict'
import { observeLegacyRecoveryCompletion } from '../../../../tests/support/legacy-recovery-completion.ts'

let complete
const observation = observeLegacyRecoveryCompletion(new Promise((resolve) => { complete = resolve }))
await new Promise((resolve) => setTimeout(resolve, 25))
// Park this thread: a real 250 ms event-loop stall without a CPU-burning spin.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
complete({ workerThreadId: 1 })
const report = await observation
assert.ok(report.maximumHeartbeatGapMs >= 250)
assert.throws(() => assert.ok(report.maximumHeartbeatGapMs < 200))
console.log(JSON.stringify({ control: 'real main-thread blocked final interval', report, strictGateRejected: true }))
