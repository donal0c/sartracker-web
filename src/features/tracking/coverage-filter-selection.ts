import type {
  CoverageChunkKey,
  CoverageManifest,
  CoverageManifestChunk,
} from '../../infrastructure/mission-store/tauri-mission-store'

export type CoverageOmissions = {
  readonly omittedDeviceIds: readonly string[]
  readonly omittedPeriodKeys: readonly string[]
}

/** Selects manifest chunks from stable omission predicates, including later additions. */
export function selectCoverageManifestChunks(
  manifest: CoverageManifest,
  filters: CoverageOmissions,
): readonly CoverageManifestChunk[] {
  if (filters.omittedDeviceIds.length === 0 && filters.omittedPeriodKeys.length === 0) {
    return manifest.chunks
  }
  const omittedDevices = new Set(filters.omittedDeviceIds)
  const omittedPeriods = new Set(filters.omittedPeriodKeys)
  return manifest.chunks.filter((chunk) =>
    !omittedDevices.has(chunk.key.device_id) &&
    !omittedPeriods.has(coveragePeriodKey(chunk.key)))
}

/** Selects the exact claim denominator without changing evidence or live scope. */
export function selectCoverageChunkKeys(
  manifest: CoverageManifest | null,
  filters: CoverageOmissions,
): readonly CoverageChunkKey[] | undefined {
  if (filters.omittedDeviceIds.length === 0 && filters.omittedPeriodKeys.length === 0) {
    return undefined
  }
  if (manifest === null) return []
  return selectCoverageManifestChunks(manifest, filters).map((chunk) => chunk.key)
}

/** Returns the stable identity used by period visibility filters. */
export function coveragePeriodKey(key: CoverageChunkKey): string {
  return `${key.period_kind}\u0000${key.period_id}`
}
