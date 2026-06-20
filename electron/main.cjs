const {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
} = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const { createElectronSettingsStore } = require('./settings-store.cjs')
const { createElectronRuntimeFiles } = require('./runtime-files.cjs')
const { createElectronMissionStore } = require('./mission-store.cjs')
const { createElectronFileSystem } = require('./file-system.cjs')
const { createElectronOfficialMapProxy } = require('./official-map-proxy.cjs')
const { createRuntimeLog } = require('./runtime-log.cjs')
const { createCrashLog, isRendererFaultReason } = require('./crash-log.cjs')

const TRACCAR_REQUEST_CHANNEL = 'sartracker:traccar-http-request'
const LOAD_SETTINGS_CHANNEL = 'sartracker:load-app-settings'
const SAVE_SETTINGS_CHANNEL = 'sartracker:save-app-settings'
const TEST_TRACKING_CONNECTION_CHANNEL = 'sartracker:test-tracking-connection'
const LOAD_RUNTIME_BOOTSTRAP_CHANNEL = 'sartracker:load-runtime-bootstrap-settings'
const READ_TRACKING_CACHE_CHANNEL = 'sartracker:read-tracking-cache'
const WRITE_TRACKING_CACHE_CHANNEL = 'sartracker:write-tracking-cache'
const EXPORT_DIAGNOSTICS_REPORT_CHANNEL = 'sartracker:export-diagnostics-report'
const EXPORT_SUPPORT_BUNDLE_CHANNEL = 'sartracker:export-support-bundle'
const READ_CRASH_RECOVERY_STATE_CHANNEL = 'sartracker:read-crash-recovery-state'
const CHOOSE_GPX_FILE_PATHS_CHANNEL = 'sartracker:choose-gpx-file-paths'
const CHOOSE_GPX_DIRECTORY_PATH_CHANNEL = 'sartracker:choose-gpx-directory-path'
const CHOOSE_OFFICIAL_MAP_SOURCE_FILE_PATH_CHANNEL = 'sartracker:choose-official-map-source-file-path'
const CHOOSE_OFFICIAL_MAP_PACKAGE_PATH_CHANNEL = 'sartracker:choose-official-map-package-path'
const IMPORT_OFFICIAL_MAP_PACKAGE_CHANNEL = 'sartracker:import-official-map-package'
const READ_GPX_FILES_CHANNEL = 'sartracker:read-gpx-files'
const LIST_GPX_DIRECTORY_FILES_CHANNEL = 'sartracker:list-gpx-directory-files'
const INGEST_MARKER_ATTACHMENT_CHANNEL = 'sartracker:ingest-marker-attachment'
const OPEN_EXTERNAL_PATH_CHANNEL = 'sartracker:open-external-path'
const OPEN_EXTERNAL_URL_CHANNEL = 'sartracker:open-external-url'
const FETCH_OFFICIAL_MAP_TILE_CHANNEL = 'sartracker:fetch-official-map-tile'

const MISSION_STORE_CHANNELS = {
  info: 'sartracker:mission-store:info',
  syncBackup: 'sartracker:mission-store:sync-backup',
  createMissionArchive: 'sartracker:mission-store:create-mission-archive',
  createMission: 'sartracker:mission-store:create-mission',
  upsertDevice: 'sartracker:mission-store:upsert-device',
  getDevice: 'sartracker:mission-store:get-device',
  listDevices: 'sartracker:mission-store:list-devices',
  addPosition: 'sartracker:mission-store:add-position',
  addPositionsBulk: 'sartracker:mission-store:add-positions-bulk',
  listPositions: 'sartracker:mission-store:list-positions',
  countPositions: 'sartracker:mission-store:count-positions',
  latestPositions: 'sartracker:mission-store:latest-positions',
  listMissionEvents: 'sartracker:mission-store:list-mission-events',
  listAuditEvents: 'sartracker:mission-store:list-audit-events',
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

const validationUserDataPath = process.env.SARTRACKER_ELECTRON_USER_DATA_PATH
if (validationUserDataPath !== undefined && validationUserDataPath.trim() !== '') {
  app.setPath('userData', path.resolve(validationUserDataPath))
}

configureLinuxSecretStorage()

const ownsSingleInstanceLock = app.requestSingleInstanceLock()
if (!ownsSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusExistingWindow()
  })
}

