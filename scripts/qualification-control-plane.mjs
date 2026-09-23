#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  cleanupCampaignLease,
  compileCampaignDefinition,
  computeCampaignVerdict,
  getCandidateAdapterInventory,
  ingestAdvisoryJudgeResult,
  preflightCampaign,
  qualificationVerdictExitCode,
  runContractAttempt,
  verifyCampaignAttempt,
} from './qualification/control-plane.mjs'
import { ingestHumanTrainingEvidence } from './qualification/candidate-control-plane.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Parse the explicit command-line grammar used by the controller. */
function parseArguments(argv) {
  const [commandOrFlag, ...rest] = argv
  if (commandOrFlag?.startsWith('--')) return { command: 'dry-run', options: parseOptionPairs(argv) }
  return { command: commandOrFlag ?? 'help', options: parseOptionPairs(rest) }
}

/** Parse `--key value` pairs and boolean flags without invoking a shell. */
function parseOptionPairs(argv) {
  const options = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token?.startsWith('--')) throw new Error(`Unexpected argument: ${token}.`)
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) options.set(key, true)
    else {
      options.set(key, next)
      index += 1
    }
  }
  return options
}

/** Read a JSON file from an explicit CLI path. */
async function readJson(filePath, label) {
  if (typeof filePath !== 'string' || filePath === '') throw new Error(`${label} is required.`)
  return JSON.parse(await readFile(path.resolve(filePath), 'utf8'))
}

/** Capture the exact clean source identity used by compile/preflight. */
function currentSourceIdentity() {
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim()
  const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: projectRoot, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' }).trim() !== ''
  return { sha: sourceSha, tree: sourceTree, dirty }
}

/** Resolve the default campaign root from a definition path. */
function defaultCampaignRoot(definitionPath) {
  return path.resolve(path.dirname(definitionPath), '..', '..', 'tmp', 'qualification-campaign')
}

/** Resolve an attempt's external anchor from the standard campaign layout. */
function defaultAnchorPath(attemptDirectory) {
  const attemptId = path.basename(path.resolve(attemptDirectory))
  return path.join(path.dirname(path.dirname(path.resolve(attemptDirectory))), 'anchors', `${attemptId}.anchor.json`)
}

/** Emit a machine-readable result. */
function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/** Convert a lease cleanup exception into a reportable fail-closed result. */
function cleanupFailure(error) {
  return {
    status: 'CLEANUP_BLOCKED',
    reason: error instanceof Error ? error.message : String(error),
  }
}

/** Clean up a lease owned by this CLI invocation and retain failures as data. */
async function cleanupOwnedLease(preflight) {
  try {
    return await cleanupCampaignLease({ leasePath: preflight.lease.leasePath })
  } catch (error) {
    return cleanupFailure(error)
  }
}

