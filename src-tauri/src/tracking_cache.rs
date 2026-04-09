use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

const TRACKING_CACHE_FILE_NAME: &str = "tracking-cache.json";

fn tracking_cache_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve tracking cache directory: {error}"))?;

    Ok(config_dir.join(TRACKING_CACHE_FILE_NAME))
}

#[tauri::command]
pub fn read_tracking_cache<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let cache_path = tracking_cache_path(&app)?;
    if !cache_path.exists() {
        return Ok(None);
    }

    std::fs::read_to_string(&cache_path)
        .map(Some)
        .map_err(|error| format!("Failed to read tracking cache: {error}"))
}

#[tauri::command]
pub fn write_tracking_cache<R: Runtime>(
    app: AppHandle<R>,
    contents: String,
) -> Result<String, String> {
    let cache_path = tracking_cache_path(&app)?;
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create tracking cache directory: {error}"))?;
    }

    let temporary_path = cache_path.with_extension("tmp");
    std::fs::write(&temporary_path, contents)
        .map_err(|error| format!("Failed to write temporary tracking cache: {error}"))?;
    std::fs::rename(&temporary_path, &cache_path)
        .map_err(|error| format!("Failed to finalize tracking cache write: {error}"))?;

    Ok(cache_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::TRACKING_CACHE_FILE_NAME;
    use uuid::Uuid;

    fn temp_cache_paths() -> (PathBuf, PathBuf) {
        let unique = Uuid::new_v4().to_string();
        let base = std::env::temp_dir().join(format!("sartracker-tracking-cache-{unique}"));
        let cache_path = base.join(TRACKING_CACHE_FILE_NAME);
        let temporary_path = cache_path.with_extension("tmp");
        (cache_path, temporary_path)
    }

    #[test]
    fn writes_cache_atomically_via_temp_rename() {
        let (cache_path, temporary_path) = temp_cache_paths();
        fs::create_dir_all(cache_path.parent().expect("cache parent")).expect("create dir");

        fs::write(&temporary_path, "{\"cached\":true}").expect("write temp cache");
        fs::rename(&temporary_path, &cache_path).expect("rename cache");

        assert!(cache_path.exists());
        assert!(!temporary_path.exists());
        assert_eq!(
            fs::read_to_string(cache_path).expect("cache contents"),
            "{\"cached\":true}"
        );
    }
}
