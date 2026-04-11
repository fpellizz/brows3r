use tauri::AppHandle;

use crate::models::settings::AppSettings;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    Ok(crate::store::config::load_settings(&app))
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    crate::store::config::save_settings(&app, &settings)
}