/** Run the qualification controller command selected by the user. */
async function main() {
  const { command, options } = parseArguments(process.argv.slice(2))
  if (command === 'help') {
    emit({ commands: ['compile', 'calibration', 'preflight', 'run', 'resume', 'ingest-judge', 'ingest-human', 'verify', 'verdict', 'cleanup', 'inventory', 'dry-run'] })
    return
  }
  if (command === 'dry-run') {
    if (options.get('mode') !== 'dry-run') throw new Error('Only --mode dry-run is implemented for the legacy dry-run command.')
    const { runControlPlaneDryRun } = await import('./qualification/control-plane.mjs')
    const outputRoot = path.resolve(options.get('output') ?? path.join(projectRoot, 'tmp', 'qualification-control-plane'))
    const result = await runControlPlaneDryRun({
      registryPath: path.join(projectRoot, 'docs', 'assurance', 'qualification-contracts.json'),
      outputRoot,
      sourceIdentity: currentSourceIdentity(),
      fixturePaths: [path.join(projectRoot, 'tests', 'fixtures', 'outing-window-vectors.json')],
      validatorPaths: [path.join(projectRoot, 'scripts', 'qualification-control-plane.mjs'), path.join(projectRoot, 'scripts', 'qualification', 'control-plane.mjs')],
    })
    emit({ verdict: result.result.verdict, releaseEligible: result.result.releaseEligible, attemptDirectory: result.attemptDirectory, manifestSha256: result.seal.manifestSha256, anchorPath: result.anchorPath })
    return
  }
  if (command === 'inventory') {
    emit(await getCandidateAdapterInventory())
    return
  }
  if (command === 'compile') {
    const planPath = path.resolve(requireOption(options, 'plan'))
    const outputPath = path.resolve(requireOption(options, 'output'))
    const definition = await compileCampaignDefinition({ planPath, sourceIdentity: currentSourceIdentity(), outputPath })
    emit({ campaignId: definition.campaignId, mode: definition.mode, definitionDigest: definition.definitionDigest, outputPath, releaseEligible: false })
    return
  }
  if (command === 'calibration') {
    const planPath = path.resolve(options.get('plan') ?? path.join(projectRoot, 'docs', 'assurance', 'qualification-calibration-plan.json'))
    const campaignRoot = path.resolve(options.get('root') ?? path.join(projectRoot, 'tmp', 'qualification-calibration'))
    const definitionPath = path.join(campaignRoot, 'campaign-definition.json')
    const definition = await compileCampaignDefinition({ planPath, sourceIdentity: currentSourceIdentity(), outputPath: definitionPath })
    const preflight = await preflightCampaign({ definition, campaignRoot, currentSourceIdentity: currentSourceIdentity() })
    if (preflight.status !== 'READY') {
      emit({ calibration: true, definitionDigest: definition.definitionDigest, preflight })
      process.exitCode = 2
      return
    }
    let verdict
    let cleanup
    try {
      for (const binding of definition.bindings.filter((candidate) => candidate.mandatory)) {
        let attempt = await runContractAttempt({
          definition,
          preflight,
          campaignRoot,
          contractId: binding.contractId,
          variantId: binding.variantId,
        })
        if (attempt.status === 'ABORTED_SAFE') {
          attempt = await runContractAttempt({
            definition,
            preflight,
            campaignRoot,
            contractId: binding.contractId,
            variantId: binding.variantId,
            resumeAttemptId: attempt.attemptId,
          })
        }
        if (attempt.judgePacketSha256 !== undefined) {
          await ingestAdvisoryJudgeResult({
            attemptDirectory: attempt.attemptDirectory,
            result: {
              schema: 'sartracker-oracle-blind-judge-result-v1',
              campaignId: definition.campaignId,
              attemptId: attempt.attemptId,
              packetSha256: attempt.judgePacketSha256,
              verdict: 'pass',
              observations: [],
            },
          })
        }
      }
      verdict = await computeCampaignVerdict({ definition, campaignRoot })
    } finally {
      cleanup = await cleanupCampaignLease({ leasePath: preflight.lease.leasePath })
    }
    emit({ calibration: true, definitionDigest: definition.definitionDigest, verdict, cleanup })
    if (cleanup.status !== 'CLEANED') process.exitCode = 2
    return
  }
  if (command === 'ingest-judge') {
    const attemptDirectory = path.resolve(requireOption(options, 'attempt'))
    const result = await readJson(requireOption(options, 'result'), 'judge result')
    emit(await ingestAdvisoryJudgeResult({ attemptDirectory, result }))
    return
  }
  if (command === 'ingest-human') {
    const definitionPath = path.resolve(requireOption(options, 'campaign'))
    const definition = await readJson(definitionPath, 'campaign definition')
    const campaignRoot = path.resolve(requireOption(options, 'root'))
    const preflight = await preflightCampaign({ definition, campaignRoot, currentSourceIdentity: currentSourceIdentity() })
    if (preflight.status !== 'READY') {
      emit(preflight)
      process.exitCode = 2
      return
    }
    let result
    let executionError
    let cleanup
    try {
      result = await ingestHumanTrainingEvidence({
        definition,
        preflight,
        campaignRoot,
        attemptId: requireOption(options, 'attempt'),
        envelopePath: path.resolve(requireOption(options, 'envelope')),
        evidencePath: path.resolve(requireOption(options, 'evidence')),
      })
    } catch (error) {
      executionError = error
    } finally {
      cleanup = await cleanupOwnedLease(preflight)
    }
    if (executionError !== undefined) {
      if (cleanup.status !== 'CLEANED') {
        executionError = new Error(`${executionError instanceof Error ? executionError.message : String(executionError)}; cleanup: ${cleanup.reason ?? cleanup.status}`)
      }
      throw executionError
    }
    result = { ...result, cleanup }
    emit(result)
    if (cleanup.status !== 'CLEANED') process.exitCode = 2
    if (result.status === 'INVALID_EVIDENCE' && process.exitCode === undefined) process.exitCode = 1
    return
  }
  if (command === 'verify') {
    const attemptDirectory = path.resolve(requireOption(options, 'attempt'))
    const anchorPath = path.resolve(options.get('anchor') ?? defaultAnchorPath(attemptDirectory))
    const definition = await readJson(requireOption(options, 'campaign'), 'campaign definition')
    emit(await verifyCampaignAttempt({ attemptDirectory, anchorPath, definition }))
    return
  }
  if (command === 'cleanup') {
    emit(await cleanupCampaignLease({ leasePath: path.resolve(requireOption(options, 'lease')), simulateFailure: options.get('simulate-failure') === true }))
    return
  }
  if (!['preflight', 'run', 'resume', 'verdict'].includes(command)) {
    throw new Error(`Unknown qualification command: ${command}.`)
  }
  const definitionPath = path.resolve(requireOption(options, 'campaign'))
  const definition = await readJson(definitionPath, 'campaign definition')
  const campaignRoot = path.resolve(options.get('root') ?? defaultCampaignRoot(definitionPath))
  if (command === 'preflight') {
    const preflight = await preflightCampaign({ definition, campaignRoot, currentSourceIdentity: currentSourceIdentity() })
    if (preflight.status !== 'READY') {
      emit(preflight)
      process.exitCode = 2
      return
    }
    const cleanup = await cleanupOwnedLease(preflight)
    const probe = { ...preflight }
    delete probe.lease
    emit({ ...probe, lifecycle: 'probe', cleanup })
    if (cleanup.status !== 'CLEANED') process.exitCode = 2
    return
  }
  if (command === 'run' || command === 'resume') {
    const preflight = await preflightCampaign({ definition, campaignRoot, currentSourceIdentity: currentSourceIdentity() })
    if (preflight.status !== 'READY') {
      emit(preflight)
      process.exitCode = 2
      return
    }
    let attempt
    let executionError
    let cleanup
    try {
      const resumeAttemptId = command === 'resume' ? requireOption(options, 'attempt') : options.get('attempt')
      let contractId = options.get('contract')
      let variantId = options.get('variant')
      if (command === 'resume' && (contractId === undefined || variantId === undefined)) {
        const attemptMetadata = await readJson(path.join(campaignRoot, 'attempts', resumeAttemptId, 'attempt.json'), 'attempt metadata')
        contractId ??= attemptMetadata.contractId
        variantId ??= attemptMetadata.variantId
      }
      attempt = await runContractAttempt({ definition, preflight, campaignRoot, contractId, variantId, resumeAttemptId })
    } catch (error) {
      executionError = error
    } finally {
      cleanup = await cleanupOwnedLease(preflight)
    }
    if (executionError !== undefined) {
      if (cleanup.status !== 'CLEANED') {
        executionError = new Error(`${executionError instanceof Error ? executionError.message : String(executionError)}; cleanup: ${cleanup.reason ?? cleanup.status}`)
      }
      throw executionError
    }
    attempt = { ...attempt, cleanup }
    emit(attempt)
    if (cleanup.status !== 'CLEANED' || attempt.status === 'ENVIRONMENT_BLOCKED') process.exitCode = 2
    if (attempt.status === 'FAIL' && process.exitCode === undefined) process.exitCode = 1
    return
  }
  if (command === 'verdict') {
    const verdict = await computeCampaignVerdict({ definition, campaignRoot })
    emit(verdict)
    process.exitCode = qualificationVerdictExitCode(verdict)
    return
  }
  throw new Error(`Unknown qualification command: ${command}.`)
}

/** Read a required option and fail closed when it is absent. */
function requireOption(options, name) {
  const value = options.get(name)
  if (typeof value !== 'string' || value === '') throw new Error(`--${name} is required.`)
  return value
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}
