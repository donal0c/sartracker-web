const { contextBridge, ipcRenderer } = require('electron')

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

contextBridge.exposeInMainWorld('sartrackerElectron', {
  loadAppSettings() {
    return ipcRenderer.invoke(LOAD_SETTINGS_CHANNEL)
  },
  saveAppSettings(input) {
    return ipcRenderer.invoke(SAVE_SETTINGS_CHANNEL, input)
  },
  testTrackingConnection(input) {
    return ipcRenderer.invoke(TEST_TRACKING_CONNECTION_CHANNEL, input)
  },
  loadRuntimeBootstrapSettings(forceConnect) {
    return ipcRenderer.invoke(LOAD_RUNTIME_BOOTSTRAP_CHANNEL, forceConnect)
  },
  readTrackingCache() {
    return ipcRenderer.invoke(READ_TRACKING_CACHE_CHANNEL)
  },
  writeTrackingCache(contents) {
    return ipcRenderer.invoke(WRITE_TRACKING_CACHE_CHANNEL, contents)
  },
  exportDiagnosticsReport(input) {
    return ipcRenderer.invoke(EXPORT_DIAGNOSTICS_REPORT_CHANNEL, input)
  },
  chooseGpxFilePaths() {
    return ipcRenderer.invoke(CHOOSE_GPX_FILE_PATHS_CHANNEL)
  },
  chooseGpxDirectoryPath() {
    return ipcRenderer.invoke(CHOOSE_GPX_DIRECTORY_PATH_CHANNEL)
  },
  readGpxFiles(paths) {
    return ipcRenderer.invoke(READ_GPX_FILES_CHANNEL, paths)
  },
  listGpxDirectoryFiles(directoryPath) {
    return ipcRenderer.invoke(LIST_GPX_DIRECTORY_FILES_CHANNEL, directoryPath)
  },
  ingestMarkerAttachment(input) {
    return ipcRenderer.invoke(INGEST_MARKER_ATTACHMENT_CHANNEL, input)
  },
  openExternalPath(path) {
    return ipcRenderer.invoke(OPEN_EXTERNAL_PATH_CHANNEL, path)
  },
  openExternalUrl(url) {
    return ipcRenderer.invoke(OPEN_EXTERNAL_URL_CHANNEL, url)
  },
  missionStore: Object.fromEntries(
    Object.entries(MISSION_STORE_CHANNELS).map(([methodName, channel]) => [
      methodName,
      (...args) => ipcRenderer.invoke(channel, ...args),
    ]),
  ),
  layerCatalogStore: Object.fromEntries(
    Object.entries(LAYER_CATALOG_STORE_CHANNELS).map(([methodName, channel]) => [
      methodName,
      (...args) => ipcRenderer.invoke(channel, ...args),
    ]),
  ),
  traccarHttpRequest(input) {
    return ipcRenderer.invoke(TRACCAR_REQUEST_CHANNEL, input)
  },
})
