import { describe, expect, it } from 'vitest'
import { capturePackageSource, packageSourceProvenance } from '../../build/linux-package-source.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { load } from 'js-yaml'

describe('Linux package build provenance [DON-146]', () => {
  it('restores only the preceding CI web build metadata and rejects unrelated edits', () => {
    const workflow = load(readFileSync('.github/workflows/electron-linux-validation.yml', 'utf8')) as { jobs: { build: { steps: { name: string; run: string }[] } } }
    const script = workflow.jobs.build.steps.find(step => step.name === 'Production web build and bundle budgets')!.run
    const root = mkdtempSync(join(tmpdir(), 'sartracker-web-build-'))
    const bin = mkdtempSync(join(tmpdir(), 'sartracker-fake-npm-'))
    try {
      mkdirSync(join(root, 'src/lib'), { recursive: true })
      writeFileSync(join(root, 'src/lib/version.generated.ts'), 'original')
      writeFileSync(join(root, 'application.js'), 'original')
      execFileSync('git', ['init', '-q'], { cwd: root })
      execFileSync('git', ['add', '.'], { cwd: root })
      execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root })
      writeFileSync(join(bin, 'npm'), '#!/bin/sh\nprintf generated > src/lib/version.generated.ts\nif [ "$BUILD_EXTRA_CHANGE" = 1 ]; then printf changed > application.js; fi\n')
      chmodSync(join(bin, 'npm'), 0o755)
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` }
      expect(spawnSync('/bin/bash', ['-c', script], { cwd: root, env }).status).toBe(0)
      expect(capturePackageSource(root).changes).toEqual([])
      expect(spawnSync('/bin/bash', ['-c', script], { cwd: root, env: { ...env, BUILD_EXTRA_CHANGE: '1' } }).status).not.toBe(0)
      expect(readFileSync(join(root, 'application.js'), 'utf8')).toBe('changed')
      expect(readFileSync(join(root, 'src/lib/version.generated.ts'), 'utf8')).toBe('generated')
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
    }
  })
  it('distinguishes a normal generated version from pre-existing and subsequent source edits', () => {
    const root = mkdtempSync(join(tmpdir(), 'sartracker-source-'))
    try {
      mkdirSync(join(root, 'src/lib'), { recursive: true })
      writeFileSync(join(root, 'src/lib/version.generated.ts'), 'original')
      writeFileSync(join(root, 'application.js'), 'original')
      execFileSync('git', ['init', '-q'], { cwd: root })
      execFileSync('git', ['add', '.'], { cwd: root })
      execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root })
      const before = capturePackageSource(root)
      expect(packageSourceProvenance(before, before)).toMatchObject({ sourceCaptureMode: 'inspection-only', preBuildSourceCaptured: false })
      expect(packageSourceProvenance(before, before, { preBuildSourceCaptured: true }))
        .toMatchObject({ sourceCaptureMode: 'build-command', preBuildSourceCaptured: true })
      writeFileSync(join(root, 'src/lib/version.generated.ts'), 'generated')
      const after = capturePackageSource(root)
      expect(packageSourceProvenance(before, after)).toMatchObject({ sourceDirty: false, sourceDirtyBefore: false, sourceDirtyAfter: true, generatedVersionChanged: true })
      expect(packageSourceProvenance(after, after).sourceDirty).toBe(true)
      writeFileSync(join(root, 'application.js'), 'modified')
      expect(packageSourceProvenance(before, capturePackageSource(root)).sourceDirty).toBe(true)
      expect(() => packageSourceProvenance(before, { ...after, head: 'changed' })).toThrow(/source changed/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
