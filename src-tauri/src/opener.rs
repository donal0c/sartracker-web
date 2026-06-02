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

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let normalized = url.trim();
    if normalized.is_empty() {
        return Err("URL is required.".to_string());
    }

    if !normalized.starts_with("http://") && !normalized.starts_with("https://") {
        return Err("URL scheme must be http:// or https://".to_string());
    }

    open::that(normalized)
        .map_err(|error| format!("Failed to open URL in default browser: {error}"))?;

    Ok(())
}
