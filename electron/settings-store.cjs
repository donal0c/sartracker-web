const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')

const Database = require('better-sqlite3')

const SETTINGS_FILE_NAME = 'settings.json'
// Legacy keyring-encrypted secret file (beta.5 and earlier). Read-only now:
// kept for one-time migration into the app-owned local credential file, never
// written or deleted by this store (DON-177 migration decision (a)).
const LEGACY_SECRETS_FILE_NAME = 'secrets.json'
// App-owned local credential file (DON-177). Plaintext on a trusted team
// machine, written with best-effort 0600 permissions. Presence of an authMode
// entry is authoritative: it suppresses legacy migration so clearing a secret
// cannot be resurrected from an old secrets.json on the next boot.
const CREDENTIALS_FILE_NAME = 'credentials.json'
const CREDENTIALS_FILE_VERSION = 1
const CREDENTIAL_FILE_MODE = 0o600
const UNDECRYPTABLE_SECRET_MESSAGE =
  'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'
const PROVIDER_URL_CREDENTIALS_ERROR =
  'Provider URL must not include embedded credentials. Enter credentials in the authentication fields.'
const DEFAULT_INTERVAL_SECONDS = 30
const MIN_INTERVAL_SECONDS = 5
const MAX_INTERVAL_SECONDS = 3600

const DEFAULT_APP_SETTINGS = Object.freeze({
  missionDefaults: Object.freeze({
    autoRefreshEnabled: true,
    autoRefreshIntervalSeconds: 30,
    autoSaveEnabled: true,
    autoSaveIntervalSeconds: 30,
    primaryMissionRoot: '',
    backupMissionRoot: '',
    coordinatorRoster: Object.freeze([]),
    adminRoster: Object.freeze([]),
  }),
  dataSource: Object.freeze({
    providerType: 'none',
    baseUrl: '',
    authMode: 'basic',
    email: '',
    autoConnect: true,
    trackingCacheEnabled: true,
    replayEnabled: false,
    replayStart: '',
    replayDurationHours: 4,
    secretPresent: false,
  }),
  officialMaps: Object.freeze({
    sourceType: 'none',
    sourcePath: '',
    status: 'not_configured',
    username: '',
    availableSources: Object.freeze([]),
    serviceCount: 0,
    message: 'Official maps are not configured.',
    packages: Object.freeze([]),
  }),
  weather: Object.freeze({
    links: Object.freeze([]),
  }),
  advanced: Object.freeze({
    repairLayerStructureAvailable: false,
  }),
})

/**
 * Creates the Electron main-process settings store.
 */
