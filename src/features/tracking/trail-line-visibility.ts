/**
 * What the map is drawing for breadcrumb trails right now, and the plain words
 * the Tracking tab uses for it. The status must never say a line is on the map
 * when the Tracking group, the Trails switch or every per-device toggle hides it
 * [DON-338].
 */

/** Whether the map is drawing the trail line, part of it, or none of it. */
export type TrailLineVisibility = 'drawn' | 'partly-hidden' | 'switched-off' | 'all-hidden'

/** First sentence of every dots status: the line, not the dots, is the whole trail [DON-338]. */
export const WHOLE_TRAIL_LINE_SENTENCE = 'The line on the map shows the whole trail.'

/** Decides what the map draws from the effective trail switch and the hidden-trail count. */
export function resolveTrailLineVisibility(
  trailsVisible: boolean,
  hiddenTrailCount: number,
  trailDeviceCount: number,
): TrailLineVisibility {
  if (!trailsVisible) return 'switched-off'
  const hidden = Number.isSafeInteger(hiddenTrailCount) && hiddenTrailCount > 0 ? hiddenTrailCount : 0
  if (hidden === 0) return 'drawn'
  return trailDeviceCount > 0 && hidden >= trailDeviceCount ? 'all-hidden' : 'partly-hidden'
}

/** The first sentence of every dots status: what trail line the map is drawing right now. */
export function describeTrailLine(visibility: TrailLineVisibility): string {
  switch (visibility) {
    case 'drawn':
      return WHOLE_TRAIL_LINE_SENTENCE
    case 'partly-hidden':
      return 'The line on the map shows the whole trail of each device whose trail is shown.'
    case 'switched-off':
      return 'Trails are switched off on the Layers tab, so no trail line or dots are drawn on the map.'
    case 'all-hidden':
      return 'Every device has its trail hidden on the Layers tab, so no trail line or dots are drawn on the map.'
  }
}

/**
 * The sentence appended to the simplified-line disclosure when no line is drawn,
 * or null when at least one trail line is on the map [DON-338].
 */
export function describeTrailLineNotDrawn(visibility: TrailLineVisibility): string | null {
  switch (visibility) {
    case 'switched-off':
      return 'Trails are switched off on the Layers tab, so this line is not drawn on the map.'
    case 'all-hidden':
      return 'Every device has its trail hidden on the Layers tab, so this line is not drawn on the map.'
    default:
      return null
  }
}

/** Explains that hidden trails are counted in the page but not drawn [LIV-2]. */
export function describeHiddenTrails(hiddenTrailCount: number): string | null {
  if (!Number.isSafeInteger(hiddenTrailCount) || hiddenTrailCount <= 0) {
    return null
  }
  return hiddenTrailCount === 1
    ? '1 device has its trail hidden on the Layers tab. Its fixes are counted here but its line and dots are not drawn.'
    : `${hiddenTrailCount} devices have their trails hidden on the Layers tab. Their fixes are counted here but their lines and dots are not drawn.`
}
