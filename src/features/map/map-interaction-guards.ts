type ScreenPoint = {
  readonly x: number
  readonly y: number
}

type MapPanClickGuard = {
  readonly recordPointerDown: (point: ScreenPoint) => void
  readonly recordPointerMove: (point: ScreenPoint) => void
  readonly recordPointerUp: () => void
  readonly cancel: () => void
  readonly consumeClickSuppression: () => boolean
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

const DEFAULT_PAN_SUPPRESSION_THRESHOLD_PX = 6

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

/**
 * Tracks whether the next click should be treated as the tail end of a map pan.
 */
export function createMapPanClickGuard(
  thresholdPx = DEFAULT_PAN_SUPPRESSION_THRESHOLD_PX,
): MapPanClickGuard {
  let pointerDownPoint: ScreenPoint | null = null
  let thresholdExceeded = false
  let suppressNextClick = false

  return {
    recordPointerDown: (point) => {
      pointerDownPoint = point
      thresholdExceeded = false
    },
    recordPointerMove: (point) => {
      if (pointerDownPoint === null || thresholdExceeded) {
        return
      }

      const deltaX = point.x - pointerDownPoint.x
      const deltaY = point.y - pointerDownPoint.y
      if (Math.hypot(deltaX, deltaY) >= thresholdPx) {
        thresholdExceeded = true
      }
    },
    recordPointerUp: () => {
      suppressNextClick = thresholdExceeded
      pointerDownPoint = null
      thresholdExceeded = false
    },
    cancel: () => {
      pointerDownPoint = null
      thresholdExceeded = false
      suppressNextClick = false
    },
    consumeClickSuppression: () => {
      const shouldSuppress = suppressNextClick
      suppressNextClick = false
      return shouldSuppress
    },
  }
}
