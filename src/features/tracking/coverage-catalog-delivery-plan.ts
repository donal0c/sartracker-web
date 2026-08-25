import type {
  CoverageManifest,
  CoverageManifestChunk,
} from '../../infrastructure/mission-store/tauri-mission-store'

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
    input.priorManifest,
    input.priorDelivered,
    input.retainDelivery,
  )
  const batches: CoverageManifestChunk[][] = []
  for (const periodBatch of groupChunksByPeriod(input.orderedPending)) {
    const periodIdentity = coveragePeriodIdentity(periodBatch[0]!)
    for (const [identity, descriptor] of working.entries()) {
      if (coveragePeriodIdentity(descriptor) === periodIdentity) working.delete(identity)
    }
    for (const descriptor of input.manifest.chunks.filter((chunk) =>
      coveragePeriodIdentity(chunk) === periodIdentity)) {
      working.set(coverageChunkIdentity(descriptor.key), descriptor)
    }
    batches.push([...working.values()])
  }
  return batches
}

function coverageChunkIdentity(key: CoverageManifestChunk['key']): string {
  return `${key.device_id}\u0000${key.period_kind}\u0000${key.period_id}`
}

function retainRenderableDescriptors(
  prior: CoverageManifest | null,
  delivered: CoverageDelivery,
  retainDelivery: boolean,
): Map<string, CoverageManifestChunk> {
  if (!retainDelivery || prior === null) return new Map()
  return new Map(prior.chunks.flatMap((chunk) => {
    const identity = coverageChunkIdentity(chunk.key)
    return delivered[identity] === chunk.contentRev ? [[identity, chunk]] : []
  }))
}

function groupChunksByPeriod(
  chunks: readonly CoverageManifestChunk[],
): readonly (readonly CoverageManifestChunk[])[] {
  const groups: CoverageManifestChunk[][] = []
  for (const chunk of chunks) {
    const identity = coveragePeriodIdentity(chunk)
    const current = groups.at(-1)
    if (current === undefined || coveragePeriodIdentity(current[0]!) !== identity) {
      groups.push([chunk])
    } else {
      current.push(chunk)
    }
  }
  return groups
}

function coveragePeriodIdentity(chunk: CoverageManifestChunk): string {
  return `${chunk.key.period_kind}\u0000${chunk.key.period_id}`
}
