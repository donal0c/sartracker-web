import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const generatedVersionPath = 'src/lib/version.generated.ts'

/** Capture real Git state before or after packaging, without mutating it. */
export function capturePackageSource(root) {
  /** Run bounded, read-only Git commands against the supplied checkout. */
  function git(args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
  }
  return {
    head: git(['rev-parse', 'HEAD']).trim(),
    tree: git(['rev-parse', 'HEAD^{tree}']).trim(),
    changes: git(['status', '--porcelain', '-z', '--untracked-files=all']).split('\0').filter(Boolean),
    generatedVersionSha256: createHash('sha256').update(readFileSync(path.join(root, generatedVersionPath))).digest('hex'),
  }
}

/** Preserve pre-build dirtiness; distinguish only the known generated-file change. */
export function packageSourceProvenance(before, after, { preBuildSourceCaptured = false } = {}) {
  if (before.head !== after.head || before.tree !== after.tree) throw new Error('Package source changed commit/tree during the build.')
  const unexpectedAfter = after.changes.filter((change) => change !== ` M ${generatedVersionPath}`)
  return {
    sourceCaptureMode: preBuildSourceCaptured ? 'build-command' : 'inspection-only',
    preBuildSourceCaptured,
    sourceHead: before.head, sourceTree: before.tree,
    sourceDirty: before.changes.length > 0 || unexpectedAfter.length > 0,
    sourceDirtyBefore: before.changes.length > 0,
    sourceDirtyAfter: after.changes.length > 0,
    generatedVersionChanged: before.generatedVersionSha256 !== after.generatedVersionSha256,
    sourceBefore: before, sourceAfter: after,
  }
}
