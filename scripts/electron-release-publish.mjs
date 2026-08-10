#!/usr/bin/env node
/**
 * Publishes an already-qualified Electron draft release.
 *
 * This is intentionally not a convenience wrapper around `gh release edit`.
 * It refuses publication unless the draft targets the exact local tag commit,
 * every packaged-smoke row is final, both Linux installers have full reviewed
 * hashes and evidence, the named draft assets exist, SHA256SUMS agrees, and a
 * fresh download of each installer hashes to the same value.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertDraftReleaseState,
  assertQualifiedAssets,
  assertReleaseAssetMetadata,
  assertReleaseUnchanged,
  parseSha256Manifest,
  peelGitHubTagToCommit,
  validateQualificationBody,
  validateRegressionRecord,
  validateReleaseProvenance,
} from '../build/electron-release-lib.js'

const scriptFile = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(scriptFile), '..')

main().catch((error) => {
  console.error(
    `electron-release-publish: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
})

/**
 * Runs every qualification guard and publishes only after fresh-download hash
 * proof succeeds.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY
  if (repo === undefined || repo.trim() === '') {
    throw new Error('--repo is required outside GitHub Actions.')
  }

  const expectedCommit = await resolveRemoteTagCommit(repo, args.tag)

  const release = fetchDraftRelease(repo, args.tag)
  assertDraftReleaseState(release)
  validateReleaseProvenance(release.body, expectedCommit)
  validateRegressionRecord(release.body)
  const qualification = validateQualificationBody(release.body)
  const assetNames = release.assets.map((asset) => asset.name)

  const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-release-publish-'))
  let manifest
  let manifestSha256
  try {
    for (const name of [
      'SHA256SUMS',
      qualification.appImage.name,
      qualification.deb.name,
    ]) {
      run('gh', [
        'release',
        'download',
        args.tag,
        '--repo',
        repo,
        '--dir',
        downloadDir,
        '--pattern',
        name,
      ])
    }

    const manifestBytes = await readFile(path.join(downloadDir, 'SHA256SUMS'))
    manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')
    manifest = parseSha256Manifest(manifestBytes.toString('utf8'))
    assertQualifiedAssets(assetNames, qualification, manifest)
    assertReleaseAssetMetadata(release.assets, qualification, manifestSha256)
    await assertDownloadedHash(downloadDir, qualification.appImage)
    await assertDownloadedHash(downloadDir, qualification.deb)
  } finally {
    await rm(downloadDir, { recursive: true, force: true })
  }

  const finalRelease = fetchDraftRelease(repo, args.tag)
  assertDraftReleaseState(finalRelease)
  validateReleaseProvenance(finalRelease.body, expectedCommit)
  validateRegressionRecord(finalRelease.body)
  assertReleaseUnchanged(release, finalRelease)
  const finalQualification = validateQualificationBody(finalRelease.body)
  if (JSON.stringify(finalQualification) !== JSON.stringify(qualification)) {
    throw new Error('Draft qualification identity changed during fresh-download verification.')
  }
  assertReleaseAssetMetadata(finalRelease.assets, qualification, manifestSha256)
  assertQualifiedAssets(
    finalRelease.assets.map((asset) => asset.name),
    qualification,
    manifest,
  )
  const finalRemoteCommit = await resolveRemoteTagCommit(repo, args.tag)
  if (finalRemoteCommit !== expectedCommit) {
    throw new Error(
      `Remote tag moved during qualification: ${expectedCommit} -> ${finalRemoteCommit}.`,
    )
  }

  console.log(
    `Qualification guard passed for ${args.tag} at ${expectedCommit}: ` +
      `${qualification.appImage.name} and ${qualification.deb.name}.`,
  )
  if (args.dryRun) {
    console.log('Dry run: release remains a draft.')
    return
  }
  run(
    'gh',
    [
      'release',
      'edit',
      args.tag,
      '--repo',
      repo,
      '--draft=false',
      '--prerelease',
    ],
    'inherit',
  )
  console.log(`Published qualified prerelease: ${release.url}`)
}

/**
 * Fetches draft state, body, and immutable asset metadata through the release
 * CLI, which can discover draft releases.
 */
function fetchDraftRelease(repo, tag) {
  return JSON.parse(
    run('gh', [
      'release',
      'view',
      tag,
      '--repo',
      repo,
      '--json',
      'isDraft,isPrerelease,body,assets,url',
    ]),
  )
}

/**
 * Resolves and peels the authoritative tag in the requested GitHub repository.
 */
async function resolveRemoteTagCommit(repo, tag) {
  const reference = JSON.parse(
    run('gh', ['api', `repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`]),
  )
  return peelGitHubTagToCommit(reference.object, async (tagSha) => {
    const annotated = JSON.parse(run('gh', ['api', `repos/${repo}/git/tags/${tagSha}`]))
    return annotated.object
  })
}

/**
 * Hashes one freshly downloaded release asset and compares it to qualification.
 */
async function assertDownloadedHash(downloadDir, artifact) {
  const bytes = await readFile(path.join(downloadDir, artifact.name))
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== artifact.sha256) {
    throw new Error(
      `Fresh download digest for ${JSON.stringify(artifact.name)} is ${actual}, ` +
        `expected ${artifact.sha256}.`,
    )
  }
}

/**
 * Parses the narrow guarded-publisher CLI.
 */
function parseArgs(argv) {
  const args = { tag: undefined, repo: undefined, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--tag') {
      args.tag = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--tag=')) {
      args.tag = arg.slice('--tag='.length)
    } else if (arg === '--repo') {
      args.repo = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--repo=')) {
      args.repo = arg.slice('--repo='.length)
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      printUsageAndExit(0)
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(arg)}.`)
    }
  }
  if (typeof args.tag !== 'string' || !/^electron-v[0-9]/u.test(args.tag)) {
    throw new Error('--tag must be an existing electron-v* release tag.')
  }
  return args
}

/**
 * Executes one command without a shell so tag and repository arguments are not
 * reinterpreted.
 */
function run(command, args, stdio = 'pipe') {
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio,
  })
}

/**
 * Prints guarded-publisher usage and exits with the requested status.
 */
function printUsageAndExit(code) {
  console.log(
    [
      'Usage: npm run electron:release:publish -- --tag <electron-v*> --repo <owner/repo>',
      '',
      'Options:',
      '  --dry-run   Run every guard and fresh-download hash without publishing',
    ].join('\n'),
  )
  process.exit(code)
}
