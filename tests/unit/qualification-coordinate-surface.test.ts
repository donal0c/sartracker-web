import { describe, expect, it } from 'vitest'
import { validateCoordinateSurface } from '../../scripts/qualification/coordinate-surface-receipts.mjs'

/** Fixed local-radius endpoint fixture at 2 km and 94.5 degrees. */
function facts() {
  const rad = Math.PI / 180; const start = [-9, 52]; const theta = 94.5 * rad
  const equatorial = 6378137; const polar = 6356752.314245179
  const radius = Math.sqrt(((equatorial ** 2 * Math.cos(52 * rad)) ** 2 + (polar ** 2 * Math.sin(52 * rad)) ** 2)
    / ((equatorial * Math.cos(52 * rad)) ** 2 + (polar * Math.sin(52 * rad)) ** 2))
  const delta = 2000 / radius
  const lat = Math.asin(Math.sin(start[1] * rad) * Math.cos(delta) + Math.cos(start[1] * rad) * Math.sin(delta) * Math.cos(theta))
  const lon = start[0] * rad + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(start[1] * rad), Math.cos(delta) - Math.sin(start[1] * rad) * Math.sin(lat))
  return { conversions: [
    { mode: 'dd', input: ['52.179337', '-9.464944'], grid: 'Q 99842 04015' },
    { mode: 'ig', input: ['Q 99842 04015'], dd: '52.179336, -9.464945' },
    { mode: 'dms', input: ['52°10\'45.613"N', '9°27\'53.798"W'], grid: 'Q 99842 04015' },
  ], rejected: ['NaN', 'Infinity', '91', '-91'].map(input => ({ input, goToDisabled: true, error: 'Latitude must be valid.' })),
  conversionLabel: 'True 94.5° / Magnetic 90.0° (fixed Ireland declination -4.5°)', geometry: { type: 'LineString', coordinates: [start, [lon / rad, lat / rad]] },
  renderedGeometry: { type: 'LineString', coordinates: [start, [lon / rad, lat / rad]] },
  sourceId: 'drawings', drawingId: 'bearing-id', persistedDrawingId: 'bearing-id', measurement: { count: '1', text: '2.00 km 94.5°', coordinates: [start, [lon / rad, lat / rad]] } }
}
describe('packaged coordinate operator surface oracle', () => {
  it('checks golden grid vectors, magnetic sign and independent geometry math', () => {
    expect(validateCoordinateSurface(facts()).status).toBe('PASS')
  })
  it('rejects wrong datum output, declination sign, geometry, rendered identity and unsafe input acceptance', () => {
    const mutations = [
      (value) => { value.conversions[0].grid = 'Q 00000 00000' },
      (value) => { value.conversionLabel = 'True 85.5° / Magnetic 90.0°' },
      (value) => { value.geometry.coordinates[1] = [-8, 51] },
      (value) => { value.renderedGeometry.coordinates[1] = [-8, 51] },
      (value) => { value.rejected[0].goToDisabled = false },
      (value) => { value.drawingId = 'another' },
      (value) => { value.measurement.text = '3.00 km 94.5°' },
    ]
    for (const mutate of mutations) { const value = facts(); mutate(value); expect(() => validateCoordinateSurface(value)).toThrow() }
  })
})
