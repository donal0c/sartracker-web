import path from 'node:path'
import { compilePackageCommand } from './package-command.mjs'

const POSITIVE_CASES = Object.freeze([
  ['C02', 'main-sigkill'], ['C02', 'pending-finalize'],
  ['C05'], ['C09'], ['C10', 'known-at-time-replay'], ['C10', 'replay-201-outings'],
  ['C12'], ['C13'], ['C16'], ['C19', 'legacy-schema-matrix'], ['C19', 'legacy-v11-50k-kill'],
  ['C21'], ['C23'], ['C26'], ['C28', 'routine'],
])

/** Compile a fixed bounded PR mechanics inventory, never a substitute candidate plan. */
export function compileProducerDevelopmentPlan({ app, output, sourceSha, appSha256 }) {
  const cases = POSITIVE_CASES.map(([contractId, variantId]) => {
    const id = variantId ? `${contractId}-${variantId}` : contractId
    const evidence = path.join(output, id)
    const command = compilePackageCommand(contractId, { app, evidence, sourceSha, appSha256, variantId })
    return Object.freeze({ id, contractId, evidence, mechanicsOnly: false,
      command: Object.freeze({ ...command, timeoutMs: Math.min(command.timeoutMs, 300000) }),
    })
  })
  for (const gateKind of ['diagnostics', 'crash', 'store']) {
    const id = `C01-held-${gateKind}`
    const evidence = path.join(output, id)
    cases.push(Object.freeze({ id, contractId: 'C01', evidence, mechanicsOnly: true,
      command: Object.freeze({ script: 'scripts/qualification/producer-development-held-gate.mjs',
        args: Object.freeze([app, evidence, gateKind]), report: 'development-mechanics.json',
        // Includes the 20 s response bound, 20 s product-exit observation and cleanup.
        timeoutMs: 120000 }),
    }))
  }
  return Object.freeze(cases)
}
