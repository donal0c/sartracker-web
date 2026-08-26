import type { CoverageManifestChunk } from '../../infrastructure/mission-store/tauri-mission-store'
import { coverageChunkIdentity } from './coverage-identity'

type CoverageDelivery = Readonly<Record<string, number>>

/** Calculates selected-scope progress without treating built state as delivery. */
export function calculateCoverageProgress(input: {
  readonly chunks: readonly CoverageManifestChunk[]
  readonly delivered: CoverageDelivery
}): { readonly deliveredFixCount: number; readonly totalFixCount: number } {
  let deliveredFixCount = 0
  let totalFixCount = 0
  for (const chunk of input.chunks) {
    const fresh = chunk.builtRev === chunk.contentRev
    const count = fresh && chunk.fixCount !== null ? chunk.fixCount : chunk.exactCount
    totalFixCount += count
    if (fresh && input.delivered[coverageChunkIdentity(chunk.key)] === chunk.contentRev) {
      deliveredFixCount += count
    }
  }
  return { deliveredFixCount, totalFixCount }
}