function createElectronSettingsStore(options) {
  const userDataPath = options.userDataPath
  const settingsPath = path.join(userDataPath, SETTINGS_FILE_NAME)
  const legacySecretsPath = path.join(userDataPath, LEGACY_SECRETS_FILE_NAME)
  const credentialsPath = path.join(userDataPath, CREDENTIALS_FILE_NAME)
  const safeStorage = options.safeStorage
  const fetchFn = options.fetchFn ?? fetch
  const platform = options.platform ?? process.platform
  const now = options.now ?? (() => new Date())

  return {
    loadAppSettings,
    saveAppSettings,
    loadRuntimeBootstrapSettings,
    testTrackingConnection,
  }

  async function loadAppSettings() {
    const persisted = await readSettings(settingsPath)
    return toView(persisted, await hasSecret(persisted.dataSource.authMode))
  }

  async function saveAppSettings(input) {
    const existingSecretPresent = await hasSecret(input.dataSource.authMode)
    validateSettingsDraft(input, existingSecretPresent)
    const previous = await readSettings(settingsPath)

    const next = {
      missionDefaults: normalizeMissionDefaults(input.missionDefaults),
      dataSource: normalizeDataSource(input.dataSource),
      officialMaps: await normalizeOfficialMaps(input.officialMaps, now),
      weather: normalizeWeather(input.weather),
    }

    await writeJsonAtomically(settingsPath, next)
    await updateSecrets(input.dataSource)
    await removeDeletedAppOwnedOfficialMapPackages(previous.officialMaps.packages, next.officialMaps.packages, userDataPath)

    return toView(next, await hasSecret(next.dataSource.authMode))
  }

  async function loadRuntimeBootstrapSettings(forceConnect = false) {
    const persisted = await readSettings(settingsPath)
    const secretResult = await readSecret(persisted.dataSource.authMode)
    const disabledReason = resolveTrackingDisabledReason({
      persisted,
      secretResult,
      forceConnect,
    })
    const shouldConnect =
      disabledReason === undefined &&
      persisted.dataSource.providerType === 'traccar_http' &&
      persisted.missionDefaults.autoRefreshEnabled &&
      (forceConnect || persisted.dataSource.autoConnect) &&
      secretResult.value !== null

    return {
      autosaveEnabled: persisted.missionDefaults.autoSaveEnabled,
      autosaveIntervalMs: persisted.missionDefaults.autoSaveIntervalSeconds * 1000,
      trackingPollIntervalMs: persisted.missionDefaults.autoRefreshIntervalSeconds * 1000,
      trackingCacheEnabled: persisted.dataSource.trackingCacheEnabled,
      trackingConfig: shouldConnect
        ? createTrackingConfig(persisted.dataSource, secretResult.value)
        : null,
      ...(disabledReason === undefined ? {} : { trackingDisabledReason: disabledReason }),
    }
  }

  async function testTrackingConnection(input) {
    const existingSecretPresent = await hasSecret(input.dataSource.authMode)
    validateSettingsDraft(input, existingSecretPresent)

    if (input.dataSource.providerType !== 'traccar_http') {
      return { ok: false, message: 'Select the Traccar HTTP provider first.' }
    }

    const secret = await resolveDraftSecret(input.dataSource)
    if (secret === null) {
      return { ok: false, message: 'A provider secret is required before testing the connection.' }
    }

    return testTraccarConnection(input.dataSource, secret)
  }

  async function resolveDraftSecret(dataSource) {
    if (dataSource.clearSecret) {
      return null
    }

    const nextSecret = readOptionalString(dataSource.secretInput).trim()
    if (nextSecret !== '') {
      return nextSecret
    }

    const result = await readSecret(dataSource.authMode)
    if (result.unsafeReason !== undefined) {
      throw new Error(result.unsafeReason)
    }
    return result.value
  }

  async function updateSecrets(dataSource) {
    const secretInput = readOptionalString(dataSource.secretInput).trim()
    if (dataSource.clearSecret) {
      // Authoritative clear: persist an explicit "no secret" entry so a legacy
      // secrets.json cannot resurrect the credential on the next boot.
      await writeCredential(dataSource.authMode, null)
      return
    }

    if (secretInput === '') {
      return
    }

    await writeCredential(dataSource.authMode, secretInput)
  }

  async function hasSecret(authMode) {
    const credentials = await readCredentials(credentialsPath)
    const entry = credentials.traccar?.[authMode]
    if (entry !== undefined) {
      return typeof entry.secret === 'string' && entry.secret !== ''
    }
    // No app-owned entry yet: fall back to the legacy file's presence so the
    // Settings "stored secret present" view is accurate before first migration.
    const legacy = await readLegacySecrets()
    return legacy[authMode]?.encrypted !== undefined
  }

  async function readSecret(authMode) {
    const credentials = await readCredentials(credentialsPath)
    const entry = credentials.traccar?.[authMode]
    if (entry !== undefined) {
      // App-owned entry is authoritative. An explicit null means the operator
      // cleared the secret; do not migrate from the legacy file.
      const secret = typeof entry.secret === 'string' && entry.secret !== '' ? entry.secret : null
      return { value: secret }
    }

    return migrateLegacySecret(authMode)
  }

  /**
   * One-time migration of a beta.5-style keyring-encrypted secret into the
   * app-owned local credential file. The legacy secrets.json is never modified
   * or deleted (DON-177 decision (a)).
   */
  async function migrateLegacySecret(authMode) {
    const legacy = await readLegacySecrets()
    const encrypted = legacy[authMode]?.encrypted
    if (encrypted === undefined) {
      return { value: null }
    }

    if (!safeStorage.isEncryptionAvailable()) {
      return { value: null, unsafeReason: UNDECRYPTABLE_SECRET_MESSAGE }
    }

    let decrypted
    try {
      decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return { value: null, unsafeReason: UNDECRYPTABLE_SECRET_MESSAGE }
    }

    await writeCredential(authMode, decrypted)
    return { value: decrypted }
  }

  async function readLegacySecrets() {
    return readObject(await readJson(legacySecretsPath, {}))
  }

  /**
   * Writes the active authMode credential to the app-owned local file. A null
   * secret persists an authoritative "cleared" entry. Other authMode entries
   * are dropped so only one provider credential is ever stored at a time.
   */
  async function writeCredential(authMode, secret) {
    const next = {
      version: CREDENTIALS_FILE_VERSION,
      traccar: {
        [authMode]: { secret: typeof secret === 'string' ? secret : null },
      },
    }
    await writeJsonAtomically(credentialsPath, next, { mode: CREDENTIAL_FILE_MODE })
  }

  async function testTraccarConnection(dataSource, secret) {
    const baseUrl = normalizeBaseUrl(dataSource.baseUrl)

    if (dataSource.authMode === 'basic') {
      const sessionResponse = await fetchFn(`${baseUrl}/api/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: dataSource.email.trim(),
          password: secret,
        }).toString(),
      })

      if (!sessionResponse.ok) {
        return { ok: false, message: `Authentication failed: ${sessionResponse.status}` }
      }

      const devicesResponse = await fetchFn(`${baseUrl}/api/devices`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${dataSource.email.trim()}:${secret}`).toString('base64')}`,
        },
      })

      return {
        ok: devicesResponse.ok,
        message: devicesResponse.ok
          ? 'Connection successful.'
          : `Device fetch failed: ${devicesResponse.status}`,
      }
    }

    const devicesResponse = await fetchFn(`${baseUrl}/api/devices`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${secret}`,
      },
    })

    return {
      ok: devicesResponse.ok,
      message: devicesResponse.ok
        ? 'Connection successful.'
        : `Device fetch failed: ${devicesResponse.status}`,
    }
  }
}

