import { invoke } from '@tauri-apps/api/core'

import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsDraft,
  type RuntimeBootstrapSettings,
  type TrackingAuthMode,
} from '../../features/settings/settings-types'

const BROWSER_SETTINGS_STORAGE_KEY = 'sartracker:browser-settings'
const browserSecrets: Partial<Record<TrackingAuthMode, string>> = {}

type TestConnectionResult = {
  readonly ok: boolean
  readonly message: string
}

/**
 * Loads the persisted app settings, using a browser fallback for validation runs.
 */
export async function loadAppSettings(): Promise<AppSettings> {
  if (isTauriRuntimeAvailable()) {
    return invoke<AppSettings>('load_app_settings')
  }

  return readBrowserSettings()
}

/**
 * Saves the app settings and secret updates, using a browser fallback for validation runs.
 */
export async function saveAppSettings(input: AppSettingsDraft): Promise<AppSettings> {
  if (isTauriRuntimeAvailable()) {
    return invoke<AppSettings>('save_app_settings', { input })
  }

  const next = toBrowserSettings(input)
  updateBrowserSecret(input)
  window.localStorage.setItem(BROWSER_SETTINGS_STORAGE_KEY, JSON.stringify(withoutBrowserSecretState(next)))
  return next
}

/**
 * Tests the current provider settings without requiring a save first.
 */
export async function testTrackingConnection(input: AppSettingsDraft): Promise<TestConnectionResult> {
  if (isTauriRuntimeAvailable()) {
    return invoke<TestConnectionResult>('test_tracking_connection', { input })
  }

  if (input.dataSource.providerType !== 'traccar_http') {
    return { ok: false, message: 'Select the Traccar HTTP provider first.' }
  }

  if (input.dataSource.baseUrl.trim() === '') {
    return { ok: false, message: 'Enter a Traccar base URL first.' }
  }

  const secret = resolveBrowserSecret(input)
  if (secret === null) {
    return { ok: false, message: 'A provider secret is required before testing the connection.' }
  }

  return testBrowserTrackingConnection(input, secret)
}

/**
 * Loads the runtime bootstrap settings used by autosave and tracking startup/reload.
 */
export async function loadRuntimeBootstrapSettings(
  forceConnect = false,
): Promise<RuntimeBootstrapSettings> {
  if (isTauriRuntimeAvailable()) {
    return invoke<RuntimeBootstrapSettings>('load_runtime_bootstrap_settings', { forceConnect })
  }

  const settings = readBrowserSettings()
  const secret = browserSecrets[settings.dataSource.authMode]
  const shouldConnect =
    settings.dataSource.providerType === 'traccar_http' &&
    (forceConnect || settings.dataSource.autoConnect) &&
    settings.missionDefaults.autoRefreshEnabled &&
    secret !== undefined

  return {
    autosaveEnabled: settings.missionDefaults.autoSaveEnabled,
    autosaveIntervalMs: settings.missionDefaults.autoSaveIntervalSeconds * 1000,
    trackingPollIntervalMs: settings.missionDefaults.autoRefreshIntervalSeconds * 1000,
    trackingCacheEnabled: settings.dataSource.trackingCacheEnabled,
    trackingConfig:
      shouldConnect
        ? {
            baseUrl: settings.dataSource.baseUrl,
            ...(settings.dataSource.authMode === 'basic'
              ? {
                  email: settings.dataSource.email,
                  password: secret,
                }
              : { token: secret }),
          }
        : null,
  }
}

function readBrowserSettings(): AppSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_SETTINGS
  }

  try {
    const raw = window.localStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY)
    if (raw === null) {
      return DEFAULT_APP_SETTINGS
    }

    const parsed = JSON.parse(raw) as AppSettings
    return {
      missionDefaults: {
        ...DEFAULT_APP_SETTINGS.missionDefaults,
        ...parsed.missionDefaults,
      },
      dataSource: {
        ...DEFAULT_APP_SETTINGS.dataSource,
        ...parsed.dataSource,
        secretPresent: browserSecrets[parsed.dataSource?.authMode as TrackingAuthMode] !== undefined,
      },
      advanced: {
        ...DEFAULT_APP_SETTINGS.advanced,
        ...parsed.advanced,
      },
    }
  } catch {
    return DEFAULT_APP_SETTINGS
  }
}

function toBrowserSettings(input: AppSettingsDraft): AppSettings {
  const replayEnabled =
    input.dataSource.providerType === 'traccar_http' && input.dataSource.replayEnabled
  const secret = resolveBrowserSecret(input)

  return {
    missionDefaults: input.missionDefaults,
    dataSource: {
      providerType: input.dataSource.providerType,
      baseUrl: input.dataSource.baseUrl,
      authMode: input.dataSource.authMode,
      email: input.dataSource.email,
      autoConnect: input.dataSource.autoConnect,
      trackingCacheEnabled: input.dataSource.trackingCacheEnabled,
      replayEnabled,
      replayStart: replayEnabled ? input.dataSource.replayStart : '',
      replayDurationHours: input.dataSource.replayDurationHours,
      secretPresent: secret !== null,
    },
    advanced: DEFAULT_APP_SETTINGS.advanced,
  }
}

function updateBrowserSecret(input: AppSettingsDraft): void {
  if (input.dataSource.clearSecret) {
    delete browserSecrets[input.dataSource.authMode]
    return
  }

  const nextSecret = input.dataSource.secretInput.trim()
  if (nextSecret !== '') {
    browserSecrets[input.dataSource.authMode] = nextSecret
  }
}

function resolveBrowserSecret(input: AppSettingsDraft): string | null {
  if (input.dataSource.clearSecret) {
    return null
  }

  const nextSecret = input.dataSource.secretInput.trim()
  if (nextSecret !== '') {
    return nextSecret
  }

  return browserSecrets[input.dataSource.authMode] ?? null
}

function withoutBrowserSecretState(settings: AppSettings): AppSettings {
  return {
    ...settings,
    dataSource: {
      ...settings.dataSource,
      secretPresent: false,
    },
  }
}

async function testBrowserTrackingConnection(
  input: AppSettingsDraft,
  secret: string,
): Promise<TestConnectionResult> {
  const baseUrl = input.dataSource.baseUrl.trim().replace(/\/+$/, '')

  if (input.dataSource.authMode === 'basic') {
    const sessionResponse = await window.fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: input.dataSource.email.trim(),
        password: secret,
      }).toString(),
    })

    if (!sessionResponse.ok) {
      return { ok: false, message: `Authentication failed: ${sessionResponse.status}` }
    }

    const devicesResponse = await window.fetch(`${baseUrl}/api/devices`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${window.btoa(`${input.dataSource.email.trim()}:${secret}`)}`,
      },
    })

    return {
      ok: devicesResponse.ok,
      message: devicesResponse.ok
        ? 'Connection successful.'
        : `Device fetch failed: ${devicesResponse.status}`,
    }
  }

  const devicesResponse = await window.fetch(`${baseUrl}/api/devices`, {
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
