use tauri::{Emitter, State, AppHandle};

use crate::models::transfer::{
    StartDownloadRequest, StartUploadRequest, TransferCompleteEvent, TransferItem,
    TransferProgressEvent, TransferStatus,
};
use crate::s3::client::S3ClientPool;
use crate::store::credentials;
use crate::store::database::Database;
use crate::transfer::queue::TransferQueue;

use super::connection::build_s3_config;

#[tauri::command]
pub async fn start_upload(
    app: AppHandle,
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    queue: State<'_, TransferQueue>,
    request: StartUploadRequest,
) -> Result<Vec<String>, String> {
    let conn = crate::store::database::get_connection(&db, &request.connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connection not found: {}", request.connection_id))?;

    let secret_key = credentials::get_secret_key(&request.connection_id)
        .or_else(|_| {
            crate::store::database::get_db_secret(&db, &request.connection_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Secret key not found for connection {}", request.connection_id))
        })?;
    let session_token = credentials::get_session_token(&request.connection_id)
        .unwrap_or_else(|_| {
            crate::store::database::get_db_session_token(&db, &request.connection_id)
                .unwrap_or(None)
        });
    let config = build_s3_config(&conn, &secret_key, session_token.as_deref());

    let client = pool
        .get_or_create(&request.connection_id, &config)
        .await
        .map_err(|e| e.to_string())?;

    let mut transfer_ids = Vec::new();

    for local_path in &request.local_paths {
        let path = std::path::Path::new(local_path);
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");

        let key = match &request.prefix {
            Some(prefix) => format!("{prefix}{file_name}"),
            None => file_name.to_string(),
        };

        let file_size = tokio::fs::metadata(path)
            .await
            .map_err(|e| e.to_string())?
            .len() as i64;

        let item = TransferItem::new_upload(
            request.connection_id.clone(),
            request.bucket.clone(),
            key.clone(),
            local_path.clone(),
            file_size,
        );

        let transfer_id = item.id.clone();
        transfer_ids.push(transfer_id.clone());

        queue.enqueue(item).await;

        // Spawn the upload task
        let app_handle = app.clone();
        let client = client.clone();
        let bucket = request.bucket.clone();
        let local = local_path.clone();
        let tid = transfer_id.clone();

        let progress_tid = tid.clone();
        let progress_app = app_handle.clone();
        tokio::spawn(async move {
            let result = crate::transfer::upload::upload_file(
                &client,
                &bucket,
                &key,
                std::path::Path::new(&local),
                None,
                None,
                move |uploaded, total| {
                    let speed = 0i64; // TODO: calculate actual speed
                    let eta = if speed > 0 {
                        ((total - uploaded) as i64) / speed
                    } else {
                        0
                    };

                    let _ = progress_app.emit(
                        "transfer:progress",
                        TransferProgressEvent {
                            id: progress_tid.clone(),
                            transferred_bytes: uploaded as i64,
                            total_bytes: total as i64,
                            speed_bps: speed,
                            eta_secs: eta,
                        },
                    );
                },
            )
            .await;

            match result {
                Ok(etag) => {
                    let _ = app_handle.emit(
                        "transfer:complete",
                        TransferCompleteEvent {
                            id: tid,
                            success: true,
                            error: None,
                            etag: Some(etag),
                        },
                    );
                }
                Err(e) => {
                    let _ = app_handle.emit(
                        "transfer:complete",
                        TransferCompleteEvent {
                            id: tid,
                            success: false,
                            error: Some(e.to_string()),
                            etag: None,
                        },
                    );
                }
            }
        });
    }

    Ok(transfer_ids)
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    queue: State<'_, TransferQueue>,
    request: StartDownloadRequest,
) -> Result<Vec<String>, String> {
    let conn = crate::store::database::get_connection(&db, &request.connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connection not found: {}", request.connection_id))?;

    let secret_key = credentials::get_secret_key(&request.connection_id)
        .or_else(|_| {
            crate::store::database::get_db_secret(&db, &request.connection_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Secret key not found for connection {}", request.connection_id))
        })?;
    let session_token = credentials::get_session_token(&request.connection_id)
        .unwrap_or_else(|_| {
            crate::store::database::get_db_session_token(&db, &request.connection_id)
                .unwrap_or(None)
        });
    let config = build_s3_config(&conn, &secret_key, session_token.as_deref());

    let client = pool
        .get_or_create(&request.connection_id, &config)
        .await
        .map_err(|e| e.to_string())?;

    let mut transfer_ids = Vec::new();

    for key in &request.keys {
        let file_name = key.rsplit('/').next().unwrap_or(key);
        let local_path = std::path::Path::new(&request.local_dir).join(file_name);
        let local_path_str = local_path.to_string_lossy().to_string();

        // Get file size via HeadObject
        let head = client
            .head_object()
            .bucket(&request.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let file_size = head.content_length().unwrap_or(0);

        let item = TransferItem::new_download(
            request.connection_id.clone(),
            request.bucket.clone(),
            key.clone(),
            local_path_str.clone(),
            file_size,
        );

        let transfer_id = item.id.clone();
        transfer_ids.push(transfer_id.clone());

        queue.enqueue(item).await;

        // Spawn the download task
        let app_handle = app.clone();
        let client = client.clone();
        let bucket = request.bucket.clone();
        let key = key.clone();
        let tid = transfer_id.clone();

        tokio::spawn(async move {
            let result = crate::transfer::download::download_file(
                &client,
                &bucket,
                &key,
                &local_path,
                |downloaded, total| {
                    let _ = app_handle.emit(
                        "transfer:progress",
                        TransferProgressEvent {
                            id: tid.clone(),
                            transferred_bytes: downloaded as i64,
                            total_bytes: total as i64,
                            speed_bps: 0,
                            eta_secs: 0,
                        },
                    );
                },
            )
            .await;

            match result {
                Ok(()) => {
                    let _ = app_handle.emit(
                        "transfer:complete",
                        TransferCompleteEvent {
                            id: tid,
                            success: true,
                            error: None,
                            etag: None,
                        },
                    );
                }
                Err(e) => {
                    let _ = app_handle.emit(
                        "transfer:complete",
                        TransferCompleteEvent {
                            id: tid,
                            success: false,
                            error: Some(e.to_string()),
                            etag: None,
                        },
                    );
                }
            }
        });
    }

    Ok(transfer_ids)
}

#[tauri::command]
pub async fn pause_transfer(
    queue: State<'_, TransferQueue>,
    id: String,
) -> Result<(), String> {
    queue.update_status(&id, TransferStatus::Paused).await;
    Ok(())
}

#[tauri::command]
pub async fn resume_transfer(
    queue: State<'_, TransferQueue>,
    id: String,
) -> Result<(), String> {
    queue.update_status(&id, TransferStatus::InProgress).await;
    Ok(())
}

#[tauri::command]
pub async fn cancel_transfer(
    queue: State<'_, TransferQueue>,
    id: String,
) -> Result<(), String> {
    queue.update_status(&id, TransferStatus::Cancelled).await;
    Ok(())
}

#[tauri::command]
pub async fn list_transfers(queue: State<'_, TransferQueue>) -> Result<Vec<TransferItem>, String> {
    Ok(queue.list().await)
}
