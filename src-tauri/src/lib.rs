mod commands;
mod models;
mod s3;
mod store;
mod transfer;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging (stdout + optional rotating file appender).
    // Reads the user's settings.json directly so the chosen level /
    // log directory / retention are honored from the very first line.
    store::logging::init();

    if let Some(dir) = store::logging::current_log_dir() {
        tracing::info!("File logging enabled: {}", dir.display());
    }

    // Surface missing native libraries early. If a hard dependency was
    // missing the dynamic loader would already have aborted the process
    // before we reach this point — but optional ones still get logged.
    commands::system::log_startup_check();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(s3::client::S3ClientPool::new())
        .manage(transfer::queue::TransferQueue::new(4))
        .manage(std::sync::Arc::new(transfer::throttle::BandwidthThrottle::new()))
        .setup(|app| {
            // Initialize database
            let app_handle = app.handle().clone();
            store::database::init(&app_handle)?;

            // Restore pending transfers from the DB into the in-memory
            // queue so the transfer panel shows items that were in flight
            // when the app was last closed. Multipart uploads are handled
            // separately by the recovery dialog; non-multipart items just
            // appear as "Queued" so the user can see they exist (and
            // re-trigger if needed).
            let db_state = app.state::<store::database::Database>();
            if let Ok(pending) = store::database::list_all_pending(&db_state) {
                let count = pending.len();
                let restore_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let queue = restore_handle.state::<transfer::queue::TransferQueue>();
                    for item in pending {
                        queue.enqueue(item).await;
                    }
                    if count > 0 {
                        tracing::info!("Restored {} pending transfer(s) from DB", count);
                    }
                });
            }

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
            commands::bucket::set_bucket_versioning,
            commands::bucket::get_bucket_encryption,
            commands::bucket::set_bucket_encryption,
            commands::bucket::delete_bucket_encryption,
            commands::bucket::get_bucket_policy,
            commands::bucket::set_bucket_policy,
            commands::bucket::delete_bucket_policy,
            commands::bucket::get_bucket_cors,
            commands::bucket::set_bucket_cors,
            commands::bucket::delete_bucket_cors,
            commands::bucket::get_bucket_lifecycle,
            commands::bucket::set_bucket_lifecycle,
            commands::bucket::delete_bucket_lifecycle,
            commands::bucket::compute_bucket_stats,
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
            commands::object::list_object_versions,
            commands::object::get_bucket_versioning,
            commands::object::delete_object_version,
            commands::object::restore_object_version,
            // Transfer commands
            commands::transfer::start_upload,
            commands::transfer::start_download,
            commands::transfer::pause_transfer,
            commands::transfer::resume_transfer,
            commands::transfer::cancel_transfer,
            commands::transfer::list_transfers,
            commands::transfer::list_transfer_history,
            commands::transfer::clear_finished_transfers,
            commands::transfer::start_cross_transfer,
            commands::transfer::list_recoverable_uploads,
            commands::transfer::resume_upload,
            commands::transfer::discard_upload,
            // Import commands
            commands::import::import_connections,
            // Config commands
            commands::config::get_settings,
            commands::config::update_settings,
            commands::config::get_log_dir_info,
            commands::config::open_path,
            // Sync commands
            commands::sync::plan_sync,
            commands::sync::execute_sync,
            // Batch operations
            commands::batch::start_batch_operation,
            // System commands
            commands::system::check_system_prerequisites,
        ])
        .run({
            let mut ctx = tauri::generate_context!();
            ctx.set_default_window_icon(Some(
                tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
                    .expect("failed to decode app icon"),
            ));
            ctx
        })
        .expect("error while running brows3r");
}
