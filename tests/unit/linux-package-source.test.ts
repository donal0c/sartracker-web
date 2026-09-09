import { describe, expect, it } from 'vitest'
import { capturePackageSource, packageSourceProvenance } from '../../build/linux-package-source.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('Linux package build provenance [DON-146]', () => {
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
