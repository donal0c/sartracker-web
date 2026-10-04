/**
 * Marker-at-newest-fix check [DON-328].
 *
 * The position marker must be drawn at the newest fix the app holds for a
 * device, so a device's trail never ends ahead of its marker. The marker is
 * read from the map's tracking source (the same data the layers draw), the
 * newest stored fix from SQLite.
 */

import { NotTested } from './results.mjs'

/** The app polls Traccar every 30 s; a marker may trail the store by one poll. */
export const MARKER_POLL_INTERVAL_MS = 30_000
const EARTH_RADIUS_M = 6_371_000

/**
 * Reads each device marker's fix from the map's tracking source. Self-contained:
 * it runs inside the page. Returns null when the map or its source cannot be read.
 *
 * @param {any} [win] the page's window
 * @returns {{deviceId: string, sourcePositionId: string, timestamp: string}[] | null}
 */
export function readMarkerFixes(win = globalThis) {
  try {
    const source = win.__SARTRACKER_MAP__?.getSource('tracking')
    const data = source?.serialize?.().data
    if (data === undefined || data === null || !Array.isArray(data.features)) return null
    return data.features
      .filter((feature) => feature.properties?.featureKind === 'device')
      .map((feature) => ({
        deviceId: String(feature.properties.deviceId),
        sourcePositionId: String(feature.properties.sourcePositionId),
        timestamp: String(feature.properties.timestamp),
      }))
  } catch {
    return null
  }
}

/**
 * Compares each device's marker fix with its newest stored fix. A marker may
 * be older than the newest stored fix by at most `pollIntervalMs` (the store
 * is read at a different instant); more means the marker is behind its trail.
 *
 * @param {{deviceId: string, sourcePositionId: string, timestamp: string}[]} markers
 * @param {{sourcePositionId: number, time: number}[]} stored every stored fix of the mission
 * @param {{names: Record<number, string>, pollIntervalMs?: number}} options device id (the provider's) to display name
 * @returns {string[]} one volunteer-readable finding per device that fails
 */
export function markerBehindFindings(markers, stored, { names, pollIntervalMs = MARKER_POLL_INTERVAL_MS }) {
  const newest = new Map()
  for (const fix of stored) {
    const device = Math.floor(fix.sourcePositionId / 1_000_000)
    if (!newest.has(device) || fix.time > newest.get(device)) newest.set(device, fix.time)
  }
  const markerTime = new Map()
  for (const marker of markers) {
    const sourceId = Number(marker.sourcePositionId)
    const device = Number.isFinite(sourceId) && sourceId >= 1_000_000 ? Math.floor(sourceId / 1_000_000) : Number(marker.deviceId)
    markerTime.set(device, Date.parse(marker.timestamp))
  }
  const findings = []
  const clock = (ms) => new Date(ms).toISOString().slice(11, 19)
  for (const [device, newestStored] of newest) {
    const label = names[device] ?? `device ${device}`
    const shown = markerTime.get(device)
    if (shown === undefined || !Number.isFinite(shown)) {
      findings.push(`${label} has recorded fixes (newest ${clock(newestStored)} UTC) but no position marker is drawn for it`)
    } else if (newestStored - shown > pollIntervalMs) {
      findings.push(`${label}'s marker shows its ${clock(shown)} UTC fix but a newer one from ${clock(newestStored)} UTC is stored (${Math.round((newestStored - shown) / 1000)} s ahead, limit ${pollIntervalMs / 1000} s): the marker is behind the end of its trail`)
    }
  }
  return findings
}

/**
 * Great-circle distance in metres between two WGS84 points.
 *
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 */
export function distanceMetres(a, b) {
  const rad = Math.PI / 180
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/**
 * Requires the device's newest stored fixes to look like road driving: at
 * least `count` fixes, each at least `minMetres` from the last. A fixture that
 * does not is missing evidence (NotTested), never a product result.
 *
 * @param {{sourcePositionId: number, lat: number, lon: number, time: number}[]} stored
 * @param {number} deviceId
 * @param {{count?: number, minMetres?: number}} [options]
 * @throws {NotTested}
 */
export function requireRoadSpeedFixes(stored, deviceId, { count = 4, minMetres = 20 } = {}) {
  const fixes = stored.filter((fix) => Math.floor(fix.sourcePositionId / 1_000_000) === deviceId).sort((a, b) => a.time - b.time)
  if (fixes.length < count) {
    throw new NotTested(`The road-speed vehicle recorded only ${fixes.length} fixes (need ${count}); the marker check proves nothing.`)
  }
  for (let index = 1; index < fixes.length; index += 1) {
    const gap = distanceMetres(fixes[index - 1], fixes[index])
    if (gap < minMetres) {
      throw new NotTested(`The road-speed fixture moved only ${Math.round(gap)} m between fixes (need ${minMetres} m); the marker check proves nothing.`)
    }
  }
}
