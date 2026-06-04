import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

const { createElectronOfficialMapProxy } = (await import('../../electron/official-map-proxy.cjs')) as {
  readonly createElectronOfficialMapProxy: (options: {
    readonly loadSettings: () => Promise<unknown>
    readonly fetch: typeof fetch
  }) => {
    readonly fetchOfficialMapTile: (url: string) => Promise<{
      readonly contentType: string
      readonly bytesBase64: string
    }>
  }
}

describe('Electron official map proxy', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir !== null) {
      await rm(tempDir, { force: true, recursive: true })
      tempDir = null
    }
  })

  it('fetches a configured MapGenie tile through ArcGIS export without returning credentials', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-mapgenie-'))
    const sourcePath = path.join(tempDir, 'mountainrescue_org.txt')
    await writeFile(
      sourcePath,
      [
        'Customer: Mountain Rescue Ireland',
        'Username: mountainrescue_org',
        'Password: field-secret',
        'discovery ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/discovery/MapServer/wmts?REQUEST=GetCapabilities&format=text/xml',
        'ortho ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/ortho/MapServer/wmts?REQUEST=GetCapabilities&format=text/xml',
      ].join('\n'),
      'utf8',
    )
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    })
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      loadSettings: async () => ({
        ...DEFAULT_APP_SETTINGS,
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          sourceType: 'mapgenie_file',
          sourcePath,
          status: 'configured',
          availableSources: ['official_discovery_topo', 'official_aerial_imagery'],
          serviceCount: 2,
        },
      }),
    })

    const response = await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
    )

    expect(response).toEqual({
      contentType: 'image/png',
      bytesBase64: 'AQIDBA==',
    })
    expect(JSON.stringify(response)).not.toContain('field-secret')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toContain('/discovery/MapServer/export?')
    expect(url).not.toContain('field-secret')
    expect(url).not.toContain('mountainrescue_org')
    expect(options).toMatchObject({
      headers: {
        authorization: 'Basic bW91bnRhaW5yZXNjdWVfb3JnOmZpZWxkLXNlY3JldA==',
      },
    })

    await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_aerial_imagery/12/1935/1344.png',
    )
    expect(fetchMock.mock.calls[1]![0]).toContain('/ortho/MapServer/export?')
  })

  it('fails explicitly when official maps are not configured', async () => {
    const proxy = createElectronOfficialMapProxy({
      fetch: vi.fn() as never,
      loadSettings: async () => DEFAULT_APP_SETTINGS,
    })

    await expect(
      proxy.fetchOfficialMapTile('sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'),
    ).rejects.toThrow('Official maps are not configured.')
  })
})
