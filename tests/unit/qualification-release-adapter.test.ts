import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildReleaseRequestPlan,
  validateRetainedRelease,
} from '../../scripts/qualification/release-adapter.mjs'
import { BETA13_CLAIM_SCOPE, BETA13_NOT_CLAIMED_CAPABILITIES } from '../../scripts/qualification/product-capabilities.mjs'

const sourceSha = 'a'.repeat(40)
const candidateAssets = [
  { name: 'candidate.AppImage', sha256: 'b'.repeat(64), bytes: 10 },
  { name: 'candidate.deb', sha256: 'c'.repeat(64), bytes: 20 },
]
const rollbackAssets = [
  { name: 'rollback.AppImage', sha256: 'd'.repeat(64), bytes: 11 },
  { name: 'rollback.deb', sha256: 'e'.repeat(64), bytes: 21 },
]

const definition = {
  mode: 'candidate',
  claimScope: BETA13_CLAIM_SCOPE,
  identities: {
    source: { sha: sourceSha },
    candidate: {
      version: '0.1.0-beta.13',
      artifacts: candidateAssets.map((asset) => ({
        role: asset.name.endsWith('.AppImage') ? 'ci-appimage' : 'ci-deb',
        path: `/owned/${asset.name}`,
        sha256: asset.sha256,
        bytes: asset.bytes,
      })),
    },
  },
  runtimeInputs: { config: { ci: { provenance: { runId: 1, runAttempt: 1, artifactId: 2 },
    archive: { sha256: 'f'.repeat(64), bytes: 30 } } } },
  releaseInputs: {
    releaseId: 123,
    tag: 'electron-v0.1.0-beta.13',
    rollback: {
      releaseId: 122,
      tag: 'electron-v0.1.0-beta.12',
      sourceSha,
      assets: rollbackAssets,
    },
  },
}

const noRegression = '- Classification: No known regression correction\n- Linear issue: Not applicable'

/** Build the complete release body required by the production qualification parser. */
function releaseBody(assets: typeof candidateAssets) {
  const rows = [
    ['AppImage SHA-256', `PASS | \`${assets[0].name}\` ${assets[0].sha256}`],
    ['.deb SHA-256', `PASS | \`${assets[1].name}\` ${assets[1].sha256}`],
    ['AppImage launch', 'PASS | retained packaged launch receipt'],
    ['.deb install and launch', 'PASS | retained package receipt'],
    ['Core lifecycle, restart/recovery, finish/finalize/archive', 'PASS | retained lifecycle receipt'],
    ['Coordinate rejection', 'PASS | retained coordinate receipt'],
    ['Diagnostics/support/incident exports sanitized', 'PASS | retained diagnostics receipt'],
    ['Bad/corrupt stored credential reaches shell', 'PASS | retained credential receipt'],
    ['Live Traccar connection and breadcrumb reconciliation', 'PASS | retained tracking receipt'],
    ['Official offline Discovery package', 'NOT APPLICABLE | not declared for this beta'],
    ['Duplicate launch', 'PASS | retained duplicate-launch receipt'],
    ['Five-day and fourteen-day packaged soak', 'PASS | retained soak receipt'],
    ['Cross-profile exact breadcrumb identity comparison', 'PASS | retained cross-profile receipt'],
    ['Strict responsiveness (<200 ms)', 'PASS | retained responsiveness receipt'],
  ]
  return [
    '- Build commit: `' + sourceSha + '`',
    '',
    '## Packaged smoke matrix',
    '| Gate | Result | Evidence |',
    '| --- | --- | --- |',
    ...rows.map(([gate, resultEvidence]) => `| ${gate} | ${resultEvidence.split(' | ')[0]} | ${resultEvidence.split(' | ').slice(1).join(' | ')} |`),
    '',
    '## Regression provenance',
    noRegression,
    '',
  ].join('\n')
}

function manifest(assets: typeof candidateAssets) {
  return assets.map((asset) => `${asset.sha256}  ${asset.name}`).join('\n') + '\n'
}

