import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronFileSystem } = require('../../electron/file-system.cjs') as {
  readonly createElectronFileSystem: (options: {
    readonly userDataPath: string
    readonly dialog: {
      readonly showOpenDialog: (...args: unknown[]) => Promise<{
        readonly canceled: boolean
        readonly filePaths: readonly string[]
      }>
    }
    readonly shell: { readonly openPath: (path: string) => Promise<string> }
    readonly getBrowserWindow: () => unknown
  }) => ElectronFileSystem
}

type ElectronFileSystem = {
  readonly chooseGpxFilePaths: () => Promise<readonly string[]>
  readonly chooseGpxDirectoryPath: () => Promise<string | null>
  readonly chooseOfficialMapSourceFilePath: () => Promise<string | null>
  readonly chooseOfficialMapPackagePath: () => Promise<string | null>
  readonly importOfficialMapPackage: (input: {
    readonly sourcePath: string
    readonly mapId: string
  }) => Promise<{
    readonly packagePath: string
    readonly sizeBytes: number
    readonly replacedExisting: boolean
    readonly message: string
  }>
  readonly readGpxFiles: (paths: readonly string[]) => Promise<readonly {
    readonly sourcePath: string
    readonly fileName: string
    readonly contents: string
  }[]>
  readonly listGpxDirectoryFiles: (directoryPath: string) => Promise<readonly {
    readonly fileName: string
  }[]>
  readonly ingestMarkerAttachment: (
    input: { readonly missionId: string; readonly fileName: string; readonly bytesBase64: string },
    missionStore: { readonly getMission: (missionId: string) => Promise<{ readonly status: string }> },
  ) => Promise<string>
  readonly openExternalPath: (path: string) => Promise<void>
}

