use std::sync::Arc;

use globset::{Glob, GlobSetBuilder};
use tauri::{Emitter, Manager, State, AppHandle};

use crate::models::transfer::{
    RecoverableUpload, StartDownloadRequest, StartUploadRequest, TransferCompleteEvent,
    TransferItem, TransferProgressEvent, TransferStatus, TransferType, UploadedPart,
};
use crate::s3::client::S3ClientPool;
use crate::s3::multipart::MultipartPersistence;
use crate::store::credentials;
use crate::store::database::Database;
use crate::transfer::queue::TransferQueue;
use crate::transfer::throttle::BandwidthThrottle;

use super::connection::build_s3_config;

/// Bridges the `MultipartPersistence` trait (in the S3 layer) to the SQLite
/// `pending_transfers` table. Held as `Arc<dyn ...>` so the multipart
/// uploader's parallel part tasks all share the same persistence sink.
struct DbMultipartPersistence {
    app: AppHandle,
    transfer_id: String,
}

impl MultipartPersistence for DbMultipartPersistence {
    fn record_upload_id(&self, upload_id: &str, part_size_bytes: i64) {
        let db = self.app.state::<Database>();
        if let Err(e) = crate::store::database::update_pending_upload_id(
            &db,
            &self.transfer_id,
            upload_id,
            part_size_bytes,
        ) {
            tracing::warn!(
                "Failed to persist upload_id for transfer {}: {}",
                self.transfer_id,
                e
            );
        }
    }

    fn record_part(&self, part: UploadedPart) {
        let db = self.app.state::<Database>();
        if let Err(e) =
            crate::store::database::append_pending_part(&db, &self.transfer_id, part)
        {
            tracing::warn!(
                "Failed to persist completed part for transfer {}: {}",
                self.transfer_id,
                e
            );
        }
    }
}

/// Build a GlobSet from user-configured exclude patterns. Returns an error
/// (with the offending pattern) if any pattern is invalid, so the user gets
/// a clear message instead of a silent drop.
pub(crate) fn build_exclude_set(
    patterns: &[String],
) -> Result<Option<globset::GlobSet>, String> {
    let cleaned: Vec<&String> = patterns
        .iter()
        .filter(|p| !p.trim().is_empty())
        .collect();
    if cleaned.is_empty() {
        return Ok(None);
    }
    let mut builder = GlobSetBuilder::new();
    for p in cleaned {
        let glob = Glob::new(p.trim())
            .map_err(|e| format!("Invalid exclude pattern '{p}': {e}"))?;
        builder.add(glob);
    }
    builder
        .build()
        .map(Some)
        .map_err(|e| format!("Failed to build exclude pattern set: {e}"))
}

