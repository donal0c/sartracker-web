import { describe, expect, it } from 'vitest'
import { assessRepositoryControls } from '../../scripts/qualification/repository-controls.mjs'
const sha = 'a'.repeat(40)
/** Synthetic API facts for invariant assessment; this is not a live control receipt. */
function facts() { return { sourceSha: sha, repository: { default_branch: 'master', security_and_analysis: {
  secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } },
  branch: { name: 'master', protected: true }, rules: [
    { type: 'deletion' }, { type: 'non_fast_forward' },
    { type: 'pull_request', parameters: { required_approving_review_count: 1, required_review_thread_resolution: true } },
    { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'reviewed-gate' }] } },
  ], checks: { total_count: 1, check_runs: [{ name: 'reviewed-gate', head_sha: sha, status: 'completed', conclusion: 'success' }] } } }
describe('release repository control observations', () => {
  it('reports met invariants without authorizing publication', () => {
    expect(assessRepositoryControls(facts(), sha)).toMatchObject({ gaps: [], releaseEligible: false })
  })
  it('keeps absent protection, checks and disabled security controls explicit', () => {
    const value = facts(); value.rules = []; value.branch.protected = false
    value.repository.security_and_analysis.secret_scanning.status = 'disabled'
    expect(assessRepositoryControls(value, sha).gaps.length).toBeGreaterThanOrEqual(5)
  })
  it('rejects a successful check from another SHA and incomplete pagination', () => {
    const value = facts(); value.checks.check_runs[0].head_sha = 'b'.repeat(40)
    expect(assessRepositoryControls(value, sha).gaps.join(' ')).toMatch(/exact-head/i)
    value.checks.total_count = 101
    expect(() => assessRepositoryControls(value, sha)).toThrow(/incomplete/i)
  })
  it('does not borrow the name of a check produced by an unrequired GitHub app', () => {
    const value = facts()
    value.rules[3].parameters.required_status_checks[0].integration_id = 123
    value.checks.check_runs[0].appId = 456
    expect(assessRepositoryControls(value, sha).gaps.join(' ')).toMatch(/exact-head/i)
    value.checks.check_runs[0].appId = 123
    expect(assessRepositoryControls(value, sha).gaps).toEqual([])
    value.checks.check_runs.push({ ...value.checks.check_runs[0], conclusion: 'failure' })
    value.checks.total_count = 2
    expect(assessRepositoryControls(value, sha).gaps.join(' ')).toMatch(/exact-head/i)
  })
})
