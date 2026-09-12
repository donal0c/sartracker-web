/** Shared input corpus; expected canonical evidence is independent of either parser. */
export const gpxXmlValidCases = [
  ['legacy', '<gpx>'],
  ['GPX 1.0', '<gpx xmlns="http://www.topografix.com/GPX/1/0">'],
  ['GPX 1.1', '<gpx xmlns="http://www.topografix.com/GPX/1/1">'],
].map(([name, root]) => ({
  name,
  source: `${root}<trk><name>Ridge <![CDATA[& party]]></name><trkseg>
    <trkpt lat="52" lon="-9.7"><ele><![CDATA[100]]></ele><time>2026-09-07T<![CDATA[08:00:00Z]]></time>
      <extensions><time>2026-09-07T19:00:00Z</time><ele>999</ele><trkpt lat="51" lon="-8"/></extensions>
    </trkpt><trkpt lat="52.001" lon="-9.701"/>
    <extensions><trkpt lat="51" lon="-8"/><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg></extensions>
  </trkseg></trk></gpx>`,
}))

gpxXmlValidCases.push({ name: 'prefixed and rebound namespace', source: `
<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:name>Ridge &amp; party</g:name><g:trkseg>
<g:trkpt lat="52" lon="-9.7"><g:ele>100</g:ele><g:time>2026-09-07T08:00:00Z</g:time>
<g:extensions xmlns:g="urn:vendor"><g:time>2026-09-07T19:00:00Z</g:time></g:extensions></g:trkpt>
<g:trkpt lat="52.001" lon="-9.701"/></g:trkseg></g:trk></g:gpx>` })

/** Every case must fail as a whole document, without publishing partial track evidence. */
export const gpxXmlInvalidCases = [
  ['ambiguous scalar on rejected point', '<gpx><trk><trkseg><trkpt lat="999" lon="-9"><time>A</time><time>B</time></trkpt><trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg></trk></gpx>'],
  ['ambiguous name on empty track', '<gpx><trk><name>A<value/>B</name></trk><trk><trkseg><trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg></trk></gpx>'],
  ['foreign root', '<gpx xmlns="urn:vendor"><trk><trkseg><trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg></trk></gpx>'],
  ['wrapped root', '<wrapper><gpx><trk><trkseg><trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg></trk></gpx></wrapper>'],
  ['doctype', '<!DOCTYPE gpx><gpx><trk><trkseg><trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg></trk></gpx>'],
  ['duplicate scalar', '<gpx><trk><trkseg><trkpt lat="52" lon="-9"><time>2026-09-07T08:00:00Z</time><time>2026-09-07T19:00:00Z</time></trkpt><trkpt lat="53" lon="-9"/></trkseg></trk></gpx>'],
  ['nested scalar', '<gpx><trk><trkseg><trkpt lat="52" lon="-9"><ele>1<value>00</value></ele></trkpt><trkpt lat="53" lon="-9"/></trkseg></trk></gpx>'],
  ['truncated XML', '<gpx><trk><trkseg><trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg></trk>'],
  ['unbound prefix', '<gpx><trk><trkseg><v:trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg></trk></gpx>'],
].map(([name, source]) => ({ name, source, reason: ({
  'ambiguous scalar on rejected point': 'GPX time must be a single text value.',
  'ambiguous name on empty track': 'GPX name must be a single text value.',
  'foreign root': 'GPX document root is not supported.',
  'wrapped root': 'GPX document root is not supported.',
  doctype: 'GPX document type is not supported.',
  'duplicate scalar': 'GPX time must be a single text value.',
  'nested scalar': 'GPX ele must be a single text value.',
  'truncated XML': 'GPX file could not be parsed: bad.gpx',
  'unbound prefix': 'GPX file could not be parsed: bad.gpx',
} as Readonly<Record<string, string>>)[name] }))

/** Malformed track geometry must reject the source, never publish a truncated clean track. */
export const gpxXmlGeometryRefusals = [
  { name: 'mixed segment namespace', fragment: '<trkseg xmlns="urn:wrong"><trkpt lat="51" lon="-8"/><trkpt lat="51.1" lon="-8"/></trkseg>', reason: 'GPX namespace_mismatch: trkseg.' },
  { name: 'wrapped segment', fragment: '<wrapper><trkseg><trkpt lat="51" lon="-8"/><trkpt lat="51.1" lon="-8"/></trkseg></wrapper>', reason: 'GPX non_canonical_structure: trkseg.' },
  { name: 'wrapped point', fragment: '<trkseg><wrapper><trkpt lat="51" lon="-8"/></wrapper></trkseg>', reason: 'GPX non_canonical_structure: trkpt.' },
].map(({ name, fragment, reason }) => ({ name, reason, source: `<gpx><trk><trkseg><trkpt lat="52" lon="-9"/><trkpt lat="53" lon="-9"/></trkseg>${fragment}</trk></gpx>` }))

/** No canonical time exists; vendor time must not turn static evidence into a dated track. */
export const gpxXmlUndatedLateName = '<gpx><trk><trkseg><trkpt lat="52" lon="-9"><extensions><time>2026-09-07T08:00:00Z</time><ele>999</ele></extensions></trkpt><trkpt lat="53" lon="-9"/></trkseg><name>Ridge party</name></trk></gpx>'
