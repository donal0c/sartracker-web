import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('Linux validation job boundaries', () => {
  it('retains all gates while making package checks independently rerunnable', () => {
    const workflow = load(readFileSync('.github/workflows/electron-linux-validation.yml', 'utf8')) as {
      jobs: Record<string, { needs?: string[]; if?: string; name: string; steps: { name?: string; run?: string }[] }>
    }
    expect(workflow.jobs.correctness.needs).toBeUndefined()
    expect(workflow.jobs.package.needs).toBeUndefined()
    expect(workflow.jobs.build.needs).toEqual(['package'])
    expect(workflow.jobs.required.needs).toEqual(['correctness', 'package', 'build'])
    expect(workflow.jobs.required.name).toBe('Build and inspect Linux Electron artifacts')
    expect(workflow.jobs.required.if).toContain('always()')
    expect(workflow.jobs.required.steps[0].run).toContain('!= success')
    const aggregate = workflow.jobs.required.steps[0].run!
    const good = { ...process.env, CORRECTNESS: 'success', PACKAGE: 'success', PACKAGED: 'success' }
    expect(spawnSync('bash', ['-c', aggregate], { env: good }).status).toBe(0)
    for (const lane of ['CORRECTNESS', 'PACKAGE', 'PACKAGED']) {
      for (const result of ['failure', 'skipped', 'cancelled', '']) {
        expect(spawnSync('bash', ['-c', aggregate], { env: { ...good, [lane]: result } }).status).not.toBe(0)
      }
    }
    expect(workflow.jobs.build.steps.some(step => step.name === 'Full correctness unit gate')).toBe(false)
    expect(workflow.jobs.build.steps.find(step => step.name === 'Verify and restore exact package')?.run).toContain('sha256sum -c')
    expect(workflow.jobs.package.steps.find(step => step.name === 'Preserve exact package for independent checks')?.run)
      .toContain('tmp/electron-dist dist')
    expect(workflow.jobs.build.steps.find(step => step.name === 'Verify and restore exact package')?.run)
      .toContain('test -f dist/index.html')
  })
})
