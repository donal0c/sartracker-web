import { describe, expect, it } from 'vitest'
import { validateCiArtifactProvenance, validateInstalledPayload } from '../../scripts/qualification/candidate-artifacts.mjs'

const sha = 'a'.repeat(40)
const digest = 'b'.repeat(64)
const expected = { sourceSha: sha, runId: 123, runAttempt: 1, artifactId: 456 }
const run = { id: 123, run_attempt: 1, head_sha: sha, head_branch: 'master', event: 'push',
  status: 'completed', conclusion: 'success', path: '.github/workflows/electron-linux-validation.yml',
  repository: { full_name: 'donal0c/sartracker-web' }, head_repository: { full_name: 'donal0c/sartracker-web' } }
const artifact = { id: 456, name: `electron-linux-artifacts-${sha}`, expired: false,
  digest: `sha256:${digest}`, workflow_run: { id: 123, head_sha: sha }, size_in_bytes: 50 }

describe('exact candidate CI and installed package boundaries', () => {
  it('binds the tag-driven release workflow separately from postmerge validation artifacts', () => {
    const releaseRun = { ...run, path: '.github/workflows/electron-release.yml', head_branch: 'electron-v0.1.0-beta.13' }
    const releaseArtifact = { ...artifact, name: 'electron-linux-artifacts' }
    expect(validateCiArtifactProvenance(releaseRun, releaseArtifact, { ...expected, version: '0.1.0-beta.13' }))
      .toMatchObject({ workflow: '.github/workflows/electron-release.yml', sourceSha: sha })
    expect(() => validateCiArtifactProvenance(releaseRun, releaseArtifact, { ...expected, version: '0.1.0-beta.14' })).toThrow()
    expect(() => validateCiArtifactProvenance(releaseRun, artifact, { ...expected, version: '0.1.0-beta.13' })).toThrow()
  })
  it('accepts only exact successful postmerge source and separately identifies ZIP bytes', () => {
    expect(validateCiArtifactProvenance(run, artifact, expected)).toMatchObject({ archiveSha256: digest, sourceSha: sha })
  })
  it.each([
    { head_sha: 'c'.repeat(40) }, { event: 'pull_request' }, { conclusion: 'failure' },
    { status: 'in_progress' }, { run_attempt: 2 }, { head_branch: 'codex/other' },
    { path: '.github/workflows/other.yml' }, { repository: { full_name: 'other/repo' } },
    { head_repository: { full_name: 'fork/repo' } },
  ])('rejects wrong CI execution identity %j', (change) => {
    expect(() => validateCiArtifactProvenance({ ...run, ...change }, artifact, expected)).toThrow()
  })
  it.each([
    { expired: true }, { digest: null }, { id: 123 }, { name: 'other' },
    { workflow_run: { id: 123, head_sha: 'c'.repeat(40) } }, { size_in_bytes: 0 },
  ])('rejects wrong archive identity %j', (change) => {
    expect(() => validateCiArtifactProvenance(run, { ...artifact, ...change }, expected)).toThrow()
  })
  it('requires actual installed dpkg state and exact payload rather than extracted files alone', () => {
    const payload = [{ path: 'opt/sar/app', sha256: digest, size: 50, executableBits: 73 }]
    const identity = { packageName: 'sartracker-web', version: '0.1.0-beta.13', architecture: 'amd64' }
    const installed = { ...identity, status: 'install ok installed', files: payload }
    expect(validateInstalledPayload(installed, { ...identity, files: payload })).toBe(true)
    for (const change of [{ status: 'deinstall ok config-files' }, { version: 'other' },
      { files: [] }, { files: [{ ...payload[0], sha256: 'c'.repeat(64) }] },
      { files: [...payload, payload[0]] }, { architecture: 'arm64' }]) {
      expect(() => validateInstalledPayload({ ...installed, ...change }, { ...identity, files: payload })).toThrow()
    }
  })
})
