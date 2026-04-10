import {
  COORDINATE_DISPLAY_MODE_STORAGE_KEY,
  persistCoordinateDisplayMode,
  readCoordinateDisplayMode,
} from '../../src/lib/coordinate-preferences'

describe('coordinate display preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to WGS84 first', () => {
    expect(readCoordinateDisplayMode()).toBe('wgs84_first')
  })

  it('persists the selected coordinate display mode', () => {
    persistCoordinateDisplayMode('tm65_first')

    expect(window.localStorage.getItem(COORDINATE_DISPLAY_MODE_STORAGE_KEY)).toBe(
      'tm65_first',
    )
    expect(readCoordinateDisplayMode()).toBe('tm65_first')
  })
})
