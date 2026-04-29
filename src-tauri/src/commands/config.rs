use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};

use crate::models::settings::AppSettings;
use crate::transfer::throttle::BandwidthThrottle;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LogDirInfo {
    pub path: Option<String>,
    pub exists: bool,
    pub file_count: usize,
    pub total_size_bytes: u64,
}

/// Open a filesystem path in the user's file manager (or default
/// handler). The default `tauri-plugin-shell` allow-open pattern only
/// accepts http/mailto/tel URLs, not filesystem paths, so this command
/// shells out directly to the platform-specific opener.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    #[cfg(target_os = "linux")]
    let program = "xdg-open";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";

    std::process::Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open {path}: {e}"))
}

#[tauri::command]
pub fn get_log_dir_info() -> Result<LogDirInfo, String> {
    let dir: Option<PathBuf> = crate::store::logging::current_log_dir();
    let Some(dir) = dir else {
        return Ok(LogDirInfo {
            path: None,
            exists: false,
            file_count: 0,
            total_size_bytes: 0,
        });
    };

    let path_str = dir.to_string_lossy().into_owned();
    if !dir.exists() {
        return Ok(LogDirInfo {
            path: Some(path_str),
            exists: false,
            file_count: 0,
            total_size_bytes: 0,
        });
    }

    let mut count = 0usize;
    let mut total = 0u64;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    count += 1;
                    total += meta.len();
                }
            }
        }
    }
    Ok(LogDirInfo {
        path: Some(path_str),
        exists: true,
        file_count: count,
        total_size_bytes: total,
    })
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    Ok(crate::store::config::load_settings(&app))
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    throttle: State<'_, Arc<BandwidthThrottle>>,
    settings: AppSettings,
) -> Result<(), String> {
    // Validate exclude patterns up-front so the user gets a clear error at
    // save time, rather than on their next upload attempt.
    super::transfer::build_exclude_set(&settings.transfer.upload_exclude_patterns)?;

    // Update throttle config from settings
    throttle.update_config(
        settings.transfer.max_bandwidth_mbps,
        settings.transfer.bandwidth_schedules.clone(),
    );

    // Apply log level at runtime. Anything that requires a restart
    // (file path / file logging on-off) is left to the user — we just
    // hot-swap what we can without bouncing the process. RUST_LOG, if
    // set, still wins because EnvFilter honors it on startup; level
    // changes only take effect when RUST_LOG is unset.
    if let Err(e) = crate::store::logging::apply_log_level(&settings.general.log_level) {
        tracing::warn!("Could not apply new log level: {e}");
    }

    crate::store::config::save_settings(&app, &settings)
}
