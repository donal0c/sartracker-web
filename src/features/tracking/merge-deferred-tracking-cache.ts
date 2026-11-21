import { mergeCacheBreadcrumbMetadata } from './tracking-cache-breadcrumb-disclosure'
import { createTrackingPositionIdentityKey } from './tracking-position-identity'
import type { TrackingSnapshot } from './tracking-types'

/**
 * Combines same-mission presentation data after hydration. Live rows supersede
 * cached rows for the same device/fix; cache-only trails remain visible. Cached
 * display history is never added to the incoming durable persistence payload.
 */
export function mergeDeferredTrackingCache(
  cached: TrackingSnapshot,
  live: TrackingSnapshot,
): TrackingSnapshot {
  const breadcrumbs = [...new Map([...cached.breadcrumbs, ...live.breadcrumbs]
    .map((position) => [createTrackingPositionIdentityKey(position), position])).values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp)
      || createTrackingPositionIdentityKey(left).localeCompare(createTrackingPositionIdentityKey(right)))
  return {
    ...live,
    devices: [...new Map([...cached.devices, ...live.devices]
      .map((device) => [device.device_id, device])).values()],
    positions: [...new Map([...cached.positions, ...live.positions]
      .map((position) => [position.device_id, position])).values()],
    breadcrumbs,
    // Live-only reduction counts cannot describe a cache/live union. No new
    // completeness claim is inferred from cached display rows; if either side
    // is (or may be) simplified, the union is disclosed as simplified [DON-338].
    breadcrumbMetadata: cached.breadcrumbs.length === 0 ? live.breadcrumbMetadata
      : mergeCacheBreadcrumbMetadata(
        cached.breadcrumbs, cached.breadcrumbMetadata, live.breadcrumbMetadata, breadcrumbs,
      ),
  }
}
