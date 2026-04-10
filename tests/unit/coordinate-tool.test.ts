import { describe, expect, it } from 'vitest'

import {
  convertCoordinates,
  createCoordinateConverterDraft,
  formatCoordinateClipboardValue,
} from '../../src/features/coordinates/coordinate-tool'

describe('coordinate converter', () => {
  it('converts WGS84 input into ITM and TM65 outputs', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'wgs84',
      latitude: '51.99917',
      longitude: '-9.74406',
    })

    expect(result.itmDisplay).toBe('480245, 584452')
    expect(result.tm65GridRef).toBe('V 80011 84363')
  })

  it('converts ITM input back into WGS84 and TM65 outputs', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'itm',
      itmEasting: '480245',
      itmNorthing: '584452',
    })

    expect(result.wgs84Display).toContain('51.999')
    expect(result.tm65GridRef).toBe('V 80011 84364')
  })

  it('converts TM65 grid references back into WGS84 and ITM outputs', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'tm65',
      tm65GridRef: 'V 80011 84363',
    })

    expect(result.wgs84Display).toContain('51.999')
    expect(result.itmDisplay).toBe('480245, 584451')
  })

  it('formats clipboard values using the operator-facing display strings', () => {
    const result = convertCoordinates({
      ...createCoordinateConverterDraft(),
      mode: 'wgs84',
      latitude: '52.274681',
      longitude: '-9.530912',
    })

    expect(formatCoordinateClipboardValue(result, 'wgs84')).toContain('°N')
    expect(formatCoordinateClipboardValue(result, 'itm')).toMatch(/^\d+, \d+$/)
    expect(formatCoordinateClipboardValue(result, 'tm65')).toMatch(/^[A-Z] \d{5} \d{5}$/)
  })
})
