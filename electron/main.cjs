const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const { createElectronSettingsStore } = require('./settings-store.cjs')
const { createElectronRuntimeFiles } = require('./runtime-files.cjs')
const { createElectronMissionStore } = require('./mission-store.cjs')
const { createElectronFileSystem } = require('./file-system.cjs')

const TRACCAR_REQUEST_CHANNEL = 'sartracker:traccar-http-request'
const LOAD_SETTINGS_CHANNEL = 'sartracker:load-app-settings'
const SAVE_SETTINGS_CHANNEL = 'sartracker:save-app-settings'
const TEST_TRACKING_CONNECTION_CHANNEL = 'sartracker:test-tracking-connection'
const LOAD_RUNTIME_BOOTSTRAP_CHANNEL = 'sartracker:load-runtime-bootstrap-settings'
const READ_TRACKING_CACHE_CHANNEL = 'sartracker:read-tracking-cache'
const WRITE_TRACKING_CACHE_CHANNEL = 'sartracker:write-tracking-cache'
const EXPORT_DIAGNOSTICS_REPORT_CHANNEL = 'sartracker:export-diagnostics-report'
const CHOOSE_GPX_FILE_PATHS_CHANNEL = 'sartracker:choose-gpx-file-paths'
const CHOOSE_GPX_DIRECTORY_PATH_CHANNEL = 'sartracker:choose-gpx-directory-path'
const READ_GPX_FILES_CHANNEL = 'sartracker:read-gpx-files'
const LIST_GPX_DIRECTORY_FILES_CHANNEL = 'sartracker:list-gpx-directory-files'
const INGEST_MARKER_ATTACHMENT_CHANNEL = 'sartracker:ingest-marker-attachment'
const OPEN_EXTERNAL_PATH_CHANNEL = 'sartracker:open-external-path'
const OPEN_EXTERNAL_URL_CHANNEL = 'sartracker:open-external-url'

const MISSION_STORE_CHANNELS = {
  info: 'sartracker:mission-store:info',
  syncBackup: 'sartracker:mission-store:sync-backup',
  createMissionArchive: 'sartracker:mission-store:create-mission-archive',
  createMission: 'sartracker:mission-store:create-mission',
  upsertDevice: 'sartracker:mission-store:upsert-device',
  getDevice: 'sartracker:mission-store:get-device',
  listDevices: 'sartracker:mission-store:list-devices',
  addPosition: 'sartracker:mission-store:add-position',
  listPositions: 'sartracker:mission-store:list-positions',
  latestPositions: 'sartracker:mission-store:latest-positions',
  listMissionEvents: 'sartracker:mission-store:list-mission-events',
  upsertMarker: 'sartracker:mission-store:upsert-marker',
  getMarker: 'sartracker:mission-store:get-marker',
  listMarkers: 'sartracker:mission-store:list-markers',
  deleteMarker: 'sartracker:mission-store:delete-marker',
  upsertDrawing: 'sartracker:mission-store:upsert-drawing',
  getDrawing: 'sartracker:mission-store:get-drawing',
  listDrawings: 'sartracker:mission-store:list-drawings',
  deleteDrawing: 'sartracker:mission-store:delete-drawing',
  upsertHelicopter: 'sartracker:mission-store:upsert-helicopter',
  listHelicopters: 'sartracker:mission-store:list-helicopters',
  deleteHelicopter: 'sartracker:mission-store:delete-helicopter',
  upsertGpxImport: 'sartracker:mission-store:upsert-gpx-import',
  listGpxImports: 'sartracker:mission-store:list-gpx-imports',
  deleteGpxImport: 'sartracker:mission-store:delete-gpx-import',
  getMission: 'sartracker:mission-store:get-mission',
  listMissions: 'sartracker:mission-store:list-missions',
  getActiveMission: 'sartracker:mission-store:get-active-mission',
  getRecoverableMission: 'sartracker:mission-store:get-recoverable-mission',
  pauseMission: 'sartracker:mission-store:pause-mission',
  resumeMission: 'sartracker:mission-store:resume-mission',
  finishMission: 'sartracker:mission-store:finish-mission',
  finalizeMission: 'sartracker:mission-store:finalize-mission',
  unlockFinalizedMission: 'sartracker:mission-store:unlock-finalized-mission',
}

const LAYER_CATALOG_STORE_CHANNELS = {
  listMetadata: 'sartracker:layer-catalog-store:list-metadata',
  upsertMetadata: 'sartracker:layer-catalog-store:upsert-metadata',
  clearMetadata: 'sartracker:layer-catalog-store:clear-metadata',
}

