/** Said when the feed is online: current positions are still arriving. */
export const CURRENT_POSITIONS_LIVE = 'Current positions remain live.'

/** Said when the feed is not online, so no other warning calls positions live [DON-375]. */
export const CURRENT_POSITIONS_NOT_LIVE = 'Current positions are not live: new positions are not arriving until tracking is connected.'

/**
 * The one sentence a history or evidence warning uses about current positions.
 * It must agree with the top bar: while tracking is not online (not connected,
 * reconnecting, offline or suspended) nothing may say positions are live.
 *
 * @param trackingLive whether the feed is online with no suspended-refresh warning
 * @returns the sentence to show
 */
export function describeCurrentPositionsFreshness(trackingLive: boolean): string {
  return trackingLive ? CURRENT_POSITIONS_LIVE : CURRENT_POSITIONS_NOT_LIVE
}