#[tauri::command]
pub async fn start_upload(
    app: AppHandle,
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    queue: State<'_, TransferQueue>,
    request: StartUploadRequest,
) -> Result<Vec<String>, String> {
    // Apply user-configured glob exclude patterns (matched against file
    // basenames). Skipped files are silently dropped from the queue — the
    // caller can compare returned IDs vs requested paths to detect skips.
    let settings = crate::store::config::load_settings(&app);
    let exclude_set = build_exclude_set(&settings.transfer.upload_exclude_patterns)?;
    let local_paths: Vec<String> = if let Some(set) = &exclude_set {
        request
            .local_paths
            .iter()
            .filter(|p| {
                let basename = std::path::Path::new(p)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                !set.is_match(basename)
            })
            .cloned()
            .collect()
    } else {
        request.local_paths.clone()
    };

    if local_paths.is_empty() {
        return Ok(Vec::new());
    }

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

    for local_path in &local_paths {
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

        // Persist BEFORE the upload task starts so a crash between enqueue
        // and the first network call still leaves a row to recover (or
        // discard) on next launch. Failures here are logged but don't
        // block the upload — persistence is best-effort, the upload itself
        // is the source of truth.
        if let Err(e) = crate::store::database::insert_pending_transfer(&db, &item) {
            tracing::warn!("Failed to persist pending transfer {}: {}", item.id, e);
        }

        queue.enqueue(item).await;

        // Spawn the upload task
        let app_handle = app.clone();
        let client = client.clone();
        let bucket = request.bucket.clone();
        let local = local_path.clone();
        let tid = transfer_id.clone();

        let progress_tid = tid.clone();
        let progress_app = app_handle.clone();
        let persistence: Arc<dyn MultipartPersistence> = Arc::new(DbMultipartPersistence {
            app: app_handle.clone(),
            transfer_id: tid.clone(),
        });
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
                Some(persistence),
            )
            .await;

            // Clean up the pending row. On success the upload is done, so
            // there's nothing to recover. On failure we ALSO delete: the
            // user can retry from the UI, and leaving stale rows around
            // would clutter the recovery dialog with already-failed
            // attempts. (User-initiated cancel goes through a different
            // path that calls `abort_multipart_upload` first.)
            let db = app_handle.state::<Database>();
            let _ = crate::store::database::delete_pending_transfer(&db, &tid);

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
    throttle: State<'_, Arc<BandwidthThrottle>>,
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
        let dl_throttle = Arc::clone(&throttle);

        tokio::spawn(async move {
            let result = crate::transfer::download::download_file(
                &client,
                &bucket,
                &key,
                &local_path,
                Some(dl_throttle),
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

/// List all multipart uploads that were interrupted on the previous run
/// (or earlier — anything still sitting in `pending_transfers` with an
/// `upload_id`). Called by the frontend on app startup so the user can
/// choose to Resume or Discard each one.
#[tauri::command]
pub async fn list_recoverable_uploads(
    db: State<'_, Database>,
) -> Result<Vec<RecoverableUpload>, String> {
    crate::store::database::list_recoverable_uploads(&db).map_err(|e| e.to_string())
}

/// Resume a previously-interrupted multipart upload. Looks up the saved
/// upload_id + part_size in `pending_transfers`, asks S3 which parts are
/// already there (source of truth), uploads the missing ones, and
/// completes the upload. Emits the same `transfer:progress` and
/// `transfer:complete` events as a fresh upload so the existing UI
/// observes it transparently.
#[tauri::command]
pub async fn resume_upload(
    app: AppHandle,
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    queue: State<'_, TransferQueue>,
    transfer_id: String,
) -> Result<(), String> {
    let pending = crate::store::database::get_pending_multipart(&db, &transfer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Recoverable upload not found: {transfer_id}"))?;

    // Connection still exists?
    let conn = crate::store::database::get_connection(&db, &pending.connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            format!(
                "Connection {} no longer exists; please discard this upload.",
                pending.connection_id
            )
        })?;

    // Local file still exists and matches the recorded size?
    let metadata = tokio::fs::metadata(&pending.local_path)
        .await
        .map_err(|e| format!("Local file '{}' is no longer accessible: {e}", pending.local_path))?;
    if metadata.len() as i64 != pending.total_bytes {
        return Err(format!(
            "Local file size changed since upload was interrupted (was {}, now {}); cannot resume safely.",
            pending.total_bytes,
            metadata.len()
        ));
    }

    let secret_key = credentials::get_secret_key(&pending.connection_id)
        .or_else(|_| {
            crate::store::database::get_db_secret(&db, &pending.connection_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| {
                    format!("Secret key not found for connection {}", pending.connection_id)
                })
        })?;
    let session_token = credentials::get_session_token(&pending.connection_id)
        .unwrap_or_else(|_| {
            crate::store::database::get_db_session_token(&db, &pending.connection_id)
                .unwrap_or(None)
        });
    let config = build_s3_config(&conn, &secret_key, session_token.as_deref());
    let client = pool
        .get_or_create(&pending.connection_id, &config)
        .await
        .map_err(|e| e.to_string())?;

    // Re-add to the in-memory queue so the existing UI shows progress.
    let item = TransferItem {
        id: pending.id.clone(),
        transfer_type: TransferType::Upload,
        connection_id: pending.connection_id.clone(),
        bucket: pending.bucket.clone(),
        key: pending.key.clone(),
        local_path: pending.local_path.clone(),
        total_bytes: pending.total_bytes,
        transferred_bytes: pending.uploaded_bytes,
        status: TransferStatus::InProgress,
        speed_bps: None,
        eta_secs: None,
        error: None,
        created_at: pending.created_at.clone(),
        completed_at: None,
    };
    queue.enqueue(item).await;

    let app_handle = app.clone();
    let tid = pending.id.clone();
    let bucket = pending.bucket.clone();
    let key = pending.key.clone();
    let local_path = pending.local_path.clone();
    let upload_id = pending.upload_id.clone();
    let part_size = pending.part_size_bytes.max(1) as usize;

    let progress_tid = tid.clone();
    let progress_app = app_handle.clone();
    let persistence: Arc<dyn MultipartPersistence> = Arc::new(DbMultipartPersistence {
        app: app_handle.clone(),
        transfer_id: tid.clone(),
    });

    tracing::info!(
        "resume_upload: starting transfer {} (upload_id={}, {}/{} bytes already uploaded)",
        tid,
        upload_id,
        pending.uploaded_bytes,
        pending.total_bytes,
    );

    tokio::spawn(async move {
        tracing::info!("resume_upload[{}]: calling list_parts on S3...", tid);
        let result = crate::s3::multipart::resume_upload(
            &client,
            &bucket,
            &key,
            std::path::Path::new(&local_path),
            &upload_id,
            part_size,
            None,
            move |uploaded, total| {
                let _ = progress_app.emit(
                    "transfer:progress",
                    TransferProgressEvent {
                        id: progress_tid.clone(),
                        transferred_bytes: uploaded as i64,
                        total_bytes: total as i64,
                        speed_bps: 0,
                        eta_secs: 0,
                    },
                );
            },
            Some(persistence),
        )
        .await;

        let db = app_handle.state::<Database>();
        let _ = crate::store::database::delete_pending_transfer(&db, &tid);

        match result {
            Ok(etag) => {
                tracing::info!("resume_upload[{}]: completed successfully (etag={})", tid, etag);
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
                tracing::error!("resume_upload[{}]: FAILED: {}", tid, e);
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

    Ok(())
}

/// Abort the multipart upload on S3 and remove the recovery row. Best-effort
/// — if `abort_multipart_upload` fails (network down, upload already gone)
/// we still delete the local row so it stops cluttering the recovery UI.
#[tauri::command]
pub async fn discard_upload(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    transfer_id: String,
) -> Result<(), String> {
    let pending = crate::store::database::get_pending_multipart(&db, &transfer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Recoverable upload not found: {transfer_id}"))?;

    // Try to abort on S3, but don't let abort failures block the local
    // cleanup — orphaned uploads on S3 will be auto-cleaned by lifecycle
    // policies (and the user can always discover them via the AWS console).
    if let Ok(Some(conn)) = crate::store::database::get_connection(&db, &pending.connection_id) {
        let secret_key = credentials::get_secret_key(&pending.connection_id)
            .or_else(|_| {
                crate::store::database::get_db_secret(&db, &pending.connection_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "Secret key not found".to_string())
            })
            .ok();
        if let Some(sk) = secret_key {
            let session_token = credentials::get_session_token(&pending.connection_id)
                .unwrap_or_else(|_| {
                    crate::store::database::get_db_session_token(&db, &pending.connection_id)
                        .unwrap_or(None)
                });
            let config = build_s3_config(&conn, &sk, session_token.as_deref());
            if let Ok(client) = pool.get_or_create(&pending.connection_id, &config).await {
                let _ = client
                    .abort_multipart_upload()
                    .bucket(&pending.bucket)
                    .key(&pending.key)
                    .upload_id(&pending.upload_id)
                    .send()
                    .await;
            }
        }
    }

    crate::store::database::delete_pending_transfer(&db, &transfer_id)
        .map_err(|e| e.to_string())
}
