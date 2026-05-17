import type { TrackingConnectionStatus } from './tracking-types'

export type CommandMastTrackingReadoutInput = {
  readonly mode: TrackingConnectionStatus['mode']
  readonly fixCount: number
  readonly staleCount: number
}

export type CommandMastTrackingReadoutTone = 'success' | 'warning' | 'default'

export type CommandMastTrackingReadout = {
  readonly label: string
  readonly tone: CommandMastTrackingReadoutTone
  readonly fix: {
    readonly label: 'FIX'
    readonly value: string
  }
  readonly stale: {
    readonly label: 'STALE'
    readonly value: string
    readonly tone: 'warning' | 'muted'
  }
}

/**
 * Builds the mast tracking readout from raw tracking state.
 *
 * Why this exists: the previous mast cell rendered `${positions.length}/${staleCount}` (e.g. `14/13`),
 * which scans visually as the impossible ratio "14 of 13". This selector splits the values into two
 * independent chips (FIX, STALE) so neither glance-readability nor the underlying semantics depend on
 * a single concatenated string.
 */
export function selectCommandMastTrackingReadout(
  input: CommandMastTrackingReadoutInput,
): CommandMastTrackingReadout {
  const staleHasIssues = input.staleCount > 0
  const offline = input.mode === 'offline'

  const tone: CommandMastTrackingReadoutTone =
    input.mode === 'online' && !staleHasIssues
      ? 'success'
      : staleHasIssues || offline
        ? 'warning'
        : 'default'

  return {
    label: input.mode.toUpperCase(),
    tone,
    fix: {
      label: 'FIX',
      value: String(input.fixCount),
    },
    stale: {
      label: 'STALE',
      value: String(input.staleCount),
      tone: staleHasIssues ? 'warning' : 'muted',
    },
  }
}
