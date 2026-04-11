use std::{
    fs,
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use chrono::Utc;
#[cfg(test)]
use chrono::Duration;
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    ConnectOptions, Executor, FromRow, Row, Sqlite, SqlitePool,
};
use tauri::{AppHandle, Manager, Runtime, State};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};
use crate::settings::SettingsStoreState;

const DATABASE_FILE_NAME: &str = "mission-store.sqlite";
const BACKUP_FILE_NAME: &str = "mission-store.backup.sqlite";
const ARCHIVE_DIRECTORY_NAME: &str = "archives";
const ATTACHMENTS_DIRECTORY_NAME: &str = "attachments";
const DEFAULT_MISSION_STORAGE_DIRECTORY_NAME: &str = "missions";
const CURRENT_SCHEMA_VERSION: i64 = 3;

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

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum MarkerType {
    IppLkp,
    Clue,
    Hazard,
    Casualty,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
pub struct Marker {
    pub id: String,
    pub mission_id: String,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub marker_type: MarkerType,
    pub name: String,
    pub description: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub irish_grid_e: i64,
    pub irish_grid_n: i64,
    pub created_at: String,
    pub updated_at: String,
    pub display_order: i64,
    pub subject_category: Option<String>,
    pub clue_type: Option<String>,
    pub confidence: Option<f64>,
    pub found_by: Option<String>,
    pub hazard_type: Option<String>,
    pub severity: Option<String>,
    pub condition: Option<String>,
    pub treatment: Option<String>,
    pub evacuation_priority: Option<String>,
    pub updated_by: Option<String>,
    pub coordinator_ids: Option<String>,
    pub attachment_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum DrawingType {
    Line,
    SearchArea,
    RangeRing,
    BearingLine,
    SearchSector,
    TextLabel,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq)]
pub struct Drawing {
    pub id: String,
    pub mission_id: String,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub drawing_type: DrawingType,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub width: Option<f64>,
    pub distance_m: Option<f64>,
    pub temporary_measure: Option<bool>,
    pub label: Option<String>,
    pub display_order: i64,
    pub geometry_json: String,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "TEXT", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum LayerCatalogNodeKind {
    Group,
    Layer,
    FeatureItem,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
pub struct LayerCatalogEntry {
    pub mission_id: String,
    pub node_id: String,
    pub parent_node_id: Option<String>,
    pub node_kind: LayerCatalogNodeKind,
    pub alias: Option<String>,
    pub is_favorite: bool,
    pub is_visible: bool,
    pub display_order: i64,
    pub metadata_json: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionStoreInfo {
    pub schema_version: i64,
    pub database_path: String,
    pub backup_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MissionArchiveInfo {
    pub mission_id: String,
    pub archive_path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FinalizeMissionResult {
    pub mission: Mission,
    pub archive: MissionArchiveInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnlockFinalizedMissionInput {
    pub mission_id: String,
    pub admin_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, PartialEq, Eq)]
pub struct MissionEvent {
    pub id: String,
    pub mission_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub details_json: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMissionInput {
    pub name: String,
    pub start_time: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertMarkerInput {
    pub id: Option<String>,
    pub mission_id: String,
    pub r#type: MarkerType,
    pub name: String,
    pub description: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub irish_grid_e: i64,
    pub irish_grid_n: i64,
    pub display_order: i64,
    pub subject_category: Option<String>,
    pub clue_type: Option<String>,
    pub confidence: Option<f64>,
    pub found_by: Option<String>,
    pub hazard_type: Option<String>,
    pub severity: Option<String>,
    pub condition: Option<String>,
    pub treatment: Option<String>,
    pub evacuation_priority: Option<String>,
    pub updated_by: Option<String>,
    pub coordinator_ids: Option<String>,
    pub attachment_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestMarkerAttachmentInput {
    pub mission_id: String,
    pub file_name: String,
    pub bytes_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertDrawingInput {
    pub id: Option<String>,
    pub mission_id: String,
    pub r#type: DrawingType,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub width: Option<f64>,
    pub distance_m: Option<f64>,
    pub temporary_measure: Option<bool>,
    pub label: Option<String>,
    pub display_order: i64,
    pub geometry_json: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertLayerCatalogEntryInput {
    pub mission_id: String,
    pub node_id: String,
    pub parent_node_id: Option<String>,
    pub node_kind: LayerCatalogNodeKind,
    pub alias: Option<String>,
    pub is_favorite: Option<bool>,
    pub is_visible: Option<bool>,
    pub display_order: Option<i64>,
    pub metadata_json: Option<String>,
}

impl MissionStore {
    async fn insert_event<'a, E>(
        executor: E,
        mission_id: &str,
        event_type: &str,
        timestamp: &str,
        details_json: Option<&serde_json::Value>,
    ) -> Result<(), String>
    where
        E: Executor<'a, Database = Sqlite>,
    {
        let details = details_json
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| format!("Failed to serialize mission event details: {error}"))?;

        sqlx::query(
            r#"
            INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(mission_id)
        .bind(event_type)
        .bind(timestamp)
        .bind(details)
        .execute(executor)
        .await
        .map_err(|error| format!("Failed to append mission event: {error}"))?;

        Ok(())
    }

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

            CREATE TABLE IF NOT EXISTS markers (
              id TEXT PRIMARY KEY,
              mission_id TEXT NOT NULL,
              type TEXT NOT NULL CHECK(type IN ('ipp_lkp', 'clue', 'hazard', 'casualty')),
              name TEXT NOT NULL,
              description TEXT,
              lat REAL NOT NULL,
              lon REAL NOT NULL,
              irish_grid_e INTEGER NOT NULL,
              irish_grid_n INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              display_order INTEGER NOT NULL DEFAULT 0,
              subject_category TEXT,
              clue_type TEXT,
              confidence REAL,
              found_by TEXT,
              hazard_type TEXT,
              severity TEXT,
              condition TEXT,
              treatment TEXT,
              evacuation_priority TEXT,
              updated_by TEXT,
              coordinator_ids TEXT,
              attachment_path TEXT,
              FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_markers_mission_display_order
              ON markers(mission_id, display_order);

            CREATE TABLE IF NOT EXISTS drawings (
              id TEXT PRIMARY KEY,
              mission_id TEXT NOT NULL,
              type TEXT NOT NULL CHECK(type IN ('line', 'search_area', 'range_ring', 'bearing_line', 'search_sector', 'text_label')),
              name TEXT NOT NULL,
              description TEXT,
              color TEXT,
              width REAL,
              distance_m REAL,
              temporary_measure INTEGER,
              label TEXT,
              display_order INTEGER NOT NULL DEFAULT 0,
              geometry_json TEXT NOT NULL,
              metadata_json TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_drawings_mission_display_order
              ON drawings(mission_id, display_order);

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

            CREATE TABLE IF NOT EXISTS layer_catalog_entries (
              mission_id TEXT NOT NULL,
              node_id TEXT NOT NULL,
              parent_node_id TEXT,
              node_kind TEXT NOT NULL CHECK(node_kind IN ('group', 'layer', 'feature_item')),
              alias TEXT,
              is_favorite INTEGER NOT NULL DEFAULT 0,
              is_visible INTEGER NOT NULL DEFAULT 1,
              display_order INTEGER NOT NULL DEFAULT 0,
              metadata_json TEXT,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (mission_id, node_id),
              FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_layer_catalog_entries_mission_parent_order
              ON layer_catalog_entries(mission_id, parent_node_id, display_order);
            "#,
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to apply mission store schema: {error}"))?;

        Self::ensure_column_exists(&mut *tx, "markers", "updated_by", "TEXT").await?;
        Self::ensure_column_exists(&mut *tx, "markers", "coordinator_ids", "TEXT").await?;
        Self::ensure_column_exists(&mut *tx, "markers", "attachment_path", "TEXT").await?;

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

    async fn ensure_column_exists(
        executor: &mut sqlx::SqliteConnection,
        table_name: &str,
        column_name: &str,
        column_sql: &str,
    ) -> Result<(), String> {
        let pragma = format!("PRAGMA table_info({table_name})");
        let rows = sqlx::query(&pragma)
            .fetch_all(&mut *executor)
            .await
            .map_err(|error| format!("Failed to inspect {table_name} columns: {error}"))?;

        if rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>("name").ok())
            .any(|existing| existing == column_name)
        {
            return Ok(());
        }

        let alter = format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}");
        sqlx::query(&alter)
            .execute(&mut *executor)
            .await
            .map_err(|error| format!("Failed to add {table_name}.{column_name}: {error}"))?;

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

        if let Some(active_mission) = self.get_active_mission().await? {
            self.append_event(
                &active_mission.id,
                "mission_backup_synced",
                serde_json::json!({
                    "backup_path": self.backup_path.to_string_lossy(),
                }),
            )
            .await?;
        }

        Ok(self.backup_path.to_string_lossy().to_string())
    }

    pub async fn create_mission_archive(
        &self,
        mission_id: String,
    ) -> Result<MissionArchiveInfo, String> {
        self.create_mission_archive_internal(&mission_id, true).await
    }

    async fn create_mission_archive_internal(
        &self,
        mission_id: &str,
        record_archive_event: bool,
    ) -> Result<MissionArchiveInfo, String> {
        let mission = self.get_mission(mission_id.to_string()).await?;
        if mission.status != MissionStatus::Finished && mission.status != MissionStatus::Finalized {
          return Err("Only finished or finalized missions can be archived.".to_string());
        }

        let backup_path = self.sync_backup().await?;
        let created_at = Utc::now().to_rfc3339();
        let archive_dir = self
            .database_path
            .parent()
            .ok_or_else(|| "Mission store config directory is unavailable.".to_string())?
            .join(ARCHIVE_DIRECTORY_NAME);
        std::fs::create_dir_all(&archive_dir)
            .map_err(|error| format!("Failed to create archive directory: {error}"))?;

        let archive_name = format!("{}-{}.zip", mission_id, created_at.replace(':', "-"));
        let temporary_archive_path = archive_dir.join(format!("{archive_name}.tmp"));
        let final_archive_path = archive_dir.join(archive_name);

        let mut zip_writer = ZipWriter::new(
            File::create(&temporary_archive_path)
                .map_err(|error| format!("Failed to create temporary mission archive: {error}"))?,
        );
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated);

        let manifest_json = serde_json::to_vec_pretty(&serde_json::json!({
            "archive_version": 1,
            "created_at": created_at,
            "mission_id": mission_id,
            "schema_version": CURRENT_SCHEMA_VERSION,
            "snapshot_format": "sqlite",
        }))
        .map_err(|error| format!("Failed to serialize mission archive manifest: {error}"))?;

        let mission_json = serde_json::to_vec_pretty(&mission)
            .map_err(|error| format!("Failed to serialize mission archive payload: {error}"))?;

        zip_writer
            .start_file("manifest.json", options)
            .map_err(|error| format!("Failed to start manifest entry: {error}"))?;
        zip_writer
            .write_all(&manifest_json)
            .map_err(|error| format!("Failed to write manifest entry: {error}"))?;

        zip_writer
            .start_file("mission.json", options)
            .map_err(|error| format!("Failed to start mission entry: {error}"))?;
        zip_writer
            .write_all(&mission_json)
            .map_err(|error| format!("Failed to write mission entry: {error}"))?;

        let snapshot_path = PathBuf::from(&backup_path);
        let snapshot_bytes = std::fs::read(&snapshot_path)
            .map_err(|error| format!("Failed to read mission store backup for archive: {error}"))?;
        zip_writer
            .start_file("mission-store.sqlite", options)
            .map_err(|error| format!("Failed to start snapshot entry: {error}"))?;
        zip_writer
            .write_all(&snapshot_bytes)
            .map_err(|error| format!("Failed to write snapshot entry: {error}"))?;

        for attachment_path in self.list_marker_attachment_paths(mission_id).await? {
            let attachment_file_path = PathBuf::from(&attachment_path);
            if !attachment_file_path.exists() {
                return Err(format!(
                    "Mission archive cannot be created because marker attachment is missing: {}",
                    attachment_file_path.to_string_lossy()
                ));
            }

            let attachment_name = attachment_file_path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| "Attachment file name is invalid.".to_string())?;
            let attachment_bytes = fs::read(&attachment_file_path)
                .map_err(|error| format!("Failed to read marker attachment for archive: {error}"))?;

            zip_writer
                .start_file(
                    format!("{ATTACHMENTS_DIRECTORY_NAME}/{attachment_name}"),
                    options,
                )
                .map_err(|error| format!("Failed to start attachment archive entry: {error}"))?;
            zip_writer
                .write_all(&attachment_bytes)
                .map_err(|error| format!("Failed to write attachment archive entry: {error}"))?;
        }

        zip_writer
            .finish()
            .map_err(|error| format!("Failed to finalize mission archive: {error}"))?;

        Self::validate_archive_file(&temporary_archive_path, mission_id)?;

        std::fs::rename(&temporary_archive_path, &final_archive_path)
            .map_err(|error| format!("Failed to finalize mission archive file: {error}"))?;

        if record_archive_event {
            self.append_event(
                mission_id,
                "mission_archived",
                serde_json::json!({ "archive_path": final_archive_path.to_string_lossy() }),
            )
            .await?;
        }

        Ok(MissionArchiveInfo {
            mission_id: mission_id.to_string(),
            archive_path: final_archive_path.to_string_lossy().to_string(),
            created_at,
        })
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
        let start_time = validate_optional_timestamp(input.start_time.as_deref(), "mission start_time")?
            .unwrap_or_else(|| Utc::now().to_rfc3339());

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
        .bind(&start_time)
        .bind(&input.notes)
        .bind(CURRENT_SCHEMA_VERSION)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to create mission: {error}"))?;

        let details_json = serde_json::json!({
            "name": input.name,
            "notes": input.notes,
            "start_time": start_time,
        });
        Self::insert_event(
            &mut *tx,
            &mission_id,
            "mission_created",
            &start_time,
            Some(&details_json),
        )
        .await?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit mission creation: {error}"))?;

        self.get_mission(mission_id).await
    }

    pub async fn upsert_device(&self, input: UpsertDeviceInput) -> Result<Device, String> {
        self.ensure_mission_mutable(&input.mission_id).await?;
        let existing_device = self
            .get_device(input.mission_id.clone(), input.device_id.clone())
            .await
            .ok();
        let event_type = if existing_device.is_some() {
            "device_updated"
        } else {
            "device_created"
        };
        let event_timestamp = input
            .last_seen
            .clone()
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        let device_row_id = Uuid::new_v4().to_string();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start device upsert transaction: {error}"))?;

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
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to upsert device {}: {error}", input.device_id))?;

        let event_details = serde_json::json!({
            "device_id": input.device_id,
            "name": input.name,
            "status": input.status,
            "color": input.color,
        });
        Self::insert_event(
            &mut *tx,
            &input.mission_id,
            event_type,
            &event_timestamp,
            Some(&event_details),
        )
        .await?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit device upsert: {error}"))?;

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
        self.ensure_mission_mutable(&input.mission_id).await?;
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

        let event_details = serde_json::json!({
            "position_id": position_id,
            "device_id": input.device_id,
            "timestamp": timestamp,
            "data_origin": data_origin,
            "source": input.source,
        });
        Self::insert_event(
            &mut *tx,
            &input.mission_id,
            "position_recorded",
            event_details["timestamp"].as_str().unwrap_or_default(),
            Some(&event_details),
        )
        .await?;

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

    pub async fn upsert_marker(&self, input: UpsertMarkerInput) -> Result<Marker, String> {
        self.ensure_mission_mutable(&input.mission_id).await?;

        if !input.lat.is_finite() || input.lat < -90.0 || input.lat > 90.0 {
            return Err("Marker latitude must be a finite value between -90 and 90.".to_string());
        }
        if !input.lon.is_finite() || input.lon < -180.0 || input.lon > 180.0 {
            return Err("Marker longitude must be a finite value between -180 and 180.".to_string());
        }

        let marker_id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let existing_marker = self
            .get_marker(marker_id.clone())
            .await
            .ok();
        let created_at = existing_marker
            .as_ref()
            .map(|existing| existing.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let event_type = if existing_marker.is_some() {
            "marker_updated"
        } else {
            "marker_created"
        };

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start marker upsert transaction: {error}"))?;

        sqlx::query(
            r#"
            INSERT INTO markers (
              id, mission_id, type, name, description, lat, lon, irish_grid_e, irish_grid_n,
              created_at, updated_at, display_order, subject_category, clue_type, confidence,
              found_by, hazard_type, severity, condition, treatment, evacuation_priority,
              updated_by, coordinator_ids, attachment_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              mission_id = excluded.mission_id,
              type = excluded.type,
              name = excluded.name,
              description = excluded.description,
              lat = excluded.lat,
              lon = excluded.lon,
              irish_grid_e = excluded.irish_grid_e,
              irish_grid_n = excluded.irish_grid_n,
              updated_at = excluded.updated_at,
              display_order = excluded.display_order,
              subject_category = excluded.subject_category,
              clue_type = excluded.clue_type,
              confidence = excluded.confidence,
              found_by = excluded.found_by,
              hazard_type = excluded.hazard_type,
              severity = excluded.severity,
              condition = excluded.condition,
              treatment = excluded.treatment,
              evacuation_priority = excluded.evacuation_priority,
              updated_by = excluded.updated_by,
              coordinator_ids = excluded.coordinator_ids,
              attachment_path = excluded.attachment_path
            "#,
        )
        .bind(&marker_id)
        .bind(&input.mission_id)
        .bind(&input.r#type)
        .bind(&input.name)
        .bind(&input.description)
        .bind(input.lat)
        .bind(input.lon)
        .bind(input.irish_grid_e)
        .bind(input.irish_grid_n)
        .bind(&created_at)
        .bind(&now)
        .bind(input.display_order)
        .bind(&input.subject_category)
        .bind(&input.clue_type)
        .bind(input.confidence)
        .bind(&input.found_by)
        .bind(&input.hazard_type)
        .bind(&input.severity)
        .bind(&input.condition)
        .bind(&input.treatment)
        .bind(&input.evacuation_priority)
        .bind(&input.updated_by)
        .bind(&input.coordinator_ids)
        .bind(&input.attachment_path)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to upsert marker {marker_id}: {error}"))?;

        let event_details = serde_json::json!({
            "marker_id": marker_id,
            "marker_type": input.r#type,
            "name": input.name,
            "display_order": input.display_order,
            "updated_by": input.updated_by,
            "coordinator_ids": input.coordinator_ids,
            "attachment_path": input.attachment_path,
        });
        Self::insert_event(
            &mut *tx,
            &input.mission_id,
            event_type,
            &now,
            Some(&event_details),
        )
        .await?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit marker upsert: {error}"))?;

        if let Some(existing_attachment_path) = existing_marker
            .as_ref()
            .and_then(|marker| marker.attachment_path.as_deref())
        {
            if Some(existing_attachment_path) != input.attachment_path.as_deref() {
                self.remove_managed_marker_attachment(&input.mission_id, existing_attachment_path);
            }
        }

        self.get_marker(marker_id).await
    }

    pub async fn get_marker(&self, marker_id: String) -> Result<Marker, String> {
        sqlx::query_as::<_, Marker>(
            r#"
            SELECT id, mission_id, type, name, description, lat, lon,
                   irish_grid_e, irish_grid_n, created_at, updated_at, display_order,
                   subject_category, clue_type, confidence, found_by, hazard_type, severity,
                   condition, treatment, evacuation_priority, updated_by, coordinator_ids, attachment_path
            FROM markers
            WHERE id = ?
            "#,
        )
        .bind(&marker_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load marker {marker_id}: {error}"))?
        .ok_or_else(|| format!("Marker not found: {marker_id}"))
    }

    pub async fn list_markers(&self, mission_id: String) -> Result<Vec<Marker>, String> {
        sqlx::query_as::<_, Marker>(
            r#"
            SELECT id, mission_id, type, name, description, lat, lon,
                   irish_grid_e, irish_grid_n, created_at, updated_at, display_order,
                   subject_category, clue_type, confidence, found_by, hazard_type, severity,
                   condition, treatment, evacuation_priority, updated_by, coordinator_ids, attachment_path
            FROM markers
            WHERE mission_id = ?
            ORDER BY display_order ASC, created_at ASC
            "#,
        )
        .bind(mission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list markers: {error}"))
    }

    pub async fn ingest_marker_attachment(
        &self,
        input: IngestMarkerAttachmentInput,
        settings: &SettingsStoreState,
    ) -> Result<String, String> {
        self.ensure_mission_mutable(&input.mission_id).await?;
        self.get_mission(input.mission_id.clone()).await?;

        let file_name = sanitize_attachment_file_name(&input.file_name)?;
        let bytes = BASE64_STANDARD
            .decode(input.bytes_base64.as_bytes())
            .map_err(|error| format!("Attachment payload is not valid base64: {error}"))?;

        if bytes.is_empty() {
            return Err("Attachment file is empty.".to_string());
        }

        if bytes.len() > 25 * 1024 * 1024 {
            return Err("Attachment must be 25 MB or smaller.".to_string());
        }

        let primary_path =
            self.resolve_attachment_destination(&input.mission_id, &file_name, settings, false)?;
        write_bytes_atomically(&primary_path, &bytes)?;

        if let Some(backup_path) =
            self.resolve_attachment_destination_optional(&input.mission_id, &file_name, settings, true)?
        {
            write_bytes_atomically(&backup_path, &bytes)?;
        }

        Ok(primary_path.to_string_lossy().to_string())
    }

    pub async fn delete_marker(&self, marker_id: String) -> Result<bool, String> {
        let existing_marker = self.get_marker(marker_id.clone()).await.ok();
        let Some(marker) = existing_marker else {
            return Ok(false);
        };
        self.ensure_mission_mutable(&marker.mission_id).await?;

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start marker delete transaction: {error}"))?;

        let result = sqlx::query("DELETE FROM markers WHERE id = ?")
            .bind(&marker_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Failed to delete marker {marker_id}: {error}"))?;

        let event_details = serde_json::json!({
            "marker_id": marker.id,
            "marker_type": marker.marker_type,
            "name": marker.name,
        });
        Self::insert_event(
            &mut *tx,
            &marker.mission_id,
            "marker_deleted",
            &Utc::now().to_rfc3339(),
            Some(&event_details),
        )
        .await?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit marker delete: {error}"))?;

        if let Some(attachment_path) = marker.attachment_path.as_deref() {
            self.remove_managed_marker_attachment(&marker.mission_id, attachment_path);
        }

        Ok(result.rows_affected() > 0)
    }

    async fn list_marker_attachment_paths(&self, mission_id: &str) -> Result<Vec<String>, String> {
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT attachment_path
            FROM markers
            WHERE mission_id = ? AND attachment_path IS NOT NULL AND TRIM(attachment_path) != ''
            ORDER BY display_order ASC, created_at ASC
            "#,
        )
        .bind(mission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list marker attachment paths: {error}"))
    }

    fn resolve_attachment_destination(
        &self,
        mission_id: &str,
        file_name: &str,
        settings: &SettingsStoreState,
        backup: bool,
    ) -> Result<PathBuf, String> {
        self.resolve_attachment_destination_optional(mission_id, file_name, settings, backup)?
            .ok_or_else(|| "Attachment destination is unavailable.".to_string())
    }

    fn resolve_attachment_destination_optional(
        &self,
        mission_id: &str,
        file_name: &str,
        settings: &SettingsStoreState,
        backup: bool,
    ) -> Result<Option<PathBuf>, String> {
        let settings_view = settings.0.load_view()?;
        let configured_root = if backup {
            settings_view.mission_defaults.backup_mission_root
        } else {
            settings_view.mission_defaults.primary_mission_root
        };

        let root = if configured_root.trim().is_empty() {
            if backup {
                return Ok(None);
            }

            self.database_path
                .parent()
                .ok_or_else(|| "Mission store config directory is unavailable.".to_string())?
                .join(DEFAULT_MISSION_STORAGE_DIRECTORY_NAME)
        } else {
            PathBuf::from(configured_root)
        };

        Ok(Some(
            root.join(mission_id)
                .join(ATTACHMENTS_DIRECTORY_NAME)
                .join(format!("{}-{}", Uuid::new_v4(), file_name)),
        ))
    }

    fn remove_managed_marker_attachment(
        &self,
        mission_id: &str,
        attachment_path: &str,
    ) {
        let Some(path) = self.managed_marker_attachment_path(mission_id, attachment_path) else {
            return;
        };

        if let Err(error) = remove_file_if_exists(&path) {
            eprintln!(
                "Failed to remove superseded marker attachment {}: {}",
                path.to_string_lossy(),
                error
            );
        }
    }

    fn managed_marker_attachment_path(
        &self,
        mission_id: &str,
        attachment_path: &str,
    ) -> Option<PathBuf> {
        let path = PathBuf::from(attachment_path);
        let normalized_path = path.to_string_lossy().replace('\\', "/");
        let managed_segment = format!("/{mission_id}/{ATTACHMENTS_DIRECTORY_NAME}/");

        if normalized_path.contains(&managed_segment) {
            Some(path)
        } else {
            None
        }
    }

    pub async fn upsert_drawing(&self, input: UpsertDrawingInput) -> Result<Drawing, String> {
        self.ensure_mission_mutable(&input.mission_id).await?;

        let drawing_id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        let existing_drawing = self
            .get_drawing(drawing_id.clone())
            .await
            .ok();
        let created_at = existing_drawing
            .as_ref()
            .map(|existing| existing.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let event_type = if existing_drawing.is_some() {
            "drawing_updated"
        } else {
            "drawing_created"
        };

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start drawing upsert transaction: {error}"))?;

        sqlx::query(
            r#"
            INSERT INTO drawings (
              id, mission_id, type, name, description, color, width, distance_m, temporary_measure,
              label, display_order, geometry_json, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              mission_id = excluded.mission_id,
              type = excluded.type,
              name = excluded.name,
              description = excluded.description,
              color = excluded.color,
              width = excluded.width,
              distance_m = excluded.distance_m,
              temporary_measure = excluded.temporary_measure,
              label = excluded.label,
              display_order = excluded.display_order,
              geometry_json = excluded.geometry_json,
              metadata_json = excluded.metadata_json,
              updated_at = excluded.updated_at
            "#,
        )
        .bind(&drawing_id)
        .bind(&input.mission_id)
        .bind(&input.r#type)
        .bind(&input.name)
        .bind(&input.description)
        .bind(&input.color)
        .bind(input.width)
        .bind(input.distance_m)
        .bind(input.temporary_measure)
        .bind(&input.label)
        .bind(input.display_order)
        .bind(&input.geometry_json)
        .bind(&input.metadata_json)
        .bind(&created_at)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to upsert drawing {drawing_id}: {error}"))?;

        let event_details = serde_json::json!({
            "drawing_id": drawing_id,
            "drawing_type": input.r#type,
            "name": input.name,
            "display_order": input.display_order,
        });
        Self::insert_event(
            &mut *tx,
            &input.mission_id,
            event_type,
            &now,
            Some(&event_details),
        )
        .await?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit drawing upsert: {error}"))?;

        self.get_drawing(drawing_id).await
    }

    pub async fn get_drawing(&self, drawing_id: String) -> Result<Drawing, String> {
        sqlx::query_as::<_, Drawing>(
            r#"
            SELECT id, mission_id, type, name, description, color, width, distance_m, temporary_measure,
                   label, display_order, geometry_json, metadata_json, created_at, updated_at
            FROM drawings
            WHERE id = ?
            "#,
        )
        .bind(&drawing_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load drawing {drawing_id}: {error}"))?
        .ok_or_else(|| format!("Drawing not found: {drawing_id}"))
    }

    pub async fn list_drawings(&self, mission_id: String) -> Result<Vec<Drawing>, String> {
        sqlx::query_as::<_, Drawing>(
            r#"
            SELECT id, mission_id, type, name, description, color, width, distance_m, temporary_measure,
                   label, display_order, geometry_json, metadata_json, created_at, updated_at
            FROM drawings
            WHERE mission_id = ?
            ORDER BY display_order ASC, created_at ASC
            "#,
        )
        .bind(mission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list drawings: {error}"))
    }

    pub async fn delete_drawing(&self, drawing_id: String) -> Result<bool, String> {
        let existing_drawing = self.get_drawing(drawing_id.clone()).await.ok();
        let Some(drawing) = existing_drawing else {
            return Ok(false);
        };
        self.ensure_mission_mutable(&drawing.mission_id).await?;

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start drawing delete transaction: {error}"))?;

        let result = sqlx::query("DELETE FROM drawings WHERE id = ?")
            .bind(&drawing_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Failed to delete drawing {drawing_id}: {error}"))?;

        let event_details = serde_json::json!({
            "drawing_id": drawing.id,
            "drawing_type": drawing.drawing_type,
            "name": drawing.name,
        });
        Self::insert_event(
            &mut *tx,
            &drawing.mission_id,
            "drawing_deleted",
            &Utc::now().to_rfc3339(),
            Some(&event_details),
        )
        .await?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit drawing delete: {error}"))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn list_layer_catalog_entries(
        &self,
        mission_id: String,
    ) -> Result<Vec<LayerCatalogEntry>, String> {
        sqlx::query_as::<_, LayerCatalogEntry>(
            r#"
            SELECT mission_id, node_id, parent_node_id, node_kind, alias, is_favorite, is_visible,
                   display_order, metadata_json, updated_at
            FROM layer_catalog_entries
            WHERE mission_id = ?
            ORDER BY parent_node_id ASC, display_order ASC, node_id ASC
            "#,
        )
        .bind(mission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list layer catalog entries: {error}"))
    }

    pub async fn upsert_layer_catalog_entry(
        &self,
        input: UpsertLayerCatalogEntryInput,
    ) -> Result<LayerCatalogEntry, String> {
        self.ensure_mission_mutable(&input.mission_id).await?;

        let timestamp = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO layer_catalog_entries (
              mission_id, node_id, parent_node_id, node_kind, alias, is_favorite, is_visible,
              display_order, metadata_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(mission_id, node_id) DO UPDATE SET
              parent_node_id = excluded.parent_node_id,
              node_kind = excluded.node_kind,
              alias = excluded.alias,
              is_favorite = excluded.is_favorite,
              is_visible = excluded.is_visible,
              display_order = excluded.display_order,
              metadata_json = excluded.metadata_json,
              updated_at = excluded.updated_at
            "#,
        )
        .bind(&input.mission_id)
        .bind(&input.node_id)
        .bind(&input.parent_node_id)
        .bind(&input.node_kind)
        .bind(&input.alias)
        .bind(input.is_favorite.unwrap_or(false))
        .bind(input.is_visible.unwrap_or(true))
        .bind(input.display_order.unwrap_or(0))
        .bind(&input.metadata_json)
        .bind(&timestamp)
        .execute(&self.pool)
        .await
        .map_err(|error| format!("Failed to save layer catalog entry: {error}"))?;

        sqlx::query_as::<_, LayerCatalogEntry>(
            r#"
            SELECT mission_id, node_id, parent_node_id, node_kind, alias, is_favorite, is_visible,
                   display_order, metadata_json, updated_at
            FROM layer_catalog_entries
            WHERE mission_id = ? AND node_id = ?
            "#,
        )
        .bind(&input.mission_id)
        .bind(&input.node_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| format!("Failed to read saved layer catalog entry: {error}"))
    }

    pub async fn clear_layer_catalog_entries(&self, mission_id: String) -> Result<(), String> {
        self.ensure_mission_mutable(&mission_id).await?;
        self.get_mission(mission_id.clone()).await?;

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start layer catalog repair transaction: {error}"))?;

        sqlx::query("DELETE FROM layer_catalog_entries WHERE mission_id = ?")
            .bind(&mission_id)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("Failed to clear layer catalog entries: {error}"))?;

        Self::insert_event(
            &mut *tx,
            &mission_id,
            "layer_catalog_repaired",
            &Utc::now().to_rfc3339(),
            Some(&serde_json::json!({
                "action": "reset_metadata",
                "mission_id": mission_id,
            })),
        )
        .await?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit layer catalog repair: {error}"))?;

        Ok(())
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
            WHERE status IN ('active', 'paused')
            ORDER BY start_time DESC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| format!("Failed to load recoverable mission: {error}"))
    }

    pub async fn list_mission_events(&self, mission_id: String) -> Result<Vec<MissionEvent>, String> {
        sqlx::query_as::<_, MissionEvent>(
            r#"
            SELECT id, mission_id, event_type, timestamp, details_json
            FROM mission_events
            WHERE mission_id = ?
            ORDER BY timestamp ASC, id ASC
            "#,
        )
        .bind(mission_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| format!("Failed to list mission events: {error}"))
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

    pub async fn finalize_mission(
        &self,
        mission_id: String,
    ) -> Result<FinalizeMissionResult, String> {
        let mission = self.get_mission(mission_id.clone()).await?;
        if mission.status != MissionStatus::Finished {
            return Err("Only finished missions can be finalized.".to_string());
        }

        self.append_event(
            &mission_id,
            "mission_finalize_requested",
            serde_json::json!({
                "resulting_status": "finished",
            }),
        )
        .await?;

        let archive = match self
            .create_mission_archive_internal(&mission_id, false)
            .await
        {
            Ok(archive) => archive,
            Err(error) => {
                self.append_event(
                    &mission_id,
                    "mission_archive_failed",
                    serde_json::json!({
                        "resulting_status": "finished",
                        "error": error,
                    }),
                )
                .await?;
                return Err(error);
            }
        };

        self.append_event(
            &mission_id,
            "mission_archive_succeeded",
            serde_json::json!({
                "resulting_status": "finished",
                "archive_path": archive.archive_path.clone(),
            }),
        )
        .await?;

        self.set_non_operational_status(&mission_id, MissionStatus::Finalized)
            .await?;

        self.append_event(
            &mission_id,
            "mission_finalized",
            serde_json::json!({
                "resulting_status": "finalized",
                "archive_path": archive.archive_path.clone(),
            }),
        )
        .await?;

        Ok(FinalizeMissionResult {
            mission: self.get_mission(mission_id).await?,
            archive,
        })
    }

    pub async fn unlock_finalized_mission(
        &self,
        input: UnlockFinalizedMissionInput,
        admin_roster: &[String],
    ) -> Result<Mission, String> {
        let mission = self.get_mission(input.mission_id.clone()).await?;
        if mission.status != MissionStatus::Finalized {
            return Err("Only finalized missions can be unlocked.".to_string());
        }

        let admin_name = input.admin_name.trim().to_string();
        let reason = input.reason.trim().to_string();
        if reason.is_empty() {
            return Err("Unlock reason is required.".to_string());
        }

        self.append_event(
            &input.mission_id,
            "mission_unlock_requested",
            serde_json::json!({
                "admin_name": admin_name,
                "reason": reason,
                "resulting_status": "finalized",
            }),
        )
        .await?;

        let allowed = admin_roster
            .iter()
            .any(|candidate| candidate.trim() == admin_name);
        if !allowed {
            self.append_event(
                &input.mission_id,
                "mission_unlock_denied",
                serde_json::json!({
                    "admin_name": admin_name,
                    "reason": reason,
                    "resulting_status": "finalized",
                }),
            )
            .await?;
            return Err("Selected admin is not authorized to unlock finalized missions.".to_string());
        }

        self.set_non_operational_status(&input.mission_id, MissionStatus::Finished)
            .await?;

        self.append_event(
            &input.mission_id,
            "mission_unlocked",
            serde_json::json!({
                "admin_name": admin_name,
                "reason": reason,
                "resulting_status": "finished",
            }),
        )
        .await?;

        self.get_mission(input.mission_id).await
    }

    async fn update_mission_status(
        &self,
        mission_id: &str,
        next_status: MissionStatus,
        pause_time: Option<String>,
        finish_time: Option<String>,
    ) -> Result<(), String> {
        let mission = self.get_mission(mission_id.to_string()).await?;
        let event_type = match next_status {
            MissionStatus::Active => "mission_resumed",
            MissionStatus::Paused => "mission_paused",
            MissionStatus::Finished => "mission_finished",
            MissionStatus::Idle | MissionStatus::Finalized => {
                return Err("Unsupported mission status transition.".to_string())
            }
        };

        let timestamp = pause_time.clone().or(finish_time.clone()).unwrap_or_else(|| Utc::now().to_rfc3339());
        let additional_paused_seconds =
            calculate_additional_paused_seconds(&mission, &timestamp)?;
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| format!("Failed to start mission update transaction: {error}"))?;

        sqlx::query(
            r#"
            UPDATE missions
            SET status = ?, pause_time = ?, finish_time = ?, paused_seconds = ?
            WHERE id = ?
            "#,
        )
        .bind(&next_status)
        .bind(pause_time)
        .bind(finish_time)
        .bind(mission.paused_seconds + additional_paused_seconds)
        .bind(mission_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Failed to update mission status: {error}"))?;

        let details = serde_json::json!({
            "status": &next_status,
        });
        Self::insert_event(&mut *tx, mission_id, event_type, &timestamp, Some(&details)).await?;

        tx.commit()
            .await
            .map_err(|error| format!("Failed to commit mission update: {error}"))?;

        Ok(())
    }

    async fn set_non_operational_status(
        &self,
        mission_id: &str,
        next_status: MissionStatus,
    ) -> Result<(), String> {
        let mission = self.get_mission(mission_id.to_string()).await?;

        sqlx::query(
            r#"
            UPDATE missions
            SET status = ?, pause_time = NULL, finish_time = ?, paused_seconds = ?
            WHERE id = ?
            "#,
        )
        .bind(&next_status)
        .bind(&mission.finish_time)
        .bind(mission.paused_seconds)
        .bind(mission_id)
        .execute(&self.pool)
        .await
        .map_err(|error| format!("Failed to update non-operational mission status: {error}"))?;

        Ok(())
    }

    async fn append_event(
        &self,
        mission_id: &str,
        event_type: &str,
        details_json: serde_json::Value,
    ) -> Result<(), String> {
        Self::insert_event(
            &self.pool,
            mission_id,
            event_type,
            &Utc::now().to_rfc3339(),
            Some(&details_json),
        )
        .await
    }

    async fn ensure_mission_mutable(&self, mission_id: &str) -> Result<Mission, String> {
        let mission = self.get_mission(mission_id.to_string()).await?;
        if mission.status == MissionStatus::Finalized {
            return Err("Finalized missions are read-only until an admin unlocks them.".to_string());
        }

        Ok(mission)
    }

    fn validate_archive_file(archive_path: &PathBuf, mission_id: &str) -> Result<(), String> {
        let archive_file = File::open(archive_path)
            .map_err(|error| format!("Failed to open temporary mission archive for validation: {error}"))?;
        let mut zip = zip::ZipArchive::new(archive_file)
            .map_err(|error| format!("Failed to read temporary mission archive for validation: {error}"))?;

        let mut manifest_json = String::new();
        {
            let mut manifest_entry = zip
                .by_name("manifest.json")
                .map_err(|error| format!("Mission archive is missing manifest.json: {error}"))?;
            std::io::Read::read_to_string(&mut manifest_entry, &mut manifest_json)
                .map_err(|error| format!("Failed to read mission archive manifest: {error}"))?;
        }
        let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
            .map_err(|error| format!("Mission archive manifest is invalid JSON: {error}"))?;
        if manifest.get("mission_id").and_then(serde_json::Value::as_str) != Some(mission_id) {
            return Err("Mission archive manifest does not match the requested mission.".to_string());
        }

        let mut mission_json = String::new();
        {
            let mut mission_entry = zip
                .by_name("mission.json")
                .map_err(|error| format!("Mission archive is missing mission.json: {error}"))?;
            std::io::Read::read_to_string(&mut mission_entry, &mut mission_json)
                .map_err(|error| format!("Failed to read mission archive payload: {error}"))?;
        }
        let mission: serde_json::Value = serde_json::from_str(&mission_json)
            .map_err(|error| format!("Mission archive payload is invalid JSON: {error}"))?;
        if mission.get("id").and_then(serde_json::Value::as_str) != Some(mission_id) {
            return Err("Mission archive payload does not match the requested mission.".to_string());
        }

        {
            let sqlite_entry = zip
                .by_name("mission-store.sqlite")
                .map_err(|error| format!("Mission archive is missing mission-store.sqlite: {error}"))?;
            if sqlite_entry.size() == 0 {
                return Err("Mission archive contains an empty mission-store.sqlite snapshot.".to_string());
            }
        }

        Ok(())
    }
}

fn calculate_additional_paused_seconds(mission: &Mission, transition_timestamp: &str) -> Result<i64, String> {
    if mission.status != MissionStatus::Paused || mission.pause_time.is_none() {
        return Ok(0);
    }

    let pause_started_at = mission.pause_time.as_deref().expect("pause_time checked above");
    let paused_duration = chrono::DateTime::parse_from_rfc3339(transition_timestamp)
        .map_err(|error| format!("Invalid mission transition timestamp: {error}"))?
        .signed_duration_since(
            chrono::DateTime::parse_from_rfc3339(pause_started_at)
                .map_err(|error| format!("Invalid mission pause_time: {error}"))?,
        )
        .num_seconds();

    Ok(paused_duration.max(0))
}

fn validate_optional_timestamp(value: Option<&str>, label: &str) -> Result<Option<String>, String> {
    let Some(timestamp) = value else {
        return Ok(None);
    };

    chrono::DateTime::parse_from_rfc3339(timestamp)
        .map_err(|error| format!("{label} must be a valid RFC3339 timestamp: {error}"))?;

    Ok(Some(timestamp.to_string()))
}

fn sanitize_attachment_file_name(file_name: &str) -> Result<String, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Attachment file name is required.".to_string());
    }

    let base_name = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Attachment file name is invalid.".to_string())?;

    let sanitized = base_name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => character,
        })
        .collect::<String>()
        .trim()
        .to_string();

    if sanitized.is_empty() {
        return Err("Attachment file name is invalid.".to_string());
    }

    Ok(sanitized)
}

fn write_bytes_atomically(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create attachment directory: {error}"))?;
    }

    let temporary_path = path.with_extension("tmp");
    if temporary_path.exists() {
        fs::remove_file(&temporary_path)
            .map_err(|error| format!("Failed to clear temporary attachment file: {error}"))?;
    }

    fs::write(&temporary_path, bytes)
        .map_err(|error| format!("Failed to write attachment file: {error}"))?;
    fs::rename(&temporary_path, path)
        .map_err(|error| format!("Failed to finalize attachment file: {error}"))?;

    Ok(())
}

fn remove_file_if_exists(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(path).map_err(|error| format!("Failed to remove file: {error}"))
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
pub async fn create_mission_archive(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<MissionArchiveInfo, String> {
    store.0.create_mission_archive(mission_id).await
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
pub async fn upsert_marker(
    input: UpsertMarkerInput,
    store: State<'_, MissionStoreState>,
) -> Result<Marker, String> {
    store.0.upsert_marker(input).await
}

#[tauri::command]
pub async fn get_marker(
    marker_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Marker, String> {
    store.0.get_marker(marker_id).await
}

#[tauri::command]
pub async fn list_markers(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Vec<Marker>, String> {
    store.0.list_markers(mission_id).await
}

#[tauri::command]
pub async fn ingest_marker_attachment(
    input: IngestMarkerAttachmentInput,
    store: State<'_, MissionStoreState>,
    settings: State<'_, SettingsStoreState>,
) -> Result<String, String> {
    store.0.ingest_marker_attachment(input, &settings).await
}

#[tauri::command]
pub async fn delete_marker(
    marker_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<bool, String> {
    store.0.delete_marker(marker_id).await
}

#[tauri::command]
pub async fn upsert_drawing(
    input: UpsertDrawingInput,
    store: State<'_, MissionStoreState>,
) -> Result<Drawing, String> {
    store.0.upsert_drawing(input).await
}

#[tauri::command]
pub async fn get_drawing(
    drawing_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Drawing, String> {
    store.0.get_drawing(drawing_id).await
}

#[tauri::command]
pub async fn list_drawings(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Vec<Drawing>, String> {
    store.0.list_drawings(mission_id).await
}

#[tauri::command]
pub async fn delete_drawing(
    drawing_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<bool, String> {
    store.0.delete_drawing(drawing_id).await
}

#[tauri::command]
pub async fn list_layer_catalog_entries(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<Vec<LayerCatalogEntry>, String> {
    store.0.list_layer_catalog_entries(mission_id).await
}

#[tauri::command]
pub async fn upsert_layer_catalog_entry(
    input: UpsertLayerCatalogEntryInput,
    store: State<'_, MissionStoreState>,
) -> Result<LayerCatalogEntry, String> {
    store.0.upsert_layer_catalog_entry(input).await
}

#[tauri::command]
pub async fn clear_layer_catalog_entries(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<(), String> {
    store.0.clear_layer_catalog_entries(mission_id).await
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
pub async fn list_mission_events(
    store: State<'_, MissionStoreState>,
    mission_id: String,
) -> Result<Vec<MissionEvent>, String> {
    store.0.list_mission_events(mission_id).await
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

#[tauri::command]
pub async fn finalize_mission(
    mission_id: String,
    store: State<'_, MissionStoreState>,
) -> Result<FinalizeMissionResult, String> {
    store.0.finalize_mission(mission_id).await
}

#[tauri::command]
pub async fn unlock_finalized_mission(
    input: UnlockFinalizedMissionInput,
    store: State<'_, MissionStoreState>,
    settings: State<'_, SettingsStoreState>,
) -> Result<Mission, String> {
    let admin_roster = settings.0.load_view()?.mission_defaults.admin_roster;
    store.0.unlock_finalized_mission(input, &admin_roster).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use zip::ZipArchive;

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
                start_time: None,
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
                start_time: None,
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
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        let create_second_result = store
            .create_mission(CreateMissionInput {
                name: "Mission B".to_string(),
                start_time: None,
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
                start_time: None,
                notes: None,
            })
            .await
            .expect("new mission should be allowed after finish");
        assert_eq!(next.status, MissionStatus::Active);
    }

    #[tokio::test]
    async fn creates_mission_with_explicit_backdated_start_time() {
        let (database_path, backup_path) = temp_paths("backdated-start");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Backdated Mission".to_string(),
                start_time: Some("2026-04-09T08:00:00.000Z".to_string()),
                notes: None,
            })
            .await
            .expect("mission should be created");

        assert_eq!(mission.start_time, "2026-04-09T08:00:00.000Z");
    }

    #[tokio::test]
    async fn recovers_active_mission_as_startup_candidate() {
        let (database_path, backup_path) = temp_paths("recover-active");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Recover Me".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        let recoverable = store
            .get_recoverable_mission()
            .await
            .expect("recoverable mission should load");

        assert_eq!(recoverable, Some(mission));
    }

    #[tokio::test]
    async fn accumulates_paused_seconds_on_resume_and_finish_from_pause() {
        let (database_path, backup_path) = temp_paths("paused-seconds");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Pause Math".to_string(),
                start_time: Some("2026-04-09T08:00:00.000Z".to_string()),
                notes: None,
            })
            .await
            .expect("mission should be created");

        let paused = store
            .pause_mission(mission.id.clone())
            .await
            .expect("pause should succeed");
        assert!(paused.pause_time.is_some());

        sqlx::query("UPDATE missions SET pause_time = ? WHERE id = ?")
            .bind((Utc::now() - Duration::seconds(300)).to_rfc3339())
            .bind(&mission.id)
            .execute(&store.pool)
            .await
            .expect("pause_time should update");

        let resumed = store
            .resume_mission(mission.id.clone())
            .await
            .expect("resume should succeed");
        assert!(resumed.paused_seconds >= 300);

        let paused_again = store
            .pause_mission(mission.id.clone())
            .await
            .expect("pause should succeed again");
        assert!(paused_again.pause_time.is_some());

        sqlx::query("UPDATE missions SET pause_time = ? WHERE id = ?")
            .bind((Utc::now() - Duration::seconds(120)).to_rfc3339())
            .bind(&mission.id)
            .execute(&store.pool)
            .await
            .expect("pause_time should update again");

        let finished = store
            .finish_mission(mission.id.clone())
            .await
            .expect("finish should succeed");
        assert!(finished.paused_seconds >= resumed.paused_seconds + 120);
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
                start_time: None,
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
                start_time: None,
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

    #[tokio::test]
    async fn upserts_lists_and_deletes_markers() {
        let (database_path, backup_path) = temp_paths("markers");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Marker Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        let marker = store
            .upsert_marker(UpsertMarkerInput {
                id: None,
                mission_id: mission.id.clone(),
                r#type: MarkerType::Clue,
                name: "Boot Print".to_string(),
                description: Some("Fresh print near river".to_string()),
                lat: 52.1,
                lon: -9.5,
                irish_grid_e: 496584,
                irish_grid_n: 591256,
                display_order: 2,
                subject_category: None,
                clue_type: Some("footwear".to_string()),
                confidence: Some(0.8),
                found_by: Some("Team Alpha".to_string()),
                hazard_type: None,
                severity: None,
                condition: None,
                treatment: None,
                evacuation_priority: None,
                updated_by: Some("Ops Lead".to_string()),
                coordinator_ids: Some("C1, C2".to_string()),
                attachment_path: Some("/tmp/attachment-a.jpg".to_string()),
            })
            .await
            .expect("marker should upsert");

        assert_eq!(marker.marker_type, MarkerType::Clue);
        assert_eq!(marker.display_order, 2);

        let updated = store
            .upsert_marker(UpsertMarkerInput {
                id: Some(marker.id.clone()),
                mission_id: mission.id.clone(),
                r#type: MarkerType::Clue,
                name: "Boot Print".to_string(),
                description: Some("Fresh print near treeline".to_string()),
                lat: 52.1001,
                lon: -9.5001,
                irish_grid_e: 496580,
                irish_grid_n: 591250,
                display_order: 1,
                subject_category: None,
                clue_type: Some("footwear".to_string()),
                confidence: Some(0.9),
                found_by: Some("Team Alpha".to_string()),
                hazard_type: None,
                severity: None,
                condition: None,
                treatment: None,
                evacuation_priority: None,
                updated_by: Some("Ops Lead".to_string()),
                coordinator_ids: Some("C1, C2".to_string()),
                attachment_path: Some("/tmp/attachment-b.jpg".to_string()),
            })
            .await
            .expect("marker should update");

        assert_eq!(updated.id, marker.id);
        assert_eq!(updated.display_order, 1);
        assert_eq!(updated.description.as_deref(), Some("Fresh print near treeline"));

        let markers = store
            .list_markers(mission.id.clone())
            .await
            .expect("markers should list");
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].id, marker.id);

        let deleted = store
            .delete_marker(marker.id.clone())
            .await
            .expect("marker should delete");
        assert!(deleted);
        assert!(store.list_markers(mission.id).await.expect("markers after delete").is_empty());
    }

    #[tokio::test]
    async fn deletes_superseded_managed_marker_attachments() {
        let (database_path, backup_path) = temp_paths("marker-attachment-cleanup");
        let store = MissionStore::connect(database_path.clone(), backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Attachment Cleanup Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        let attachments_root = database_path
            .parent()
            .expect("database parent")
            .join(DEFAULT_MISSION_STORAGE_DIRECTORY_NAME)
            .join(&mission.id)
            .join(ATTACHMENTS_DIRECTORY_NAME);
        fs::create_dir_all(&attachments_root).expect("attachments dir");

        let original_attachment = attachments_root.join("old-evidence.txt");
        fs::write(&original_attachment, b"old").expect("seed old attachment");

        let marker = store
            .upsert_marker(UpsertMarkerInput {
                id: None,
                mission_id: mission.id.clone(),
                r#type: MarkerType::Clue,
                name: "Boot Print".to_string(),
                description: None,
                lat: 52.1,
                lon: -9.5,
                irish_grid_e: 496584,
                irish_grid_n: 591256,
                display_order: 1,
                subject_category: None,
                clue_type: None,
                confidence: None,
                found_by: None,
                hazard_type: None,
                severity: None,
                condition: None,
                treatment: None,
                evacuation_priority: None,
                updated_by: None,
                coordinator_ids: None,
                attachment_path: Some(original_attachment.to_string_lossy().to_string()),
            })
            .await
            .expect("marker should create");

        let replacement_attachment = attachments_root.join("new-evidence.txt");
        fs::write(&replacement_attachment, b"new").expect("seed replacement attachment");

        store
            .upsert_marker(UpsertMarkerInput {
                id: Some(marker.id.clone()),
                mission_id: mission.id.clone(),
                r#type: MarkerType::Clue,
                name: "Boot Print".to_string(),
                description: None,
                lat: 52.1,
                lon: -9.5,
                irish_grid_e: 496584,
                irish_grid_n: 591256,
                display_order: 1,
                subject_category: None,
                clue_type: None,
                confidence: None,
                found_by: None,
                hazard_type: None,
                severity: None,
                condition: None,
                treatment: None,
                evacuation_priority: None,
                updated_by: None,
                coordinator_ids: None,
                attachment_path: Some(replacement_attachment.to_string_lossy().to_string()),
            })
            .await
            .expect("marker should update");

        assert!(!original_attachment.exists());
        assert!(replacement_attachment.exists());

        store
            .delete_marker(marker.id.clone())
            .await
            .expect("marker should delete");

        assert!(!replacement_attachment.exists());
    }

    #[tokio::test]
    async fn upserts_lists_and_deletes_drawings() {
        let (database_path, backup_path) = temp_paths("drawings");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Drawing Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        let drawing = store
            .upsert_drawing(UpsertDrawingInput {
                id: None,
                mission_id: mission.id.clone(),
                r#type: DrawingType::Line,
                name: "Track Line".to_string(),
                description: Some("Outbound route".to_string()),
                color: Some("#00AAFF".to_string()),
                width: Some(2.0),
                distance_m: Some(1200.0),
                temporary_measure: Some(false),
                label: Some("A-B".to_string()),
                display_order: 3,
                geometry_json: "{\"type\":\"LineString\",\"coordinates\":[[-9.5,52.0],[-9.4,52.1]]}".to_string(),
                metadata_json: Some("{\"team\":\"Alpha\"}".to_string()),
            })
            .await
            .expect("drawing should upsert");

        assert_eq!(drawing.drawing_type, DrawingType::Line);
        assert_eq!(drawing.display_order, 3);

        let updated = store
            .upsert_drawing(UpsertDrawingInput {
                id: Some(drawing.id.clone()),
                mission_id: mission.id.clone(),
                r#type: DrawingType::Line,
                name: "Track Line".to_string(),
                description: Some("Revised route".to_string()),
                color: Some("#0088CC".to_string()),
                width: Some(3.0),
                distance_m: Some(1300.0),
                temporary_measure: Some(false),
                label: Some("A-C".to_string()),
                display_order: 1,
                geometry_json: "{\"type\":\"LineString\",\"coordinates\":[[-9.5,52.0],[-9.3,52.2]]}".to_string(),
                metadata_json: Some("{\"team\":\"Bravo\"}".to_string()),
            })
            .await
            .expect("drawing should update");

        assert_eq!(updated.id, drawing.id);
        assert_eq!(updated.display_order, 1);
        assert_eq!(updated.description.as_deref(), Some("Revised route"));

        let drawings = store
            .list_drawings(mission.id.clone())
            .await
            .expect("drawings should list");
        assert_eq!(drawings.len(), 1);
        assert_eq!(drawings[0].id, drawing.id);

        let deleted = store
            .delete_drawing(drawing.id.clone())
            .await
            .expect("drawing should delete");
        assert!(deleted);
        assert!(store.list_drawings(mission.id).await.expect("drawings after delete").is_empty());
    }

    #[tokio::test]
    async fn records_audit_events_for_persistence_mutations() {
        let (database_path, backup_path) = temp_paths("audit-events");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Audit Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        store
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

        store
            .add_position(AddPositionInput {
                mission_id: mission.id.clone(),
                device_id: "tracker-1".to_string(),
                name: Some("Rescuer One".to_string()),
                lat: 52.0599,
                lon: -9.5045,
                altitude: None,
                speed: None,
                battery: None,
                accuracy: None,
                source: Some("traccar".to_string()),
                timestamp: None,
                data_origin: Some("live".to_string()),
            })
            .await
            .expect("position should insert");

        let marker = store
            .upsert_marker(UpsertMarkerInput {
                id: None,
                mission_id: mission.id.clone(),
                r#type: MarkerType::Clue,
                name: "Boot Print".to_string(),
                description: None,
                lat: 52.1,
                lon: -9.5,
                irish_grid_e: 496584,
                irish_grid_n: 591256,
                display_order: 1,
                subject_category: None,
                clue_type: Some("footwear".to_string()),
                confidence: Some(0.8),
                found_by: Some("Team Alpha".to_string()),
                hazard_type: None,
                severity: None,
                condition: None,
                treatment: None,
                evacuation_priority: None,
                updated_by: None,
                coordinator_ids: None,
                attachment_path: None,
            })
            .await
            .expect("marker should upsert");

        store
            .delete_marker(marker.id.clone())
            .await
            .expect("marker should delete");

        let drawing = store
            .upsert_drawing(UpsertDrawingInput {
                id: None,
                mission_id: mission.id.clone(),
                r#type: DrawingType::Line,
                name: "Track Line".to_string(),
                description: None,
                color: Some("#00AAFF".to_string()),
                width: Some(2.0),
                distance_m: Some(1200.0),
                temporary_measure: Some(false),
                label: None,
                display_order: 1,
                geometry_json: "{\"type\":\"LineString\",\"coordinates\":[[-9.5,52.0],[-9.4,52.1]]}".to_string(),
                metadata_json: None,
            })
            .await
            .expect("drawing should upsert");

        store
            .delete_drawing(drawing.id.clone())
            .await
            .expect("drawing should delete");

        let events = store
            .list_mission_events(mission.id.clone())
            .await
            .expect("events should list");
        let event_types = events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            event_types,
            vec![
                "mission_created",
                "device_created",
                "position_recorded",
                "marker_created",
                "marker_deleted",
                "drawing_created",
                "drawing_deleted",
            ]
        );
    }

    #[tokio::test]
    async fn creates_zip_archive_for_finished_mission() {
        let (database_path, backup_path) = temp_paths("archive");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Archive Mission".to_string(),
                start_time: None,
                notes: Some("Ready to archive".to_string()),
            })
            .await
            .expect("mission should be created");

        store
            .finish_mission(mission.id.clone())
            .await
            .expect("mission should finish");

        let archive = store
            .create_mission_archive(mission.id.clone())
            .await
            .expect("archive should succeed");

        assert!(PathBuf::from(&archive.archive_path).exists());

        let archive_file = File::open(&archive.archive_path).expect("archive file");
        let mut zip = ZipArchive::new(archive_file).expect("zip archive should open");
        assert!(zip.by_name("manifest.json").is_ok());
        assert!(zip.by_name("mission.json").is_ok());

        let mut sqlite_entry = zip.by_name("mission-store.sqlite").expect("sqlite snapshot");
        let mut sqlite_bytes = Vec::new();
        sqlite_entry
            .read_to_end(&mut sqlite_bytes)
            .expect("sqlite snapshot should read");
        assert!(!sqlite_bytes.is_empty());

        let events = store
            .list_mission_events(mission.id.clone())
            .await
            .expect("events should list");
        assert_eq!(
            events.last().map(|event| event.event_type.as_str()),
            Some("mission_archived")
        );
    }

    #[tokio::test]
    async fn finalizes_a_finished_mission_and_records_governance_events() {
        let (database_path, backup_path) = temp_paths("finalize");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Finalize Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        store
            .finish_mission(mission.id.clone())
            .await
            .expect("mission should finish");

        let result = store
            .finalize_mission(mission.id.clone())
            .await
            .expect("mission should finalize");

        assert_eq!(result.mission.status, MissionStatus::Finalized);
        assert!(PathBuf::from(&result.archive.archive_path).exists());

        let events = store
            .list_mission_events(mission.id)
            .await
            .expect("events should list");
        let event_types = events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>();
        assert!(event_types.ends_with(&[
            "mission_finished",
            "mission_finalize_requested",
            "mission_archive_succeeded",
            "mission_finalized",
        ]));
    }

    #[tokio::test]
    async fn blocks_mutations_for_finalized_missions_until_admin_unlock() {
        let (database_path, backup_path) = temp_paths("finalized-readonly");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Locked Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        store
            .finish_mission(mission.id.clone())
            .await
            .expect("mission should finish");
        store
            .finalize_mission(mission.id.clone())
            .await
            .expect("mission should finalize");

        let marker_error = store
            .upsert_marker(UpsertMarkerInput {
                id: None,
                mission_id: mission.id.clone(),
                r#type: MarkerType::Clue,
                name: "Blocked Marker".to_string(),
                description: None,
                lat: 52.1,
                lon: -9.5,
                irish_grid_e: 496584,
                irish_grid_n: 591256,
                display_order: 1,
                subject_category: None,
                clue_type: None,
                confidence: None,
                found_by: None,
                hazard_type: None,
                severity: None,
                condition: None,
                treatment: None,
                evacuation_priority: None,
                updated_by: None,
                coordinator_ids: None,
                attachment_path: None,
            })
            .await
            .expect_err("finalized mission should reject marker writes");
        assert!(marker_error.contains("read-only"));

        let unlock_error = store
            .unlock_finalized_mission(
                UnlockFinalizedMissionInput {
                    mission_id: mission.id.clone(),
                    admin_name: "Unauthorized".to_string(),
                    reason: "No access".to_string(),
                },
                &["Ops Lead".to_string()],
            )
            .await
            .expect_err("unauthorized admin should be rejected");
        assert!(unlock_error.contains("not authorized"));

        let unlocked = store
            .unlock_finalized_mission(
                UnlockFinalizedMissionInput {
                    mission_id: mission.id.clone(),
                    admin_name: "Ops Lead".to_string(),
                    reason: "Need to correct map data".to_string(),
                },
                &["Ops Lead".to_string()],
            )
            .await
            .expect("authorized unlock should succeed");
        assert_eq!(unlocked.status, MissionStatus::Finished);

        let marker = store
            .upsert_marker(UpsertMarkerInput {
                id: None,
                mission_id: mission.id.clone(),
                r#type: MarkerType::Clue,
                name: "Allowed Marker".to_string(),
                description: None,
                lat: 52.1,
                lon: -9.5,
                irish_grid_e: 496584,
                irish_grid_n: 591256,
                display_order: 1,
                subject_category: None,
                clue_type: None,
                confidence: None,
                found_by: None,
                hazard_type: None,
                severity: None,
                condition: None,
                treatment: None,
                evacuation_priority: None,
                updated_by: None,
                coordinator_ids: None,
                attachment_path: None,
            })
            .await
            .expect("marker should save after unlock");
        assert_eq!(marker.name, "Allowed Marker");
    }

    #[tokio::test]
    async fn lists_mission_events_in_timestamp_order() {
        let (database_path, backup_path) = temp_paths("event-list");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Event Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        let paused = store
            .pause_mission(mission.id.clone())
            .await
            .expect("pause should succeed");
        assert_eq!(paused.status, MissionStatus::Paused);

        let resumed = store
            .resume_mission(mission.id.clone())
            .await
            .expect("resume should succeed");
        assert_eq!(resumed.status, MissionStatus::Active);

        let events = store
            .list_mission_events(mission.id)
            .await
            .expect("events should list");

        assert_eq!(events.len(), 3);
        assert_eq!(events[0].event_type, "mission_created");
        assert_eq!(events[1].event_type, "mission_paused");
        assert_eq!(events[2].event_type, "mission_resumed");
    }

    #[tokio::test]
    async fn saves_and_lists_layer_catalog_entries() {
        let (database_path, backup_path) = temp_paths("layer-catalog");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Layer Catalog Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        let entry = store
            .upsert_layer_catalog_entry(UpsertLayerCatalogEntryInput {
                mission_id: mission.id.clone(),
                node_id: "feature:device:alpha".to_string(),
                parent_node_id: Some("layer:tracking:devices".to_string()),
                node_kind: LayerCatalogNodeKind::FeatureItem,
                alias: Some("Alpha Ops".to_string()),
                is_favorite: Some(true),
                is_visible: Some(false),
                display_order: Some(3),
                metadata_json: None,
            })
            .await
            .expect("catalog entry should save");

        assert_eq!(entry.parent_node_id.as_deref(), Some("layer:tracking:devices"));
        assert!(!entry.is_visible);
        assert!(entry.is_favorite);

        let entries = store
            .list_layer_catalog_entries(mission.id.clone())
            .await
            .expect("entries should list");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].alias.as_deref(), Some("Alpha Ops"));

        let updated = store
            .upsert_layer_catalog_entry(UpsertLayerCatalogEntryInput {
                mission_id: mission.id.clone(),
                node_id: "feature:device:alpha".to_string(),
                parent_node_id: Some("layer:tracking:devices".to_string()),
                node_kind: LayerCatalogNodeKind::FeatureItem,
                alias: Some("Alpha Updated".to_string()),
                is_favorite: Some(false),
                is_visible: Some(true),
                display_order: Some(1),
                metadata_json: Some("{\"favorite\":false}".to_string()),
            })
            .await
            .expect("catalog entry should update");

        assert_eq!(updated.alias.as_deref(), Some("Alpha Updated"));
        assert!(updated.is_visible);
        assert_eq!(updated.display_order, 1);

        store
            .clear_layer_catalog_entries(mission.id.clone())
            .await
            .expect("catalog repair should succeed");

        let repaired_entries = store
            .list_layer_catalog_entries(mission.id.clone())
            .await
            .expect("entries should list after repair");
        assert!(repaired_entries.is_empty());

        let repair_event = store
            .list_mission_events(mission.id)
            .await
            .expect("events should list")
            .into_iter()
            .find(|event| event.event_type == "layer_catalog_repaired")
            .expect("repair event should exist");
        assert!(
            repair_event
                .details_json
                .unwrap_or_default()
                .contains("reset_metadata")
        );
    }

    #[tokio::test]
    async fn rejects_layer_catalog_writes_for_finalized_missions() {
        let (database_path, backup_path) = temp_paths("layer-catalog-finalized");
        let store = MissionStore::connect(database_path, backup_path)
            .await
            .expect("store should initialize");

        let mission = store
            .create_mission(CreateMissionInput {
                name: "Locked Catalog Mission".to_string(),
                start_time: None,
                notes: None,
            })
            .await
            .expect("mission should be created");

        store
            .finish_mission(mission.id.clone())
            .await
            .expect("mission should finish");
        store
            .finalize_mission(mission.id.clone())
            .await
            .expect("mission should finalize");

        let error = store
            .upsert_layer_catalog_entry(UpsertLayerCatalogEntryInput {
                mission_id: mission.id,
                node_id: "group:tracking".to_string(),
                parent_node_id: Some("root:mission-catalog".to_string()),
                node_kind: LayerCatalogNodeKind::Group,
                alias: Some("Blocked".to_string()),
                is_favorite: Some(false),
                is_visible: Some(true),
                display_order: Some(1),
                metadata_json: None,
            })
            .await
            .expect_err("finalized mission should reject catalog writes");

        assert!(error.contains("read-only"));
    }
}