function releaseReport({ phase, releaseId, tag, assets }: { phase: string, releaseId: number, tag: string, assets: typeof candidateAssets }) {
  const checksums = manifest(assets)
  const checksumsSha256 = createHash('sha256').update(checksums).digest('hex')
  const release = {
    id: releaseId,
    tag_name: tag,
    draft: phase === 'prepublication',
    prerelease: true,
    body: releaseBody(assets),
    assets: [
      ...assets.map((asset, index) => ({ id: index + 1, name: asset.name, size: asset.bytes, digest: `sha256:${asset.sha256}`, state: 'uploaded' })),
      { id: 3, name: 'SHA256SUMS', size: Buffer.byteLength(checksums), digest: `sha256:${checksumsSha256}`, state: 'uploaded' },
    ],
  }
  return {
    phase,
    claimScope: BETA13_CLAIM_SCOPE,
    notClaimedCapabilities: BETA13_NOT_CLAIMED_CAPABILITIES,
    before: release,
    after: structuredClone(release),
    tagBefore: sourceSha,
    tagAfter: sourceSha,
    manifest: checksums,
    downloads: [...assets, { name: 'SHA256SUMS', sha256: checksumsSha256, bytes: Buffer.byteLength(checksums) }]
      .map((asset) => ({ ...asset, transport: phase === 'prepublication' ? 'authenticated-draft-api' : 'unauthenticated-public', url: `https://github.com/donal0c/sartracker-web/releases/download/${tag}/${asset.name}` })),
  }
}

