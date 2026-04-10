import { invoke } from '@tauri-apps/api/core'

import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsDraft,
  type RuntimeBootstrapSettings,
} from '../../features/settings/settings-types'

const BROWSER_SETTINGS_STORAGE_KEY = 'sartracker:browser-settings'

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
  window.localStorage.setItem(BROWSER_SETTINGS_STORAGE_KEY, JSON.stringify(next))
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

  return { ok: true, message: 'Browser validation mode: connection shape looks valid.' }
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
  const shouldConnect =
    settings.dataSource.providerType === 'traccar_http' &&
    (forceConnect || settings.dataSource.autoConnect) &&
    settings.missionDefaults.autoRefreshEnabled

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
                  password: 'browser-secret',
                }
              : { token: 'browser-secret' }),
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
      secretPresent: input.dataSource.clearSecret ? false : input.dataSource.secretPresent || input.dataSource.secretInput.trim() !== '',
    },
    advanced: DEFAULT_APP_SETTINGS.advanced,
  }
}
