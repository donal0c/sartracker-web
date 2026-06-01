import type { MissionRuntimePhase } from './mission-store'

export type MissionPhase = MissionRuntimePhase

export type MissionPhaseTone = 'idle' | 'active' | 'paused' | 'recovery'

/**
 * Operator-facing banner shown while a mission is paused.
 *
 * The banner exists so the paused state never depends on colour or animation
 * alone (DON-64): the heading and detail spell out the state and the recovery
 * action in plain text, which remains legible on washed-out or monochrome
 * field displays.
 */
export type MissionPausedBanner = {
  readonly heading: string
  readonly detail: string
  readonly resumeLabel: string
}

export type MissionPhasePresentation = {
  /** Phase rendered as an uppercase status word, e.g. `PAUSED`. */
  readonly statusLabel: string
  readonly tone: MissionPhaseTone
  /** True only while paused — drives the flashing chip and Resume control. */
  readonly paused: boolean
  /**
   * True when the phase must visually demand operator attention. Today this is
   * exactly the paused phase, but the flag keeps the rendering layer from
   * hard-coding the phase comparison.
   */
  readonly attention: boolean
  /** Non-null only while paused. */
  readonly banner: MissionPausedBanner | null
}

const PAUSED_BANNER: MissionPausedBanner = {
  heading: 'Mission paused',
  detail:
    'Active-search time is frozen while paused. Resume the mission to continue tracking the operation.',
  resumeLabel: 'Resume Mission',
}

/**
 * Maps a mission runtime phase to its operator-facing presentation.
 *
 * Why this exists: DON-64 requires the paused state to be unmistakable under
 * operational stress and on imperfect displays. Centralising the phase →
 * label/tone/attention/banner mapping in one tested selector means the command
 * mast pill and the Mission Control panel cannot drift apart, and the
 * "do not rely on colour alone" guarantee is verified once, here.
 */
export function selectMissionPhasePresentation(phase: MissionPhase): MissionPhasePresentation {
  const paused = phase === 'paused'

  return {
    statusLabel: phase.toUpperCase(),
    tone: phase,
    paused,
    attention: paused,
    banner: paused ? PAUSED_BANNER : null,
  }
}
