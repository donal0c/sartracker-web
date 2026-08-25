import type {
  CoverageManifest,
  CoverageManifestChunk,
} from '../../infrastructure/mission-store/tauri-mission-store'

export type CoverageScheduler = {
  readonly order: (
    manifest: CoverageManifest,
    chunks: readonly CoverageManifestChunk[],
  ) => readonly CoverageManifestChunk[]
  readonly recordAttempt: (chunk: CoverageManifestChunk) => void
}

/**
 * Orders pending work newest-period-first with stable device fairness, while
 * suppressing repeated open-outing builds until their cooldown expires.
 */
export function createCoverageScheduler(input: {
  readonly now: () => number
  readonly openOutingCooldownMs: number
}): CoverageScheduler {
  const lastAttemptByChunk = new Map<string, number>()

  return {
    order: (manifest, chunks) => {
      const outingById = new Map(manifest.outings.map((outing) => [outing.id, outing]))
      const grouped = new Map<string, CoverageManifestChunk[]>()
      for (const chunk of chunks) {
        const periodIdentity = `${chunk.key.period_kind}\u0000${chunk.key.period_id}`
        const periodChunks = grouped.get(periodIdentity) ?? []
        periodChunks.push(chunk)
        grouped.set(periodIdentity, periodChunks)
      }
      const orderedPeriods = [...grouped.entries()].sort((left, right) => {
        const leftStart = periodStart(left[1][0], outingById)
        const rightStart = periodStart(right[1][0], outingById)
        return rightStart.localeCompare(leftStart) || left[0].localeCompare(right[0])
      })
      const ready: CoverageManifestChunk[] = []
      for (const [, periodChunks] of orderedPeriods) {
        periodChunks.sort((left, right) =>
          left.key.device_id.localeCompare(right.key.device_id))
        for (const chunk of periodChunks) {
          const outing = chunk.key.period_kind === 'outing'
            ? outingById.get(chunk.key.period_id)
            : undefined
          const lastAttempt = lastAttemptByChunk.get(chunkIdentity(chunk))
          if (
            outing?.ended_at === null &&
            lastAttempt !== undefined &&
            input.now() - lastAttempt < input.openOutingCooldownMs
          ) {
            continue
          }
          ready.push(chunk)
        }
      }
      return ready
    },
    recordAttempt: (chunk) => {
      lastAttemptByChunk.set(chunkIdentity(chunk), input.now())
    },
  }
}

function chunkIdentity(chunk: CoverageManifestChunk): string {
  return `${chunk.key.device_id}\u0000${chunk.key.period_kind}\u0000${chunk.key.period_id}`
}

function periodStart(
  chunk: CoverageManifestChunk | undefined,
  outingById: ReadonlyMap<string, CoverageManifest['outings'][number]>,
): string {
  if (chunk?.key.period_kind !== 'outing') return ''
  return outingById.get(chunk.key.period_id)?.started_at ?? ''
}
