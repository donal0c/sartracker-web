use std::path::PathBuf;

#[tauri::command]
pub async fn open_external_path(path: String) -> Result<(), String> {
    let normalized = path.trim();
    if normalized.is_empty() {
        return Err("Path is required.".to_string());
    }

    let path_buf = PathBuf::from(normalized);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {normalized}"));
    }

    open::that(&path_buf)
        .map_err(|error| format!("Failed to open path with default application: {error}"))?;

    Ok(())
}
