import type { CoverageChunkKey } from '../../infrastructure/mission-store/tauri-mission-store'

/** Creates the stable tagged identity for one logical coverage chunk. */
export function coverageChunkIdentity(key: CoverageChunkKey): string {
  return `${key.device_id}\u0000${key.period_kind}\u0000${key.period_id}`
}

/** Creates the stable tagged identity for one logical coverage period. */
export function coveragePeriodIdentity(key: CoverageChunkKey): string {
  return `${key.period_kind}\u0000${key.period_id}`
}
