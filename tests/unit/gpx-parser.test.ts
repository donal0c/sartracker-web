import { describe, expect, it } from 'vitest'

import { digestGpxSource, parseGpxFile } from '../../src/features/gpx/gpx-parser'

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

  it('retains point order, source time, elevation, track names, and explicit rejection provenance [DON-274]', () => {
    const parsed = parseGpxFile({
      fileName: 'mixed.gpx',
      sourcePath: '/tracks/mixed.gpx',
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="field-team">
  <trk><name>Ridge party</name><trkseg>
    <trkpt lat="52.0000" lon="-9.7000"><ele>123.4</ele><time>2026-08-27T08:00:00Z</time></trkpt>
    <trkpt lat="52.0100" lon="-9.7100"><ele>bad</ele></trkpt>
    <trkpt lat="200" lon="-9.7200"><time>2026-08-27T08:02:00Z</time></trkpt>
    <trkpt lat="52.0300" lon="-9.7300"><time>not-a-time</time></trkpt>
  </trkseg></trk>
</gpx>`,
    })

    expect(parsed.timingClass).toBe('partially_dated')
    expect(parsed.points).toEqual([
      expect.objectContaining({
        segmentIndex: 0,
        pointIndex: 0,
        trackName: 'Ridge party',
        lat: 52,
        lon: -9.7,
        elevation: 123.4,
        timestamp: '2026-08-27T08:00:00.000Z',
      }),
      expect.objectContaining({
        segmentIndex: 0,
        pointIndex: 1,
        elevation: null,
        timestamp: null,
      }),
      expect.objectContaining({
        segmentIndex: 0,
        pointIndex: 3,
        timestamp: null,
      }),
    ])
    expect(parsed.rejections).toEqual([
      expect.objectContaining({
        kind: 'point',
        segmentIndex: 0,
        pointIndex: 1,
        reason: 'invalid_elevation',
      }),
      expect.objectContaining({
        kind: 'point',
        segmentIndex: 0,
        pointIndex: 2,
        reason: 'invalid_coordinates',
      }),
      expect.objectContaining({
        kind: 'point',
        segmentIndex: 0,
        pointIndex: 3,
        reason: 'invalid_timestamp',
      }),
    ])
  })

  it('never interpolates missing source times and classifies undated evidence as static [DON-274]', () => {
    const parsed = parseGpxFile({
      fileName: 'undated.gpx',
      sourcePath: '/tracks/undated.gpx',
      contents: `<gpx version="1.1" creator="vitest"><trk><trkseg>
        <trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/>
      </trkseg></trk></gpx>`,
    })

    expect(parsed.timingClass).toBe('undated')
    expect(parsed.points.every((point) => point.timestamp === null)).toBe(true)
  })

  it('rejects empty numeric scalars and non-explicit source times instead of coercing evidence [DON-274]', () => {
    const parsed = parseGpxFile({
      fileName: 'strict-scalars.gpx',
      sourcePath: '/tracks/strict-scalars.gpx',
      contents: `<gpx version="1.1" creator="vitest"><trk><trkseg>
        <trkpt lat="" lon=""><ele> </ele><time>2026</time></trkpt>
        <trkpt lat="52" lon="-9.7"><ele> </ele><time>2026-08-27T08:00:00</time></trkpt>
        <trkpt lat="52.01" lon="-9.71"><time>2026-02-30T08:00:00Z</time></trkpt>
      </trkseg></trk></gpx>`,
    })

    expect(parsed.points).toEqual([
      expect.objectContaining({ pointIndex: 1, elevation: null, timestamp: null }),
      expect.objectContaining({ pointIndex: 2, elevation: null, timestamp: null }),
    ])
    expect(parsed.rejections).toEqual(expect.arrayContaining([
      expect.objectContaining({ pointIndex: 0, reason: 'invalid_coordinates' }),
      expect.objectContaining({ pointIndex: 1, reason: 'invalid_elevation' }),
      expect.objectContaining({ pointIndex: 1, reason: 'invalid_timestamp' }),
      expect.objectContaining({ pointIndex: 2, reason: 'invalid_timestamp' }),
    ]))
    expect(JSON.stringify(parsed)).not.toContain('2026-01-01T00:00:00.000Z')
  })

  it('hashes exact source bytes rather than source path aliases [DON-274]', async () => {
    const first = await digestGpxSource({ contents: '<gpx>same bytes</gpx>' })
    const alias = await digestGpxSource({ contents: '<gpx>same bytes</gpx>' })
    const changed = await digestGpxSource({ contents: '<gpx>changed bytes</gpx>' })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(alias).toBe(first)
    expect(changed).not.toBe(first)
  })
})
