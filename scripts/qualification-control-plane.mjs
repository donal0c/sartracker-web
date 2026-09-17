#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runControlPlaneDryRun } from './qualification/control-plane.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1])
}
if (args.get('--mode') !== 'dry-run') {
  throw new Error('Only --mode dry-run is implemented. Final candidate execution remains separately authorized.')
}
const outputRoot = path.resolve(args.get('--output') ?? path.join(projectRoot, 'tmp', 'qualification-control-plane'))
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim()
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: projectRoot, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: projectRoot, encoding: 'utf8' }).trim() !== ''
const result = await runControlPlaneDryRun({
  registryPath: path.join(projectRoot, 'docs', 'assurance', 'qualification-contracts.json'),
  outputRoot,
  sourceIdentity: { sha: sourceSha, tree: sourceTree, dirty },
  fixturePaths: [path.join(projectRoot, 'tests', 'fixtures', 'outing-window-vectors.json')],
  validatorPaths: [
    path.join(projectRoot, 'scripts', 'qualification-control-plane.mjs'),
    path.join(projectRoot, 'scripts', 'qualification', 'control-plane.mjs'),
  ],
})
process.stdout.write(`${JSON.stringify({
  verdict: result.result.verdict,
  releaseEligible: result.result.releaseEligible,
  attemptDirectory: result.attemptDirectory,
  manifestSha256: result.seal.manifestSha256,
  anchorPath: result.anchorPath,
}, null, 2)}\n`)
