//! Configurable logging: stdout + optional rotating file appender.
//!
//! The logging stack is set up *before* the Tauri builder runs, so we
//! can capture errors that happen during early init. To honor the
//! user-configured log level / log directory we read `settings.json`
//! directly (without an `AppHandle`) using the same path Tauri would
//! resolve via `app_config_dir()`. If the file is missing or invalid
//! we fall back to the same defaults declared in `AppSettings::default()`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{filter::EnvFilter, fmt, layer::SubscriberExt, reload, util::SubscriberInitExt};

use crate::models::settings::AppSettings;

/// Same identifier as `tauri.conf.json` `identifier`. Used to resolve
/// the per-app config and data dirs without going through Tauri.
const APP_IDENTIFIER: &str = "com.brows3r.app";
const LOG_FILE_PREFIX: &str = "brows3r.log";

/// Globally-held state for the logging subsystem. The `WorkerGuard`
/// must outlive the process so that the non-blocking file writer keeps
/// flushing; storing it here in a `OnceLock` does the trick.
pub struct LoggingState {
    reload: Option<reload::Handle<EnvFilter, tracing_subscriber::Registry>>,
    _file_guard: Option<WorkerGuard>,
    pub log_dir: Option<PathBuf>,
}

static LOGGING: OnceLock<LoggingState> = OnceLock::new();

/// Resolve the directory Tauri would use as `app_config_dir`. On Linux
/// this matches `XDG_CONFIG_HOME/<identifier>` (~/.config/<identifier>).
pub fn config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join(APP_IDENTIFIER))
}

/// Default log directory: `<app local data>/logs`.
pub fn default_log_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|p| p.join(APP_IDENTIFIER).join("logs"))
}

/// Resolve the effective log directory based on user settings.
pub fn resolve_log_dir(settings: &AppSettings) -> Option<PathBuf> {
    settings
        .general
        .log_directory
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| PathBuf::from(shellexpand_home(s)))
        .or_else(default_log_dir)
}

/// Tiny `~` expansion to keep the settings file portable across users
/// without pulling in shellexpand as a dep.
fn shellexpand_home(s: &str) -> String {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    s.to_string()
}

/// Load settings from disk *before* Tauri is up. Returns defaults on
/// any error so logging always has something to work with.
fn load_settings_early() -> AppSettings {
    let Some(dir) = config_dir() else {
        return AppSettings::default();
    };
    let path = dir.join("settings.json");
    if !path.exists() {
        return AppSettings::default();
    }
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return AppSettings::default(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Initialize the global tracing subscriber. Should be called exactly
/// once at app startup, before any code that emits traces.
pub fn init() {
    let settings = load_settings_early();
    init_with_settings(&settings);
}

fn init_with_settings(settings: &AppSettings) {
    // Build the env filter. RUST_LOG always wins over settings, which
    // lets developers debug a release build without changing settings.
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(settings.general.log_level.as_str()));
    let (filter_layer, reload_handle) = reload::Layer::new(env_filter);

    let stdout_layer = fmt::layer().with_writer(std::io::stdout).with_ansi(true);

    // Try to set up the file appender. If anything fails (read-only
    // filesystem, permission denied, ...) we silently degrade to
    // stdout-only — file logging is a nice-to-have, not a hard
    // requirement.
    let log_dir = resolve_log_dir(settings);

    if settings.general.file_log_enabled {
        if let Some(dir) = log_dir.as_ref() {
            if let Err(e) = std::fs::create_dir_all(dir) {
                eprintln!("brows3r: cannot create log dir {}: {}", dir.display(), e);
            } else {
                let appender = tracing_appender::rolling::daily(dir, LOG_FILE_PREFIX);
                let (non_blocking, guard) = tracing_appender::non_blocking(appender);

                let file_layer = fmt::layer().with_writer(non_blocking).with_ansi(false);

                let result = tracing_subscriber::registry()
                    .with(filter_layer)
                    .with(stdout_layer)
                    .with(file_layer)
                    .try_init();
                if let Err(e) = result {
                    eprintln!("brows3r: tracing init failed: {e}");
                }

                let _ = LOGGING.set(LoggingState {
                    reload: Some(reload_handle),
                    _file_guard: Some(guard),
                    log_dir: Some(dir.clone()),
                });

                purge_old_logs(dir, settings.general.log_retention_days);
                return;
            }
        }
    }

    // Stdout-only fallback path.
    let result = tracing_subscriber::registry()
        .with(filter_layer)
        .with(stdout_layer)
        .try_init();
    if let Err(e) = result {
        eprintln!("brows3r: tracing init failed: {e}");
    }
    let _ = LOGGING.set(LoggingState {
        reload: Some(reload_handle),
        _file_guard: None,
        log_dir: None,
    });
}

/// Returns the active log directory, if any.
pub fn current_log_dir() -> Option<PathBuf> {
    LOGGING.get().and_then(|s| s.log_dir.clone())
}

/// Apply a new log level at runtime. The string is parsed as an
/// `EnvFilter` directive ("info", "debug", "brows3r=trace,info", ...).
pub fn apply_log_level(directive: &str) -> Result<(), String> {
    let state = LOGGING.get().ok_or("logging not initialized")?;
    let handle = state.reload.as_ref().ok_or("reload handle missing")?;
    let new_filter =
        EnvFilter::try_new(directive).map_err(|e| format!("invalid log directive: {e}"))?;
    handle
        .reload(new_filter)
        .map_err(|e| format!("failed to reload filter: {e}"))
}

/// Delete rotated log files older than `retention_days`. A value of 0
/// disables purging entirely.
pub fn purge_old_logs(dir: &Path, retention_days: u32) {
    if retention_days == 0 {
        return;
    }
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(
            u64::from(retention_days) * 86_400,
        ))
        .unwrap_or(std::time::UNIX_EPOCH);

    for entry in read_dir.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        // Only touch files we created (rolling appender produces names
        // like "brows3r.log.YYYY-MM-DD"). Leave anything else alone so
        // we never delete user-placed files in a custom directory.
        if !name.starts_with(LOG_FILE_PREFIX) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else { continue };
        if modified < cutoff {
            if let Err(e) = std::fs::remove_file(&path) {
                tracing::warn!("failed to purge old log {}: {}", path.display(), e);
            }
        }
    }
}
