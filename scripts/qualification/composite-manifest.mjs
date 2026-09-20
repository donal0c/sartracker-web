import path from 'node:path'
import { hashCandidateFile } from './candidate-artifacts.mjs'

export const COMPOSITE_SOURCE_MANIFEST_PATHS = Object.freeze([
  'electron/main.cjs', 'electron/preload.cjs', 'electron/mission-store.cjs',
  'electron/mission-archive-ipc.cjs', 'electron/archive-review-ipc.cjs',
  'electron/archive-review-sessions.cjs', 'electron/gpx-evidence-import-worker.cjs',
])

/** Independently bind the reviewed composite module inventory to current source bytes. */
export async function createCompositeSourceManifest(sourceRoot) {
  return Promise.all(COMPOSITE_SOURCE_MANIFEST_PATHS.map(async (relativePath) => {
    const identity = await hashCandidateFile(path.join(sourceRoot, relativePath))
    return { relativePath, sha256: identity.sha256, sizeBytes: identity.bytes }
  }))
}
