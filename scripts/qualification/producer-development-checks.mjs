#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileProducerDevelopmentPlan } from './producer-development-plan.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { runOwnedProcess } from './owned-process.mjs'
import { inspectHeldGateExecution } from './producer-development-policy.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [app, output, sourceSha] = process.argv.slice(2)
if (![app, output].every(value => typeof value === 'string' && path.isAbsolute(value))
    || !/^[a-f0-9]{40}$/u.test(sourceSha ?? '')) throw new Error('Development checks require absolute package/output paths and exact source SHA.')
await mkdir(output, { recursive: false, mode: 0o700 })
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim() !== sourceSha) {
  throw new Error('Producer development source SHA does not match the current checkout.')
}
const appIdentity = await hashCandidateFile(app)
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
  cwd: projectRoot,
  encoding: 'utf8',
}).trim()
const asarIdentity = await hashCandidateFile(path.join(path.dirname(app), 'resources', 'app.asar'))
const results = []
let cancellationSignal = null
let cleanupBlocked = false
const onTerminate = () => { cancellationSignal = 'SIGTERM' }
const onInterrupt = () => { cancellationSignal = 'SIGINT' }
process.on('SIGTERM', onTerminate)
process.on('SIGINT', onInterrupt)
const plan = compileProducerDevelopmentPlan({ app, output, sourceSha, appSha256: appIdentity.sha256 })
// This is a bounded PR producer check. It does not enter candidate mode, create
// seals, claim CI AppImage/install identity or satisfy any release obligation.
for (const entry of plan) {
  if (cancellationSignal !== null) break
  const { id, contractId, evidence, command } = entry
  console.log(`Starting producer development case: ${id}`)
  await mkdir(evidence, { mode: 0o700 })
  let execution
  let mechanics = null
  try {
    execution = await runOwnedProcess({ file: process.execPath,
      args: [path.join(projectRoot, command.script), ...command.args], cwd: projectRoot,
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
        EXPECTED_SOURCE_TREE: sourceTree,
        OBSERVED_EXECUTABLE_SHA256: appIdentity.sha256,
        OBSERVED_ASAR_SHA256: asarIdentity.sha256,
      },
      timeoutMs: command.timeoutMs, maxOutputBytes: 4 * 1024 * 1024 })
    if (entry.mechanicsOnly) mechanics = JSON.parse(await readFile(path.join(evidence, command.report), 'utf8'))
  } catch (error) {
    execution = { stdout: '', stderr: '', exitCode: null, timedOut: false, zeroDescendantsAfterRun: false,
      ...execution, processError: error instanceof Error ? error.message : String(error) }
  }
  await writeFile(path.join(output, `${id}-stdout.log`), execution.stdout, { flag: 'wx' })
  await writeFile(path.join(output, `${id}-stderr.log`), execution.stderr, { flag: 'wx' })
  const heldGateExecution = entry.mechanicsOnly
    ? inspectHeldGateExecution({ ...execution, mechanics })
    : null
  const infrastructurePassed = heldGateExecution?.infrastructurePassed
    ?? (execution.exitCode === 0 && !execution.timedOut
      && execution.processError === null && execution.zeroDescendantsAfterRun)
  const productCheckPassed = heldGateExecution?.productCheckPassed ?? null
  const result = { id, contractId, exitCode: execution.exitCode, timedOut: execution.timedOut,
    processError: execution.processError, zeroDescendantsAfterRun: execution.zeroDescendantsAfterRun,
    infrastructurePassed, productCheckPassed, qualificationExecuted: false, mechanics }
  results.push(result)
  console.log(`${id}: infrastructure=${infrastructurePassed}, product=${productCheckPassed}, exit=${execution.exitCode}; evidence=${evidence}`)
  if (!infrastructurePassed || productCheckPassed === false) console.error(execution.stderr.slice(-4000))
  await writeFile(path.join(output, `${id}-development-result.json`), JSON.stringify(result, null, 2), { flag: 'wx' })
  if (execution.zeroDescendantsAfterRun !== true) {
    cleanupBlocked = true
    break
  }
}
const infrastructurePassed = cancellationSignal === null && results.length === plan.length
  && results.every(result => result.infrastructurePassed)
const productChecksPassed = results.every(result => result.productCheckPassed !== false)
await writeFile(path.join(output, 'development-summary.json'), JSON.stringify({
  schema: 'sartracker-producer-development-v1', sourceSha, sourceTree, appIdentity, asarIdentity, results, infrastructurePassed,
  productChecksPassed, cancellationSignal, cleanupBlocked, plannedCases: plan.length, completedCases: results.length,
  proofMode: 'unpacked-package-producer-development', qualificationExecuted: false,
  releaseEligible: false, candidateReceipt: false,
  notRun: ['full C01 startup matrix including physical ENOSPC and field storage',
    'C03/C11/C17 exhaustive family lanes', 'C14 known overlay-warning product regression',
    'C18 physical volume and full fault matrix', 'large replay/archive/storage and long-duration soaks',
    'exact AppImage and installed-deb qualification', 'private maps, live provider and named human acceptance'],
}, null, 2), { flag: 'wx' })
process.off('SIGTERM', onTerminate)
process.off('SIGINT', onInterrupt)
if (!infrastructurePassed) process.exitCode = 1
else if (!productChecksPassed) process.exitCode = 2
