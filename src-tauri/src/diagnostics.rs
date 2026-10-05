use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

static DIAGNOSTICS_ENABLED: AtomicBool = AtomicBool::new(true);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticEvent<'a> {
    timestamp: u64,
    name: &'a str,
    level: &'a str,
    duration_ms: Option<f64>,
}

fn diagnostics_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("diagnostics");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn diagnostics_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(diagnostics_dir(app)?.join("events.jsonl"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
pub fn record_diagnostic_event(
    app: AppHandle,
    name: String,
    level: String,
    duration_ms: Option<f64>,
) -> Result<(), String> {
    if !DIAGNOSTICS_ENABLED.load(Ordering::Relaxed) {
        return Ok(());
    }
    let event = DiagnosticEvent {
        timestamp: now_ms(),
        name: &name,
        level: &level,
        duration_ms,
    };
    let line = serde_json::to_string(&event).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(diagnostics_file(&app)?)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_diagnostics_mode() -> bool {
    DIAGNOSTICS_ENABLED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_diagnostics_mode(enabled: bool) -> bool {
    DIAGNOSTICS_ENABLED.store(enabled, Ordering::Relaxed);
    enabled
}

#[tauri::command]
pub fn clear_diagnostics(app: AppHandle) -> Result<(), String> {
    let path = diagnostics_file(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_diagnostics_dir(app: AppHandle) -> Result<(), String> {
    let path = diagnostics_dir(&app)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn export_diagnostics_zip(app: AppHandle) -> Result<String, String> {
    Ok(diagnostics_file(&app)?.to_string_lossy().into_owned())
}

pub fn install_panic_hook(_app: AppHandle) {}

pub fn record_exit(app: &AppHandle) {
    let _ = record_diagnostic_event(
        app.clone(),
        "app.exit".to_string(),
        "info".to_string(),
        None,
    );
}
