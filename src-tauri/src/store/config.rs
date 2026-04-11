use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::models::settings::AppSettings;

/// Get the settings file path.
fn settings_path(app: &AppHandle) -> PathBuf {
    let config_dir = app
        .path()
        .app_config_dir()
        .expect("Failed to resolve app config dir");
    std::fs::create_dir_all(&config_dir).expect("Failed to create app config dir");
    config_dir.join("settings.json")
}

/// Load settings from disk, or return defaults.
pub fn load_settings(app: &AppHandle) -> AppSettings {
    let path = settings_path(app);
    if path.exists() {
        let data = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        let defaults = AppSettings::default();
        // Write defaults to disk
        let _ = save_settings(app, &defaults);
        defaults
    }
}

/// Save settings to disk.
pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app);
    let data =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Serialization error: {e}"))?;
    std::fs::write(&path, data).map_err(|e| format!("Failed to write settings: {e}"))
}