/**
 * Creates the main SAR Tracker Electron validation window.
 */
async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#050505',
    title: 'SAR Tracker Electron Validation',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl !== undefined && rendererUrl.trim() !== '') {
    await window.loadURL(withOptionalValidationQuery(rendererUrl))
    return
  }

  const indexUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html'))
  addValidationQueryIfRequested(indexUrl)
  await window.loadURL(indexUrl.toString())
}

/**
 * Keeps the old S8a validation harness opt-in without making it the normal
 * runtime path for the full Electron app.
 */
function withOptionalValidationQuery(rawUrl) {
  const url = new URL(rawUrl)
  addValidationQueryIfRequested(url)
  return url.toString()
}

function addValidationQueryIfRequested(url) {
  if (process.env.SARTRACKER_ELECTRON_VALIDATION_HARNESS === '1') {
    url.searchParams.set('missionHarness', '1')
  }
}

/**
 * Handles Traccar HTTP requests from the renderer without exposing Node.
 */
async function handleTraccarHttpRequest(event, input) {
  validateIpcSender(event)
  const request = normalizeTraccarRequest(input)
  const controller = new AbortController()
  const timeout =
    request.timeoutMs === null
      ? undefined
      : setTimeout(() => controller.abort(), request.timeoutMs)

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })

    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    }
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
  }
}

/**
 * Registers the narrow Electron IPC surface used by the renderer.
 */
function registerIpcHandlers(settingsStore, runtimeFiles, missionStore, fileSystem) {
  ipcMain.handle(TRACCAR_REQUEST_CHANNEL, handleTraccarHttpRequest)
  ipcMain.handle(LOAD_SETTINGS_CHANNEL, (event) => {
    validateIpcSender(event)
    return settingsStore.loadAppSettings()
  })
  ipcMain.handle(SAVE_SETTINGS_CHANNEL, (event, input) => {
    validateIpcSender(event)
    return settingsStore.saveAppSettings(input)
  })
  ipcMain.handle(TEST_TRACKING_CONNECTION_CHANNEL, (event, input) => {
    validateIpcSender(event)
    return settingsStore.testTrackingConnection(input)
  })
  ipcMain.handle(LOAD_RUNTIME_BOOTSTRAP_CHANNEL, (event, forceConnect) => {
    validateIpcSender(event)
    return settingsStore.loadRuntimeBootstrapSettings(Boolean(forceConnect))
  })
  ipcMain.handle(READ_TRACKING_CACHE_CHANNEL, (event) => {
    validateIpcSender(event)
    return runtimeFiles.readTrackingCache()
  })
  ipcMain.handle(WRITE_TRACKING_CACHE_CHANNEL, (event, contents) => {
    validateIpcSender(event)
    if (typeof contents !== 'string') {
      throw new Error('Tracking cache contents must be a string.')
    }
    return runtimeFiles.writeTrackingCache(contents)
  })
  ipcMain.handle(EXPORT_DIAGNOSTICS_REPORT_CHANNEL, (event, input) => {
    validateIpcSender(event)
    if (typeof input !== 'object' || input === null) {
      throw new Error('Diagnostics export payload is invalid.')
    }
    return runtimeFiles.exportDiagnosticsReport(input)
  })
  ipcMain.handle(CHOOSE_GPX_FILE_PATHS_CHANNEL, (event) => {
    validateIpcSender(event)
    return fileSystem.chooseGpxFilePaths()
  })
  ipcMain.handle(CHOOSE_GPX_DIRECTORY_PATH_CHANNEL, (event) => {
    validateIpcSender(event)
    return fileSystem.chooseGpxDirectoryPath()
  })
  ipcMain.handle(READ_GPX_FILES_CHANNEL, (event, paths) => {
    validateIpcSender(event)
    if (!Array.isArray(paths) || paths.some((filePath) => typeof filePath !== 'string')) {
      throw new Error('GPX paths payload is invalid.')
    }
    return fileSystem.readGpxFiles(paths)
  })
  ipcMain.handle(LIST_GPX_DIRECTORY_FILES_CHANNEL, (event, directoryPath) => {
    validateIpcSender(event)
    return fileSystem.listGpxDirectoryFiles(directoryPath)
  })
  ipcMain.handle(INGEST_MARKER_ATTACHMENT_CHANNEL, (event, input) => {
    validateIpcSender(event)
    if (typeof input !== 'object' || input === null) {
      throw new Error('Attachment ingest payload is invalid.')
    }
    return fileSystem.ingestMarkerAttachment(input, missionStore)
  })
  ipcMain.handle(OPEN_EXTERNAL_PATH_CHANNEL, (event, inputPath) => {
    validateIpcSender(event)
    return fileSystem.openExternalPath(inputPath)
  })
  ipcMain.handle(OPEN_EXTERNAL_URL_CHANNEL, (event, inputUrl) => {
    validateIpcSender(event)
    const normalized = (inputUrl ?? '').trim()
    if (normalized === '') {
      throw new Error('URL is required.')
    }
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      throw new Error('URL scheme must be http:// or https://')
    }
    return shell.openExternal(normalized)
  })
  registerMissionStoreHandlers(missionStore)
  registerLayerCatalogStoreHandlers(missionStore)
}

