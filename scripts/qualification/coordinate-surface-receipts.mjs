import { canonicalJson } from './control-plane.mjs'

/** Independently invert the documented local-radius great circle using the WGS84 ECEF norm at the origin. */
function lineFacts(geometry) {
  if (geometry?.type !== 'LineString' || geometry.coordinates?.length !== 2) throw new Error('Coordinate probe must retain one exact two-point bearing line.')
  for (const point of geometry.coordinates) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
        || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('Coordinate probe retained an unsafe coordinate.')
  }
  const [[lon1, lat1], [lon2, lat2]] = geometry.coordinates.map(point => point.map(value => value * Math.PI / 180))
  const a = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
  // The product specifies a local geocentric-radius great circle, not the
  // mean-radius Turf convention or an ellipsoidal Vincenty inverse. Compute
  // that radius independently from ECEF coordinates rather than importing it.
  const eccentricitySquared = (1 / 298.257223563) * (2 - 1 / 298.257223563)
  const primeVertical = 6378137 / Math.sqrt(1 - eccentricitySquared * Math.sin(lat1) ** 2)
  const radius = Math.hypot(primeVertical * Math.cos(lat1), primeVertical * (1 - eccentricitySquared) * Math.sin(lat1))
  return { metres: 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)),
    degrees: (Math.atan2(Math.sin(lon2 - lon1) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2)
      - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)) * 180 / Math.PI + 360) % 360 }
}

/** Verify actual UI text and persisted/rendered line against fixed production golden vectors and independent math. */
export function validateCoordinateSurface(facts) {
  if (!Array.isArray(facts?.conversions) || facts.conversions.length !== 3) throw new Error('Coordinate conversion inventory is incomplete.')
  const [dd, grid, dms] = facts.conversions
  if (dd.mode !== 'dd' || canonicalJson(dd.input) !== canonicalJson(['52.179337', '-9.464944']) || dd.grid !== 'Q 99842 04015'
      || grid.mode !== 'ig' || canonicalJson(grid.input) !== canonicalJson(['Q 99842 04015'])
      || dms.mode !== 'dms' || canonicalJson(dms.input) !== canonicalJson(['52°10\'45.613"N', '9°27\'53.798"W']) || dms.grid !== dd.grid) throw new Error('Coordinate golden vector differs.')
  const reverse = grid.dd?.split(',').map(value => Number(value.trim()))
  if (reverse?.length !== 2 || !reverse.every(Number.isFinite)
      || Math.abs(reverse[0] - 52.179337) > 0.00001 || Math.abs(reverse[1] + 9.464944) > 0.00001) throw new Error('Reverse grid conversion differs from the golden reference.')
  if (!Array.isArray(facts.rejected) || canonicalJson(facts.rejected.map(row => row.input)) !== canonicalJson(['NaN', 'Infinity', '91', '-91'])
      || facts.rejected.some(row => row.goToDisabled !== true || typeof row.error !== 'string' || row.error.length === 0)) throw new Error('Unsafe coordinate rejection was not visibly established.')
  if (facts.conversionLabel !== 'True 94.5° / Magnetic 90.0° (fixed Ireland declination -4.5°)') throw new Error('Magnetic conversion sign or labels differ.')
  const line = lineFacts(facts.geometry)
  if (Math.abs(line.metres - 2000) > 0.1 || Math.abs(line.degrees - 94.5) > 0.001) throw new Error('Persisted bearing geometry differs from independent distance/bearing oracle.')
  if (typeof facts.drawingId !== 'string' || !facts.drawingId || facts.persistedDrawingId !== facts.drawingId
      || typeof facts.sourceId !== 'string' || !facts.sourceId
      || canonicalJson(facts.renderedGeometry) !== canonicalJson(facts.geometry)) throw new Error('Rendered bearing feature differs from persisted identity or geometry.')
  const measurement = lineFacts({ type: 'LineString', coordinates: facts.measurement?.coordinates })
  const display = /^(\d+(?:\.\d+)?)\s*(km|m)\s+(\d+(?:\.\d+)?)°$/u.exec(facts.measurement?.text?.trim() ?? '')
  if (facts.measurement?.count !== '1' || !display
      || Math.abs(Number(display[1]) * (display[2] === 'km' ? 1000 : 1) - measurement.metres) > (display[2] === 'km' ? 5.1 : 0.6)
      || Math.abs(Number(display[3]) - measurement.degrees) > 0.51) throw new Error('Measurement distance/bearing differs from retained map coordinates and display rounding.')
  return Object.freeze({ status: 'PASS', line, releaseEligible: false,
    scope: 'packaged golden converter, invalid input, bearing persistence/render and measurement; exhaustive numerical corpus remains source-tier' })
}
