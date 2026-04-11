/**
 * Wall-clock-based playback engine.
 * Translates real elapsed time into scenario time using a speed multiplier.
 */
export type PlaybackEngine = {
  /** Current scenario time in milliseconds from T+0. */
  readonly getScenarioTimeMs: () => number
  /** Current scenario time as a Date (anchored to server start). */
  readonly getScenarioDate: (scenarioOffsetMs: number) => Date
  /** The anchor date (when the server started, adjusted for start offset). */
  readonly anchorDate: Date
  /** Scenario duration in ms. */
  readonly durationMs: number
}

type PlaybackOptions = {
  readonly speedMultiplier: number
  readonly startOffsetMs: number
  readonly durationMs: number
  readonly loop: boolean
}

/**
 * Creates a playback engine.
 * scenarioTimeMs = startOffsetMs + (wallElapsed * speedMultiplier)
 * The anchor date is set so that scenario T+0 corresponds to a fixed wall-clock reference.
 */
export function createPlaybackEngine(options: PlaybackOptions): PlaybackEngine {
  const serverStartMs = Date.now()

  // Anchor date: the wall-clock time that represents scenario T+0.
  // We subtract the start offset so that at server start, scenarioTimeMs = startOffsetMs.
  const anchorDate = new Date(
    serverStartMs - options.startOffsetMs / options.speedMultiplier,
  )

  return {
    getScenarioTimeMs(): number {
      const wallElapsedMs = Date.now() - serverStartMs
      let scenarioMs = options.startOffsetMs + wallElapsedMs * options.speedMultiplier

      if (options.loop && options.durationMs > 0) {
        scenarioMs = scenarioMs % options.durationMs
      } else if (scenarioMs > options.durationMs) {
        scenarioMs = options.durationMs
      }

      return scenarioMs
    },

    getScenarioDate(scenarioOffsetMs: number): Date {
      return new Date(anchorDate.getTime() + scenarioOffsetMs / options.speedMultiplier)
    },

    anchorDate,
    durationMs: options.durationMs,
  }
}
