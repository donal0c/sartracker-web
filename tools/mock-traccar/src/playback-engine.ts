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
 *
 * Timestamps are always emitted with real-time spacing regardless of playback speed.
 * The speed multiplier only controls how fast the engine advances through scenario time,
 * not the timestamp values — so breadcrumb gap segmentation (5-min threshold) and
 * stale detection work correctly at any playback speed.
 */
export function createPlaybackEngine(options: PlaybackOptions): PlaybackEngine {
  const serverStartMs = Date.now()

  // Anchor date: the wall-clock time that represents scenario T+0.
  // We subtract the full start offset so timestamps reflect real scenario spacing.
  const anchorDate = new Date(serverStartMs - options.startOffsetMs)

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
      // Timestamps use real-time spacing: anchorDate + scenario offset (no speed division)
      return new Date(anchorDate.getTime() + scenarioOffsetMs)
    },

    anchorDate,
    durationMs: options.durationMs,
  }
}
