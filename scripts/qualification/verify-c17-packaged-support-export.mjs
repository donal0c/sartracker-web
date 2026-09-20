import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCompositeSourceManifest } from './composite-manifest.mjs'
import { validateCompositeFamilyReceipt } from './composite-family-receipts.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHA1 = /^[a-f0-9]{40}$/u

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`verify-c17-packaged-support-export: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

/** Validates the exact packaged C17 support-export receipt and writes a bounded zero-canary summary. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = JSON.parse(await readFile(path.join(options.evidence, 'composite-receipt.json'), 'utf8'))
  const appBytes = await readFile(options.app)
  const validation = validateCompositeFamilyReceipt(report, {
    appPath: options.app,
    appSha256: sha256(appBytes),
    evidencePath: options.evidence,
    retainedEvidencePath: options.evidence,
    profilePath: path.join(options.evidence, '.profile-composite'),
    sourceHead: options.expectedHead,
    sourceManifest: await createCompositeSourceManifest(projectRoot),
    sourceRoot: projectRoot,
    contractId: 'C17',
  })
  const receipt = createC17PackagedSupportExportReceipt({
    sourceHead: options.expectedHead,
    appSha256: sha256(appBytes),
    validation,
  })
  const receiptPath = path.join(options.evidence, 'c17-packaged-support-export-receipt.json')
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  if (receipt.zeroCanary !== true) {
    throw new Error(`C17 exact-head packaged support export did not prove zero canaries: ${validation.failureReasons.join(' | ')}`)
  }
  console.log(`verify-c17-packaged-support-export: receipt=${receiptPath}`)
}

/** Builds the bounded C17 development receipt without promoting it to qualification. */
export function createC17PackagedSupportExportReceipt({ sourceHead, appSha256, validation }) {
  const phase = validation.phaseFacts ?? {}
  const diagnostics = {
    sanitized: phase.sanitized === true,
    containsSecret: phase.containsSecret === false,
    containsProfilePath: phase.containsProfilePath === false,
    exactSecretMatches: phase.exactSecretMatches,
    adversarialMatchCount: phase.adversarialMatchCount,
    canaryCount: phase.canaryCount,
    leakedCanaryIds: Array.isArray(phase.leakedCanaryIds) ? phase.leakedCanaryIds : null,
    outputByteLength: phase.outputByteLength,
    outputWithinLimit: phase.outputWithinLimit === true,
  }
  const receipt = {
    schema: 'sartracker-c17-packaged-support-export-v1',
    contractId: 'C17',
    proofMode: 'packaged-linux-unpacked-exact-head',
    sourceHead,
    appSha256,
    status: validation.status,
    valid: validation.valid,
    complete: validation.complete,
    coverageComplete: validation.coverageComplete,
    coverageGaps: validation.coverageGaps,
    qualificationExecuted: false,
    releaseEligible: false,
    zeroCanary: validation.status === 'PASS' && validation.valid === true
      && diagnostics.sanitized === true
      && diagnostics.containsSecret === true
      && diagnostics.containsProfilePath === true
      && diagnostics.exactSecretMatches === 0
      && diagnostics.adversarialMatchCount === 0
      && diagnostics.canaryCount === 6
      && Array.isArray(diagnostics.leakedCanaryIds)
      && diagnostics.leakedCanaryIds.length === 0
      && diagnostics.outputWithinLimit === true,
    diagnostics,
    failureReasons: validation.failureReasons,
  }
  return receipt
}

/** Parses the fixed verifier argument contract. */
function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!['--app', '--evidence', '--expected-head'].includes(name) || Object.hasOwn(values, name)) {
      throw new Error(`Unknown or duplicate argument: ${name}`)
    }
    const value = argv[index + 1]
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
      throw new Error(`Argument ${name} requires a value.`)
    }
    values[name] = value
    index += 1
  }
  for (const name of ['--app', '--evidence', '--expected-head']) {
    if (!Object.hasOwn(values, name)) throw new Error(`Missing required argument: ${name}`)
  }
  if (!path.isAbsolute(values['--app']) || !path.isAbsolute(values['--evidence'])) {
    throw new Error('C17 packaged verifier requires absolute app and evidence paths.')
  }
  if (!SHA1.test(values['--expected-head'])) throw new Error('C17 packaged verifier requires one SHA-1 source head.')
  return {
    app: path.resolve(values['--app']),
    evidence: path.resolve(values['--evidence']),
    expectedHead: values['--expected-head'],
  }
}

/** Hashes exact packaged bytes for the retained receipt identity. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