/**
 * Registers named mission-store methods without exposing raw IPC to the renderer.
 */
function registerMissionStoreHandlers(missionStore) {
  for (const [methodName, channel] of Object.entries(MISSION_STORE_CHANNELS)) {
    ipcMain.handle(channel, (event, ...args) => {
      validateIpcSender(event)
      return missionStore[methodName](...args)
    })
  }
}

/**
 * Registers layer-catalog metadata persistence on the same SQLite store.
 */
function registerLayerCatalogStoreHandlers(missionStore) {
  const methodMap = {
    listMetadata: missionStore.listLayerCatalogMetadata,
    upsertMetadata: missionStore.upsertLayerCatalogMetadata,
    clearMetadata: missionStore.clearLayerCatalogMetadata,
  }

  for (const [methodName, channel] of Object.entries(LAYER_CATALOG_STORE_CHANNELS)) {
    ipcMain.handle(channel, (event, ...args) => {
      validateIpcSender(event)
      return methodMap[methodName](...args)
    })
  }
}

/**
 * Blocks unexpected frames from invoking privileged main-process handlers.
 */
function validateIpcSender(event) {
  const senderUrl = event.senderFrame?.url
  if (typeof senderUrl !== 'string' || senderUrl.trim() === '') {
    throw new Error('Blocked Electron IPC request from an unknown renderer.')
  }

  const url = new URL(senderUrl)
  if (url.protocol === 'file:') {
    return
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl !== undefined && rendererUrl.trim() !== '') {
    const expected = new URL(rendererUrl)
    if (url.origin === expected.origin) {
      return
    }
  }

  throw new Error(`Blocked Electron IPC request from unexpected renderer: ${url.origin}`)
}

/**
 * Validates the narrow preload request shape before any network call.
 */
function normalizeTraccarRequest(input) {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid Traccar request payload.')
  }

  const url = new URL(readString(input, 'url'))
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Traccar request URL must use http or https.')
  }

  return {
    url: url.toString(),
    method: readString(input, 'method').toUpperCase(),
    headers: readStringRecord(input.headers),
    body:
      input.body === null || input.body === undefined
        ? null
        : readString(input, 'body'),
    timeoutMs: normalizeTimeout(input.timeoutMs),
  }
}

function readString(input, key) {
  const value = input[key]
  if (typeof value !== 'string') {
    throw new Error(`Traccar request ${key} must be a string.`)
  }
  return value
}

function readStringRecord(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {}
  }

  const output = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      output[key] = value
    }
  }
  return output
}

function normalizeTimeout(value) {
  if (value === null || value === undefined) {
    return null
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Traccar request timeout must be a positive number.')
  }

  return value
}

app.whenReady().then(async () => {
  const settingsStore = createElectronSettingsStore({
    userDataPath: app.getPath('userData'),
    safeStorage,
  })
  const runtimeFiles = createElectronRuntimeFiles({
    userDataPath: app.getPath('userData'),
    versions: process.versions,
    platform: process.platform,
    safeStorageBackend: () =>
      typeof safeStorage.getSelectedStorageBackend === 'function'
        ? safeStorage.getSelectedStorageBackend()
        : 'unavailable',
    loadSettings: settingsStore.loadAppSettings,
  })
  const missionStore = createElectronMissionStore({
    userDataPath: app.getPath('userData'),
    readAdminRoster: async () => {
      const settings = await settingsStore.loadAppSettings()
      return settings.missionDefaults.adminRoster
    },
  })
  const fileSystem = createElectronFileSystem({
    userDataPath: app.getPath('userData'),
    dialog,
    shell,
    getBrowserWindow: () => BrowserWindow.getFocusedWindow(),
  })
  registerIpcHandlers(settingsStore, runtimeFiles, missionStore, fileSystem)
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow()
  }
})
