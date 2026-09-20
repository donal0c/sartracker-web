import { describe, expect, it } from 'vitest'
import { validateReleaseCiEvidence } from '../../scripts/qualification/release-ci.mjs'

const sourceSha = 'a'.repeat(40)
const expected = { sourceSha, version: '0.1.0-beta.13', runId: 1, runAttempt: 2, artifactId: 3,
  archive: { sha256: 'b'.repeat(64), bytes: 42 } }
const evidence = {
  run: { id: 1, run_attempt: 2, head_sha: sourceSha, head_branch: 'electron-v0.1.0-beta.13',
    path: '.github/workflows/electron-release.yml', event: 'push', status: 'completed', conclusion: 'success',
    repository: { full_name: 'donal0c/sartracker-web' }, head_repository: { full_name: 'donal0c/sartracker-web' } },
  artifact: { id: 3, name: 'electron-linux-artifacts', expired: false, digest: `sha256:${'b'.repeat(64)}`,
    size_in_bytes: 42, workflow_run: { id: 1, head_sha: sourceSha } },
}

describe('C27 tag-driven CI provenance', () => {
  it('requires the exact successful tag run and bound archive', () => {
    expect(validateReleaseCiEvidence(evidence, expected).workflow).toBe('.github/workflows/electron-release.yml')
  })
  it('rejects ordinary master validation even when it succeeded on the same source', () => {
    const changed = structuredClone(evidence)
    changed.run.path = '.github/workflows/electron-linux-validation.yml'
    changed.run.head_branch = 'master'
    changed.artifact.name = `electron-linux-artifacts-${sourceSha}`
    expect(() => validateReleaseCiEvidence(changed, expected)).toThrow(/tag-driven/iu)
  })
  it('rejects changed archive identity and failed or different attempts', () => {
    expect(() => validateReleaseCiEvidence(evidence, { ...expected, archive: { ...expected.archive, bytes: 43 } })).toThrow(/archive/iu)
    expect(() => validateReleaseCiEvidence({ ...evidence, run: { ...evidence.run, run_attempt: 3 } }, expected)).toThrow()
    expect(() => validateReleaseCiEvidence({ ...evidence, run: { ...evidence.run, conclusion: 'failure' } }, expected)).toThrow()
  })
})
