const fs = require('node:fs/promises')
const path = require('node:path')

const SETTINGS_FILE_NAME = 'settings.json'
const SECRETS_FILE_NAME = 'secrets.json'
const UNSAFE_SECRET_MESSAGE =
  'Electron cannot store Traccar secrets safely on this Linux desktop because safeStorage selected the basic_text backend. Install or unlock a supported desktop secret service, then try again.'

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
  const secretsPath = path.join(userDataPath, SECRETS_FILE_NAME)
  const safeStorage = options.safeStorage
  const fetchFn = options.fetchFn ?? fetch
  const platform = options.platform ?? process.platform

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

    const next = {
      missionDefaults: normalizeMissionDefaults(input.missionDefaults),
      dataSource: normalizeDataSource(input.dataSource),
      weather: normalizeWeather(input.weather),
    }

    await writeJsonAtomically(settingsPath, next)
    await updateSecrets(input.dataSource)
    await removeInactiveSecret(next.dataSource.authMode)

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
      await deleteSecret(dataSource.authMode)
      return
    }

    if (secretInput === '') {
      return
    }

    const status = getSecretStorageStatus()
    if (!status.safe) {
      throw new Error(status.message)
    }

    const encrypted = safeStorage.encryptString(secretInput).toString('base64')
    const secrets = await readSecrets(secretsPath)
    secrets[dataSource.authMode] = { encrypted }
    await writeJsonAtomically(secretsPath, secrets)
  }

  async function hasSecret(authMode) {
    const secrets = await readSecrets(secretsPath)
    return secrets[authMode]?.encrypted !== undefined
  }

  async function readSecret(authMode) {
    const secrets = await readSecrets(secretsPath)
    const encrypted = secrets[authMode]?.encrypted
    if (encrypted === undefined) {
      return { value: null }
    }

    const status = getSecretStorageStatus()
    if (!status.safe) {
      return { value: null, unsafeReason: status.message }
    }

    return {
      value: safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
    }
  }

  async function deleteSecret(authMode) {
    const secrets = await readSecrets(secretsPath)
    delete secrets[authMode]
    await writeJsonAtomically(secretsPath, secrets)
  }

  async function removeInactiveSecret(activeAuthMode) {
    const inactiveAuthMode = activeAuthMode === 'basic' ? 'bearer' : 'basic'
    await deleteSecret(inactiveAuthMode)
  }

  function getSecretStorageStatus() {
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        safe: false,
        message: 'Electron cannot store Traccar secrets because OS encryption is unavailable.',
      }
    }

    const backend =
      typeof safeStorage.getSelectedStorageBackend === 'function'
        ? safeStorage.getSelectedStorageBackend()
        : ''

    if (platform === 'linux' && (backend === 'basic_text' || backend === 'unknown')) {
      return { safe: false, message: UNSAFE_SECRET_MESSAGE }
    }

    return { safe: true }
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
    missionDefaults: {
      ...DEFAULT_APP_SETTINGS.missionDefaults,
      ...readObject(parsed.missionDefaults),
      coordinatorRoster: readStringArray(parsed.missionDefaults?.coordinatorRoster),
      adminRoster: readStringArray(parsed.missionDefaults?.adminRoster),
    },
    dataSource: {
      ...DEFAULT_APP_SETTINGS.dataSource,
      ...readObject(parsed.dataSource),
      secretPresent: false,
    },
    weather: {
      links: normalizeWeatherLinks(parsed.weather?.links),
    },
  }
}

async function readSecrets(secretsPath) {
  const parsed = await readJson(secretsPath, {})
  return readObject(parsed)
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

async function writeJsonAtomically(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.rename(tempPath, filePath)
}

function toView(persisted, secretPresent) {
  return {
    missionDefaults: persisted.missionDefaults,
    dataSource: {
      ...persisted.dataSource,
      secretPresent,
    },
    weather: persisted.weather,
    advanced: DEFAULT_APP_SETTINGS.advanced,
  }
}

function validateSettingsDraft(input, existingSecretPresent) {
  if (input.dataSource.providerType === 'traccar_http') {
    if (normalizeBaseUrl(input.dataSource.baseUrl) === '') {
      throw new Error('Enter a Traccar base URL first.')
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
    autoRefreshIntervalSeconds: Number(input.autoRefreshIntervalSeconds),
    autoSaveEnabled: Boolean(input.autoSaveEnabled),
    autoSaveIntervalSeconds: Number(input.autoSaveIntervalSeconds),
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
  UNSAFE_SECRET_MESSAGE,
  createElectronSettingsStore,
}
