type ScreenPoint = {
  readonly x: number
  readonly y: number
}

type ViewportBounds = {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

type ShouldIgnoreMapInteractionArgs = {
  readonly currentMissionId: string | null
  readonly missionPhase: 'idle' | 'active' | 'paused' | 'recovery'
  readonly target: EventTarget | null
  readonly interactiveSelector: string
}

/**
 * Returns whether a map interaction should be ignored before feature-specific handlers run.
 */
export function shouldIgnoreMapInteraction(
  args: ShouldIgnoreMapInteractionArgs,
): boolean {
  if (args.currentMissionId === null || args.missionPhase === 'recovery') {
    return true
  }

  return (
    args.target instanceof HTMLElement &&
    args.target.closest(args.interactiveSelector) !== null
  )
}

/**
 * Returns whether a screen point falls inside the current map container bounds.
 */
export function isPointInsideMapContainer(
  point: ScreenPoint,
  bounds: ViewportBounds,
): boolean {
  return !(
    point.x < bounds.left ||
    point.x > bounds.right ||
    point.y < bounds.top ||
    point.y > bounds.bottom
  )
}
