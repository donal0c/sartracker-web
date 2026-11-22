import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const promisesFs = require('node:fs/promises') as typeof import('node:fs/promises')
const BetterSqlite3 = require('better-sqlite3') as new (
  file: string,
  options?: { readonly readonly?: boolean },
) => {
  readonly prepare: (sql: string) => { readonly all: (...args: unknown[]) => unknown[] }
  readonly close: () => void
}
const { enumerateArchiveAttachments } = require('../../electron/archive-attachments.cjs') as {
  readonly enumerateArchiveAttachments: (input: {
    readonly db: unknown
    readonly databasePath: string
    readonly missionId: string
  }) => readonly { readonly custodyClass: string; readonly sha256: string }[]
}
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
        writeAttachment: () => Promise<unknown>,
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
          (await writeAttachment() as { readonly attachmentPath: string }).attachmentPath),
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
        writeAttachment: () => Promise<unknown>,
      ) => (await writeAttachment() as { readonly attachmentPath: string }).attachmentPath),
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

  it('flushes attachment bytes and directory entries before custody is committed [M-41]', async () => {
    const service = await createService()
    const syncedPaths: string[] = []
    const realOpen = promisesFs.open.bind(promisesFs)
    const openSpy = vi.spyOn(promisesFs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...(args as Parameters<typeof promisesFs.open>))
      const realSync = handle.sync.bind(handle)
      handle.sync = async () => {
        syncedPaths.push(String(args[0]))
        return realSync()
      }
      return handle
    })
    let syncedBeforeCommit: readonly string[] = []
    try {
      const storedPath = await service.ingestMarkerAttachment({
        missionId: 'mission-fsync',
        fileName: 'evidence.jpg',
        bytesBase64: Buffer.from('flushed evidence').toString('base64'),
      }, {
        runMarkerAttachmentIngest: async (_missionId, writeAttachment) => {
          const written = await writeAttachment() as { readonly attachmentPath: string }
          syncedBeforeCommit = [...syncedPaths]
          return written.attachmentPath
        },
      })
      const attachmentDirectory = path.dirname(storedPath)
      expect(syncedBeforeCommit.some((synced) => synced.startsWith(`${storedPath}.`)))
        .toBe(true)
      if (process.platform !== 'win32') {
        expect(syncedBeforeCommit).toContain(attachmentDirectory)
        // The new mission and attachments folders are themselves named durably.
        expect(syncedBeforeCommit).toContain(path.dirname(attachmentDirectory))
        expect(syncedBeforeCommit).toContain(path.join(userDataPath!, 'missions'))
      }
      await expect(readFile(storedPath, 'utf8')).resolves.toBe('flushed evidence')
    } finally {
      openSpy.mockRestore()
    }
  })

  it('flushes the parent folders again when a write is retried after a failed folder flush [M-41]', async () => {
    const service = await createService()
    const missionsDirectory = path.join(userDataPath!, 'missions')
    const syncedPaths: string[] = []
    let failMissionsFlushOnce = true
    const realOpen = promisesFs.open.bind(promisesFs)
    const openSpy = vi.spyOn(promisesFs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...(args as Parameters<typeof promisesFs.open>))
      const realSync = handle.sync.bind(handle)
      handle.sync = async () => {
        if (String(args[0]) === missionsDirectory && failMissionsFlushOnce) {
          failMissionsFlushOnce = false
          throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO', syscall: 'fsync' })
        }
        syncedPaths.push(String(args[0]))
        return realSync()
      }
      return handle
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const missionStore = {
      runMarkerAttachmentIngest: async (_missionId: string, writeAttachment: () => Promise<unknown>) =>
        (await writeAttachment() as { readonly attachmentPath: string }).attachmentPath,
    }
    const input = {
      missionId: 'mission-retry',
      fileName: 'retry.jpg',
      bytesBase64: Buffer.from('retry evidence').toString('base64'),
    }
    try {
      await expect(service.ingestMarkerAttachment(input, missionStore)).rejects.toThrow()
      syncedPaths.length = 0
      // The folders already exist now, so mkdir creates nothing on the retry.
      const storedPath = await service.ingestMarkerAttachment(input, missionStore)
      if (process.platform !== 'win32') {
        const missionDirectory = path.join(missionsDirectory, 'mission-retry')
        expect(syncedPaths).toEqual(expect.arrayContaining([
          userDataPath!,
          missionsDirectory,
          missionDirectory,
          path.dirname(storedPath),
        ]))
      }
      await expect(readFile(storedPath, 'utf8')).resolves.toBe('retry evidence')
    } finally {
      openSpy.mockRestore()
    }
  })

  it('tells the operator plainly when the attachment cannot be saved safely [M-41]', async () => {
    const service = await createService()
    const attachmentDirectory = path.join(userDataPath!, 'missions', 'mission-eio', 'attachments')
    const realOpen = promisesFs.open.bind(promisesFs)
    const openSpy = vi.spyOn(promisesFs, 'open').mockImplementation(async (...args) => {
      const handle = await realOpen(...(args as Parameters<typeof promisesFs.open>))
      if (String(args[0]).startsWith(`${attachmentDirectory}${path.sep}`)) {
        handle.sync = async () => {
          throw Object.assign(new Error(`EIO: i/o error, fsync '${String(args[0])}'`), {
            code: 'EIO',
            syscall: 'fsync',
          })
        }
      }
      return handle
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const runMarkerAttachmentIngest = vi.fn(async (
      _missionId: string,
      writeAttachment: () => Promise<unknown>,
    ) => (await writeAttachment() as { readonly attachmentPath: string }).attachmentPath)
    try {
      const failure = service.ingestMarkerAttachment({
        missionId: 'mission-eio',
        fileName: 'eio.jpg',
        bytesBase64: Buffer.from('never durable').toString('base64'),
      }, { runMarkerAttachmentIngest })
      await expect(failure).rejects.toMatchObject({
        code: 'ATTACHMENT_WRITE_FAILED',
        message: expect.stringMatching(
          /could not be saved safely.*not added.*free disk space.*attach the file again/iu,
        ),
      })
      await expect(failure).rejects.not.toThrow(/EIO|fsync|i\/o error/u)
      expect(errors).toHaveBeenCalledWith(expect.stringMatching(/attachment write failed.*EIO.*fsync/iu))
      for (const call of errors.mock.calls) {
        expect(String(call[0])).not.toContain(userDataPath!)
      }
      // No half-written file is left behind for a reference that was never committed.
      await expect(promisesFs.readdir(attachmentDirectory)).resolves.toEqual([])
    } finally {
      openSpy.mockRestore()
    }
  })

  it('refuses custody the archive would reject, including the 25 MB bound [M-41]', async () => {
    const missionStore = createElectronMissionStore({ userDataPath: (userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-custody-bound-'))) }) as unknown as {
      readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
      readonly runMarkerAttachmentIngest: (
        missionId: string,
        writeAttachment: () => Promise<unknown>,
        cleanupAttachment: (attachmentPath: string) => Promise<void>,
      ) => Promise<string>
      readonly close: () => void
    }
    try {
      const mission = await missionStore.createMission({ name: 'Custody bound' })
      const attachmentId = '0b5c3f7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f'
      const storedName = `${attachmentId}-big.jpg`
      const attachmentPath = path.join(userDataPath, 'missions', mission.id, 'attachments', storedName)
      const cleanup = vi.fn(async () => undefined)
      await expect(missionStore.runMarkerAttachmentIngest(mission.id, async () => ({
        attachmentPath,
        custody: {
          custody_version: 2,
          attachment_id: attachmentId,
          size_bytes: 25 * 1024 * 1024 + 1,
          sha256: 'a'.repeat(64),
          relative_path: `missions/${mission.id}/attachments/${storedName}`,
          display_name: 'big.jpg',
        },
      }), cleanup)).rejects.toThrow(/custody record is invalid/u)
      expect(cleanup).toHaveBeenCalledWith(attachmentPath)
    } finally {
      missionStore.close()
    }
  })

  it('records v2 custody so a damaged attachment is caught at archive [M-41]', async () => {
    const service = await createService()
    const missionStore = createElectronMissionStore({ userDataPath: userDataPath! })
    const mission = await missionStore.createMission({ name: 'Attachment custody' })
    const bytes = Buffer.from('custody evidence bytes')
    let reader: InstanceType<typeof BetterSqlite3> | null = null
    try {
      const storedPath = await service.ingestMarkerAttachment({
        missionId: mission.id,
        fileName: 'custody.jpg',
        bytesBase64: bytes.toString('base64'),
      }, missionStore)
      const events = await missionStore.listMissionEvents(mission.id) as readonly {
        readonly event_type: string
        readonly details_json: string
      }[]
      const ingest = events.find((event) => event.event_type === 'marker_attachment_ingested')
      const details = JSON.parse(ingest!.details_json) as Record<string, unknown>
      const basename = path.basename(storedPath)
      expect(details).toMatchObject({
        attachment_path: storedPath,
        custody_version: 2,
        size_bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        relative_path: `missions/${mission.id}/attachments/${basename}`,
        display_name: 'custody.jpg',
      })
      expect(basename.startsWith(`${String(details.attachment_id)}-`)).toBe(true)

      const databasePath = path.join(userDataPath!, 'mission-store.sqlite')
      reader = new BetterSqlite3(databasePath, { readonly: true })
      const intact = enumerateArchiveAttachments({ db: reader, databasePath, missionId: mission.id })
      expect(intact).toHaveLength(1)
      expect(intact[0]!.custodyClass).toBe('v2_digest')

      // A torn write after a power cut leaves fewer bytes than were recorded.
      await truncate(storedPath, 4)
      expect(() => enumerateArchiveAttachments({ db: reader, databasePath, missionId: mission.id }))
        .toThrow(expect.objectContaining({ code: 'ARCHIVE_ATTACHMENT_CHANGED' }))
    } finally {
      reader?.close()
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
    const filePath = path.join(userDataPath!, 'missions', 'mission-1', 'attachments', 'report.txt')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, 'report')

    await service.openExternalPath(filePath)

    expect(shell.openPath).toHaveBeenCalledWith(await realpath(filePath))
  })

  it('refuses private app state and symlinks from live attachments into protected files', async () => {
    const shell = { openPath: vi.fn().mockResolvedValue('') }
    const service = await createService({ shell })
    const privatePath = path.join(userDataPath!, 'archive-review', 'session', 'mission-store.sqlite')
    await mkdir(path.dirname(privatePath), { recursive: true })
    await writeFile(privatePath, 'PRIVATE')
    const link = path.join(userDataPath!, 'missions', 'mission-1', 'attachments', 'innocent.pdf')
    await mkdir(path.dirname(link), { recursive: true })
    await symlink(privatePath, link)
    await expect(service.openExternalPath(privatePath)).rejects.toThrow(/allowed|protected/iu)
    await expect(service.openExternalPath(link)).rejects.toThrow(/allowed|protected|symbolic/iu)
    expect(shell.openPath).not.toHaveBeenCalled()
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
