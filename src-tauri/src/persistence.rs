use std::{path::PathBuf, sync::Arc};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    ConnectOptions, FromRow, SqlitePool,
};
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;

const DATABASE_FILE_NAME: &str = "mission-store.sqlite";
const BACKUP_FILE_NAME: &str = "mission-store.backup.sqlite";
const CURRENT_SCHEMA_VERSION: i64 = 1;

#[derive(Clone)]
pub struct MissionStore {
    pool: SqlitePool,
    database_path: PathBuf,
    backup_path: PathBuf,
}

#[derive(Clone)]
pub struct MissionStoreState(pub Arc<MissionStore>);

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "TEXT", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum MissionStatus {
    Idle,
    Active,
    Paused,
    Finished,
    Finalized,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
pub struct Mission {
    pub id: String,
    pub name: String,
    pub status: MissionStatus,
    pub start_time: String,
    pub pause_time: Option<String>,
    pub finish_time: Option<String>,
    pub paused_seconds: i64,
    pub notes: Option<String>,
    pub schema_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "TEXT", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum DeviceStatus {
    Online,
    Offline,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
pub struct Device {
    pub id: String,
    pub mission_id: String,
    pub device_id: String,
    pub name: String,
    pub color: String,
    pub last_seen: Option<String>,
    pub status: DeviceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
pub struct Position {
    pub id: String,
    pub mission_id: String,
    pub device_id: String,
    pub name: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub altitude: Option<f64>,
    pub speed: Option<f64>,
    pub battery: Option<f64>,
    pub accuracy: Option<f64>,
    pub source: Option<String>,
    pub timestamp: String,
    pub data_origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionStoreInfo {
    pub schema_version: i64,
    pub database_path: String,
    pub backup_path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMissionInput {
    pub name: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertDeviceInput {
    pub mission_id: String,
    pub device_id: String,
    pub name: String,
    pub color: String,
    pub status: DeviceStatus,
    pub last_seen: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddPositionInput {
    pub mission_id: String,
    pub device_id: String,
    pub name: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub altitude: Option<f64>,
    pub speed: Option<f64>,
    pub battery: Option<f64>,
    pub accuracy: Option<f64>,
    pub source: Option<String>,
    pub timestamp: Option<String>,
    pub data_origin: Option<String>,
}

impl MissionStore {
    pub async fn connect(database_path: PathBuf, backup_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create app config directory: {error}"))?;
        }

        let connect_options = SqliteConnectOptions::new()
            .filename(&database_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .foreign_keys(true)
            .disable_statement_logging();

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(connect_options)
            .await
            .map_err(|error| format!("Failed to open mission store: {error}"))?;

        let store = Self {
            pool,
            database_path,
            backup_path,
        };

        store.initialize().await?;
        Ok(store)
    }

    async fn initialize(&self) -> Result<(), String> {
        sqlx::query("PRAGMA journal_mode = WAL;")
            .execute(&self.pool)
            .await
            .map_err(|error| format!("Failed to enable WAL mode: {error}"))?;
        sqlx::query("PRAGMA foreign_keys = ON;")
            .execute(&self.pool)
            .await
            .map_err(|error| format!("Failed to enable foreign keys: {error}"))?;
        sqlx::query("PRAGMA synchronous = NORMAL;")
            .execute(&self.pool)
            .await
            .map_err(|error| format!("Failed to set synchronous mode: {error}"))?;

        self.run_migrations().await?;
        Ok(())
    }

    async fn run_migrations(&self) -> Result<(), String> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start migration transaction: {error}"))?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS missions (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('idle', 'active', 'paused', 'finished', 'finalized')),
              start_time TEXT NOT NULL,
              pause_time TEXT,
              finish_time TEXT,
              paused_seconds INTEGER NOT NULL DEFAULT 0,
              notes TEXT,
              schema_version INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);

            CREATE TABLE IF NOT EXISTS devices (
              id TEXT PRIMARY KEY,
              mission_id TEXT NOT NULL,
              device_id TEXT NOT NULL,
              name TEXT NOT NULL,
              color TEXT NOT NULL,
              last_seen TEXT,
              status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'unknown')),
              FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
              UNIQUE (mission_id, device_id)
            );

            CREATE INDEX IF NOT EXISTS idx_devices_mission_name
              ON devices(mission_id, name);

            CREATE TABLE IF NOT EXISTS positions (
              id TEXT PRIMARY KEY,
              mission_id TEXT NOT NULL,
              device_id TEXT NOT NULL,
              name TEXT,
              lat REAL NOT NULL,
              lon REAL NOT NULL,
              altitude REAL,
              speed REAL,
              battery REAL,
              accuracy REAL,
              source TEXT,
              timestamp TEXT NOT NULL,
              data_origin TEXT NOT NULL DEFAULT 'live' CHECK(data_origin IN ('live', 'cache')),
              FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
              FOREIGN KEY (mission_id, device_id) REFERENCES devices(mission_id, device_id)
            );

            CREATE INDEX IF NOT EXISTS idx_positions_mission_device_timestamp
              ON positions(mission_id, device_id, timestamp);

            CREATE TABLE IF NOT EXISTS mission_events (
              id TEXT PRIMARY KEY,
              mission_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              timestamp TEXT NOT NULL,
              details_json TEXT,
              FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_mission_events_mission_timestamp
              ON mission_events(mission_id, timestamp);
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to apply mission store schema: {error}"))?;

        sqlx::query(
            "INSERT INTO metadata (key, value) VALUES ('schema_version', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(CURRENT_SCHEMA_VERSION.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to record schema version: {error}"))?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit mission store migrations: {error}"))?;

        Ok(())
    }

    pub async fn info(&self) -> Result<MissionStoreInfo, String> {
        Ok(MissionStoreInfo {
            schema_version: self.schema_version().await?,
            database_path: self.database_path.to_string_lossy().to_string(),
            backup_path: self.backup_path.to_string_lossy().to_string(),
        })
    }

    pub async fn sync_backup(&self) -> Result<String, String> {
        if let Some(parent) = self.backup_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create backup directory: {error}"))?;
        }

        let temporary_path = self.backup_path.with_extension("tmp");
        if temporary_path.exists() {
            std::fs::remove_file(&temporary_path)
                .map_err(|error| format!("Failed to clear temporary backup file: {error}"))?;
        }

        let escaped_path = temporary_path.to_string_lossy().replace('\'', "''");
        let vacuum_statement = format!("VACUUM INTO '{escaped_path}'");
        sqlx::query(&vacuum_statement)
            .execute(&self.pool)
            .await
            .map_err(|error| format!("Failed to write mission store backup: {error}"))?;

        std::fs::rename(&temporary_path, &self.backup_path)
            .map_err(|error| format!("Failed to finalize mission store backup: {error}"))?;

        Ok(self.backup_path.to_string_lossy().to_string())
    }

    pub async fn schema_version(&self) -> Result<i64, String> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM metadata WHERE key = 'schema_version'")
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| format!("Failed to read schema version: {error}"))?;

        row.and_then(|(value,)| value.parse::<i64>().ok())
            .ok_or_else(|| "Mission store schema version is missing or invalid".to_string())
    }

    pub async fn create_mission(&self, input: CreateMissionInput) -> Result<Mission, String> {
        let existing_active = self.get_active_mission().await?;
        if existing_active.is_some() {
            return Err("Cannot create a new mission while another mission is active.".to_string());
        }

        let mission_id = Uuid::new_v4().to_string();
        let event_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start create mission transaction: {error}"))?;

        sqlx::query(
            r#"
            INSERT INTO missions (
              id, name, status, start_time, pause_time, finish_time, paused_seconds, notes, schema_version
            ) VALUES (?, ?, 'active', ?, NULL, NULL, 0, ?, ?)
            "#,
        )
        .bind(&mission_id)
        .bind(&input.name)
        .bind(&now)
        .bind(&input.notes)
        .bind(CURRENT_SCHEMA_VERSION)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to create mission: {error}"))?;

        let details_json = serde_json::json!({ "name": input.name }).to_string();
        sqlx::query(
            r#"
            INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
            VALUES (?, ?, 'mission_created', ?, ?)
            "#,
        )
        .bind(&event_id)
        .bind(&mission_id)
        .bind(&now)
        .bind(details_json)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to record mission creation event: {error}"))?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit mission creation: {error}"))?;

        self.get_mission(mission_id).await
    }

    pub async fn upsert_device(&self, input: UpsertDeviceInput) -> Result<Device, String> {
        self.get_mission(input.mission_id.clone()).await?;

        let device_row_id = Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO devices (id, mission_id, device_id, name, color, last_seen, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(mission_id, device_id) DO UPDATE SET
              name = excluded.name,
              color = excluded.color,
              last_seen = excluded.last_seen,
              status = excluded.status
            "#,
        )
        .bind(device_row_id)
        .bind(&input.mission_id)
        .bind(&input.device_id)
        .bind(&input.name)
        .bind(&input.color)
        .bind(&input.last_seen)
        .bind(&input.status)
        .execute(&self.pool)
        .await
        .map_err(|error| format!("Failed to upsert device {}: {error}", input.device_id))?;

        self.get_device(input.mission_id, input.device_id).await
    }

    pub async fn get_device(
        &self,
        mission_id: String,
        device_id: String,
    ) -> Result<Device, String> {
        sqlx::query_as::<_, Device>(
            r#"
            SELECT id, mission_id, device_id, name, color, last_seen, status
            FROM devices
            WHERE mission_id = ? AND device_id = ?
            "#,
        )
        .bind(&mission_id)
        .bind(&device_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load device {device_id}: {error}"))?
        .ok_or_else(|| format!("Device not found: {device_id}"))
    }

    pub async fn list_devices(&self, mission_id: String) -> Result<Vec<Device>, String> {
        sqlx::query_as::<_, Device>(
            r#"
            SELECT id, mission_id, device_id, name, color, last_seen, status
            FROM devices
            WHERE mission_id = ?
            ORDER BY name ASC
            "#,
        )
        .bind(mission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list devices: {error}"))
    }

    pub async fn add_position(&self, input: AddPositionInput) -> Result<Position, String> {
        self.get_device(input.mission_id.clone(), input.device_id.clone()).await?;

        if !input.lat.is_finite() || input.lat < -90.0 || input.lat > 90.0 {
            return Err("Latitude must be a finite value between -90 and 90.".to_string());
        }
        if !input.lon.is_finite() || input.lon < -180.0 || input.lon > 180.0 {
            return Err("Longitude must be a finite value between -180 and 180.".to_string());
        }

        let position_id = Uuid::new_v4().to_string();
        let timestamp = input.timestamp.unwrap_or_else(|| Utc::now().to_rfc3339());
        let data_origin = input.data_origin.unwrap_or_else(|| "live".to_string());

        if data_origin != "live" && data_origin != "cache" {
            return Err("Position data origin must be either 'live' or 'cache'.".to_string());
        }

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start position transaction: {error}"))?;

        sqlx::query(
            r#"
            INSERT INTO positions (
              id, mission_id, device_id, name, lat, lon, altitude, speed, battery, accuracy,
              source, timestamp, data_origin
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&position_id)
        .bind(&input.mission_id)
        .bind(&input.device_id)
        .bind(&input.name)
        .bind(input.lat)
        .bind(input.lon)
        .bind(input.altitude)
        .bind(input.speed)
        .bind(input.battery)
        .bind(input.accuracy)
        .bind(&input.source)
        .bind(&timestamp)
        .bind(&data_origin)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to insert position: {error}"))?;

        sqlx::query(
            r#"
            UPDATE devices
            SET last_seen = ?, status = 'online'
            WHERE mission_id = ? AND device_id = ?
            "#,
        )
        .bind(&timestamp)
        .bind(&input.mission_id)
        .bind(&input.device_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to update device last_seen: {error}"))?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit position insert: {error}"))?;

        self.get_position(position_id).await
    }

    pub async fn get_position(&self, position_id: String) -> Result<Position, String> {
        sqlx::query_as::<_, Position>(
            r#"
            SELECT id, mission_id, device_id, name, lat, lon, altitude, speed, battery, accuracy,
                   source, timestamp, data_origin
            FROM positions
            WHERE id = ?
            "#,
        )
        .bind(&position_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load position {position_id}: {error}"))?
        .ok_or_else(|| format!("Position not found: {position_id}"))
    }

    pub async fn list_positions(
        &self,
        mission_id: String,
        device_id: Option<String>,
    ) -> Result<Vec<Position>, String> {
        if let Some(device_id) = device_id {
            return sqlx::query_as::<_, Position>(
                r#"
                SELECT id, mission_id, device_id, name, lat, lon, altitude, speed, battery, accuracy,
                       source, timestamp, data_origin
                FROM positions
                WHERE mission_id = ? AND device_id = ?
                ORDER BY timestamp ASC
                "#,
            )
            .bind(mission_id)
            .bind(device_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|error| format!("Failed to list positions: {error}"));
        }

        sqlx::query_as::<_, Position>(
            r#"
            SELECT id, mission_id, device_id, name, lat, lon, altitude, speed, battery, accuracy,
                   source, timestamp, data_origin
            FROM positions
            WHERE mission_id = ?
            ORDER BY timestamp ASC
            "#,
        )
        .bind(mission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list positions: {error}"))
    }

    pub async fn latest_positions(&self, mission_id: String) -> Result<Vec<Position>, String> {
        sqlx::query_as::<_, Position>(
            r#"
            SELECT p.id, p.mission_id, p.device_id, p.name, p.lat, p.lon, p.altitude, p.speed,
                   p.battery, p.accuracy, p.source, p.timestamp, p.data_origin
            FROM positions p
            INNER JOIN (
              SELECT device_id, MAX(timestamp) AS max_timestamp
              FROM positions
              WHERE mission_id = ?
              GROUP BY device_id
            ) latest
              ON p.device_id = latest.device_id AND p.timestamp = latest.max_timestamp
            WHERE p.mission_id = ?
            ORDER BY p.device_id ASC
            "#,
        )
        .bind(&mission_id)
        .bind(&mission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to load latest positions: {error}"))
    }

    pub async fn get_mission(&self, mission_id: String) -> Result<Mission, String> {
        sqlx::query_as::<_, Mission>(
            r#"
            SELECT id, name, status, start_time, pause_time, finish_time,
                   paused_seconds, notes, schema_version
            FROM missions
            WHERE id = ?
            "#,
        )
        .bind(mission_id.clone())
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load mission {mission_id}: {error}"))?
        .ok_or_else(|| format!("Mission not found: {mission_id}"))
    }

    pub async fn list_missions(&self) -> Result<Vec<Mission>, String> {
        sqlx::query_as::<_, Mission>(
            r#"
            SELECT id, name, status, start_time, pause_time, finish_time,
                   paused_seconds, notes, schema_version
            FROM missions
            ORDER BY start_time DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list missions: {error}"))
    }

    pub async fn get_active_mission(&self) -> Result<Option<Mission>, String> {
        sqlx::query_as::<_, Mission>(
            r#"
            SELECT id, name, status, start_time, pause_time, finish_time,
                   paused_seconds, notes, schema_version
            FROM missions
            WHERE status IN ('active', 'paused')
            ORDER BY start_time DESC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load active mission: {error}"))
    }

    pub async fn get_recoverable_mission(&self) -> Result<Option<Mission>, String> {
        sqlx::query_as::<_, Mission>(
            r#"
            SELECT id, name, status, start_time, pause_time, finish_time,
                   paused_seconds, notes, schema_version
            FROM missions
            WHERE status = 'paused'
            ORDER BY start_time DESC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load recoverable mission: {error}"))
    }

    pub async fn pause_mission(&self, mission_id: String) -> Result<Mission, String> {
        let mission = self.get_mission(mission_id.clone()).await?;
        if mission.status != MissionStatus::Active {
            return Err(format!(
                "Cannot pause mission with status '{:?}'.",
                mission.status
            ));
        }

        let now = Utc::now().to_rfc3339();
        self.update_mission_status(&mission_id, MissionStatus::Paused, Some(now), None)
            .await?;

        self.get_mission(mission_id).await
    }

    pub async fn resume_mission(&self, mission_id: String) -> Result<Mission, String> {
        let mission = self.get_mission(mission_id.clone()).await?;
        if mission.status != MissionStatus::Paused {
            return Err(format!(
                "Cannot resume mission with status '{:?}'.",
                mission.status
            ));
        }

        self.update_mission_status(&mission_id, MissionStatus::Active, None, None)
            .await?;

        self.get_mission(mission_id).await
    }

    pub async fn finish_mission(&self, mission_id: String) -> Result<Mission, String> {
        let mission = self.get_mission(mission_id.clone()).await?;
        if mission.status == MissionStatus::Finished || mission.status == MissionStatus::Finalized {
            return Err("Mission is already finished.".to_string());
        }

        let now = Utc::now().to_rfc3339();
        self.update_mission_status(&mission_id, MissionStatus::Finished, None, Some(now))
            .await?;

        self.get_mission(mission_id).await
    }

    async fn update_mission_status(
        &self,
        mission_id: &str,
        next_status: MissionStatus,
        pause_time: Option<String>,
        finish_time: Option<String>,
    ) -> Result<(), String> {
        let event_type = match next_status {
            MissionStatus::Active => "mission_resumed",
            MissionStatus::Paused => "mission_paused",
            MissionStatus::Finished => "mission_finished",
            MissionStatus::Idle | MissionStatus::Finalized => {
                return Err("Unsupported mission status transition.".to_string())
            }
        };

        let timestamp = pause_time.clone().or(finish_time.clone()).unwrap_or_else(|| Utc::now().to_rfc3339());
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start mission update transaction: {error}"))?;

        sqlx::query(
            r#"
            UPDATE missions
            SET status = ?, pause_time = ?, finish_time = ?
            WHERE id = ?
            "#,
        )
        .bind(next_status)
        .bind(pause_time)
        .bind(finish_time)
        .bind(mission_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to update mission status: {error}"))?;

        sqlx::query(
            r#"
            INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
            VALUES (?, ?, ?, ?, NULL)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(mission_id)
        .bind(event_type)
        .bind(timestamp)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to append mission event: {error}"))?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit mission update: {error}"))?;

        Ok(())
    }
}

pub async fn build_mission_store<R: Runtime>(app: &AppHandle<R>) -> Result<MissionStore, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve app config directory: {error}"))?;

    let database_path = config_dir.join(DATABASE_FILE_NAME);
    let backup_path = config_dir.join(BACKUP_FILE_NAME);

    MissionStore::connect(database_path, backup_path).await
}

#[tauri::command]
pub async fn mission_store_info(
    store: State<'_, MissionStoreState>,
) -> Result<MissionStoreInfo, String> {
    store.0.info().await
}

#[tauri::command]
pub async fn sync_mission_store_backup(
    store: State<'_, MissionStoreState>,
) -> Result<String, String> {
    store.0.sync_backup().await
}

#[tauri::command]
pub async fn create_mission(
    input: CreateMissionInput,
    store: State<'_, MissionStoreState>,
) -> Result<Mission, String> {
    store.0.create_mission(input).await
}

#[tauri::command]
pub async fn upsert_device(
    input: UpsertDeviceInput,
    store: State<'_, MissionStoreState>,
) -> Result<Device, String> {
    store.0.upsert_device(input).await
}

#[tauri::command]
pub async fn get_device(
    mission_id: String,
    device_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Device, String> {
    store.0.get_device(mission_id, device_id).await
}

#[tauri::command]
pub async fn list_devices(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Vec<Device>, String> {
    store.0.list_devices(mission_id).await
}

#[tauri::command]
pub async fn add_position(
    input: AddPositionInput,
    store: State<'_, MissionStoreState>,
) -> Result<Position, String> {
    store.0.add_position(input).await
}

#[tauri::command]
pub async fn list_positions(
    mission_id: String,
    device_id: Option<String>,
    store: State<'_, MissionStoreState>,
) -> Result<Vec<Position>, String> {
    store.0.list_positions(mission_id, device_id).await
}

#[tauri::command]
pub async fn latest_positions(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Vec<Position>, String> {
    store.0.latest_positions(mission_id).await
}

#[tauri::command]
pub async fn get_mission(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Mission, String> {
    store.0.get_mission(mission_id).await
}

#[tauri::command]
pub async fn list_missions(store: State<'_, MissionStoreState>) -> Result<Vec<Mission>, String> {
    store.0.list_missions().await
}

#[tauri::command]
pub async fn get_active_mission(
    store: State<'_, MissionStoreState>,
) -> Result<Option<Mission>, String> {
    store.0.get_active_mission().await
}

#[tauri::command]
pub async fn get_recoverable_mission(
    store: State<'_, MissionStoreState>,
) -> Result<Option<Mission>, String> {
    store.0.get_recoverable_mission().await
}

#[tauri::command]
pub async fn pause_mission(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Mission, String> {
    store.0.pause_mission(mission_id).await
}

#[tauri::command]
pub async fn resume_mission(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Mission, String> {
    store.0.resume_mission(mission_id).await
}

#[tauri::command]
pub async fn finish_mission(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Mission, String> {
    store.0.finish_mission(mission_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(name: &str) -> (PathBuf, PathBuf) {
        let unique = Uuid::new_v4().to_string();
        let base = std::env::temp_dir().join(format!("sartracker-{name}-{unique}"));
        let database_path = base.join("mission-store.sqlite");
        let backup_path = base.join("mission-store.backup.sqlite");
        (database_path, backup_path)
    }

    #[tokio::test]
    async fn initializes_schema_and_pragmas() {
        let (database_path, backup_path) = temp_paths("init");
        let store = MissionStore::connect(database_path.clone(), backup_path.clone())
            .await
            .expect("store should initialize");

        let schema_version = store.schema_version().await.expect("schema version");
        assert_eq!(schema_version, CURRENT_SCHEMA_VERSION);
        assert!(database_path.exists());
        assert_eq!(store.info().await.expect("store info").backup_path, backup_path.to_string_lossy());
    }

    #[tokio::test]
    async fn creates_and_lists_active_mission() {
        let (database_path, backup_path) = temp_paths("create");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Test Mission".to_string(),
                notes: Some("First mission".to_string()),
            })
            .await
            .expect("mission should be created");

        assert_eq!(mission.status, MissionStatus::Active);
        assert_eq!(store.get_active_mission().await.expect("active mission"), Some(mission.clone()));
        assert_eq!(store.list_missions().await.expect("missions").len(), 1);
    }

    #[tokio::test]
    async fn writes_atomic_backup_copy() {
        let (database_path, backup_path) = temp_paths("backup");
        let store = MissionStore::connect(database_path, backup_path.clone())
            .await
            .expect("store should initialize");

        store
            .create_mission(CreateMissionInput {
                name: "Backup Mission".to_string(),
                notes: None,
            })
            .await
            .expect("mission should be created");

        let backup_file = store.sync_backup().await.expect("backup should succeed");
        assert_eq!(backup_file, backup_path.to_string_lossy());
        assert!(backup_path.exists());
        assert!(std::fs::metadata(&backup_path).expect("backup metadata").len() > 0);
    }

    #[tokio::test]
    async fn enforces_single_active_mission_and_lifecycle_transitions() {
        let (database_path, backup_path) = temp_paths("lifecycle");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Mission A".to_string(),
                notes: None,
            })
            .await
            .expect("mission should be created");

        let create_second_result = store
            .create_mission(CreateMissionInput {
                name: "Mission B".to_string(),
                notes: None,
            })
            .await;
        assert!(create_second_result.is_err());

        let paused = store
            .pause_mission(mission.id.clone())
            .await
            .expect("pause should succeed");
        assert_eq!(paused.status, MissionStatus::Paused);
        assert!(paused.pause_time.is_some());
        assert_eq!(
            store
                .get_recoverable_mission()
                .await
                .expect("recoverable mission"),
            Some(paused.clone())
        );

        let resumed = store
            .resume_mission(mission.id.clone())
            .await
            .expect("resume should succeed");
        assert_eq!(resumed.status, MissionStatus::Active);
        assert!(resumed.pause_time.is_none());

        let finished = store
            .finish_mission(mission.id.clone())
            .await
            .expect("finish should succeed");
        assert_eq!(finished.status, MissionStatus::Finished);
        assert!(finished.finish_time.is_some());

        let next = store
            .create_mission(CreateMissionInput {
                name: "Mission B".to_string(),
                notes: None,
            })
            .await
            .expect("new mission should be allowed after finish");
        assert_eq!(next.status, MissionStatus::Active);
    }

    #[tokio::test]
    async fn upserts_devices_and_records_latest_position() {
        let (database_path, backup_path) = temp_paths("tracking");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Tracking Mission".to_string(),
                notes: None,
            })
            .await
            .expect("mission should be created");

        let device = store
            .upsert_device(UpsertDeviceInput {
                mission_id: mission.id.clone(),
                device_id: "tracker-1".to_string(),
                name: "Rescuer One".to_string(),
                color: "#00AAFF".to_string(),
                status: DeviceStatus::Unknown,
                last_seen: None,
            })
            .await
            .expect("device should upsert");

        assert_eq!(device.status, DeviceStatus::Unknown);

        let position = store
            .add_position(AddPositionInput {
                mission_id: mission.id.clone(),
                device_id: "tracker-1".to_string(),
                name: Some("Rescuer One".to_string()),
                lat: 52.0599,
                lon: -9.5045,
                altitude: Some(15.0),
                speed: Some(1.4),
                battery: Some(88.0),
                accuracy: Some(4.0),
                source: Some("traccar".to_string()),
                timestamp: Some("2026-04-08T06:00:00Z".to_string()),
                data_origin: Some("live".to_string()),
            })
            .await
            .expect("position should insert");

        assert_eq!(position.device_id, "tracker-1");

        let devices = store
            .list_devices(mission.id.clone())
            .await
            .expect("devices should list");
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].status, DeviceStatus::Online);
        assert_eq!(devices[0].last_seen.as_deref(), Some("2026-04-08T06:00:00Z"));

        let latest_positions = store
            .latest_positions(mission.id.clone())
            .await
            .expect("latest positions should list");
        assert_eq!(latest_positions.len(), 1);
        assert_eq!(latest_positions[0].timestamp, "2026-04-08T06:00:00Z");
    }

    #[tokio::test]
    async fn rejects_invalid_position_coordinates() {
        let (database_path, backup_path) = temp_paths("invalid-position");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Validation Mission".to_string(),
                notes: None,
            })
            .await
            .expect("mission should be created");

        store
            .upsert_device(UpsertDeviceInput {
                mission_id: mission.id.clone(),
                device_id: "tracker-2".to_string(),
                name: "Rescuer Two".to_string(),
                color: "#FF8800".to_string(),
                status: DeviceStatus::Unknown,
                last_seen: None,
            })
            .await
            .expect("device should upsert");

        let invalid_position = store
            .add_position(AddPositionInput {
                mission_id: mission.id,
                device_id: "tracker-2".to_string(),
                name: None,
                lat: 120.0,
                lon: -9.0,
                altitude: None,
                speed: None,
                battery: None,
                accuracy: None,
                source: None,
                timestamp: None,
                data_origin: None,
            })
            .await;

        assert!(invalid_position.is_err());
    }
}
