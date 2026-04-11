use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, serde::Deserialize)]
pub struct ExportDiagnosticsReportInput {
    pub file_name: String,
    pub contents: String,
}

#[tauri::command]
pub async fn export_diagnostics_report<R: Runtime>(
    input: ExportDiagnosticsReportInput,
    app: AppHandle<R>,
) -> Result<String, String> {
    let reports_dir = diagnostics_reports_dir(&app)?;
    export_diagnostics_report_to_dir(input, &reports_dir)
}

fn diagnostics_reports_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve app config directory: {error}"))?;

    Ok(config_dir.join("diagnostics-reports"))
}

fn export_diagnostics_report_to_dir(
    input: ExportDiagnosticsReportInput,
    reports_dir: &PathBuf,
) -> Result<String, String> {
    let normalized_file_name = sanitize_report_file_name(&input.file_name)?;
    fs::create_dir_all(reports_dir)
        .map_err(|error| format!("Failed to create diagnostics report directory: {error}"))?;

    let final_path = reports_dir.join(normalized_file_name);
    let temporary_path = final_path.with_extension("tmp");
    fs::write(&temporary_path, input.contents)
        .map_err(|error| format!("Failed to write diagnostics report: {error}"))?;
    fs::rename(&temporary_path, &final_path)
        .map_err(|error| format!("Failed to finalize diagnostics report: {error}"))?;

    Ok(final_path.to_string_lossy().to_string())
}

fn sanitize_report_file_name(file_name: &str) -> Result<String, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Diagnostics report file name is required.".to_string());
    }

    let base_name = std::path::Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Diagnostics report file name is invalid.".to_string())?;
    let sanitized = base_name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => character,
        })
        .collect::<String>();

    if sanitized.trim().is_empty() {
        return Err("Diagnostics report file name is invalid.".to_string());
    }

    Ok(sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn exports_diagnostics_report_atomically() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let reports_dir = std::env::temp_dir().join(format!("sartracker-diagnostics-{unique}"));

        let exported_path = export_diagnostics_report_to_dir(
            ExportDiagnosticsReportInput {
                file_name: "diagnostics-report.txt".to_string(),
                contents: "Diagnostics Report\nruntime: test".to_string(),
            },
            &reports_dir,
        )
        .expect("diagnostics report should export");

        let path = PathBuf::from(exported_path);
        assert!(path.exists());
        assert_eq!(
            fs::read_to_string(&path).expect("report contents"),
            "Diagnostics Report\nruntime: test"
        );

        let _ = fs::remove_dir_all(reports_dir);
    }
}
