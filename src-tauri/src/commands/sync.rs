//! Tauri commands for the sync feature. Two calls:
//!   `plan_sync`    — enumerate + diff, return a `SyncPlan` (fast-ish,
//!                    dominated by a `list_objects_v2` loop + possible
//!                    `head_object` calls for same-size comparisons).
//!   `execute_sync` — run the actions the user approved, streaming per-
//!                    action events so the frontend can render a live log.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::models::sync::{
    ExecuteSyncRequest, PlanSyncRequest, SyncActionEvent, SyncActionKind, SyncActionStatus,
    SyncCompleteEvent, SyncPlan,
};
use crate::s3::client::S3ClientPool;
use crate::store::credentials;
use crate::store::database::Database;
use crate::transfer::sync::{mtime_metadata, validate_execute_paths};
use crate::transfer::throttle::BandwidthThrottle;

use super::connection::build_s3_config;
use super::transfer::build_exclude_set;

#[tauri::command]
pub async fn plan_sync(
    app: AppHandle,
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    request: PlanSyncRequest,
) -> Result<SyncPlan, String> {
    let client = build_client(&app, &db, &pool, &request.connection_id).await?;

    // Reuse the upload exclude patterns from settings — same "noise files
    // I don't want synced" list users already configure.
    let settings = crate::store::config::load_settings(&app);
    let exclude = build_exclude_set(&settings.transfer.upload_exclude_patterns)?;

    crate::transfer::sync::plan_sync(&client, &request, exclude.as_ref()).await
}

#[tauri::command]
pub async fn execute_sync(
    app: AppHandle,
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    throttle: State<'_, Arc<BandwidthThrottle>>,
    request: ExecuteSyncRequest,
) -> Result<String, String> {
    validate_execute_paths(&request)?;

    let client = build_client(&app, &db, &pool, &request.connection_id).await?;
    let throttle = Arc::clone(throttle.inner());

    let sync_id = if request.sync_id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        request.sync_id.clone()
    };

    let app_handle = app.clone();
    let sid = sync_id.clone();
    tokio::spawn(async move {
        run_sync(app_handle, client, throttle, request, sid).await;
    });

    Ok(sync_id)
}

