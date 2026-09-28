#!/usr/bin/env node
/**
 * Publishes a checked Electron draft release.
 *
 * This is intentionally not a convenience wrapper around `gh release edit`.
 * It refuses publication unless the draft targets the exact remote tag commit,
 * every row of the release checklist (`docs/release-checklist.md`) has a final
 * result, any FAIL or NOT TESTED row carries an owner-approved exception for
 * this tag, both Linux installers have full reviewed hashes, the named draft
 * assets exist, SHA256SUMS agrees, and a fresh download of each installer
 * hashes to the same value.
 *
 * `--check-notes <file>` validates a local release note offline (checklist
 * results, exceptions and regression record) before tagging or editing a draft.
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
  validateRegressionRecord,
  validateReleaseMatrix,
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
 * Runs every release guard and publishes only after fresh-download hash proof
 * succeeds.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.checkNotes !== undefined) {
    const body = await readFile(path.resolve(args.checkNotes), 'utf8')
    validateRegressionRecord(body)
    const matrix = validateReleaseMatrix(body, args.tag)
    console.log(`Release note ${args.checkNotes} satisfies the checklist for ${args.tag}.`)
    printExceptions(matrix.exceptions)
    return
  }
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY
  if (repo === undefined || repo.trim() === '') {
    throw new Error('--repo is required outside GitHub Actions.')
  }

  const expectedCommit = await resolveRemoteTagCommit(repo, args.tag)

  const release = fetchDraftRelease(repo, args.tag)
  assertDraftReleaseState(release)
  validateReleaseProvenance(release.body, expectedCommit)
  validateRegressionRecord(release.body)
  const checklist = validateReleaseMatrix(release.body, args.tag)
  const assetNames = release.assets.map((asset) => asset.name)

  const downloadDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-release-publish-'))
  let manifest
  let manifestSha256
  try {
    for (const name of [
      'SHA256SUMS',
      checklist.appImage.name,
      checklist.deb.name,
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
    assertQualifiedAssets(assetNames, checklist, manifest)
    assertReleaseAssetMetadata(release.assets, checklist, manifestSha256)
    await assertDownloadedHash(downloadDir, checklist.appImage)
    await assertDownloadedHash(downloadDir, checklist.deb)
  } finally {
    await rm(downloadDir, { recursive: true, force: true })
  }

  const finalRelease = fetchDraftRelease(repo, args.tag)
  assertDraftReleaseState(finalRelease)
  validateReleaseProvenance(finalRelease.body, expectedCommit)
  validateRegressionRecord(finalRelease.body)
  assertReleaseUnchanged(release, finalRelease)
  const finalChecklist = validateReleaseMatrix(finalRelease.body, args.tag)
  if (JSON.stringify(finalChecklist) !== JSON.stringify(checklist)) {
    throw new Error('Draft checklist identity changed during fresh-download verification.')
  }
  assertReleaseAssetMetadata(finalRelease.assets, checklist, manifestSha256)
  assertQualifiedAssets(
    finalRelease.assets.map((asset) => asset.name),
    checklist,
    manifest,
  )
  const finalRemoteCommit = await resolveRemoteTagCommit(repo, args.tag)
  if (finalRemoteCommit !== expectedCommit) {
    throw new Error(
      `Remote tag moved during verification: ${expectedCommit} -> ${finalRemoteCommit}.`,
    )
  }

  console.log(
    `Release guard passed for ${args.tag} at ${expectedCommit}: ` +
      `${checklist.appImage.name} and ${checklist.deb.name}.`,
  )
  printExceptions(checklist.exceptions)
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
  console.log(`Published prerelease: ${release.url}`)
}

/**
 * Prints each owner-approved exception so the person publishing sees exactly
 * which known gaps they are shipping.
 */
function printExceptions(exceptions) {
  if (exceptions.length === 0) {
    console.log('Owner-approved exceptions: none.')
    return
  }
  console.log(`Owner-approved exceptions (${exceptions.length}):`)
  for (const exception of exceptions) {
    console.log(
      `  - ${exception.check}: ${exception.result}, ${exception.severity}; ` +
        `approved by ${exception.approvedBy} (${exception.approvalReference}); ` +
        `follow-up ${exception.followUp}`,
    )
  }
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
 * Hashes one freshly downloaded release asset and compares it to the reviewed
 * checklist digest.
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
  const args = { tag: undefined, repo: undefined, dryRun: false, checkNotes: undefined }
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
    } else if (arg === '--check-notes') {
      args.checkNotes = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--check-notes=')) {
      args.checkNotes = arg.slice('--check-notes='.length)
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
      '       npm run electron:release:publish -- --tag <electron-v*> --check-notes <release-note.md>',
      '',
      'Options:',
      '  --dry-run            Run every guard and fresh-download hash without publishing',
      '  --check-notes <file> Validate a local release note offline; no GitHub access',
    ].join('\n'),
  )
  process.exit(code)
}
