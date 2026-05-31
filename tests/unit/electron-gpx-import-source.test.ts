import { afterEach, describe, expect, it, vi } from 'vitest'

import { createElectronGpxImportSource } from '../../src/infrastructure/gpx-import-source/electron-gpx-import-source'

describe('Electron GPX import source', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delegates file selection and reads to the typed preload bridge', async () => {
    const bridge = {
      chooseGpxFilePaths: vi.fn().mockResolvedValue(['/tracks/a.gpx']),
      chooseGpxDirectoryPath: vi.fn().mockResolvedValue('/tracks'),
      readGpxFiles: vi.fn().mockResolvedValue([{ fileName: 'a.gpx' }]),
      listGpxDirectoryFiles: vi.fn().mockResolvedValue([{ fileName: 'b.gpx' }]),
    }
    vi.stubGlobal('window', {
      sartrackerElectron: bridge,
    })

    const source = createElectronGpxImportSource()

    await expect(source.chooseFilePaths()).resolves.toEqual(['/tracks/a.gpx'])
    await expect(source.chooseDirectoryPath()).resolves.toBe('/tracks')
    await expect(source.readFiles(['/tracks/a.gpx'])).resolves.toEqual([{ fileName: 'a.gpx' }])
    await expect(source.listDirectoryFiles('/tracks')).resolves.toEqual([{ fileName: 'b.gpx' }])
  })
})
