const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const {
  MAX_GPX_IMPORT_PATH_LENGTH,
  MAX_GPX_IMPORT_PATHS,
  normalizeGpxImportPaths,
  normalizeRawGpxPath,
} = require('./gpx-import-envelope.cjs')

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const OFFICIAL_MAP_PACKAGE_DIRECTORY = 'official-map-packages'

/**
 * Creates Electron main-process filesystem helpers behind narrow IPC handlers.
 */
function createElectronFileSystem(options) {
  const allowedFiles = new Set()
  const allowedDirectories = new Set([normalizeResolvedPath(options.userDataPath)])

  function allowFile(inputPath) {
    allowedFiles.add(normalizeResolvedPath(inputPath))
  }

  function allowDirectory(inputPath) {
    allowedDirectories.add(normalizeResolvedPath(inputPath))
  }

  function assertAllowedPath(inputPath, label) {
    const resolvedPath = normalizeResolvedPath(inputPath)
    if (allowedFiles.has(resolvedPath)) {
      return
    }
    for (const directoryPath of allowedDirectories) {
      if (isPathInsideDirectory(resolvedPath, directoryPath)) {
        return
      }
    }
    throw new Error(`${label} is not under an allowed app-owned or operator-selected path.`)
  }

  return {
    chooseGpxFilePaths: async () => {
      const result = await showOpenDialog(options, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'GPX tracks', extensions: ['gpx'] }],
      })
      if (result.canceled) {
        return []
      }
      const selectedPaths = normalizeGpxImportPaths(result.filePaths, 'GPX file selection')
      for (const filePath of selectedPaths) {
        allowFile(filePath)
      }
      return selectedPaths
    },
    chooseGpxDirectoryPath: async () => {
      const result = await showOpenDialog(options, {
        properties: ['openDirectory'],
      })
      const selectedPath = result.canceled
        ? null
        : result.filePaths[0] === undefined
          ? null
          : normalizeRawGpxPath(result.filePaths[0], 'GPX directory')
      if (selectedPath !== null) {
        allowDirectory(selectedPath)
      }
      return selectedPath
    },
    chooseOfficialMapSourceFilePath: async () => {
      const result = await showOpenDialog(options, {
        properties: ['openFile'],
        filters: [{ name: 'MapGenie source details', extensions: ['txt'] }],
      })
      const selectedPath = result.canceled ? null : result.filePaths[0] ?? null
      if (selectedPath !== null) {
        allowFile(selectedPath)
      }
      return selectedPath
    },
    chooseOfficialMapPackagePath: async () => {
      const result = await showOpenDialog(options, {
        properties: ['openFile'],
        filters: [{ name: 'Official map packages', extensions: ['mbtiles'] }],
      })
      const selectedPath = result.canceled ? null : result.filePaths[0] ?? null
      if (selectedPath !== null) {
        allowFile(selectedPath)
      }
      return selectedPath
    },
    importOfficialMapPackage: async (input) => {
      const sourcePath = normalizeRequiredPath(input?.sourcePath, 'Official map package')
      assertAllowedPath(sourcePath, 'Official map package')
      if (path.extname(sourcePath).toLowerCase() !== '.mbtiles') {
        throw new Error(getOfficialMapPackageExtensionError(sourcePath))
      }

      const sourceStat = await fs.stat(sourcePath).catch((error) => {
        if (error?.code === 'ENOENT') {
          throw new Error('Official map package file was not found.')
        }
        throw error
      })
      if (!sourceStat.isFile()) {
        throw new Error('Official map package path is not a file.')
      }

      const mapId = normalizeOfficialMapId(input?.mapId)
      const destinationDirectory = path.join(options.userDataPath, OFFICIAL_MAP_PACKAGE_DIRECTORY)
      const destinationPath = path.join(destinationDirectory, `${mapId}.mbtiles`)
      await fs.mkdir(destinationDirectory, { recursive: true })
      await assertEnoughDiskSpace(options, destinationDirectory, sourceStat.size)

      const replacedExisting = await fs.stat(destinationPath)
        .then((stat) => stat.isFile())
        .catch(() => false)
      const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
      await fs.copyFile(sourcePath, temporaryPath)
      await fs.rename(temporaryPath, destinationPath)

      return {
        packagePath: destinationPath,
        sizeBytes: sourceStat.size,
        replacedExisting,
        message: replacedExisting
          ? 'Official map package replaced in SAR Tracker storage.'
          : 'Official map package copied into SAR Tracker storage.',
      }
    },
    readGpxFiles: async (paths) => {
      const normalizedPaths = normalizeGpxImportPaths(paths)
      return Promise.all(normalizedPaths.map(
        (filePath) => readGpxFile(filePath, assertAllowedPath),
      ))
    },
    validateGpxEvidencePaths: async (paths) => {
      const normalizedPaths = normalizeGpxImportPaths(paths, 'GPX file')
      return Promise.all(normalizedPaths.map(async (inputPath) => {
        const filePath = normalizeRawGpxPath(inputPath, 'GPX file')
        assertAllowedPath(filePath, 'GPX file')
        if (!isGpxPath(filePath)) throw new Error(`Only .gpx files can be imported: ${filePath}`)
        return filePath
      }))
    },
    listGpxDirectoryFiles: async (directoryPath) => {
      const normalizedDirectoryPath = normalizeRawGpxPath(directoryPath, 'GPX directory')
      assertAllowedPath(normalizedDirectoryPath, 'GPX directory')
      const stat = await fs.stat(normalizedDirectoryPath).catch(() => null)
      if (stat === null || !stat.isDirectory()) {
        throw new Error(`GPX watch directory was not found: ${normalizedDirectoryPath}`)
      }

      const gpxPaths = await listBoundedGpxDirectoryPaths(normalizedDirectoryPath)

      return Promise.all(gpxPaths.map((filePath) => readGpxFile(filePath, assertAllowedPath)))
    },
    listGpxDirectoryPaths: async (directoryPath) => {
      const normalizedDirectoryPath = normalizeRawGpxPath(directoryPath, 'GPX directory')
      assertAllowedPath(normalizedDirectoryPath, 'GPX directory')
      return listBoundedGpxDirectoryPaths(normalizedDirectoryPath)
    },
    ingestMarkerAttachment: async (input, missionStore) => {
      const missionId = normalizeMissionId(input.missionId)
      const fileName = normalizeAttachmentFileName(input.fileName)
      const bytes = Buffer.from(readString(input, 'bytesBase64'), 'base64')
      if (bytes.length === 0) {
        throw new Error('Attachment file is empty.')
      }
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        throw new Error('Attachment must be 25 MB or smaller.')
      }

      return missionStore.runMarkerAttachmentIngest(missionId, async () => {
        const attachmentDirectory = path.join(
          options.userDataPath,
          'missions',
          missionId,
          'attachments',
        )
        await fs.mkdir(attachmentDirectory, { recursive: true })
        const destinationPath = path.join(attachmentDirectory, `${randomUUID()}-${fileName}`)
        await writeFileAtomically(destinationPath, bytes)
        return destinationPath
      }, async (attachmentPath) => {
        await fs.rm(attachmentPath, { force: true })
      })
    },
    openExternalPath: async (inputPath) => {
      const normalizedPath = normalizeRequiredPath(inputPath, 'Path')
      assertAllowedPath(normalizedPath, 'Path')
      await fs.access(normalizedPath).catch(() => {
        throw new Error(`Path does not exist: ${normalizedPath}`)
      })
      const errorMessage = await options.shell.openPath(normalizedPath)
      if (errorMessage !== '') {
        throw new Error(`Failed to open path with default application: ${errorMessage}`)
      }
    },
  }
}

