use std::{fs, path::PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpxImportFilePayload {
    pub source_path: String,
    pub file_name: String,
    pub contents: String,
}

#[tauri::command]
pub async fn read_gpx_files(paths: Vec<String>) -> Result<Vec<GpxImportFilePayload>, String> {
    let mut files = Vec::new();
    for path in paths {
        files.push(read_gpx_file(PathBuf::from(path))?);
    }

    Ok(files)
}

#[tauri::command]
pub async fn list_gpx_directory_files(
    directory_path: String,
) -> Result<Vec<GpxImportFilePayload>, String> {
    let directory = PathBuf::from(&directory_path);
    if !directory.is_dir() {
        return Err(format!(
            "GPX watch directory was not found: {directory_path}"
        ));
    }

    let mut files = fs::read_dir(&directory)
        .map_err(|error| format!("Failed to read GPX directory {directory_path}: {error}"))?
        .filter_map(|entry| entry.ok().map(|dir_entry| dir_entry.path()))
        .filter(|path| is_gpx_path(path))
        .collect::<Vec<_>>();
    files.sort_by(|left, right| left.file_name().cmp(&right.file_name()));

    files.into_iter().map(read_gpx_file).collect()
}

fn read_gpx_file(path: PathBuf) -> Result<GpxImportFilePayload, String> {
    if !path.is_file() {
        return Err(format!(
            "GPX file was not found: {}",
            path.to_string_lossy()
        ));
    }
    if !is_gpx_path(&path) {
        return Err(format!(
            "Only .gpx files can be imported: {}",
            path.to_string_lossy()
        ));
    }

    let contents = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read GPX file {}: {error}",
            path.to_string_lossy()
        )
    })?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("GPX file name is invalid: {}", path.to_string_lossy()))?;

    Ok(GpxImportFilePayload {
        source_path: path.to_string_lossy().to_string(),
        file_name: file_name.to_string(),
        contents,
    })
}

fn is_gpx_path(path: &PathBuf) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("gpx"))
        .unwrap_or(false)
}
