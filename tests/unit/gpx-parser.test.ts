import { describe, expect, it } from 'vitest'

import { parseGpxFile } from '../../src/features/gpx/gpx-parser'

describe('gpx parser', () => {
  it('parses multiple tracks in a file into a consolidated multiline geometry', () => {
    const parsed = parseGpxFile({
      fileName: 'glen.gpx',
      sourcePath: '/tracks/glen.gpx',
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="vitest">
  <trk>
    <name>Loop One</name>
    <trkseg>
      <trkpt lat="52.0000" lon="-9.7000"></trkpt>
      <trkpt lat="52.0100" lon="-9.7100"></trkpt>
    </trkseg>
  </trk>
  <trk>
    <name>Loop Two</name>
    <trkseg>
      <trkpt lat="52.0200" lon="-9.7200"></trkpt>
      <trkpt lat="52.0300" lon="-9.7300"></trkpt>
    </trkseg>
  </trk>
</gpx>`,
    })

    expect(parsed.displayName).toBe('glen')
    expect(parsed.trackCount).toBe(2)
    expect(parsed.pointCount).toBe(4)
    expect(JSON.parse(parsed.geometryJson)).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [-9.7, 52],
          [-9.71, 52.01],
        ],
        [
          [-9.72, 52.02],
          [-9.73, 52.03],
        ],
      ],
    })
  })

  it('fails loudly when the file contains no usable track geometry', () => {
    expect(() =>
      parseGpxFile({
        fileName: 'empty.gpx',
        sourcePath: '/tracks/empty.gpx',
        contents: `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="vitest"></gpx>`,
      }),
    ).toThrow('GPX file does not contain any track segments.')
  })
})