async function readSettings(settingsPath) {
  const parsed = await readJson(settingsPath, {})
  return {
    missionDefaults: normalizeMissionDefaults({
      ...DEFAULT_APP_SETTINGS.missionDefaults,
      ...readObject(parsed.missionDefaults),
      coordinatorRoster: readStringArray(parsed.missionDefaults?.coordinatorRoster),
      adminRoster: readStringArray(parsed.missionDefaults?.adminRoster),
    }),
    dataSource: normalizeDataSource({
      ...DEFAULT_APP_SETTINGS.dataSource,
      ...readObject(parsed.dataSource),
      secretPresent: false,
    }),
    officialMaps: normalizePersistedOfficialMaps(parsed.officialMaps),
    weather: {
      links: normalizeWeatherLinks(parsed.weather?.links),
    },
  }
}

/**
 * Reads the app-owned local credential file. A missing or corrupt file must
 * never block mission startup, so any read/parse failure degrades to an empty
 * credential set (tracking is then disabled with a clear warning).
 */
async function readCredentials(credentialsPath) {
  let raw
  try {
    raw = await fs.readFile(credentialsPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { version: CREDENTIALS_FILE_VERSION, traccar: {} }
    }
    throw error
  }

  try {
    const parsed = readObject(JSON.parse(raw))
    return { ...parsed, traccar: readObject(parsed.traccar) }
  } catch {
    return { version: CREDENTIALS_FILE_VERSION, traccar: {} }
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback
    }
    throw error
  }
}

async function writeJsonAtomically(filePath, payload, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const writeOptions = { encoding: 'utf8' }
  if (typeof options.mode === 'number') {
    writeOptions.mode = options.mode
  }
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, writeOptions)
  // Atomic rename preserves the temp file's mode; enforce it again in case the
  // temp file pre-existed with a wider umask. Best-effort: a chmod failure must
  // not block saving on platforms/filesystems that do not support POSIX modes.
  if (typeof options.mode === 'number') {
    try {
      await fs.chmod(tempPath, options.mode)
    } catch {
      // ignore — permission hardening is best-effort (see DON-177 scope)
    }
  }
  await fs.rename(tempPath, filePath)
}

function toView(persisted, secretPresent) {
  return {
    missionDefaults: persisted.missionDefaults,
    dataSource: {
      ...persisted.dataSource,
      secretPresent,
    },
    officialMaps: persisted.officialMaps,
    weather: persisted.weather,
    advanced: DEFAULT_APP_SETTINGS.advanced,
  }
}

