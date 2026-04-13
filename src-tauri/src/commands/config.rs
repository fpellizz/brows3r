use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::models::settings::AppSettings;
use crate::transfer::throttle::BandwidthThrottle;

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
    // Update throttle config from settings
    throttle.update_config(
        settings.transfer.max_bandwidth_mbps,
        settings.transfer.bandwidth_schedules.clone(),
    );

    crate::store::config::save_settings(&app, &settings)
}
