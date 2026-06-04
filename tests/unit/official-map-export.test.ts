import { describe, expect, it } from 'vitest'

import {
  buildMapGenieExportRequest,
  parseOfficialMapTileUrl,
} from '../../src/features/map/official-map-export'

describe('official MapGenie export requests', () => {
  it('parses the app-owned official map tile URL used by MapLibre', () => {
    expect(
      parseOfficialMapTileUrl('sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'),
    ).toEqual({
      mapId: 'official_discovery_topo',
      z: 12,
      x: 1935,
      y: 1344,
    })
  })

  it('builds a credential-free ArcGIS export URL for a Web Mercator tile', () => {
    const request = buildMapGenieExportRequest({
      mapId: 'official_discovery_topo',
      serviceUrl:
        'https://ogcmapgenie.osi.ie/data/rest/services/ITM/discovery/MapServer/wmts?REQUEST=GetCapabilities&format=text/xml',
      username: 'mountainrescue_org',
      password: 'field-secret',
      z: 12,
      x: 1935,
      y: 1344,
    })

    expect(request.url).toContain(
      'https://ogcmapgenie.osi.ie/data/rest/services/ITM/discovery/MapServer/export?',
    )
    expect(request.url).toContain('bboxSR=3857')
    expect(request.url).toContain('imageSR=3857')
    expect(request.url).toContain('size=256%2C256')
    expect(request.url).toContain('format=png32')
    expect(request.url).toContain('f=image')
    expect(request.url).not.toContain('field-secret')
    expect(request.url).not.toContain('mountainrescue_org')
    expect(request.authorizationHeader).toBe('Basic bW91bnRhaW5yZXNjdWVfb3JnOmZpZWxkLXNlY3JldA==')
  })
})