function validateSettingsDraft(input, existingSecretPresent) {
  if (input.dataSource.providerType === 'traccar_http') {
    if (normalizeBaseUrl(input.dataSource.baseUrl) === '') {
      throw new Error('Enter a Traccar base URL first.')
    }
    if (baseUrlIncludesCredentials(input.dataSource.baseUrl)) {
      throw new Error(PROVIDER_URL_CREDENTIALS_ERROR)
    }

    if (input.dataSource.authMode === 'basic' && input.dataSource.email.trim() === '') {
      throw new Error('Email is required for basic authentication.')
    }

    if (
      !existingSecretPresent &&
      !input.dataSource.clearSecret &&
      readOptionalString(input.dataSource.secretInput).trim() === ''
    ) {
      throw new Error('A provider secret is required before saving Traccar settings.')
    }
  }
}

function normalizeMissionDefaults(input) {
  return {
    autoRefreshEnabled: Boolean(input.autoRefreshEnabled),
    autoRefreshIntervalSeconds: normalizeIntervalSeconds(input.autoRefreshIntervalSeconds),
    autoSaveEnabled: Boolean(input.autoSaveEnabled),
    autoSaveIntervalSeconds: normalizeIntervalSeconds(input.autoSaveIntervalSeconds),
    primaryMissionRoot: readOptionalString(input.primaryMissionRoot).trim(),
    backupMissionRoot: readOptionalString(input.backupMissionRoot).trim(),
    coordinatorRoster: normalizeRoster(input.coordinatorRoster),
    adminRoster: normalizeRoster(input.adminRoster),
  }
}

function normalizeDataSource(input) {
  const replayEnabled = input.providerType === 'traccar_http' && Boolean(input.replayEnabled)
  return {
    providerType: input.providerType === 'traccar_http' ? 'traccar_http' : 'none',
    baseUrl: normalizeBaseUrl(input.baseUrl),
    authMode: input.authMode === 'bearer' ? 'bearer' : 'basic',
    email: readOptionalString(input.email).trim(),
    autoConnect: Boolean(input.autoConnect),
    trackingCacheEnabled: Boolean(input.trackingCacheEnabled),
    replayEnabled,
    replayStart: replayEnabled ? readOptionalString(input.replayStart).trim() : '',
    replayDurationHours: Number(input.replayDurationHours),
  }
}

function normalizeBaseUrl(baseUrl) {
  return readOptionalString(baseUrl).trim().replace(/\/+$/, '')
}

function normalizeIntervalSeconds(input) {
  const numeric = Number(input)
  if (!Number.isFinite(numeric)) {
    return DEFAULT_INTERVAL_SECONDS
  }
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.trunc(numeric)))
}

function baseUrlIncludesCredentials(baseUrl) {
  try {
    const parsed = new URL(normalizeBaseUrl(baseUrl))
    return parsed.username !== '' || parsed.password !== ''
  } catch {
    return false
  }
}

async function normalizeOfficialMaps(input, now) {
  const sourceType = input?.sourceType === 'mapgenie_file' ? 'mapgenie_file' : 'none'
  const sourcePath = readOptionalString(input?.sourcePath).trim()
  const packages = await normalizeOfficialMapPackages(input?.packages, now)

  if (sourceType === 'none') {
    return {
      ...DEFAULT_APP_SETTINGS.officialMaps,
      packages,
    }
  }

  if (sourcePath === '') {
    return {
      ...DEFAULT_APP_SETTINGS.officialMaps,
      sourceType: 'mapgenie_file',
      status: 'missing',
      message: 'Choose the MapGenie source file before enabling official maps.',
      packages,
    }
  }

  try {
    const metadata = parseMapGenieSourceDetails(await fs.readFile(sourcePath, 'utf8'))
    return {
      sourceType: 'mapgenie_file',
      sourcePath,
      ...metadata,
      packages,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ...DEFAULT_APP_SETTINGS.officialMaps,
        sourceType: 'mapgenie_file',
        sourcePath,
        status: 'missing',
        message: 'MapGenie source file was not found.',
        packages,
      }
    }
    return {
      ...DEFAULT_APP_SETTINGS.officialMaps,
      sourceType: 'mapgenie_file',
      sourcePath,
      status: 'invalid',
      message: 'MapGenie source file could not be read.',
      packages,
    }
  }
}

