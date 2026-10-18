import type { CoverageState } from './coverage-controller'

/**
 * Coverage refreshes run every 30 s. Under constant tracking a refresh can lose
 * the race with new fixes and come back stale; that is expected and retried
 * quietly. Ten cycles without reaching Complete is not, so it is escalated.
 */
export const COVERAGE_PERSISTENTLY_STALE_AFTER_MS = 5 * 60_000
export const COVERAGE_PERSISTENTLY_STALE_MIN_RESULTS = 5

export type CoveragePersistentStaleness = {
  readonly staleForMs: number
  readonly staleResults: number
}

export type CoverageStalenessRecovery = {
  readonly reason: 'complete' | 'mission_changed' | 'stopped'
  readonly staleForMs: number
}

export type CoverageStalenessMonitor = {
  /** Feeds every published coverage state, in order. */
  readonly observe: (state: CoverageState) => void
  /** Ends monitoring; an open escalation is withdrawn as `stopped`. */
  readonly stop: () => void
}

/**
 * Watches published coverage states for a stale spell that never reaches
 * Complete [DON-334]. An episode opens at the first stale result and closes
 * only at Complete, a mission change or stop; loading and error states keep it
 * open. It escalates once per episode, when it has lasted
 * `COVERAGE_PERSISTENTLY_STALE_AFTER_MS` with at least
 * `COVERAGE_PERSISTENTLY_STALE_MIN_RESULTS` stale results, and reports the
 * matching recovery when an escalated episode closes.
 */
export function createCoverageStalenessMonitor(input: {
  readonly now?: () => number
  readonly onPersistent: (staleness: CoveragePersistentStaleness) => void
  readonly onRecovered: (recovery: CoverageStalenessRecovery) => void
}): CoverageStalenessMonitor {
  const now = input.now ?? (() => Date.now())
  let missionId: string | null = null
  // The controller's stale counter is cumulative and resets with its identity.
  let lastStaleCount = 0
  let staleSinceMs: number | null = null
  let staleResults = 0
  let escalated = false

  const closeEpisode = (reason: CoverageStalenessRecovery['reason']): void => {
    if (escalated && staleSinceMs !== null) {
      input.onRecovered({ reason, staleForMs: now() - staleSinceMs })
    }
    staleSinceMs = null
    staleResults = 0
    escalated = false
  }

  return {
    observe(state) {
      const nextMissionId = state.status === 'inactive' ? null : state.missionId
      if (nextMissionId !== missionId) {
        closeEpisode('mission_changed')
        missionId = nextMissionId
        lastStaleCount = 0
      }
      if (state.status === 'inactive') return
      if (state.status === 'complete') {
        closeEpisode('complete')
        lastStaleCount = state.retryableStaleCount ?? 0
        return
      }

      const staleCount = state.retryableStaleCount ?? 0
      if (staleCount > lastStaleCount) {
        staleSinceMs ??= now()
        staleResults += staleCount - lastStaleCount
      }
      lastStaleCount = staleCount

      if (escalated || staleSinceMs === null) return
      const staleForMs = now() - staleSinceMs
      if (staleForMs >= COVERAGE_PERSISTENTLY_STALE_AFTER_MS &&
        staleResults >= COVERAGE_PERSISTENTLY_STALE_MIN_RESULTS) {
        escalated = true
        input.onPersistent({ staleForMs, staleResults })
      }
    },
    stop() {
      closeEpisode('stopped')
      missionId = null
      lastStaleCount = 0
    },
  }
}
