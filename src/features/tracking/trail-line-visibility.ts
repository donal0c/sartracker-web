/**
 * What the map is drawing for breadcrumb trails right now, and the plain words
 * the Tracking tab uses for it. The status must never say a line is on the map
 * when the Tracking group, the Trails switch or every per-device toggle hides
 * it, or when there is no trail geometry at all [DON-338].
 *
 * Whether a device's trail is drawn is decided only from the geometry the
 * renderers are given (the live snapshot's breadcrumbs for the line, the exact
 * page's positions for the dots) and the same switch and hidden-device list
 * they apply. Roster membership never decides it.
 */

/** Whether the map is drawing the trail line, part of it, none of it, or has none to draw. */
export type TrailLineVisibility =
  | 'drawn'
  | 'partly-hidden'
  | 'switched-off'
  | 'all-hidden'
  | 'no-trail'

/** Whether the exact dots on the page are drawn for every, some or none of their devices. */
export type TrailDotVisibility = 'all' | 'some' | 'none'

/** The renderers' inputs that decide which trails are drawn. */
export type TrailDrawingInput = {
  /** Effective trail visibility: the Tracking group and the Trails switch are both on. */
  readonly trailsVisible: boolean
  /** Devices whose trail is hidden on the Layers tab. */
  readonly hiddenBreadcrumbDeviceIds: readonly string[]
  /** Devices with at least one fix in the live trail (the line source). */
  readonly lineDeviceIds: ReadonlySet<string>
  /** Devices with at least one fix on the current exact-dot page. */
  readonly dotDeviceIds: ReadonlySet<string>
}

/** What the map draws, summarised for the Tracking tab. */
export type TrailDrawingSummary = {
  readonly line: TrailLineVisibility
  readonly dots: TrailDotVisibility
  /** Devices with trail geometry (line or dots) whose trail is hidden. */
  readonly hiddenTrailCount: number
}

/** First sentence of every dots status: the line, not the dots, is the whole trail [DON-338]. */
export const WHOLE_TRAIL_LINE_SENTENCE = 'The line on the map shows the whole trail.'

/**
 * The single rule both maps use for one device's trail (line, lone fixes and
 * dots): drawn only while trails are visible and the device is not hidden.
 */
export function isBreadcrumbTrailDrawnForDevice(
  deviceId: string | null,
  trailsVisible: boolean,
  hiddenBreadcrumbDeviceIds: ReadonlySet<string>,
): boolean {
  return trailsVisible && (deviceId === null || !hiddenBreadcrumbDeviceIds.has(deviceId))
}

/** Collects the device ids present in a list of fixes. */
export function collectTrailDeviceIds(
  positions: readonly { readonly device_id: string }[],
): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const position of positions) ids.add(position.device_id)
  return ids
}

/** Decides what the map draws from the renderers' own inputs. */
export function summarizeTrailDrawing(input: TrailDrawingInput): TrailDrawingSummary {
  const hidden = new Set(input.hiddenBreadcrumbDeviceIds)
  const countDrawn = (deviceIds: ReadonlySet<string>): number => {
    let drawn = 0
    for (const deviceId of deviceIds) {
      if (isBreadcrumbTrailDrawnForDevice(deviceId, input.trailsVisible, hidden)) drawn += 1
    }
    return drawn
  }

  const lineDrawn = countDrawn(input.lineDeviceIds)
  const line: TrailLineVisibility = !input.trailsVisible
    ? 'switched-off'
    : input.lineDeviceIds.size === 0
      ? 'no-trail'
      : lineDrawn === input.lineDeviceIds.size
        ? 'drawn'
        : lineDrawn === 0
          ? 'all-hidden'
          : 'partly-hidden'

  const dotsDrawn = countDrawn(input.dotDeviceIds)
  const dots: TrailDotVisibility = !input.trailsVisible
    ? 'none'
    : dotsDrawn === input.dotDeviceIds.size
      ? 'all'
      : dotsDrawn === 0
        ? 'none'
        : 'some'

  let hiddenTrailCount = 0
  if (input.trailsVisible) {
    for (const deviceId of new Set([...input.lineDeviceIds, ...input.dotDeviceIds])) {
      if (hidden.has(deviceId)) hiddenTrailCount += 1
    }
  }
  return { line, dots, hiddenTrailCount }
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
    case 'no-trail':
      return 'No trail line is on the map yet.'
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