function normalizePersistedOfficialMaps(input) {
  const parsed = readObject(input)
  const sourceType = parsed.sourceType === 'mapgenie_file' ? 'mapgenie_file' : 'none'

  return {
    ...DEFAULT_APP_SETTINGS.officialMaps,
    sourceType,
    sourcePath: readOptionalString(parsed.sourcePath).trim(),
    status:
      sourceType === 'none'
        ? 'not_configured'
        : ['configured', 'missing', 'invalid'].includes(parsed.status)
          ? parsed.status
          : 'not_configured',
    username: readOptionalString(parsed.username).trim(),
    availableSources: readOfficialMapSources(parsed.availableSources),
    serviceCount: Number.isFinite(Number(parsed.serviceCount)) ? Number(parsed.serviceCount) : 0,
    message: readOptionalString(parsed.message).trim() || 'Official map source status unavailable.',
    packages: normalizePersistedOfficialMapPackages(parsed.packages),
  }
}

async function normalizeOfficialMapPackages(input, now) {
  if (!Array.isArray(input)) {
    return []
  }

  const output = []
  const seen = new Set()
  for (const candidate of input) {
    const parsed = readObject(candidate)
    const packagePath = readOptionalString(parsed.packagePath).trim()
    if (packagePath === '') {
      continue
    }
    const mapId = readOfficialMapId(parsed.mapId)
    const dedupeKey = `${mapId}\0${packagePath}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    output.push(await validateOfficialMapPackage({ mapId, packagePath, now }))
  }
  return output
}

function normalizePersistedOfficialMapPackages(input) {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .map((candidate) => {
      const parsed = readObject(candidate)
      const packagePath = readOptionalString(parsed.packagePath).trim()
      if (packagePath === '') {
        return null
      }
      const mapId = readOfficialMapId(parsed.mapId)
      const status = ['ready', 'missing', 'invalid'].includes(parsed.status)
        ? parsed.status
        : 'invalid'
      return {
        id: readOfficialMapPackageId(parsed.id, mapId, packagePath),
        sourceType: 'mbtiles',
        mapId,
        packagePath,
        status,
        bounds: readOfficialMapBounds(parsed.bounds),
        minZoom: readOptionalNumber(parsed.minZoom),
        maxZoom: readOptionalNumber(parsed.maxZoom),
        tileCount: readNonNegativeInteger(parsed.tileCount),
        tileFormat: readOptionalString(parsed.tileFormat).trim(),
        sizeBytes: readNonNegativeInteger(parsed.sizeBytes),
        createdAt: readOptionalString(parsed.createdAt).trim(),
        verifiedAt: readOptionalString(parsed.verifiedAt).trim(),
        message:
          readOptionalString(parsed.message).trim() ||
          packageStatusMessage(mapId, status),
      }
    })
    .filter(Boolean)
}

async function validateOfficialMapPackage(input) {
  const verifiedAt = input.now().toISOString()
  const base = {
    id: createOfficialMapPackageId(input.mapId, input.packagePath),
    sourceType: 'mbtiles',
    mapId: input.mapId,
    packagePath: input.packagePath,
    bounds: null,
    minZoom: null,
    maxZoom: null,
    tileCount: 0,
    tileFormat: '',
    sizeBytes: 0,
    createdAt: '',
    verifiedAt,
  }

  try {
    const stats = await fs.stat(input.packagePath)
    if (!stats.isFile()) {
      return {
        ...base,
        status: 'invalid',
        createdAt: toIsoTimestamp(stats.birthtime),
        message: 'Official map package path is not a file.',
      }
    }

    const metadata = readMbtilesMetadata(input.packagePath)
    return {
      ...base,
      ...metadata,
      status: 'ready',
      sizeBytes: stats.size,
      createdAt: toIsoTimestamp(stats.birthtime),
      message: packageStatusMessage(input.mapId, 'ready'),
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        ...base,
        status: 'missing',
        message: 'Official map package file was not found.',
      }
    }
    return {
      ...base,
      status: 'invalid',
      message: 'Official map package could not be read as MBTiles.',
    }
  }
}

async function removeDeletedAppOwnedOfficialMapPackages(previousPackages, nextPackages, userDataPath) {
  const nextPaths = new Set(
    nextPackages
      .map((mapPackage) => path.resolve(mapPackage.packagePath))
      .filter((packagePath) => isAppOwnedOfficialMapPackagePath(packagePath, userDataPath)),
  )

  for (const mapPackage of previousPackages) {
    const packagePath = path.resolve(mapPackage.packagePath)
    if (!isAppOwnedOfficialMapPackagePath(packagePath, userDataPath) || nextPaths.has(packagePath)) {
      continue
    }
    await fs.rm(packagePath, { force: true })
  }
}

function isAppOwnedOfficialMapPackagePath(packagePath, userDataPath) {
  const libraryDirectory = path.resolve(userDataPath, 'official-map-packages')
  return packagePath === libraryDirectory || packagePath.startsWith(`${libraryDirectory}${path.sep}`)
}

function readMbtilesMetadata(packagePath) {
  const db = new Database(packagePath, { readonly: true, fileMustExist: true })
  try {
    const tableRows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('metadata', 'tiles')")
      .all()
    const tableNames = new Set(tableRows.map((row) => row.name))
    if (!tableNames.has('metadata') || !tableNames.has('tiles')) {
      throw new Error('MBTiles metadata and tiles tables are required.')
    }

    const metadataRows = db.prepare('SELECT name, value FROM metadata').all()
    const metadata = new Map(
      metadataRows.map((row) => [String(row.name).toLowerCase(), String(row.value)]),
    )
    const tileCount = readNonNegativeInteger(db.prepare('SELECT COUNT(*) AS count FROM tiles').get()?.count)
    if (tileCount === 0) {
      throw new Error('MBTiles package has no tiles.')
    }

    const zoomRange = db
      .prepare('SELECT MIN(zoom_level) AS minZoom, MAX(zoom_level) AS maxZoom FROM tiles')
      .get()
    return {
      bounds: readOfficialMapBounds(metadata.get('bounds')),
      minZoom: readZoomValue(metadata.get('minzoom'), zoomRange?.minZoom),
      maxZoom: readZoomValue(metadata.get('maxzoom'), zoomRange?.maxZoom),
      tileCount,
      tileFormat: readOptionalString(metadata.get('format')).trim().toLowerCase(),
    }
  } finally {
    db.close()
  }
}

function readZoomValue(primary, fallback) {
  const value = Number(primary)
  if (Number.isInteger(value) && value >= 0) {
    return value
  }
  return readOptionalNumber(fallback)
}

function readOfficialMapBounds(input) {
  const values = Array.isArray(input)
    ? input
    : readOptionalString(input)
        .split(',')
        .map((value) => value.trim())
  if (values.length !== 4) {
    return null
  }
  const numbers = values.map((value) => Number(value))
  const [west, south, east, north] = numbers
  if (
    numbers.every(Number.isFinite) &&
    west >= -180 &&
    west <= 180 &&
    east >= -180 &&
    east <= 180 &&
    south >= -90 &&
    south <= 90 &&
    north >= -90 &&
    north <= 90 &&
    west < east &&
    south < north
  ) {
    return [west, south, east, north]
  }
  return null
}

function readOfficialMapId(input) {
  const allowed = new Set(OFFICIAL_SOURCE_PATTERNS.map(([id]) => id))
  const value = readOptionalString(input).trim()
  return allowed.has(value) ? value : 'official_discovery_topo'
}

function readOfficialMapPackageId(input, mapId, packagePath) {
  const value = readOptionalString(input).trim()
  if (new RegExp(`^${mapId}-[a-f0-9]{12}$`, 'u').test(value)) {
    return value
  }
  return createOfficialMapPackageId(mapId, packagePath)
}

function createOfficialMapPackageId(mapId, packagePath) {
  const digest = createHash('sha256').update(`${mapId}\0${packagePath}`).digest('hex').slice(0, 12)
  return `${mapId}-${digest}`
}

function packageStatusMessage(mapId, status) {
  if (status === 'ready') {
    return `${officialMapLabel(mapId)} package is ready.`
  }
  if (status === 'missing') {
    return 'Official map package file was not found.'
  }
  return 'Official map package could not be read as MBTiles.'
}

function officialMapLabel(mapId) {
  const labels = {
    official_discovery_topo: 'Official Discovery Topo',
    official_premium_basemap: 'Official Premium Basemap',
    official_aerial_imagery: 'Official Aerial Imagery',
    official_high_resolution_imagery: 'Official High-Resolution Imagery',
  }
  return labels[mapId] ?? 'Official map'
}

function readOptionalNumber(input) {
  const value = Number(input)
  return Number.isFinite(value) ? value : null
}

function readNonNegativeInteger(input) {
  const value = Number(input)
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function toIsoTimestamp(input) {
  return input instanceof Date && Number.isFinite(input.getTime()) ? input.toISOString() : ''
}

function normalizeWeather(input) {
  return {
    links: normalizeWeatherLinks(input?.links),
  }
}

function normalizeWeatherLinks(input) {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .map((link) => ({
      name: readOptionalString(link?.name).trim(),
      url: normalizeWeatherUrl(link?.url),
    }))
    .filter((link) => link.name !== '')
}

function normalizeWeatherUrl(input) {
  const raw = readOptionalString(input).trim()
  if (raw === '') {
    return ''
  }

  try {
    const url = new URL(addWeatherSchemeIfMissing(raw))
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw
  }
}

const OFFICIAL_SOURCE_PATTERNS = [
  ['official_discovery_topo', /\bdiscovery\b/i],
  ['official_premium_basemap', /\bbasemap_premium\b/i],
  ['official_aerial_imagery', /\bortho\b/i],
  ['official_high_resolution_imagery', /\bNational_High_Resolution_Imagery\b/i],
]

function parseMapGenieSourceDetails(contents) {
  const username = /^Username:\s*(\S+)/im.exec(contents)?.[1] ?? ''
  const availableSources = OFFICIAL_SOURCE_PATTERNS
    .filter(([, pattern]) => pattern.test(contents))
    .map(([id]) => id)
  const hasDiscovery = availableSources.includes('official_discovery_topo')

  return {
    status: hasDiscovery ? 'configured' : 'invalid',
    username,
    availableSources,
    serviceCount: availableSources.length,
    message: hasDiscovery
      ? 'Official Discovery Topo source configured.'
      : 'MapGenie source file is missing the Discovery Topo service.',
  }
}

function readOfficialMapSources(input) {
  const allowed = new Set(OFFICIAL_SOURCE_PATTERNS.map(([id]) => id))
  return readStringArray(input).filter((source) => allowed.has(source))
}

function addWeatherSchemeIfMissing(input) {
  if (input.includes(':') || input.startsWith('/')) {
    return input
  }
  return `https://${input}`
}

function normalizeRoster(input) {
  const output = []
  for (const value of readStringArray(input)) {
    const trimmed = value.trim()
    if (trimmed !== '' && !output.includes(trimmed)) {
      output.push(trimmed)
    }
  }
  return output
}

function resolveTrackingDisabledReason(input) {
  if (input.persisted.dataSource.providerType !== 'traccar_http') {
    return 'Tracking is not configured.'
  }

  if (!input.persisted.missionDefaults.autoRefreshEnabled) {
    return 'Tracking auto-refresh is disabled in Settings.'
  }

  if (baseUrlIncludesCredentials(input.persisted.dataSource.baseUrl)) {
    return PROVIDER_URL_CREDENTIALS_ERROR
  }

  if (input.secretResult.unsafeReason !== undefined) {
    return input.secretResult.unsafeReason
  }

  if (input.secretResult.value === null) {
    return 'A provider secret is required before tracking can start.'
  }

  if (!input.forceConnect && !input.persisted.dataSource.autoConnect) {
    return 'Tracking auto-connect is off. Use Save, Connect & Close to start live tracking.'
  }

  return undefined
}

function createTrackingConfig(dataSource, secret) {
  if (dataSource.authMode === 'basic') {
    return {
      baseUrl: dataSource.baseUrl,
      email: dataSource.email,
      password: secret,
    }
  }

  return {
    baseUrl: dataSource.baseUrl,
    token: secret,
  }
}

function readObject(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {}
  }
  return input
}

function readStringArray(input) {
  if (!Array.isArray(input)) {
    return []
  }
  return input.filter((value) => typeof value === 'string')
}

function readOptionalString(input) {
  return typeof input === 'string' ? input : ''
}

module.exports = {
  createElectronSettingsStore,
}
