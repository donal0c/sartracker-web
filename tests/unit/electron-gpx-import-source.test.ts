import { afterEach, describe, expect, it, vi } from 'vitest'

import { createElectronGpxImportSource } from '../../src/infrastructure/gpx-import-source/electron-gpx-import-source'

describe('Electron GPX import source', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delegates path selection but refuses raw GPX byte reads across the preload bridge', async () => {
    const bridge = {
      chooseGpxFilePaths: vi.fn().mockResolvedValue(['/tracks/a.gpx']),
      chooseGpxDirectoryPath: vi.fn().mockResolvedValue('/tracks'),
      listGpxDirectoryPaths: vi.fn().mockResolvedValue(['/tracks/b.gpx']),
    }
    vi.stubGlobal('window', {
      sartrackerElectron: bridge,
    })

    const source = createElectronGpxImportSource()

    await expect(source.chooseFilePaths()).resolves.toEqual(['/tracks/a.gpx'])
    await expect(source.chooseDirectoryPath()).resolves.toBe('/tracks')
    await expect(source.readFiles(['/tracks/a.gpx'])).rejects.toThrow(/raw GPX.*renderer/i)
    await expect(source.listDirectoryFiles('/tracks')).rejects.toThrow(/raw GPX.*renderer/i)
    await expect(source.listDirectoryPaths?.('/tracks')).resolves.toEqual(['/tracks/b.gpx'])
  })
})
