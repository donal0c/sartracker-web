import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

  async function createService(overrides?: Partial<{
    readonly dialog: {
      readonly showOpenDialog: (...args: unknown[]) => Promise<{
        readonly canceled: boolean
        readonly filePaths: readonly string[]
      }>
    }
    readonly shell: { readonly openPath: (path: string) => Promise<string> }
  }>): Promise<ElectronFileSystem> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-files-'))
    return createElectronFileSystem({
      userDataPath,
      dialog: overrides?.dialog ?? {
        showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
      },
      shell: overrides?.shell ?? { openPath: vi.fn().mockResolvedValue('') },
      getBrowserWindow: () => null,
    })
  }
})