/**
 * Selects the secure freedesktop Secret Service backend before safeStorage is
 * initialized on Linux desktops.
 */
function configureLinuxSecretStorage() {
  if (process.platform !== 'linux') {
    return
  }

  if (
    typeof app.commandLine.hasSwitch === 'function' &&
    app.commandLine.hasSwitch('password-store')
  ) {
    return
  }

  app.commandLine.appendSwitch('password-store', 'gnome-libsecret')
}

/**
 * Creates the main SAR Tracker Electron validation window.
 */
async function createWindow(crashLog, runtimeLog) {
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

  if (crashLog !== undefined) {
    // A renderer crash leaves the operator with a blank or frozen window; record
    // it so the next launch can surface a recovery notice with the exit reason.
    window.webContents.on('render-process-gone', (_event, details) => {
      // `clean-exit` fires on normal window teardown; only record genuine faults so a
      // normal quit never writes a spurious crash or trips the recovery notice.
      if (!isRendererFaultReason(details?.reason)) {
        return
      }
      const summary = `renderer ${details?.reason ?? 'gone'}${
        typeof details?.exitCode === 'number' ? ` (exit ${details.exitCode})` : ''
      }`
      void crashLog.record({ kind: 'render-process-gone', summary })
      void runtimeLog?.append({
        level: 'error',
        event: 'render_process_gone',
        fields: { reason: details?.reason ?? 'unknown', exitCode: details?.exitCode ?? null },
      })
    })
  }

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
 * Brings the existing operational window forward when the user launches the app again.
 */
function focusExistingWindow() {
  const [existingWindow] = BrowserWindow.getAllWindows()
  if (existingWindow === undefined) {
    return
  }

  if (typeof existingWindow.isMinimized === 'function' && existingWindow.isMinimized()) {
    existingWindow.restore()
  }
  existingWindow.focus()
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
 * Installs crash and unhandled-error capture for the main process.
 *
 * Native minidumps are written by Electron's crashReporter to `userData/crashes/`;
 * JavaScript-level faults (uncaught exceptions, unhandled rejections) are recorded as
 * structured entries so an operator can export them without crash-file archaeology.
 */
function installCrashCapture(crashLog, runtimeLog) {
  try {
    crashReporter.start({
      productName: 'SAR Tracker',
      companyName: 'Kerry Mountain Rescue',
      submitURL: '',
      uploadToServer: false,
      compress: true,
    })
  } catch {
    // crashReporter is unavailable in some headless/test contexts; structured
    // JS-level capture below still works regardless.
  }

  process.on('uncaughtException', (error) => {
    void crashLog.record({
      kind: 'uncaughtException',
      summary: error?.message ? `${error.name}: ${error.message}` : 'Uncaught exception',
      detail: typeof error?.stack === 'string' ? error.stack : undefined,
    })
    void runtimeLog.append({
      level: 'error',
      event: 'uncaught_exception',
      fields: { name: error?.name ?? 'Error' },
    })
  })

  process.on('unhandledRejection', (reason) => {
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : `Unhandled rejection: ${String(reason)}`
    void crashLog.record({
      kind: 'unhandledRejection',
      summary: message,
      detail: reason instanceof Error && typeof reason.stack === 'string' ? reason.stack : undefined,
    })
    void runtimeLog.append({ level: 'error', event: 'unhandled_rejection' })
  })
}

/**
 * Blocks renderer HTTP/S egress for packaged official-map offline validation.
 */
function installValidationNetworkBlock() {
  if (process.env.SARTRACKER_ELECTRON_BLOCK_NETWORK !== '1') {
    return
  }

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => {
      callback({ cancel: true })
    },
  )
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
function registerIpcHandlers(
  settingsStore,
  runtimeFiles,
  missionStore,
  fileSystem,
  officialMapProxy,
  crashLog,
) {
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
  ipcMain.handle(EXPORT_SUPPORT_BUNDLE_CHANNEL, (event, input) => {
    validateIpcSender(event)
    if (typeof input !== 'object' || input === null) {
      throw new Error('Support bundle export payload is invalid.')
    }
    return runtimeFiles.exportSupportBundle(input)
  })
  ipcMain.handle(READ_CRASH_RECOVERY_STATE_CHANNEL, async (event) => {
    validateIpcSender(event)
    const [uncleanShutdown, recentCrashes] = await Promise.all([
      crashLog.hadUncleanShutdown(),
      crashLog.readRecent(1),
    ])
    return {
      uncleanShutdown,
      lastCrash: recentCrashes[recentCrashes.length - 1] ?? null,
    }
  })
  ipcMain.handle(CHOOSE_GPX_FILE_PATHS_CHANNEL, (event) => {
    validateIpcSender(event)
    return fileSystem.chooseGpxFilePaths()
  })
  ipcMain.handle(CHOOSE_GPX_DIRECTORY_PATH_CHANNEL, (event) => {
    validateIpcSender(event)
    return fileSystem.chooseGpxDirectoryPath()
  })
  ipcMain.handle(CHOOSE_OFFICIAL_MAP_SOURCE_FILE_PATH_CHANNEL, (event) => {
    validateIpcSender(event)
    return fileSystem.chooseOfficialMapSourceFilePath()
  })
  ipcMain.handle(CHOOSE_OFFICIAL_MAP_PACKAGE_PATH_CHANNEL, (event) => {
    validateIpcSender(event)
    return fileSystem.chooseOfficialMapPackagePath()
  })
  ipcMain.handle(IMPORT_OFFICIAL_MAP_PACKAGE_CHANNEL, (event, input) => {
    validateIpcSender(event)
    if (typeof input !== 'object' || input === null) {
      throw new Error('Official map package import payload is invalid.')
    }
    return fileSystem.importOfficialMapPackage(input)
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
  ipcMain.handle(FETCH_OFFICIAL_MAP_TILE_CHANNEL, (event, inputUrl) => {
    validateIpcSender(event)
    if (typeof inputUrl !== 'string') {
      throw new Error('Official map tile URL must be a string.')
    }
    return officialMapProxy.fetchOfficialMapTile(inputUrl)
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

if (ownsSingleInstanceLock) {
  app.whenReady().then(startElectronApp)
}

/**
 * Starts the SAR Tracker runtime once this process owns the single-instance lock.
 */
async function startElectronApp() {
  installValidationNetworkBlock()
  const userDataPath = app.getPath('userData')
  const runtimeLog = createRuntimeLog({ userDataPath })
  const crashLog = createCrashLog({ userDataPath })
  installCrashCapture(crashLog, runtimeLog)
  void runtimeLog.append({
    level: 'info',
    event: 'app_start',
    fields: {
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
    },
  })
  const settingsStore = createElectronSettingsStore({
    userDataPath,
    safeStorage,
  })
  const runtimeFiles = createElectronRuntimeFiles({
    userDataPath,
    versions: process.versions,
    platform: process.platform,
    safeStorageBackend: () =>
      typeof safeStorage.getSelectedStorageBackend === 'function'
        ? safeStorage.getSelectedStorageBackend()
        : 'unavailable',
    loadSettings: settingsStore.loadAppSettings,
    readRecentCrashes: () => crashLog.readRecent(10),
    readRecentLog: () => runtimeLog.readRecent(1000),
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
  const officialMapProxy = createElectronOfficialMapProxy({
    fetch,
    loadSettings: settingsStore.loadAppSettings,
  })
  registerIpcHandlers(
    settingsStore,
    runtimeFiles,
    missionStore,
    fileSystem,
    officialMapProxy,
    crashLog,
  )
  await createWindow(crashLog, runtimeLog)

  app.on('before-quit', () => {
    // Record an intentional shutdown so the next launch does not show a false
    // crash-recovery notice. Best-effort; never block quit on it.
    void crashLog.markCleanExit()
    officialMapProxy.close?.()
  })
}

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