async function assertEnoughDiskSpace(options, directoryPath, requiredBytes) {
  const statfs = options.statfs ?? fs.statfs
  if (typeof statfs !== 'function') {
    return
  }

  const stats = await statfs(directoryPath)
  const availableBytes = Number(stats.bavail) * Number(stats.bsize)
  if (Number.isFinite(availableBytes) && availableBytes < requiredBytes) {
    throw new Error('Not enough free disk space to import the official map package.')
  }
}

async function showOpenDialog(options, dialogOptions) {
  const browserWindow = options.getBrowserWindow()
  if (browserWindow === null || browserWindow === undefined) {
    return options.dialog.showOpenDialog(dialogOptions)
  }

  return options.dialog.showOpenDialog(browserWindow, dialogOptions)
}

async function readGpxFile(inputPath, assertAllowedPath) {
  const filePath = normalizeRawGpxPath(inputPath, 'GPX file')
  assertAllowedPath(filePath, 'GPX file')
  const stat = await fs.stat(filePath).catch(() => null)
  if (stat === null || !stat.isFile()) {
    throw new Error(`GPX file was not found: ${filePath}`)
  }
  if (!isGpxPath(filePath)) {
    throw new Error(`Only .gpx files can be imported: ${filePath}`)
  }

  const sourceBytes = await fs.readFile(filePath)
  return {
    sourcePath: filePath,
    fileName: path.basename(filePath),
    contents: sourceBytes.toString('utf8'),
    bytesBase64: sourceBytes.toString('base64'),
  }
}

