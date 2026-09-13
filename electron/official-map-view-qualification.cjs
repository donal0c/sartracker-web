const MAP_IDS = new Set(['official_discovery_topo', 'official_premium_basemap',
  'official_aerial_imagery', 'official_high_resolution_imagery'])
const LATITUDE_LIMIT = 85.05112878
const MAX_VIEW_TILES = 4096

/** Checks every required local tile; online fallback and no-coverage images cannot qualify. */
async function qualifyOfficialMapView(input, options) {
  const range = readViewTileRange(input)
  const packages = options.packages.filter(mapPackage =>
    mapPackage.mapId === input.mapId && mapPackage.status === 'ready' &&
    mapPackage.attestation?.version === 1 &&
    input.zoom >= mapPackage.minZoom && input.zoom <= mapPackage.maxZoom)
  const totalTiles = (range.east - range.west + 1) * (range.south - range.north + 1)
  let usableTiles = 0
  let changed = packages.some(mapPackage => !options.isCurrent(mapPackage))
  for (let x = range.west; !changed && x <= range.east; x += 1) {
    for (let y = range.north; y <= range.south; y += 1) {
      for (const mapPackage of packages) {
        const result = await options.readTile(mapPackage, {mapId: input.mapId, z: input.zoom, x, y})
        if (result.status === 'hit') {
          usableTiles += 1
          break
        }
      }
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  changed ||= packages.some(mapPackage => !options.isCurrent(mapPackage))
  const status = changed ? 'error' : usableTiles === totalTiles ? 'complete' : usableTiles > 0 ? 'partial' : 'missing'
  return {
    mapId: input.mapId,
    bounds: {...input.bounds},
    zoom: input.zoom,
    status,
    totalTiles,
    usableTiles: changed ? 0 : usableTiles,
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
    packageIdentities: packages.map(mapPackage => ({id: mapPackage.id, sha256: mapPackage.attestation.sha256})),
    message: changed ? 'Offline package changed during the check. Check View again.' :
      status === 'complete' ? 'Every required local tile is readable and usable for this view and tile zoom.' :
        'Required local tiles are missing or unusable. Keep an alternative map available.',
  }
}

/** Validates bounded geographic input before allocating or reading tiles. */
function readViewTileRange(input) {
  if (!MAP_IDS.has(input?.mapId) || !Number.isInteger(input?.zoom) || input.zoom < 0 || input.zoom > 19) {
    throw new Error('Official map view or tile zoom is invalid.')
  }
  const bounds = input.bounds
  if (!bounds || !['west', 'south', 'east', 'north'].every(key => Number.isFinite(bounds[key])) ||
      bounds.west < -180 || bounds.east > 180 || bounds.west >= bounds.east ||
      bounds.south < -LATITUDE_LIMIT || bounds.north > LATITUDE_LIMIT || bounds.south >= bounds.north) {
    throw new Error('Official map view bounds are invalid or cross the date line.')
  }
  const axis = 2 ** input.zoom
  const x = longitude => Math.max(0, Math.min(axis - 1, Math.floor((longitude + 180) / 360 * axis)))
  const y = latitude => {
    const radians = latitude * Math.PI / 180
    return Math.max(0, Math.min(axis - 1, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * axis)))
  }
  const range = {west: x(bounds.west), east: x(bounds.east), north: y(bounds.north), south: y(bounds.south)}
  if ((range.east - range.west + 1) * (range.south - range.north + 1) > MAX_VIEW_TILES) {
    throw new Error('Official map view is too large to check. Zoom in and check a smaller area.')
  }
  return range
}

module.exports = {qualifyOfficialMapView, readViewTileRange}
