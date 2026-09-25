#!/usr/bin/env node
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { runStartupHeldGateDevelopmentProbe } from './startup-probe.mjs'
import { inspectHeldGateDevelopment } from './producer-development-policy.mjs'

const [appPath, evidenceDir, gateKind] = process.argv.slice(2)
if (![appPath, evidenceDir].every(value => typeof value === 'string' && path.isAbsolute(value))
    || !['diagnostics', 'crash', 'crash-write', 'store'].includes(gateKind)) {
  throw new Error('Held-gate development check requires absolute app/evidence paths and a fixed gate kind.')
}
const report = await runStartupHeldGateDevelopmentProbe({ appPath, evidenceDir, gateKind, launchPackagedTarget: true })
const result = inspectHeldGateDevelopment(report, gateKind)
await writeFile(path.join(evidenceDir, 'development-mechanics.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
// Exit 2 retains an observed product failure while preserving the successful
// producer mechanics receipt. Exit 1 remains reserved for infrastructure faults.
if (!result.infrastructurePassed) process.exitCode = 1
else if (!result.producerCheckPassed) process.exitCode = 2
