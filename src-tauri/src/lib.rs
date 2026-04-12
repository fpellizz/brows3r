mod commands;
mod models;
mod s3;
mod store;
mod transfer;

use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(s3::client::S3ClientPool::new())
        .manage(transfer::queue::TransferQueue::new(4))
        .setup(|app| {
            // Initialize database
            let app_handle = app.handle().clone();
            store::database::init(&app_handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Connection commands
            commands::connection::list_connections,
            commands::connection::get_connection,
            commands::connection::create_connection,
            commands::connection::update_connection,
            commands::connection::delete_connection,
            commands::connection::test_connection,
            commands::connection::test_connection_inline,
            // Bucket commands
            commands::bucket::list_buckets,
            commands::bucket::create_bucket,
            commands::bucket::delete_bucket,
            commands::bucket::get_bucket_info,
            // Object commands
            commands::object::list_objects,
            commands::object::head_object,
            commands::object::delete_objects,
            commands::object::copy_object,
            commands::object::move_object,
            commands::object::rename_object,
            commands::object::create_folder,
            commands::object::update_object_metadata,
            commands::object::get_presigned_url,
            commands::object::get_object_preview,
            // Transfer commands
            commands::transfer::start_upload,
            commands::transfer::start_download,
            commands::transfer::pause_transfer,
            commands::transfer::resume_transfer,
            commands::transfer::cancel_transfer,
            commands::transfer::list_transfers,
            // Import commands
            commands::import::import_connections,
            // Config commands
            commands::config::get_settings,
            commands::config::update_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running brows3r");
}
