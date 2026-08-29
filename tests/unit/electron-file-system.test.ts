import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => {
    readonly close: () => void
    readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
    readonly finishMission: (missionId: string) => Promise<{ readonly status: string }>
    readonly getMission: (missionId: string) => Promise<{ readonly status: string }>
    readonly listMissionEvents: (missionId: string) => Promise<readonly {
      readonly event_type: string
    }[]>
  }
}
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
  readonly listGpxDirectoryPaths: (directoryPath: string) => Promise<readonly string[]>
  readonly ingestMarkerAttachment: (
    input: { readonly missionId: string; readonly fileName: string; readonly bytesBase64: string },
    missionStore: {
      readonly runMarkerAttachmentIngest: (
        missionId: string,
        writeAttachment: () => Promise<string>,
      ) => Promise<string>
    },
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
        bytesBase64: 'PGdweD5iPC9ncHg+',
      },
    ])
    await expect(service.listGpxDirectoryFiles(userDataPath!)).resolves.toMatchObject([
      { fileName: 'a.gpx' },
      { fileName: 'b.gpx' },
    ])
  })

  it('rejects GPX reads outside app-owned or dialog-selected paths [DON-236]', async () => {
    const service = await createService()
    const externalDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-external-gpx-'))
    const externalPath = path.join(externalDirectory, 'team.gpx')
    await writeFile(externalPath, '<gpx>external</gpx>')

    await expect(service.readGpxFiles([externalPath])).rejects.toThrow(/not under an allowed/)
    await expect(service.listGpxDirectoryFiles(externalDirectory)).rejects.toThrow(
      /not under an allowed/,
    )

    await rm(externalDirectory, { recursive: true, force: true })
  })

  it('allows GPX files and directories after an explicit dialog selection [DON-236]', async () => {
    const externalDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-selected-gpx-'))
    const externalPath = path.join(externalDirectory, 'team.gpx')
    await writeFile(externalPath, '<gpx>selected</gpx>')
    const dialog = {
      showOpenDialog: vi
        .fn()
        .mockResolvedValueOnce({ canceled: false, filePaths: [externalPath] })
        .mockResolvedValueOnce({ canceled: false, filePaths: [externalDirectory] }),
    }
    const service = await createService({ dialog })

    await expect(service.chooseGpxFilePaths()).resolves.toEqual([externalPath])
    await expect(service.readGpxFiles([externalPath])).resolves.toMatchObject([
      { fileName: 'team.gpx', contents: '<gpx>selected</gpx>' },
    ])
    await expect(service.chooseGpxDirectoryPath()).resolves.toBe(externalDirectory)
    await expect(service.listGpxDirectoryFiles(externalDirectory)).resolves.toMatchObject([
      { fileName: 'team.gpx' },
    ])

    await rm(externalDirectory, { recursive: true, force: true })
  })

  it('rejects oversized GPX file selections atomically without allowing a partial selection', async () => {
    const selectedPaths = Array.from(
      { length: 101 },
      (_, index) => `/Volumes/team/${String(index).padStart(3, '0')}.gpx`,
    )
    const dialog = {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: selectedPaths }),
    }
    const service = await createService({ dialog })

    await expect(service.chooseGpxFilePaths()).rejects.toThrow(/more than 100/iu)
    await expect(service.readGpxFiles([selectedPaths[0]])).rejects.toThrow(/not under an allowed/iu)
  })

  it('rejects overlong GPX dialog paths before allowing or resolving them', async () => {
    const oversizedPath = `/${'x'.repeat(4_096)}`
    const dialog = {
      showOpenDialog: vi.fn()
        .mockResolvedValueOnce({ canceled: false, filePaths: [oversizedPath] })
        .mockResolvedValueOnce({ canceled: false, filePaths: [oversizedPath] }),
    }
    const service = await createService({ dialog })

    await expect(service.chooseGpxFilePaths()).rejects.toThrow(/GPX file.*4096/iu)
    await expect(service.chooseGpxDirectoryPath()).rejects.toThrow(/GPX directory.*4096/iu)
  })

  it('refuses to return or materialize more than 100 GPX directory results', async () => {
    const service = await createService()
    await Promise.all(Array.from({ length: 101 }, (_, index) =>
      writeFile(path.join(userDataPath!, `${String(index).padStart(3, '0')}.gpx`), '<gpx/>')))

    await expect(service.listGpxDirectoryPaths(userDataPath!))
      .rejects.toThrow(/more than 100/iu)
    await expect(service.listGpxDirectoryFiles(userDataPath!))
      .rejects.toThrow(/more than 100/iu)
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
        runMarkerAttachmentIngest: vi.fn(async (_missionId, writeAttachment) =>
          writeAttachment()),
      },
    )

    expect(path.dirname(storedPath)).toBe(
      path.join(userDataPath!, 'missions', 'mission-1', 'attachments'),
    )
    expect(path.basename(storedPath)).toMatch(/^[0-9a-f-]+-team-photo-\.jpg$/u)
    await expect(readFile(storedPath, 'utf8')).resolves.toBe('image bytes')
  })

  it('never overwrites retained attachment bytes when sanitized names collide [DON-277]', async () => {
    const service = await createService()
    const missionStore = {
      runMarkerAttachmentIngest: vi.fn(async (
        _missionId: string,
        writeAttachment: () => Promise<string>,
      ) => writeAttachment()),
    }
    const firstPath = await service.ingestMarkerAttachment({
      missionId: 'mission-1', fileName: 'evidence.jpg',
      bytesBase64: Buffer.from('old-evidence').toString('base64'),
    }, missionStore)
    const secondPath = await service.ingestMarkerAttachment({
      missionId: 'mission-1', fileName: 'evidence.jpg',
      bytesBase64: Buffer.from('new-evidence').toString('base64'),
    }, missionStore)

    expect(secondPath).not.toBe(firstPath)
    await expect(readFile(firstPath, 'utf8')).resolves.toBe('old-evidence')
    await expect(readFile(secondPath, 'utf8')).resolves.toBe('new-evidence')
  })

  it('orders attachment custody before a concurrent Finish write fence [DON-277]', async () => {
    const service = await createService()
    const missionStore = createElectronMissionStore({ userDataPath: userDataPath! })
    const mission = await missionStore.createMission({ name: 'Attachment finish race' })

    try {
      const attachmentPromise = service.ingestMarkerAttachment({
        missionId: mission.id,
        fileName: 'finish-race.txt',
        bytesBase64: Buffer.from('retained-before-finish').toString('base64'),
      }, missionStore)
      const finishPromise = missionStore.finishMission(mission.id)
      const [attachmentPath, finishedMission] = await Promise.all([
        attachmentPromise,
        finishPromise,
      ])
      const events = await missionStore.listMissionEvents(mission.id)
      const attachmentEventIndex = events.findIndex(
        (event) => event.event_type === 'marker_attachment_ingested',
      )
      const finishEventIndex = events.findIndex((event) => event.event_type === 'mission_finished')

      expect(finishedMission.status).toBe('finished')
      await expect(readFile(attachmentPath, 'utf8')).resolves.toBe('retained-before-finish')
      expect(attachmentEventIndex).toBeGreaterThanOrEqual(0)
      expect(finishEventIndex).toBeGreaterThan(attachmentEventIndex)
    } finally {
      missionStore.close()
    }
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
          runMarkerAttachmentIngest: vi.fn(async (missionId) => {
            throw new Error(
              `Cannot write data to finished mission ${missionId}; resume the mission or unlock it first.`,
            )
          }),
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
