import { describe, expect, it } from 'vitest'

import {
  convertCoordinates,
  createCoordinateConverterDraft,
  formatCoordinateClipboardValue,
} from '../../src/features/coordinates/coordinate-tool'

describe('coordinate converter', () => {
  it('defaults to the team-requested Irish Grid first flow', () => {
    expect(createCoordinateConverterDraft().mode).toBe('ig')
  })

  it('converts Irish Grid input into DD and DMS outputs', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'ig',
      irishGridRef: 'Q 99842 04015',
    })

    expect(result.ddDisplay).toBe('52.179336, -9.464944')
    expect(result.dmsDisplay).toBe('52°10\'45.609"N, 9°27\'53.800"W')
    expect(result.irishGridRef).toBe('Q 99842 04015')
    expect(result.w3wDisplay).toBe('W3W unavailable offline')
  })

  it('converts DD input into Irish Grid and DMS outputs', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'dd',
      latitude: '52.179337',
      longitude: '-9.464944',
    })

    expect(result.irishGridRef).toBe('Q 99842 04015')
    expect(result.dmsDisplay).toBe('52°10\'45.613"N, 9°27\'53.798"W')
  })

  it('converts pasted DD latitude and longitude pairs from the latitude field', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'dd',
      latitude: '52.004677 -9.748060',
      longitude: '',
    })

    expect(result.ddDisplay).toBe('52.004677, -9.748060')
    expect(result.irishGridRef).toBe('V 80009 85011')
  })

  it('converts pasted comma-separated DD pairs from the latitude field', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'dd',
      latitude: '52.004677, -9.748060',
      longitude: '',
    })

    expect(result.ddDisplay).toBe('52.004677, -9.748060')
  })

  it('converts pasted DD pairs with hemisphere suffixes', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'dd',
      latitude: '52.004677°N 9.748060°W',
      longitude: '',
    })

    expect(result.ddDisplay).toBe('52.004677, -9.748060')
  })

  it('converts DMS input into Irish Grid and DD outputs', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'dms',
      dmsLatitude: '52°10\'45.613"N',
      dmsLongitude: '9°27\'53.798"W',
    })

    expect(result.ddDisplay).toBe('52.179337, -9.464944')
    expect(result.irishGridRef).toBe('Q 99842 04015')
  })

  it('converts pasted DMS latitude and longitude pairs from the latitude field', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'dms',
      dmsLatitude: '52°10\'45.613"N 9°27\'53.798"W',
      dmsLongitude: '',
    })

    expect(result.ddDisplay).toBe('52.179337, -9.464944')
    expect(result.irishGridRef).toBe('Q 99842 04015')
  })

  it('gives a clear error when a pasted DD pair is incomplete', () => {
    expect(() =>
      convertCoordinates({
        ...createCoordinateConverterDraft(),
        mode: 'dd',
        latitude: '52.004677 west',
        longitude: '',
      }),
    ).toThrow(
      'DD input must include both latitude and longitude. Paste a pair like 52.004677, -9.748060, or split the values into Latitude and Longitude.',
    )
  })

  it('keeps W3W decision-gated until API, licensing, and offline behavior are settled', () => {
    expect(() =>
      convertCoordinates({
        ...createCoordinateConverterDraft(),
        mode: 'w3w',
        w3wWords: 'filled.count.soap',
      }),
    ).toThrow(/W3W conversion is not available/)
  })

  describe('sign-vs-direction conflict (DON-172 / B2-PARSERS)', () => {
    it('rejects a negative value paired with an East direction', () => {
      // '-6.0E' is ambiguous: the minus sign says West, the cardinal says East.
      // Silently returning -6.0 sent the operator ~800 km off target. Throw instead.
      expect(() =>
        convertCoordinates({
          ...createCoordinateConverterDraft(),
          mode: 'dd',
          latitude: '53.0',
          longitude: '-6.0E',
        }),
      ).toThrow(/ambiguous/i)
    })

    it('rejects a negative value paired with a North direction', () => {
      expect(() =>
        convertCoordinates({
          ...createCoordinateConverterDraft(),
          mode: 'dd',
          latitude: '-53.0N',
          longitude: '-9.0',
        }),
      ).toThrow(/ambiguous/i)
    })

    it('still accepts a positive N latitude and W longitude (normal Irish case)', () => {
      // All of Ireland is N/W, so the valid normal case for this app is N + W.
      const result = convertCoordinates({
        ...createCoordinateConverterDraft(),
        mode: 'dd',
        latitude: '52.179337N',
        longitude: '9.464944W',
      })

      expect(result.latitude).toBeCloseTo(52.179337, 6)
      expect(result.longitude).toBeCloseTo(-9.464944, 6)
    })

    it('still accepts a bare signed value with no direction suffix', () => {
      const result = convertCoordinates({
        ...createCoordinateConverterDraft(),
        mode: 'dd',
        latitude: '52.179337',
        longitude: '-9.464944',
      })

      expect(result.latitude).toBeCloseTo(52.179337, 6)
      expect(result.longitude).toBeCloseTo(-9.464944, 6)
    })
  })

  it('formats clipboard values using the operator-facing display strings', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'dd',
      latitude: '52.179337',
      longitude: '-9.464944',
    })

    expect(formatCoordinateClipboardValue(result, 'ig')).toBe('Q 99842 04015')
    expect(formatCoordinateClipboardValue(result, 'dd')).toBe('52.179337, -9.464944')
    expect(formatCoordinateClipboardValue(result, 'dms')).toBe('52°10\'45.613"N, 9°27\'53.798"W')
  })
})
