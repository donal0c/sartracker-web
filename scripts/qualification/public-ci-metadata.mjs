const API_ROOT = 'https://api.github.com/repos/donal0c/sartracker-web/actions'
const MAX_BYTES = 8 * 1024 * 1024
const MAX_JOBS = 10_000
const VALIDATION_WORKFLOW = '.github/workflows/electron-linux-validation.yml'

/** Read fresh public CI metadata only; callers must independently validate provenance and local bytes. */
export async function readPublicCiMetadata(runId, artifactId) {
  if (![runId, artifactId].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Exact positive CI identities are required.')
  }
  const budget = { bytes: 0, signal: AbortSignal.timeout(120_000) }
  const run = await readMetadata(`${API_ROOT}/runs/${runId}`, budget)
  const artifact = await readMetadata(`${API_ROOT}/artifacts/${artifactId}`, budget)
  const jobs = []
  if (run?.path === VALIDATION_WORKFLOW && run.run_attempt > 1) {
    let total
    const seen = new Set()
    for (let page = 1; ; page += 1) {
      // Construct each page ourselves; never follow an API-supplied URL.
      const result = await readMetadata(`${API_ROOT}/runs/${runId}/jobs?filter=all&per_page=100&page=${page}`, budget)
      if (!Number.isSafeInteger(result?.total_count) || result.total_count < 0 || result.total_count > MAX_JOBS
          || (total !== undefined && total !== result.total_count) || !Array.isArray(result.jobs)) {
        throw new Error('Public CI job history is invalid, changed or exceeds its bound.')
      }
      total = result.total_count
      if (result.jobs.length !== Math.min(100, total - jobs.length)) throw new Error('Public CI job history is incomplete.')
      for (const job of result.jobs) {
        if (!Number.isSafeInteger(job?.id) || job.id <= 0 || seen.has(job.id)) throw new Error('Public CI job history has invalid or duplicate jobs.')
        seen.add(job.id)
        jobs.push(job)
      }
      if (jobs.length === total) break
    }
  }
  return { run, artifact, jobs }
}

/** Read one fixed GitHub endpoint within the shared time/body budget, without credentials or redirects. */
async function readMetadata(url, budget) {
  const response = await fetch(url, {
    redirect: 'error', credentials: 'omit', cache: 'no-store', signal: budget.signal,
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'sartracker-public-ci-verification' },
  })
  if (response.status !== 200 || (response.url && response.url !== url) || !response.body) {
    await response.body?.cancel()
    if (response.status !== 200) throw new Error(`Public CI metadata request failed: HTTP ${response.status}.`)
    throw new Error('Public CI metadata response URL or body is invalid.')
  }
  const reader = response.body.getReader()
  const chunks = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      budget.bytes += value.byteLength
      if (budget.bytes > MAX_BYTES) throw new Error('Public CI metadata exceeds the shared size bound.')
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    throw new Error('Invalid public CI metadata JSON.')
  }
}