describe('Electron filesystem service', () => {
  let userDataPath: string | null = null

  afterEach(async () => {
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('reads explicit GPX files and sorted GPX directory contents', async () => {
    const service = await createService()
    const firstPath = path.join(userDataPath!, 'b.gpx')
    const secondPath = path.join(userDataPath!, 'a.gpx')
    const ignoredPath = path.join(userDataPath!, 'notes.txt')
    await writeFile(firstPath, '<gpx>b</gpx>')
    await writeFile(secondPath, '<gpx>a</gpx>')
    await writeFile(ignoredPath, 'ignore')

    await expect(service.readGpxFiles([firstPath])).resolves.toEqual([
      {
        sourcePath: firstPath,
        fileName: 'b.gpx',
        contents: '<gpx>b</gpx>',
      },
    ])
    await expect(service.listGpxDirectoryFiles(userDataPath!)).resolves.toMatchObject([
      { fileName: 'a.gpx' },
      { fileName: 'b.gpx' },
    ])
  })

  it('stores marker attachments under Electron userData with a sanitized file name', async () => {
    const service = await createService()
    const storedPath = await service.ingestMarkerAttachment(
      {
        missionId: 'mission-1',
        fileName: 'team/photo?.jpg',
        bytesBase64: Buffer.from('image bytes').toString('base64'),
      },
      {
        getMission: vi.fn().mockResolvedValue({ status: 'active' }),
      },
    )

    expect(storedPath).toBe(
      path.join(userDataPath!, 'missions', 'mission-1', 'attachments', 'team-photo-.jpg'),
    )
    await expect(readFile(storedPath, 'utf8')).resolves.toBe('image bytes')
  })

  it('blocks attachment writes to finished missions', async () => {
    const service = await createService()

    await expect(
      service.ingestMarkerAttachment(
        {
          missionId: 'mission-1',
          fileName: 'photo.jpg',
          bytesBase64: Buffer.from('image bytes').toString('base64'),
        },
        {
          getMission: vi.fn().mockResolvedValue({ status: 'finished' }),
        },
      ),
    ).rejects.toThrow('Cannot write data to finished mission mission-1')
  })

  it('opens existing paths through Electron shell', async () => {
    const shell = { openPath: vi.fn().mockResolvedValue('') }
    const service = await createService({ shell })
    const filePath = path.join(userDataPath!, 'report.txt')
    await writeFile(filePath, 'report')

    await service.openExternalPath(filePath)

    expect(shell.openPath).toHaveBeenCalledWith(filePath)
  })

  it('chooses official map setup files with constrained file filters', async () => {
    const dialog = {
      showOpenDialog: vi
        .fn()
        .mockResolvedValueOnce({
          canceled: false,
          filePaths: ['/Volumes/team/mountainrescue_org.txt'],
        })
        .mockResolvedValueOnce({
          canceled: false,
          filePaths: ['/Volumes/team/reeks-standard-60km-z16.mbtiles'],
        }),
    }
    const service = await createService({ dialog })

    await expect(service.chooseOfficialMapSourceFilePath()).resolves.toBe(
      '/Volumes/team/mountainrescue_org.txt',
    )
    await expect(service.chooseOfficialMapPackagePath()).resolves.toBe(
      '/Volumes/team/reeks-standard-60km-z16.mbtiles',
    )

    expect(dialog.showOpenDialog).toHaveBeenNthCalledWith(1, {
      properties: ['openFile'],
      filters: [{ name: 'MapGenie source details', extensions: ['txt'] }],
    })
    expect(dialog.showOpenDialog).toHaveBeenNthCalledWith(2, {
      properties: ['openFile'],
      filters: [{ name: 'Official map packages', extensions: ['mbtiles'] }],
    })
  })

  it('imports official map packages into app-owned storage with duplicate replacement', async () => {
    const service = await createService()
    const sourcePath = path.join(userDataPath!, 'usb', 'Reeks Standard 60km.mbtiles')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, 'first package')

    const imported = await service.importOfficialMapPackage({
      sourcePath,
      mapId: 'official_discovery_topo',
    })

    expect(imported).toMatchObject({
      packagePath: path.join(userDataPath!, 'official-map-packages', 'official_discovery_topo.mbtiles'),
      sizeBytes: 13,
      replacedExisting: false,
      message: 'Official map package copied into SAR Tracker storage.',
    })
    await expect(readFile(imported.packagePath, 'utf8')).resolves.toBe('first package')
    await rm(sourcePath)
    await expect(access(sourcePath)).rejects.toThrow()
    await expect(readFile(imported.packagePath, 'utf8')).resolves.toBe('first package')

    await writeFile(sourcePath, 'replacement package')
    const replacement = await service.importOfficialMapPackage({
      sourcePath,
      mapId: 'official_discovery_topo',
    })

    expect(replacement).toMatchObject({
      packagePath: imported.packagePath,
      sizeBytes: 19,
      replacedExisting: true,
    })
    await expect(readFile(imported.packagePath, 'utf8')).resolves.toBe('replacement package')
  })

  it('rejects invalid package paths before copying', async () => {
    const service = await createService()
    const textPath = path.join(userDataPath!, 'not-mbtiles.txt')
    await writeFile(textPath, 'nope')

    await expect(
      service.importOfficialMapPackage({
        sourcePath: textPath,
        mapId: 'official_discovery_topo',
      }),
    ).rejects.toThrow('Official map package must be a .mbtiles file.')
  })

  it('explains raw Discovery source files cannot be imported as beta packages', async () => {
    const service = await createService()
    const geoTiffPath = path.join(userDataPath!, 'Discovery_RGB_95pct_C70_high30.1953.tif')
    const zipPath = path.join(userDataPath!, 'Discovery_National.zip')
    await writeFile(geoTiffPath, 'raw geotiff')
    await writeFile(zipPath, 'raw zip')

    await expect(
      service.importOfficialMapPackage({
        sourcePath: geoTiffPath,
        mapId: 'official_discovery_topo',
      }),
    ).rejects.toThrow(
      'This beta cannot import raw Discovery .tif/.tiff source files. Use Add Discovery Package with a prepared .mbtiles package, such as reeks-standard-60km-z16.mbtiles, or ask the map admin to prepare one from the licensed source.',
    )

    await expect(
      service.importOfficialMapPackage({
        sourcePath: zipPath,
        mapId: 'official_discovery_topo',
      }),
    ).rejects.toThrow(
      'This beta cannot import raw Discovery .zip source files. Use Add Discovery Package with a prepared .mbtiles package, such as reeks-standard-60km-z16.mbtiles, or ask the map admin to prepare one from the licensed source.',
    )
  })

  it('preflights disk space before copying official map packages', async () => {
    const service = await createService({
      statfs: vi.fn().mockResolvedValue({ bavail: 1, bsize: 1 }),
    })
    const sourcePath = path.join(userDataPath!, 'reeks.mbtiles')
    await writeFile(sourcePath, 'package larger than one byte')

    await expect(
      service.importOfficialMapPackage({
        sourcePath,
        mapId: 'official_discovery_topo',
      }),
    ).rejects.toThrow('Not enough free disk space to import the official map package.')
  })

  async function createService(overrides?: Partial<{
    readonly dialog: {
      readonly showOpenDialog: (...args: unknown[]) => Promise<{
        readonly canceled: boolean
        readonly filePaths: readonly string[]
      }>
    }
    readonly shell: { readonly openPath: (path: string) => Promise<string> }
    readonly statfs: (path: string) => Promise<{ readonly bavail: number; readonly bsize: number }>
  }>): Promise<ElectronFileSystem> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-files-'))
    return createElectronFileSystem({
      userDataPath,
      dialog: overrides?.dialog ?? {
        showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      },
      shell: overrides?.shell ?? { openPath: vi.fn().mockResolvedValue('') },
      statfs: overrides?.statfs,
      getBrowserWindow: () => null,
    })
  }
})
