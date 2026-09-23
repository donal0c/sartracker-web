import path from 'node:path'
import { hashCandidateFile } from './candidate-artifacts.mjs'

export const COMPOSITE_SOURCE_MANIFEST_PATHS = Object.freeze([
  'electron/main.cjs', 'electron/preload.cjs', 'electron/mission-store.cjs',
  'electron/mission-archive-ipc.cjs', 'electron/archive-review-ipc.cjs',
  'electron/archive-review-sessions.cjs', 'electron/gpx-evidence-import-worker.cjs',
  'electron/diagnostic-sanitizer.cjs',
  'src/features/diagnostics/diagnostic-event-log.ts',
  'scripts/qualification/composite-probe.mjs',
  'scripts/qualification/composite-family-receipts.mjs',
  'scripts/qualification/composite-manifest.mjs',
  'scripts/qualification/c17-adversarial-corpus.mjs',
  'scripts/qualification/c17-output-scan.mjs',
  'scripts/qualification/verify-c17-packaged-support-export.mjs',
  'tests/fixtures/c17-adversarial-corpus.mjs',
  'tests/unit/qualification-c17-adversarial-corpus.test.ts',
  'tests/unit/qualification-c17-output-scan.test.ts',
  'tests/unit/qualification-c17-packaged-support-export.test.ts',
  'tests/unit/qualification-composite-producer.test.ts',
  'tests/unit/qualification-composite-family-receipts.test.ts',
])

/** Independently bind the reviewed composite module inventory to current source bytes. */
export async function createCompositeSourceManifest(sourceRoot) {
  return Promise.all(COMPOSITE_SOURCE_MANIFEST_PATHS.map(async (relativePath) => {
    const identity = await hashCandidateFile(path.join(sourceRoot, relativePath))
    return { relativePath, sha256: identity.sha256, sizeBytes: identity.bytes }
  }))
}
