/**
 * Reports, for the packaged WAR-06 probe only, whether the tracking snapshot
 * last given to the map was the real one or the empty stand-in used while
 * tracking is hidden, so a zero on the map is never mistaken for nobody
 * (DON-353). Write-only: nothing in the product reads it. It is removed when
 * the tracking overlay is torn down, so a stale `true` never outlives the map.
 */

type ReportingWindow = Window & { __SARTRACKER_TRACKING_VISIBLE__?: boolean }

/**
 * Records whether tracking was shown in the snapshot just given to the map.
 *
 * @param visible true when the map was given the real tracking snapshot
 */
export function reportTrackingVisibleOnMap(visible: boolean): void {
  if (typeof window === 'undefined') return
  ;(window as ReportingWindow).__SARTRACKER_TRACKING_VISIBLE__ = visible
}

/** Removes the report, so nothing claims tracking is shown on a map that is gone. */
export function clearTrackingVisibleOnMap(): void {
  if (typeof window === 'undefined') return
  delete (window as ReportingWindow).__SARTRACKER_TRACKING_VISIBLE__
}
