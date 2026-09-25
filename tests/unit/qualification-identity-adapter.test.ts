import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { validateRetainedIdentity } from '../../scripts/qualification/identity-adapter.mjs'
import { CANONICAL_INSTALLED_EXECUTABLE_PATH } from '../../scripts/qualification/candidate-artifacts.mjs'

const sourceSha = 'a'.repeat(40)
const archiveSha = 'b'.repeat(64)
const appImageSha = 'c'.repeat(64)
const debSha = 'd'.repeat(64)
const version = '0.1.0-beta.13'
const payload = [{ path: CANONICAL_INSTALLED_EXECUTABLE_PATH.slice(1), sha256: 'e'.repeat(64), size: 50, executableBits: 73 }]
const run = {
  id: 123,
  run_attempt: 1,
  head_sha: sourceSha,
  head_branch: 'master',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  path: '.github/workflows/electron-linux-validation.yml',
  repository: { full_name: 'donal0c/sartracker-web' },
  head_repository: { full_name: 'donal0c/sartracker-web' },
}
const artifact = {
  id: 456,
  name: `electron-linux-artifacts-${sourceSha}`,
  expired: false,
  digest: `sha256:${archiveSha}`,
  workflow_run: { id: 123, head_sha: sourceSha },
  size_in_bytes: 100,
}
const config = {
  ci: {
    version,
    provenance: { sourceSha, runId: 123, runAttempt: 1, artifactId: 456 },
    archive: { path: '/owned/candidate.zip', sha256: archiveSha, bytes: 100 },
    installers: [
      { role: 'ci-appimage', path: '/owned/candidate.AppImage', sha256: appImageSha, bytes: 10 },
      { role: 'ci-deb', path: '/owned/candidate.deb', sha256: debSha, bytes: 20 },
    ],
  },
  installedExecutablePath: CANONICAL_INSTALLED_EXECUTABLE_PATH,
}
const definition = {
  identities: {
    source: { sha: sourceSha },
    candidate: {
      version,
      artifacts: [
        { role: 'ci-appimage', path: config.ci.installers[0].path, sha256: appImageSha, bytes: 10 },
        { role: 'ci-deb', path: config.ci.installers[1].path, sha256: debSha, bytes: 20 },
      ],
    },
  },
  runtimeInputs: { schema: 'sartracker-bound-runtime-inputs-v1', config },
}

/** Build the retained identity report emitted by the read-only runtime verifier. */
function report() {
  return {
    schema: 'sartracker-identity-report-v1',
    status: 'PASS',
    scope: 'ci-installation-identity-only',
    launchVerified: false,
    sourceSha,
    version,
    ciMetadata: { run, artifact },
    ci: {
      schema: 'sartracker-candidate-ci-artifacts-v1',
      version,
      provenance: { repository: 'donal0c/sartracker-web', workflow: run.path, sourceSha, runId: 123, runAttempt: 1, artifactId: 456, archiveSha256: archiveSha, archiveBytes: 100 },
      archive: { path: '/owned/candidate.zip', sha256: archiveSha, bytes: 100 },
      installers: [
        { path: '/owned/verified-ci/candidate.AppImage', sha256: appImageSha, bytes: 10, role: 'ci-appimage' },
        { path: '/owned/verified-ci/candidate.deb', sha256: debSha, bytes: 20, role: 'ci-deb' },
      ],
    },
    installation: {
      schema: 'sartracker-candidate-installed-deb-v1',
      deb: { path: '/owned/candidate.deb', sha256: debSha, bytes: 20 },
      packageName: 'sartracker-web',
      status: 'install ok installed',
      version,
      architecture: 'amd64',
      files: payload,
      payloadExpected: { packageName: 'sartracker-web', version, architecture: 'amd64', files: payload.map((entry) => ({ ...entry })) },
    },
    installedExecutablePath: config.installedExecutablePath,
  }
}

describe('C00 CI and installation identity adapter', () => {
  it('revalidates retained CI metadata, archive/installers, and installed payload without claiming launch', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qualification-identity-adapter-'))
    try {
      const reportPath = path.join(directory, 'identity-report.json')
      await writeFile(reportPath, JSON.stringify(report()), { flag: 'wx' })
      const checked = await validateRetainedIdentity({ reportPath, status: 'PASS' }, { contractId: 'C00', proofMode: 'ci-appimage' }, { definition, attemptDirectory: directory })
      expect(checked).toMatchObject({ status: 'PASS', validation: { status: 'PASS' }, releaseEligible: false })
      expect(checked.validation.scope).toBe('ci-installation-identity-only')
      expect(checked.validation.launchVerified).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('revalidates retained producer and consumer lineage after a failed-job-only rerun', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qualification-identity-rerun-'))
    try {
      const retained = structuredClone(report())
      retained.ciMetadata.run.run_attempt = 2
      retained.ciMetadata.artifact.name = `electron-linux-artifacts-${sourceSha}-attempt-1`
      retained.ci.provenance.runAttempt = 2
      const jobs = [
        { name: 'Build exact Linux package', run_attempt: 1 },
        { name: 'Packaged Linux checks', run_attempt: 2 },
      ].map(job => ({ ...job, run_id: 123, head_sha: sourceSha, status: 'completed', conclusion: 'success' }))
      const reportPath = path.join(directory, 'identity-report.json')
      await writeFile(reportPath, JSON.stringify({ ...retained, ciMetadata: { ...retained.ciMetadata, jobs } }))
      const rerunDefinition = structuredClone(definition)
      rerunDefinition.runtimeInputs.config.ci.provenance.runAttempt = 2
      await expect(validateRetainedIdentity({ reportPath, status: 'PASS' }, { contractId: 'C00', proofMode: 'ci-appimage' },
        { definition: rerunDefinition, attemptDirectory: directory })).resolves.toBeDefined()
      await writeFile(reportPath, JSON.stringify(retained))
      await expect(validateRetainedIdentity({ reportPath, status: 'PASS' }, { contractId: 'C00', proofMode: 'ci-appimage' },
        { definition: rerunDefinition, attemptDirectory: directory })).rejects.toThrow(/lineage/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['run source', (value: ReturnType<typeof report>) => { value.ciMetadata.run.head_sha = 'f'.repeat(40) }],
    ['archive hash', (value: ReturnType<typeof report>) => { value.ci.archive.sha256 = 'f'.repeat(64) }],
    ['installer bytes', (value: ReturnType<typeof report>) => { value.ci.installers[1].bytes++ }],
    ['installed payload', (value: ReturnType<typeof report>) => { value.installation.files[0].sha256 = 'f'.repeat(64) }],
  ])('rejects retained %s substitution', async (_label, mutate) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qualification-identity-adapter-'))
    try {
      const retained = report()
      mutate(retained)
      const reportPath = path.join(directory, 'identity-report.json')
      await writeFile(reportPath, JSON.stringify(retained), { flag: 'wx' })
      await expect(validateRetainedIdentity({ reportPath, status: 'PASS' }, { contractId: 'C00', proofMode: 'ci-appimage' }, { definition, attemptDirectory: directory })).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a report that claims a runtime launch identity', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'qualification-identity-adapter-'))
    try {
      const retained = report()
      retained.launchVerified = true
      const reportPath = path.join(directory, 'identity-report.json')
      await writeFile(reportPath, JSON.stringify(retained), { flag: 'wx' })
      await expect(validateRetainedIdentity({ reportPath, status: 'PASS' }, { contractId: 'C00', proofMode: 'ci-appimage' }, { definition, attemptDirectory: directory })).rejects.toThrow(/launch/i)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
