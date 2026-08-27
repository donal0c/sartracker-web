import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from './tracking-types'

/** Returns whether a position carries Traccar's canonical source fixTime. */
export function isCanonicalFixTimeEvidence(
  position: NormalizedTrackingPosition,
): boolean {
  return position.timestamp_source === 'fix' && position.fix_time_unverified !== true
}

/** Removes positions whose timestamp came from a non-fix Traccar clock. */
export function filterCanonicalFixTimeEvidencePositions(
  positions: readonly NormalizedTrackingPosition[],
): readonly NormalizedTrackingPosition[] {
  return positions.filter(isCanonicalFixTimeEvidence)
}

/**
 * Produces the mission-evidence view of a tracking snapshot. The caller keeps
 * the original snapshot for immediate operational current-location visibility.
 */
export function filterCanonicalFixTimeEvidenceSnapshot(
  snapshot: TrackingSnapshot,
): TrackingSnapshot {
  return {
    ...snapshot,
    positions: filterCanonicalFixTimeEvidencePositions(snapshot.positions),
    breadcrumbs: filterCanonicalFixTimeEvidencePositions(snapshot.breadcrumbs),
    ...(snapshot.rawBreadcrumbsForPersistence === undefined
      ? {}
      : {
          rawBreadcrumbsForPersistence: filterCanonicalFixTimeEvidencePositions(
            snapshot.rawBreadcrumbsForPersistence,
          ),
        }),
  }
}
