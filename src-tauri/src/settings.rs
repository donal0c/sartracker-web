use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

const SETTINGS_FILE_NAME: &str = "settings.json";
const SECRET_SERVICE: &str = "ie.kmrt.sartracker-web";
const PASSWORD_SECRET_KEY: &str = "traccar_basic_password";
const TOKEN_SECRET_KEY: &str = "traccar_bearer_token";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrackingProviderType {
    None,
    TraccarHttp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrackingAuthMode {
    Basic,
    Bearer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct MissionDefaultsSettings {
    pub auto_refresh_enabled: bool,
    pub auto_refresh_interval_seconds: u64,
    pub auto_save_enabled: bool,
    pub auto_save_interval_seconds: u64,
    pub primary_mission_root: String,
    pub backup_mission_root: String,
    pub coordinator_roster: Vec<String>,
    pub admin_roster: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceSettings {
    pub provider_type: TrackingProviderType,
    pub base_url: String,
    pub auth_mode: TrackingAuthMode,
    pub email: String,
    pub auto_connect: bool,
    pub tracking_cache_enabled: bool,
    pub replay_enabled: bool,
    pub replay_start: String,
    pub replay_duration_hours: u8,
    pub secret_present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSettings {
    pub repair_layer_structure_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsView {
    pub mission_defaults: MissionDefaultsSettings,
    pub data_source: DataSourceSettings,
    pub advanced: AdvancedSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsDraft {
    pub mission_defaults: MissionDefaultsSettings,
    pub data_source: DataSourceDraft,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DataSourceDraft {
    pub provider_type: TrackingProviderType,
    pub base_url: String,
    pub auth_mode: TrackingAuthMode,
    pub email: String,
    pub auto_connect: bool,
    pub tracking_cache_enabled: bool,
    pub replay_enabled: bool,
    pub replay_start: String,
    pub replay_duration_hours: u8,
    pub secret_input: String,
    pub clear_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBootstrapSettings {
    pub autosave_enabled: bool,
    pub autosave_interval_ms: u64,
    pub tracking_poll_interval_ms: u64,
    pub tracking_cache_enabled: bool,
    pub tracking_config: Option<TrackingRuntimeConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackingRuntimeConfig {
    pub base_url: String,
    pub email: Option<String>,
    pub password: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
struct PersistedSettings {
    mission_defaults: MissionDefaultsSettings,
    data_source: PersistedDataSourceSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
struct PersistedDataSourceSettings {
    provider_type: TrackingProviderType,
    base_url: String,
    auth_mode: TrackingAuthMode,
    email: String,
    auto_connect: bool,
    tracking_cache_enabled: bool,
    replay_enabled: bool,
    replay_start: String,
    replay_duration_hours: u8,
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            mission_defaults: MissionDefaultsSettings {
                ..MissionDefaultsSettings::default()
            },
            data_source: PersistedDataSourceSettings::default(),
        }
    }
}

impl Default for MissionDefaultsSettings {
    fn default() -> Self {
        Self {
            auto_refresh_enabled: true,
            auto_refresh_interval_seconds: 30,
            auto_save_enabled: true,
            auto_save_interval_seconds: 30,
            primary_mission_root: String::new(),
            backup_mission_root: String::new(),
            coordinator_roster: Vec::new(),
            admin_roster: Vec::new(),
        }
    }
}

impl Default for PersistedDataSourceSettings {
    fn default() -> Self {
        Self {
            provider_type: TrackingProviderType::None,
            base_url: String::new(),
            auth_mode: TrackingAuthMode::Basic,
            email: String::new(),
            auto_connect: true,
            tracking_cache_enabled: true,
            replay_enabled: false,
            replay_start: String::new(),
            replay_duration_hours: 4,
        }
    }
}

trait SecretStore: Send + Sync {
    fn set_secret(&self, key: &str, value: &str) -> Result<(), String>;
    fn get_secret(&self, key: &str) -> Result<Option<String>, String>;
    fn delete_secret(&self, key: &str) -> Result<(), String>;
}

struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn set_secret(&self, key: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(SECRET_SERVICE, key)
            .map_err(|error| format!("Failed to create keyring entry: {error}"))?
            .set_password(value)
            .map_err(|error| format!("Failed to save secret: {error}"))
    }

    fn get_secret(&self, key: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(SECRET_SERVICE, key)
            .map_err(|error| format!("Failed to create keyring entry: {error}"))?;

        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("Failed to read secret: {error}")),
        }
    }

    fn delete_secret(&self, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(SECRET_SERVICE, key)
            .map_err(|error| format!("Failed to create keyring entry: {error}"))?;

        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("Failed to delete secret: {error}")),
        }
    }
}

pub struct SettingsStore {
    settings_path: PathBuf,
    persisted: Mutex<PersistedSettings>,
    secret_store: Arc<dyn SecretStore>,
}

pub struct SettingsStoreState(pub Arc<SettingsStore>);

impl SettingsStore {
    fn new(settings_path: PathBuf, secret_store: Arc<dyn SecretStore>) -> Result<Self, String> {
        let persisted = read_settings_file(&settings_path)?;
        Ok(Self {
            settings_path,
            persisted: Mutex::new(persisted),
            secret_store,
        })
    }

    pub fn load_view(&self) -> Result<AppSettingsView, String> {
        let persisted = self
            .persisted
            .lock()
            .map_err(|_| String::from("Settings store lock poisoned."))?
            .clone();
        Ok(self.to_view(&persisted)?)
    }

    pub fn save(&self, draft: AppSettingsDraft) -> Result<AppSettingsView, String> {
        let existing_secret_present = self
            .read_current_secret(&draft.data_source.auth_mode)?
            .is_some();
        validate_settings_draft(&draft, existing_secret_present)?;
        let next = PersistedSettings {
            mission_defaults: normalize_mission_defaults(draft.mission_defaults),
            data_source: normalize_data_source(&draft.data_source),
        };

        write_settings_file(&self.settings_path, &next)?;

        match next.data_source.auth_mode {
            TrackingAuthMode::Basic => {
                update_secret(
                    self.secret_store.as_ref(),
                    PASSWORD_SECRET_KEY,
                    &draft.data_source.secret_input,
                    draft.data_source.clear_secret,
                )?;
                self.secret_store.delete_secret(TOKEN_SECRET_KEY)?;
            }
            TrackingAuthMode::Bearer => {
                update_secret(
                    self.secret_store.as_ref(),
                    TOKEN_SECRET_KEY,
                    &draft.data_source.secret_input,
                    draft.data_source.clear_secret,
                )?;
                self.secret_store.delete_secret(PASSWORD_SECRET_KEY)?;
            }
        }

        let mut guard = self
            .persisted
            .lock()
            .map_err(|_| String::from("Settings store lock poisoned."))?;
        *guard = next.clone();
        drop(guard);

        self.to_view(&next)
    }

    pub fn runtime_bootstrap(&self, force_connect: bool) -> Result<RuntimeBootstrapSettings, String> {
        let persisted = self
            .persisted
            .lock()
            .map_err(|_| String::from("Settings store lock poisoned."))?
            .clone();

        let secret = self.read_current_secret(&persisted.data_source.auth_mode)?;
        let should_connect = persisted.data_source.provider_type == TrackingProviderType::TraccarHttp
            && persisted.mission_defaults.auto_refresh_enabled
            && (force_connect || persisted.data_source.auto_connect)
            && secret.is_some();

        Ok(RuntimeBootstrapSettings {
            autosave_enabled: persisted.mission_defaults.auto_save_enabled,
            autosave_interval_ms: persisted.mission_defaults.auto_save_interval_seconds * 1000,
            tracking_poll_interval_ms: persisted.mission_defaults.auto_refresh_interval_seconds * 1000,
            tracking_cache_enabled: persisted.data_source.tracking_cache_enabled,
            tracking_config: if should_connect {
                Some(match persisted.data_source.auth_mode {
                    TrackingAuthMode::Basic => TrackingRuntimeConfig {
                        base_url: persisted.data_source.base_url.clone(),
                        email: Some(persisted.data_source.email.clone()),
                        password: secret,
                        token: None,
                    },
                    TrackingAuthMode::Bearer => TrackingRuntimeConfig {
                        base_url: persisted.data_source.base_url.clone(),
                        email: None,
                        password: None,
                        token: secret,
                    },
                })
            } else {
                None
            },
        })
    }

    pub async fn test_connection(&self, draft: AppSettingsDraft) -> Result<TestConnectionResult, String> {
        let existing_secret_present = self
            .read_current_secret(&draft.data_source.auth_mode)?
            .is_some();
        validate_settings_draft(&draft, existing_secret_present)?;

        if draft.data_source.provider_type != TrackingProviderType::TraccarHttp {
            return Ok(TestConnectionResult {
                ok: false,
                message: String::from("Select the Traccar HTTP provider first."),
            });
        }

        let secret = if draft.data_source.clear_secret {
            None
        } else if !draft.data_source.secret_input.trim().is_empty() {
            Some(draft.data_source.secret_input.clone())
        } else {
            self.read_current_secret(&draft.data_source.auth_mode)?
        };

        let Some(secret_value) = secret else {
            return Ok(TestConnectionResult {
                ok: false,
                message: String::from("A provider secret is required before testing the connection."),
            });
        };

        let client = Client::builder()
            .cookie_store(true)
            .build()
            .map_err(|error| format!("Failed to build HTTP client: {error}"))?;
        let base_url = draft.data_source.base_url.trim().trim_end_matches('/').to_string();

        match draft.data_source.auth_mode {
            TrackingAuthMode::Basic => {
                let response = client
                    .post(format!("{base_url}/api/session"))
                    .form(&[
                        ("email", draft.data_source.email.as_str()),
                        ("password", secret_value.as_str()),
                    ])
                    .send()
                    .await
                    .map_err(|error| format!("Traccar session request failed: {error}"))?;

                if !response.status().is_success() {
                    return Ok(TestConnectionResult {
                        ok: false,
                        message: format!("Authentication failed: {}", response.status()),
                    });
                }

                let devices = client
                    .get(format!("{base_url}/api/devices"))
                    .send()
                    .await
                    .map_err(|error| format!("Traccar devices request failed: {error}"))?;

                return Ok(TestConnectionResult {
                    ok: devices.status().is_success(),
                    message: if devices.status().is_success() {
                        String::from("Connection successful.")
                    } else {
                        format!("Device fetch failed: {}", devices.status())
                    },
                });
            }
            TrackingAuthMode::Bearer => {
                let response = client
                    .get(format!("{base_url}/api/devices"))
                    .bearer_auth(secret_value)
                    .send()
                    .await
                    .map_err(|error| format!("Traccar devices request failed: {error}"))?;

                return Ok(TestConnectionResult {
                    ok: response.status().is_success(),
                    message: if response.status().is_success() {
                        String::from("Connection successful.")
                    } else {
                        format!("Device fetch failed: {}", response.status())
                    },
                });
            }
        }
    }

    fn to_view(&self, persisted: &PersistedSettings) -> Result<AppSettingsView, String> {
        let secret_present = self
            .read_current_secret(&persisted.data_source.auth_mode)?
            .is_some();

        Ok(AppSettingsView {
            mission_defaults: persisted.mission_defaults.clone(),
            data_source: DataSourceSettings {
                provider_type: persisted.data_source.provider_type.clone(),
                base_url: persisted.data_source.base_url.clone(),
                auth_mode: persisted.data_source.auth_mode.clone(),
                email: persisted.data_source.email.clone(),
                auto_connect: persisted.data_source.auto_connect,
                tracking_cache_enabled: persisted.data_source.tracking_cache_enabled,
                replay_enabled: persisted.data_source.replay_enabled,
                replay_start: persisted.data_source.replay_start.clone(),
                replay_duration_hours: persisted.data_source.replay_duration_hours,
                secret_present,
            },
            advanced: AdvancedSettings {
                repair_layer_structure_available: false,
            },
        })
    }

    fn read_current_secret(&self, auth_mode: &TrackingAuthMode) -> Result<Option<String>, String> {
        match auth_mode {
            TrackingAuthMode::Basic => self.secret_store.get_secret(PASSWORD_SECRET_KEY),
            TrackingAuthMode::Bearer => self.secret_store.get_secret(TOKEN_SECRET_KEY),
        }
    }
}

pub fn build_settings_store<R: Runtime>(app: &AppHandle<R>) -> Result<SettingsStore, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve app config directory: {error}"))?;
    let settings_path = config_dir.join(SETTINGS_FILE_NAME);
    SettingsStore::new(settings_path, Arc::new(KeyringSecretStore))
}

#[tauri::command]
pub fn load_app_settings(store: State<'_, SettingsStoreState>) -> Result<AppSettingsView, String> {
    store.0.load_view()
}

#[tauri::command]
pub fn save_app_settings(
    input: AppSettingsDraft,
    store: State<'_, SettingsStoreState>,
) -> Result<AppSettingsView, String> {
    store.0.save(input)
}

#[tauri::command]
pub async fn test_tracking_connection(
    input: AppSettingsDraft,
    store: State<'_, SettingsStoreState>,
) -> Result<TestConnectionResult, String> {
    store.0.test_connection(input).await
}

#[tauri::command]
pub fn load_runtime_bootstrap_settings(
    force_connect: bool,
    store: State<'_, SettingsStoreState>,
) -> Result<RuntimeBootstrapSettings, String> {
    store.0.runtime_bootstrap(force_connect)
}

fn read_settings_file(path: &PathBuf) -> Result<PersistedSettings, String> {
    if !path.exists() {
        return Ok(PersistedSettings::default());
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read settings file: {error}"))?;

    serde_json::from_str(&raw).map_err(|error| format!("Failed to parse settings file: {error}"))
}

fn write_settings_file(path: &PathBuf, settings: &PersistedSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create settings directory: {error}"))?;
    }

    let payload = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Failed to serialize settings: {error}"))?;
    fs::write(path, payload).map_err(|error| format!("Failed to write settings file: {error}"))
}

fn normalize_mission_defaults(input: MissionDefaultsSettings) -> MissionDefaultsSettings {
    MissionDefaultsSettings {
        auto_refresh_enabled: input.auto_refresh_enabled,
        auto_refresh_interval_seconds: input.auto_refresh_interval_seconds,
        auto_save_enabled: input.auto_save_enabled,
        auto_save_interval_seconds: input.auto_save_interval_seconds,
        primary_mission_root: input.primary_mission_root.trim().to_string(),
        backup_mission_root: input.backup_mission_root.trim().to_string(),
        coordinator_roster: normalize_roster(input.coordinator_roster),
        admin_roster: normalize_roster(input.admin_roster),
    }
}

fn normalize_data_source(input: &DataSourceDraft) -> PersistedDataSourceSettings {
    let replay_enabled =
        input.provider_type == TrackingProviderType::TraccarHttp && input.replay_enabled;

    PersistedDataSourceSettings {
        provider_type: input.provider_type.clone(),
        base_url: input.base_url.trim().trim_end_matches('/').to_string(),
        auth_mode: input.auth_mode.clone(),
        email: input.email.trim().to_string(),
        auto_connect: input.auto_connect,
        tracking_cache_enabled: input.tracking_cache_enabled,
        replay_enabled,
        replay_start: if replay_enabled {
            input.replay_start.trim().to_string()
        } else {
            String::new()
        },
        replay_duration_hours: input.replay_duration_hours,
    }
}

fn normalize_roster(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();

    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }

        if !normalized.iter().any(|existing: &String| existing == trimmed) {
            normalized.push(trimmed.to_string());
        }
    }

    normalized
}

fn update_secret(
    secret_store: &dyn SecretStore,
    key: &str,
    value: &str,
    clear_secret: bool,
) -> Result<(), String> {
    if clear_secret {
        return secret_store.delete_secret(key);
    }

    if value.trim().is_empty() {
        return Ok(());
    }

    secret_store.set_secret(key, value.trim())
}

fn validate_settings_draft(
    draft: &AppSettingsDraft,
    existing_secret_present: bool,
) -> Result<(), String> {
    let defaults = &draft.mission_defaults;
    if defaults.auto_refresh_interval_seconds < 5 || defaults.auto_refresh_interval_seconds > 3600
    {
        return Err(String::from(
            "Auto-refresh interval must be between 5 and 3600 seconds.",
        ));
    }

    if defaults.auto_save_interval_seconds < 5 || defaults.auto_save_interval_seconds > 3600 {
        return Err(String::from(
            "Auto-save interval must be between 5 and 3600 seconds.",
        ));
    }

    let data_source = &draft.data_source;
    if data_source.provider_type != TrackingProviderType::TraccarHttp && data_source.replay_enabled {
        return Err(String::from(
            "Replay defaults are only available for the Traccar HTTP provider.",
        ));
    }

    if data_source.provider_type == TrackingProviderType::TraccarHttp {
        let url = reqwest::Url::parse(data_source.base_url.trim())
            .map_err(|error| format!("Provider URL must be a valid absolute URL: {error}"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(String::from("Provider URL must use http or https."));
        }

        if data_source.auth_mode == TrackingAuthMode::Basic && data_source.email.trim().is_empty() {
            return Err(String::from("Email is required for basic authentication."));
        }

        let secret_required = !data_source.clear_secret
            && data_source.secret_input.trim().is_empty()
            && !existing_secret_present
            && data_source.provider_type == TrackingProviderType::TraccarHttp;
        if secret_required {
            return Err(String::from("A provider secret is required."));
        }

        if data_source.replay_enabled {
            if data_source.replay_duration_hours < 1 || data_source.replay_duration_hours > 24 {
                return Err(String::from("Replay duration must be between 1 and 24 hours."));
            }

            if data_source.replay_start.trim().is_empty() {
                return Err(String::from(
                    "Replay start time is required when replay defaults are enabled.",
                ));
            }

            chrono::NaiveDateTime::parse_from_str(data_source.replay_start.trim(), "%Y-%m-%dT%H:%M")
                .map_err(|error| format!("Replay start must be a valid local datetime: {error}"))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, time::{SystemTime, UNIX_EPOCH}};

    #[derive(Default)]
    struct MemorySecretStore {
        secrets: Mutex<HashMap<String, String>>,
    }

    impl SecretStore for MemorySecretStore {
        fn set_secret(&self, key: &str, value: &str) -> Result<(), String> {
            self.secrets
                .lock()
                .map_err(|_| String::from("secret lock poisoned"))?
                .insert(key.to_string(), value.to_string());
            Ok(())
        }

        fn get_secret(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self
                .secrets
                .lock()
                .map_err(|_| String::from("secret lock poisoned"))?
                .get(key)
                .cloned())
        }

        fn delete_secret(&self, key: &str) -> Result<(), String> {
            self.secrets
                .lock()
                .map_err(|_| String::from("secret lock poisoned"))?
                .remove(key);
            Ok(())
        }
    }

    #[test]
    fn saves_and_loads_settings_with_secret_presence() {
        let path = unique_settings_path("save-load");
        let secret_store = Arc::new(MemorySecretStore::default());
        let store = SettingsStore::new(path.clone(), secret_store).expect("store");

        let view = store
            .save(AppSettingsDraft {
                mission_defaults: PersistedSettings::default().mission_defaults,
                data_source: DataSourceDraft {
                    provider_type: TrackingProviderType::TraccarHttp,
                    base_url: String::from("https://traccar.example.com"),
                    auth_mode: TrackingAuthMode::Basic,
                    email: String::from("ops@example.com"),
                    auto_connect: true,
                    tracking_cache_enabled: true,
                    replay_enabled: false,
                    replay_start: String::new(),
                    replay_duration_hours: 4,
                    secret_input: String::from("topsecret"),
                    clear_secret: false,
                },
            })
            .expect("save settings");

        assert!(view.data_source.secret_present);
        let reloaded = store.load_view().expect("load settings");
        assert_eq!(reloaded.data_source.base_url, "https://traccar.example.com");
        assert!(reloaded.data_source.secret_present);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn builds_runtime_bootstrap_without_connecting_when_auto_connect_is_disabled() {
        let path = unique_settings_path("runtime");
        let secret_store = Arc::new(MemorySecretStore::default());
        let store = SettingsStore::new(path.clone(), secret_store.clone()).expect("store");
        secret_store
            .set_secret(PASSWORD_SECRET_KEY, "pw")
            .expect("set secret");

        write_settings_file(
            &path,
            &PersistedSettings {
                mission_defaults: PersistedSettings::default().mission_defaults,
                data_source: PersistedDataSourceSettings {
                    provider_type: TrackingProviderType::TraccarHttp,
                    base_url: String::from("https://traccar.example.com"),
                    auth_mode: TrackingAuthMode::Basic,
                    email: String::from("ops@example.com"),
                    auto_connect: false,
                    tracking_cache_enabled: true,
                    replay_enabled: false,
                    replay_start: String::new(),
                    replay_duration_hours: 4,
                },
            },
        )
        .expect("write settings");
        *store.persisted.lock().expect("lock") = read_settings_file(&path).expect("read");

        let runtime = store.runtime_bootstrap(false).expect("runtime");
        assert!(runtime.tracking_config.is_none());

        let forced = store.runtime_bootstrap(true).expect("forced runtime");
        assert!(forced.tracking_config.is_some());
        assert!(forced.tracking_cache_enabled);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn loads_legacy_partial_settings_with_defaults() {
        let path = unique_settings_path("legacy-partial");
        fs::write(
            &path,
            r#"{
  "mission_defaults": {
    "auto_refresh_enabled": true,
    "auto_refresh_interval_seconds": 45,
    "auto_save_enabled": true,
    "auto_save_interval_seconds": 60,
    "primary_mission_root": "/missions",
    "backup_mission_root": "",
    "coordinator_roster": ["Alice"],
    "admin_roster": []
  },
  "data_source": {
    "provider_type": "traccar_http",
    "base_url": "https://traccar.example.com",
    "auth_mode": "basic",
    "email": "ops@example.com",
    "auto_connect": true
  }
}"#,
        )
        .expect("write legacy settings");

        let loaded = read_settings_file(&path).expect("read legacy settings");
        assert!(loaded.data_source.tracking_cache_enabled);
        assert!(!loaded.data_source.replay_enabled);
        assert_eq!(loaded.data_source.replay_duration_hours, 4);

        let _ = fs::remove_file(path);
    }

    fn unique_settings_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("sartracker-settings-{label}-{nonce}.json"))
    }
}