async fn build_client(
    _app: &AppHandle,
    db: &State<'_, Database>,
    pool: &State<'_, S3ClientPool>,
    connection_id: &str,
) -> Result<aws_sdk_s3::Client, String> {
    let conn = crate::store::database::get_connection(db, connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connection not found: {connection_id}"))?;
    let secret_key = credentials::get_secret_key(connection_id).or_else(|_| {
        crate::store::database::get_db_secret(db, connection_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Secret key not found for connection {connection_id}"))
    })?;
    let session_token = credentials::get_session_token(connection_id).unwrap_or_else(|_| {
        crate::store::database::get_db_session_token(db, connection_id).unwrap_or(None)
    });
    let config = build_s3_config(&conn, &secret_key, session_token.as_deref());
    pool.get_or_create(connection_id, &config)
        .await
        .map_err(|e| e.to_string())
}

async fn run_sync(
    app: AppHandle,
    client: aws_sdk_s3::Client,
    throttle: Arc<BandwidthThrottle>,
    request: ExecuteSyncRequest,
    sync_id: String,
) {
    let local_root = PathBuf::from(&request.local_dir);
    let prefix = request.prefix.clone();
    let bucket = request.bucket.clone();

    let mut succeeded: u32 = 0;
    let mut failed: u32 = 0;
    let mut skipped: u32 = 0;

    for action in &request.actions {
        if matches!(action.kind, SyncActionKind::Skip) {
            skipped += 1;
            emit_action(
                &app,
                &sync_id,
                action.kind,
                &action.rel_path,
                SyncActionStatus::Completed,
                None,
            );
            continue;
        }

        emit_action(
            &app,
            &sync_id,
            action.kind,
            &action.rel_path,
            SyncActionStatus::Started,
            None,
        );

        let result: Result<(), String> = match action.kind {
            SyncActionKind::Upload => {
                let local_path = local_root.join(&action.rel_path);
                let key = compose_key(&prefix, &action.rel_path);
                do_upload(&client, &bucket, &key, &local_path).await
            }
            SyncActionKind::Download => {
                let local_path = local_root.join(&action.rel_path);
                let key = compose_key(&prefix, &action.rel_path);
                do_download(&client, &bucket, &key, &local_path, Arc::clone(&throttle)).await
            }
            SyncActionKind::DeleteRemote => {
                let key = compose_key(&prefix, &action.rel_path);
                client
                    .delete_object()
                    .bucket(&bucket)
                    .key(&key)
                    .send()
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
            SyncActionKind::DeleteLocal => {
                let local_path = local_root.join(&action.rel_path);
                tokio::fs::remove_file(&local_path)
                    .await
                    .map_err(|e| e.to_string())
            }
            SyncActionKind::Skip => unreachable!("handled above"),
        };

        match result {
            Ok(()) => {
                succeeded += 1;
                emit_action(
                    &app,
                    &sync_id,
                    action.kind,
                    &action.rel_path,
                    SyncActionStatus::Completed,
                    None,
                );
            }
            Err(e) => {
                failed += 1;
                tracing::error!(
                    "sync[{}] {} {:?} failed: {}",
                    sync_id,
                    action.rel_path,
                    action.kind,
                    e
                );
                emit_action(
                    &app,
                    &sync_id,
                    action.kind,
                    &action.rel_path,
                    SyncActionStatus::Failed,
                    Some(e),
                );
            }
        }
    }

    let _ = app.emit(
        "sync:complete",
        SyncCompleteEvent {
            sync_id: sync_id.clone(),
            succeeded,
            failed,
            skipped,
        },
    );
    tracing::info!(
        "sync[{}] done — {} succeeded, {} failed, {} skipped",
        sync_id,
        succeeded,
        failed,
        skipped
    );
}

fn emit_action(
    app: &AppHandle,
    sync_id: &str,
    kind: SyncActionKind,
    rel_path: &str,
    status: SyncActionStatus,
    error: Option<String>,
) {
    let _ = app.emit(
        "sync:action",
        SyncActionEvent {
            sync_id: sync_id.to_string(),
            rel_path: rel_path.to_string(),
            kind,
            status,
            error,
        },
    );
}

fn compose_key(prefix: &str, rel: &str) -> String {
    if prefix.is_empty() {
        rel.to_string()
    } else if prefix.ends_with('/') {
        format!("{prefix}{rel}")
    } else {
        format!("{prefix}/{rel}")
    }
}

async fn do_upload(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
    local_path: &Path,
) -> Result<(), String> {
    let meta = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| format!("stat {}: {}", local_path.display(), e))?;
    let mtime: DateTime<Utc> = meta
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
        .unwrap_or_else(Utc::now);

    crate::transfer::upload::upload_file(
        client,
        bucket,
        key,
        local_path,
        None,
        None,
        |_uploaded, _total| {
            // Per-byte progress for sync uploads is intentionally dropped —
            // the UI only tracks per-file action status. Adding byte-level
            // progress would mean giving every action a unique transfer id
            // and plumbing it through; not worth the noise for v1.
        },
        None,
        Some(mtime_metadata(mtime)),
    )
    .await
    .map(|_etag| ())
    .map_err(|e| e.to_string())
}

async fn do_download(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
    local_path: &Path,
    throttle: Arc<BandwidthThrottle>,
) -> Result<(), String> {
    crate::transfer::download::download_file(
        client,
        bucket,
        key,
        local_path,
        Some(throttle),
        |_downloaded, _total| {},
    )
    .await
    .map_err(|e| e.to_string())?;

    // Stamp the local file's mtime with the S3 object's stored mtime so
    // the NEXT sync in the other direction doesn't see the freshly-
    // downloaded file as "newer than source". Best-effort — if we can't
    // read or set the time, just leave it alone.
    if let Ok(head) = client.head_object().bucket(bucket).key(key).send().await {
        if let Some(md) = head.metadata() {
            if let Some(raw) = md.get(crate::transfer::sync::MTIME_METADATA_KEY) {
                if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
                    let ts = filetime::FileTime::from_unix_time(
                        dt.timestamp(),
                        dt.timestamp_subsec_nanos(),
                    );
                    let _ = filetime::set_file_mtime(local_path, ts);
                }
            }
        }
    }

    Ok(())
}
