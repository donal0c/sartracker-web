const REPOSITORY = 'donal0c/sartracker-web'

/** Collect fresh, read-only repository controls and candidate-associated review metadata. */
export async function collectRepositoryControls(sourceSha, readJson) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha)) throw new Error('Repository controls require an exact candidate SHA.')
  const prefix = `repos/${REPOSITORY}`
  const [repository, branch, rules, checks, pulls] = await Promise.all([
    readJson(prefix), readJson(`${prefix}/branches/master`), readJson(`${prefix}/rules/branches/master`),
    readJson(`${prefix}/commits/${sourceSha}/check-runs?per_page=100`),
    readJson(`${prefix}/commits/${sourceSha}/pulls?per_page=100`),
  ])
  if (!Array.isArray(pulls) || pulls.length >= 100) throw new Error('Candidate-associated pull request inventory is incomplete.')
  const reviews = []
  for (const pull of pulls) {
    if (!Number.isSafeInteger(pull.number) || pull.number < 1) throw new Error('Associated pull request identity is invalid.')
    const responses = await readJson(`${prefix}/pulls/${pull.number}/reviews?per_page=100`)
    if (!Array.isArray(responses) || responses.length >= 100) throw new Error('Candidate review inventory is incomplete.')
    reviews.push({ number: pull.number, headSha: pull.head?.sha, mergeSha: pull.merge_commit_sha,
      mergedAt: pull.merged_at, author: pull.user?.login,
      reviews: responses.map(review => ({ id: review.id, state: review.state, commitId: review.commit_id,
        author: review.user?.login, submittedAt: review.submitted_at })) })
  }
  return { schema: 'sartracker-repository-controls-v1', observedAt: new Date().toISOString(), sourceSha,
    repository: { default_branch: repository.default_branch, security_and_analysis: repository.security_and_analysis },
    branch: { name: branch.name, protected: branch.protected, sha: branch.commit?.sha }, rules,
    checks: { total_count: checks.total_count, check_runs: checks.check_runs?.map(check => ({
      id: check.id, name: check.name, head_sha: check.head_sha, status: check.status, conclusion: check.conclusion, appId: check.app?.id,
    })) }, reviews }
}

/** Report unmet documented REL-004 invariants; this assessment never grants release authority. */
export function assessRepositoryControls(facts, sourceSha) {
  if (!/^[a-f0-9]{40}$/u.test(sourceSha) || facts?.sourceSha !== sourceSha || !Array.isArray(facts.rules)
      || !Array.isArray(facts.checks?.check_runs) || !Number.isSafeInteger(facts.checks.total_count)
      || facts.checks.total_count !== facts.checks.check_runs.length) throw new Error('Repository control identity or check inventory is incomplete.')
  const gaps = []
  if (facts.repository?.default_branch !== 'master' || facts.branch?.name !== 'master' || facts.branch.protected !== true) gaps.push('master protection is absent or unobservable')
  for (const rule of ['deletion', 'non_fast_forward']) {
    if (!facts.rules.some(value => value.type === rule)) gaps.push(`required ${rule} rule is absent`)
  }
  const review = facts.rules.find(value => value.type === 'pull_request')?.parameters
  if (!(review?.required_approving_review_count >= 1) || review.required_review_thread_resolution !== true) gaps.push('independent approval and resolved-review enforcement is absent')
  const requiredChecks = facts.rules.filter(value => value.type === 'required_status_checks')
    .flatMap(value => value.parameters?.required_status_checks ?? [])
  if (requiredChecks.length === 0) gaps.push('required status-check enforcement is absent')
  for (const required of requiredChecks) {
    const matching = facts.checks.check_runs.filter(check => check.name === required.context && check.head_sha === sourceSha
      && (required.integration_id === undefined || required.integration_id === null || required.integration_id === -1 || check.appId === required.integration_id))
    if (matching.length === 0 || matching.some(check => check.status !== 'completed' || check.conclusion !== 'success')) {
      gaps.push(`required exact-head check is missing or unsuccessful: ${required.context}`)
    }
  }
  for (const name of ['secret_scanning', 'secret_scanning_push_protection']) {
    if (facts.repository?.security_and_analysis?.[name]?.status !== 'enabled') gaps.push(`${name} is disabled or unobservable`)
  }
  return { gaps, releaseEligible: false, sourceSha, reviewMetadataRetained: Array.isArray(facts.reviews) }
}
