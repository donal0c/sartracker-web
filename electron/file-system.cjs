const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const OFFICIAL_MAP_PACKAGE_DIRECTORY = 'official-map-packages'

/**
 * Creates Electron main-process filesystem helpers behind narrow IPC handlers.
 */
function createElectronFileSystem(options) {
  return {
    chooseGpxFilePaths: async () => {
      const result = await showOpenDialog(options, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'GPX tracks', extensions: ['gpx'] }],
      })
      return result.canceled ? [] : result.filePaths
    },
    chooseGpxDirectoryPath: async () => {
      const result = await showOpenDialog(options, {
        properties: ['openDirectory'],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    chooseOfficialMapSourceFilePath: async () => {
      const result = await showOpenDialog(options, {
        properties: ['openFile'],
        filters: [{ name: 'MapGenie source details', extensions: ['txt'] }],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    chooseOfficialMapPackagePath: async () => {
      const result = await showOpenDialog(options, {
        properties: ['openFile'],
        filters: [{ name: 'Official map packages', extensions: ['mbtiles'] }],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    importOfficialMapPackage: async (input) => {
      const sourcePath = normalizeRequiredPath(input?.sourcePath, 'Official map package')
      if (path.extname(sourcePath).toLowerCase() !== '.mbtiles') {
        throw new Error('Official map package must be a .mbtiles file.')
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
      return Promise.all(paths.map((filePath) => readGpxFile(filePath)))
    },
    listGpxDirectoryFiles: async (directoryPath) => {
      const normalizedDirectoryPath = normalizeRequiredPath(directoryPath, 'GPX directory')
      const stat = await fs.stat(normalizedDirectoryPath).catch(() => null)
      if (stat === null || !stat.isDirectory()) {
        throw new Error(`GPX watch directory was not found: ${normalizedDirectoryPath}`)
      }

      const entries = await fs.readdir(normalizedDirectoryPath, { withFileTypes: true })
      const gpxPaths = entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(normalizedDirectoryPath, entry.name))
        .filter(isGpxPath)
        .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))

      return Promise.all(gpxPaths.map((filePath) => readGpxFile(filePath)))
    },
    ingestMarkerAttachment: async (input, missionStore) => {
      const missionId = normalizeMissionId(input.missionId)
      const mission = await missionStore.getMission(missionId)
      if (mission.status === 'finished' || mission.status === 'finalized') {
        throw new Error(
          `Cannot write data to finished mission ${missionId}; resume the mission or unlock it first.`,
        )
      }

      const fileName = normalizeAttachmentFileName(input.fileName)
      const bytes = Buffer.from(readString(input, 'bytesBase64'), 'base64')
      if (bytes.length === 0) {
        throw new Error('Attachment file is empty.')
      }
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        throw new Error('Attachment must be 25 MB or smaller.')
      }

      const attachmentDirectory = path.join(
        options.userDataPath,
        'missions',
        missionId,
        'attachments',
      )
      await fs.mkdir(attachmentDirectory, { recursive: true })
      const destinationPath = path.join(attachmentDirectory, fileName)
      await writeFileAtomically(destinationPath, bytes)
      return destinationPath
    },
    openExternalPath: async (inputPath) => {
      const normalizedPath = normalizeRequiredPath(inputPath, 'Path')
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

async function readGpxFile(inputPath) {
  const filePath = normalizeRequiredPath(inputPath, 'GPX file')
  const stat = await fs.stat(filePath).catch(() => null)
  if (stat === null || !stat.isFile()) {
    throw new Error(`GPX file was not found: ${filePath}`)
  }
  if (!isGpxPath(filePath)) {
    throw new Error(`Only .gpx files can be imported: ${filePath}`)
  }

  return {
    sourcePath: filePath,
    fileName: path.basename(filePath),
    contents: await fs.readFile(filePath, 'utf8'),
  }
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

async function writeFileAtomically(destinationPath, bytes) {
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temporaryPath, bytes)
  await fs.rename(temporaryPath, destinationPath)
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  createElectronFileSystem,
}
