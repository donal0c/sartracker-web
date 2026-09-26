import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

type Step = { name?: string; run?: string; if?: string; uses?: string; 'continue-on-error'?: boolean; with?: Record<string, string> }
/** Reads the gate steps used by the real GitHub workflow. */
function steps(file: string, job: string): Step[] {
  const workflow = load(readFileSync(file, 'utf8')) as { jobs: Record<string, { steps: Step[] }> }
  return workflow.jobs[job].steps
}

describe('full Chromium release preflight', () => {
  it('requires the isolated browser driver contract before application Chromium gates', () => {
    for (const [file, job, appStep] of [
      ['.github/workflows/electron-linux-validation.yml', 'correctness', 'Full Chromium release preflight'],
      ['.github/workflows/electron-release.yml', 'gates', 'Standard Chromium E2E'],
    ]) {
      const gateSteps = steps(file, job)
      const index = gateSteps.findIndex(step => step.name === 'Browser driver promise lifetime contract')
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(gateSteps.findIndex(step => step.name === appStep))
      expect(gateSteps[index].run).toBe('npm run test:browser-driver')
      expect(gateSteps[index].if).toBeUndefined()
      expect(gateSteps[index]['continue-on-error']).toBeUndefined()
    }
  })

  it('runs the release Chromium command on Linux source CI without retaining a duplicate coverage-only run', () => {
    const source = steps('.github/workflows/electron-linux-validation.yml', 'correctness')
    const release = steps('.github/workflows/electron-release.yml', 'gates')
    const command = release.find(step => step.name === 'Standard Chromium E2E')!.run!
    expect(command).toContain('--fail-on-flaky-tests')
    const preflight = source.find(step => step.name === 'Full Chromium release preflight')
    expect(preflight?.run).toContain(command)
    expect(preflight?.run).toContain('set -euo pipefail')
    expect(preflight?.run).not.toMatch(/--(?:grep|retries|timeout|workers|config)|\|\|\s*true/)
    expect(preflight?.['continue-on-error']).toBeUndefined()
    expect(preflight?.if).toBeUndefined()
    expect(source.some(step => step.run?.includes('playwright test tests/e2e/coverage.spec.ts'))).toBe(false)
  })

  it('preserves full-suite traces even when source or release gates fail', () => {
    const source = steps('.github/workflows/electron-linux-validation.yml', 'correctness')
    const sourceUpload = source.find(step => step.name === 'Upload validation evidence')!
    expect(sourceUpload.if).toBe('always()')
    expect(sourceUpload.with?.path).toContain('test-results/release-chromium')
    const release = steps('.github/workflows/electron-release.yml', 'gates')
    const releaseUpload = release.find(step => step.name === 'Preserve Chromium release evidence')
    expect(releaseUpload?.if).toBe('always()')
    expect(releaseUpload?.uses).toBe('actions/upload-artifact@v4')
    expect(releaseUpload?.with?.path).toContain('test-results')
    expect(releaseUpload?.with?.name).toContain('github.run_attempt')
    expect(releaseUpload?.with?.name).toContain('steps.resolve_tag.outputs.commit')
    expect(releaseUpload?.with?.name).not.toContain('github.sha')
  })

  it('retains release installers for the full supported campaign retention period', () => {
    const upload = steps('.github/workflows/electron-release.yml', 'bundle-linux')
      .find(step => step.name === 'Upload built artifacts for downstream jobs')!
    expect(upload.with?.['retention-days']).toBe(90)
  })
})
