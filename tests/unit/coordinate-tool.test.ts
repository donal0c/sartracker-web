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

  it('keeps W3W decision-gated until API, licensing, and offline behavior are settled', () => {
    expect(() =>
      convertCoordinates({
        ...createCoordinateConverterDraft(),
        mode: 'w3w',
        w3wWords: 'filled.count.soap',
      }),
    ).toThrow(/W3W conversion is not available/)
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
