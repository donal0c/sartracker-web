import type {
  CoverageManifest,
  CoverageManifestChunk,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { coverageChunkIdentity, coveragePeriodIdentity } from './coverage-identity'

type CoverageDelivery = Readonly<Record<string, number>>

/**
 * Builds cumulative Candidate-B catalogs one logical period at a time. Prior
 * delivered revisions remain present until their replacement period is ready.
 */
export function createCoverageCatalogDeliveryBatches(input: {
  readonly manifest: CoverageManifest
  readonly priorManifest: CoverageManifest | null
  readonly priorDelivered: CoverageDelivery
  readonly retainDelivery: boolean
  readonly orderedPending: readonly CoverageManifestChunk[]
}): readonly (readonly CoverageManifestChunk[])[] {
  const working = retainRenderableDescriptors(
    input.manifest,
    input.priorManifest,
    input.priorDelivered,
    input.retainDelivery,
  )
  const batches: CoverageManifestChunk[][] = []
  for (const periodBatch of groupChunksByPeriod(input.orderedPending)) {
    const periodIdentity = coveragePeriodIdentity(periodBatch[0]!.key)
    for (const [identity, descriptor] of working.entries()) {
      if (coveragePeriodIdentity(descriptor.key) === periodIdentity) working.delete(identity)
    }
    for (const descriptor of input.manifest.chunks.filter((chunk) =>
      coveragePeriodIdentity(chunk.key) === periodIdentity)) {
      working.set(coverageChunkIdentity(descriptor.key), descriptor)
    }
    batches.push([...working.values()])
  }
  return batches
}

function retainRenderableDescriptors(
  current: CoverageManifest,
  prior: CoverageManifest | null,
  delivered: CoverageDelivery,
  retainDelivery: boolean,
): Map<string, CoverageManifestChunk> {
  if (!retainDelivery || prior === null) return new Map()
  const currentByIdentity = new Map(current.chunks.map((chunk) => [
    coverageChunkIdentity(chunk.key), chunk,
  ]))
  return new Map(prior.chunks.flatMap((chunk) => {
    const identity = coverageChunkIdentity(chunk.key)
    const currentChunk = currentByIdentity.get(identity)
    const deliveredRevision = delivered[identity]
    return typeof deliveredRevision === 'number' && Number.isSafeInteger(deliveredRevision) &&
      deliveredRevision >= 1 && currentChunk !== undefined
      ? [[identity, currentChunk]]
      : []
  }))
}

function groupChunksByPeriod(
  chunks: readonly CoverageManifestChunk[],
): readonly (readonly CoverageManifestChunk[])[] {
  const groups: CoverageManifestChunk[][] = []
  for (const chunk of chunks) {
    const identity = coveragePeriodIdentity(chunk.key)
    const current = groups.at(-1)
    if (current === undefined || coveragePeriodIdentity(current[0]!.key) !== identity) {
      groups.push([chunk])
    } else {
      current.push(chunk)
    }
  }
  return groups
}