/** Enumerates at most one renderer-safe GPX selection page without building an oversized result. */
async function listBoundedGpxDirectoryPaths(directoryPath) {
  const directory = await fs.opendir(directoryPath).catch(() => null)
  if (directory === null) {
    throw new Error(`GPX watch directory was not found: ${directoryPath}`)
  }
  const gpxPaths = []
  for await (const entry of directory) {
    if (!entry.isFile() || !isGpxPath(entry.name)) continue
    if (gpxPaths.length >= MAX_GPX_IMPORT_PATHS) {
      throw new Error('GPX directory contains more than 100 GPX files; select at most 100 files at a time.')
    }
    if (directoryPath.length + 1 + entry.name.length > MAX_GPX_IMPORT_PATH_LENGTH) {
      throw new Error('GPX directory contains a path longer than 4096 characters.')
    }
    gpxPaths.push(path.join(directoryPath, entry.name))
  }
  return gpxPaths.sort(
    (left, right) => path.basename(left).localeCompare(path.basename(right)),
  )
}

function normalizeRequiredPath(inputPath, label) {
  if (typeof inputPath !== 'string') {
    throw new Error(`${label} must be a string.`)
  }

  const normalizedPath = inputPath.trim()
  if (normalizedPath === '') {
    throw new Error(`${label} is required.`)
  }
  return normalizedPath
}

function normalizeResolvedPath(inputPath) {
  return path.resolve(normalizeRequiredPath(inputPath, 'Path'))
}

function isPathInsideDirectory(filePath, directoryPath) {
  const relativePath = path.relative(directoryPath, filePath)
  return relativePath === '' || (relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function normalizeMissionId(missionId) {
  if (typeof missionId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(missionId)) {
    throw new Error('Mission id is invalid.')
  }
  return missionId
}

function normalizeAttachmentFileName(fileName) {
  const normalized = readString({ fileName }, 'fileName')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
  if (normalized === '') {
    throw new Error('Attachment file name is required.')
  }
  return normalized
}

function readString(input, key) {
  const value = input[key]
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string.`)
  }
  return value
}

function isGpxPath(filePath) {
  return path.extname(filePath).toLowerCase() === '.gpx'
}

function normalizeOfficialMapId(input) {
  const value = typeof input === 'string' ? input.trim() : ''
  const allowed = new Set([
    'official_discovery_topo',
    'official_premium_basemap',
    'official_aerial_imagery',
    'official_high_resolution_imagery',
  ])
  return allowed.has(value) ? value : 'official_discovery_topo'
}

function getOfficialMapPackageExtensionError(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase()
  if (extension === '.tif' || extension === '.tiff') {
    return 'This beta cannot import raw Discovery .tif/.tiff source files. Use Add Discovery Package with a prepared .mbtiles package, such as reeks-standard-60km-z16.mbtiles, or ask the map admin to prepare one from the licensed source.'
  }
  if (extension === '.zip') {
    return 'This beta cannot import raw Discovery .zip source files. Use Add Discovery Package with a prepared .mbtiles package, such as reeks-standard-60km-z16.mbtiles, or ask the map admin to prepare one from the licensed source.'
  }
  return 'Official map package must be a .mbtiles file.'
}

async function writeFileAtomically(destinationPath, bytes) {
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temporaryPath, bytes)
  await fs.rename(temporaryPath, destinationPath)
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  createElectronFileSystem,
}
