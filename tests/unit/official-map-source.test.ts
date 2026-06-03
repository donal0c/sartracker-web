import { describe, expect, it } from 'vitest'

import { parseMapGenieSourceDetails } from '../../src/features/settings/official-map-source'

const SAMPLE_DETAILS = [
  'Customer: Mountain Rescue Ireland',
  'Username: mountainrescue_org',
  'Password: field-secret',
  '',
  'discovery ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/discovery/MapServer/wmts',
  'basemap_premium ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/basemap_premium/MapServer/wmts',
  'ortho ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/ortho/MapServer/wmts',
  'National_High_Resolution_Imagery ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/National_High_Resolution_Imagery/MapServer/wmts',
].join('\n')

describe('official map source parsing', () => {
  it('extracts MapGenie metadata without returning the password', () => {
    const metadata = parseMapGenieSourceDetails(SAMPLE_DETAILS)

    expect(metadata).toEqual({
      status: 'configured',
      username: 'mountainrescue_org',
      availableSources: [
        'official_discovery_topo',
        'official_premium_basemap',
        'official_aerial_imagery',
        'official_high_resolution_imagery',
      ],
      serviceCount: 4,
      message: 'Official Discovery Topo source configured.',
    })
    expect(JSON.stringify(metadata)).not.toContain('field-secret')
  })

  it('reports an invalid source file when Discovery is missing', () => {
    expect(parseMapGenieSourceDetails('Username: mountainrescue_org\northo ITM')).toEqual({
      status: 'invalid',
      username: 'mountainrescue_org',
      availableSources: ['official_aerial_imagery'],
      serviceCount: 1,
      message: 'MapGenie source file is missing the Discovery Topo service.',
    })
  })
})