describe('read-only release adapter', () => {
  it('compiles fixed C27 draft and rollback reads without accepting commands or URLs', () => {
    const plan = buildReleaseRequestPlan({ normalized: definition, binding: { contractId: 'C27', proofMode: 'ci-appimage', phase: 'prepublication' } })
    expect(plan.phase).toBe('prepublication')
    expect(plan.expected).toEqual({ releaseId: 123, tag: definition.releaseInputs.tag, sourceSha, assets: candidateAssets })
    expect(plan.rollbackExpected).toEqual(definition.releaseInputs.rollback)
    expect(plan.operations.every((operation) => operation.kind === 'api' || operation.kind === 'download')).toBe(true)
    expect(plan.operations.every((operation) => operation.repository === 'donal0c/sartracker-web')).toBe(true)
    expect(plan.operations.flatMap((operation) => operation.command ?? []).join(' ')).not.toMatch(/(?:\bpublish\b|\bdelete\b|\bedit\b|\brelease\s+create\b|\binstall\b)/iu)
    expect(plan.operations.some((operation) => operation.auth === 'authenticated-draft-api')).toBe(true)
    expect(plan.operations.some((operation) => operation.auth === 'unauthenticated-public')).toBe(true)
  })

  it('compiles C00 as a fresh unauthenticated public read', () => {
    const plan = buildReleaseRequestPlan({ normalized: definition, binding: { contractId: 'C00', proofMode: 'public-release', phase: 'postpublication' } })
    expect(plan.phase).toBe('postpublication')
    expect(plan.operations.every((operation) => operation.auth === 'unauthenticated-public')).toBe(true)
    expect(plan.operations.every((operation) => operation.command === undefined)).toBe(true)
    expect(plan.operations.map((operation) => operation.url).filter(Boolean)).toContain(
      'https://github.com/donal0c/sartracker-web/releases/download/electron-v0.1.0-beta.13/candidate.AppImage',
    )
  })

  it('recomputes a retained C00 report from the report file and rejects byte mutation', async () => {
    const attemptDirectory = await mkdtemp(path.join(os.tmpdir(), 'qualification-release-adapter-'))
    try {
      const report = releaseReport({ phase: 'postpublication', releaseId: 123, tag: definition.releaseInputs.tag, assets: candidateAssets })
      report.claimScope = Object.fromEntries(Object.entries(report.claimScope).reverse())
      report.notClaimedCapabilities = report.notClaimedCapabilities.map((capability) =>
        Object.fromEntries(Object.entries(capability).reverse()))
      const reportPath = path.join(attemptDirectory, 'release-report.json')
      await writeFile(reportPath, JSON.stringify(report), { flag: 'wx' })
      const receipt = await validateRetainedRelease({ reportPath, status: 'PASS' }, { contractId: 'C00', proofMode: 'public-release', phase: 'postpublication' }, { definition, attemptDirectory })
      expect(receipt).toMatchObject({ status: 'PASS', validation: { status: 'PASS' }, releaseEligible: false })

      report.downloads[0].sha256 = '9'.repeat(64)
      await rm(reportPath)
      await writeFile(reportPath, JSON.stringify(report), { flag: 'wx' })
      await expect(validateRetainedRelease({ reportPath, status: 'PASS' }, { contractId: 'C00', proofMode: 'public-release', phase: 'postpublication' }, { definition, attemptDirectory })).rejects.toThrow(/Fresh release transfer|retained release/i)
      await truncate(reportPath, 16 * 1024 * 1024 + 1)
      await expect(validateRetainedRelease({ reportPath, status: 'PASS' }, { contractId: 'C00', proofMode: 'public-release', phase: 'postpublication' }, { definition, attemptDirectory })).rejects.toThrow(/bounded/iu)
    } finally {
      await rm(attemptDirectory, { recursive: true, force: true })
    }
  })

  it('rejects a retained C27/C00 report whose NOT_CLAIMED record was altered', async () => {
    const attemptDirectory = await mkdtemp(path.join(os.tmpdir(), 'qualification-release-adapter-'))
    try {
      const report = releaseReport({ phase: 'postpublication', releaseId: 123, tag: definition.releaseInputs.tag, assets: candidateAssets })
      report.notClaimedCapabilities = []
      const reportPath = path.join(attemptDirectory, 'release-report.json')
      await writeFile(reportPath, JSON.stringify(report), { flag: 'wx' })
      await expect(validateRetainedRelease({ reportPath, status: 'PASS' },
        { contractId: 'C00', proofMode: 'public-release', phase: 'postpublication' },
        { definition, attemptDirectory })).rejects.toThrow(/claim scope/iu)
    } finally {
      await rm(attemptDirectory, { recursive: true, force: true })
    }
  })

  it('revalidates both the C27 draft and its independently downloaded rollback release', async () => {
    const attemptDirectory = await mkdtemp(path.join(os.tmpdir(), 'qualification-release-adapter-'))
    try {
      const report = releaseReport({ phase: 'prepublication', releaseId: 123, tag: definition.releaseInputs.tag, assets: candidateAssets })
      report.rollback = releaseReport({ phase: 'postpublication', releaseId: 122, tag: definition.releaseInputs.rollback.tag, assets: rollbackAssets })
      report.releaseCi = {
        run: { id: 1, run_attempt: 1, head_sha: sourceSha, head_branch: definition.releaseInputs.tag,
          path: '.github/workflows/electron-release.yml', event: 'push', status: 'completed', conclusion: 'success',
          repository: { full_name: 'donal0c/sartracker-web' }, head_repository: { full_name: 'donal0c/sartracker-web' } },
        artifact: { id: 2, name: 'electron-linux-artifacts', expired: false, digest: `sha256:${'f'.repeat(64)}`,
          size_in_bytes: 30, workflow_run: { id: 1, head_sha: sourceSha } },
      }
      report.releaseCiAfter = structuredClone(report.releaseCi)
      report.repositoryControls = { sourceSha, observedAt: '2026-09-19T22:00:00.000Z',
        repository: { default_branch: 'master', security_and_analysis: {
          secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } },
        branch: { name: 'master', protected: true }, rules: [{ type: 'deletion' }, { type: 'non_fast_forward' },
          { type: 'pull_request', parameters: { required_approving_review_count: 1, required_review_thread_resolution: true } },
          { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'gate' }] } }],
        checks: { total_count: 1, check_runs: [{ name: 'gate', head_sha: sourceSha, status: 'completed', conclusion: 'success' }] } }
      report.repositoryControlsAfter = structuredClone(report.repositoryControls)
      const reportPath = path.join(attemptDirectory, 'release-report.json')
      await writeFile(reportPath, JSON.stringify(report), { flag: 'wx' })
      const receipt = await validateRetainedRelease({ reportPath, status: 'PASS' }, { contractId: 'C27', proofMode: 'ci-appimage', phase: 'prepublication' }, { definition, attemptDirectory })
      expect(receipt).toMatchObject({ status: 'PASS', validation: { status: 'PASS' }, rollbackValidation: { status: 'PASS' } })
      report.repositoryControlsAfter.rules = []
      await writeFile(reportPath, JSON.stringify(report))
      await expect(validateRetainedRelease({ reportPath, status: 'PASS' }, { contractId: 'C27', proofMode: 'ci-appimage', phase: 'prepublication' }, { definition, attemptDirectory })).rejects.toThrow(/status differs/i)
      await expect(validateRetainedRelease({ reportPath, status: 'NEEDS_HUMAN_DECISION' }, { contractId: 'C27', proofMode: 'ci-appimage', phase: 'prepublication' }, { definition, attemptDirectory })).resolves.toMatchObject({ status: 'NEEDS_HUMAN_DECISION' })
      report.repositoryControlsAfter = structuredClone(report.repositoryControls)
      report.releaseCiAfter.run.run_attempt = 2
      await writeFile(reportPath, JSON.stringify(report))
      await expect(validateRetainedRelease({ reportPath, status: 'PASS' }, { contractId: 'C27', proofMode: 'ci-appimage', phase: 'prepublication' }, { definition, attemptDirectory })).rejects.toThrow(/workflow|run identity/iu)
      report.releaseCiAfter.run.run_attempt = 1
      report.releaseCi.run.conclusion = 'failure'
      await writeFile(reportPath, JSON.stringify(report))
      await expect(validateRetainedRelease({ reportPath, status: 'PASS' }, { contractId: 'C27', proofMode: 'ci-appimage', phase: 'prepublication' }, { definition, attemptDirectory })).rejects.toThrow(/workflow|run identity/iu)
    } finally {
      await rm(attemptDirectory, { recursive: true, force: true })
    }
  })
})
