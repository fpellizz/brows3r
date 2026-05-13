//! Batch operations applied to a set of object keys in a bucket.
//!
//! Today supports: storage-class change, content-type change, canned
//! ACL change. Per-key progress and final summary are streamed to the
//! frontend as Tauri events.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::s3::client::S3ClientPool;
use crate::store::credentials;
use crate::store::database::Database;

use super::connection::build_s3_config;

/// Operation to apply to every object key. `serde(tag = "type")`
/// matches a sum-type the React side encodes as
/// `{ "type": "set_storage_class", "storage_class": "STANDARD_IA" }`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BatchOp {
    SetStorageClass { storage_class: String },
    SetContentType { content_type: String },
    SetAcl { acl: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BatchProgressEvent {
    pub batch_id: String,
    pub key: String,
    pub status: String, // "ok" or "error"
    pub error: Option<String>,
    pub completed: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BatchCompleteEvent {
    pub batch_id: String,
    pub succeeded: u32,
    pub failed: u32,
}

#[tauri::command]
pub async fn start_batch_operation(
    app: AppHandle,
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    keys: Vec<String>,
    operation: BatchOp,
) -> Result<String, String> {
    // Build the client up front, on the calling task, so any
    // configuration error surfaces synchronously from the command.
    let conn = crate::store::database::get_connection(&db, &connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connection not found: {connection_id}"))?;
    let secret = credentials::get_secret_key(&connection_id).or_else(|_| {
        crate::store::database::get_db_secret(&db, &connection_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Secret key not found for connection {connection_id}"))
    })?;
    let session_token = credentials::get_session_token(&connection_id).unwrap_or_else(|_| {
        crate::store::database::get_db_session_token(&db, &connection_id).unwrap_or(None)
    });
    let config = build_s3_config(&conn, &secret, session_token.as_deref());
    let client = pool
        .get_or_create(&connection_id, &config)
        .await
        .map_err(|e| e.to_string())?;

    let batch_id = Uuid::new_v4().to_string();
    let total = keys.len() as u32;
    let bid = batch_id.clone();
    let app_handle = app.clone();
    let op = Arc::new(operation);

    tokio::spawn(async move {
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        for (i, key) in keys.iter().enumerate() {
            let result = apply_one(&client, &bucket, key, op.as_ref()).await;
            let completed = (i as u32) + 1;
            let (status, error) = match result {
                Ok(()) => {
                    succeeded += 1;
                    ("ok".to_string(), None)
                }
                Err(e) => {
                    failed += 1;
                    ("error".to_string(), Some(e.to_string()))
                }
            };
            let _ = app_handle.emit(
                "batch:progress",
                BatchProgressEvent {
                    batch_id: bid.clone(),
                    key: key.clone(),
                    status,
                    error,
                    completed,
                    total,
                },
            );
        }
        let _ = app_handle.emit(
            "batch:complete",
            BatchCompleteEvent {
                batch_id: bid,
                succeeded,
                failed,
            },
        );
    });

    Ok(batch_id)
}

async fn apply_one(
    client: &aws_sdk_s3::Client,
    bucket: &str,
    key: &str,
    op: &BatchOp,
) -> Result<(), crate::s3::error::S3Error> {
    match op {
        BatchOp::SetStorageClass { storage_class } => {
            crate::s3::client::copy_object_in_place_replace(
                client,
                bucket,
                key,
                None,
                None,
                Some(storage_class),
            )
            .await
        }
        BatchOp::SetContentType { content_type } => {
            crate::s3::client::copy_object_in_place_replace(
                client,
                bucket,
                key,
                Some(content_type),
                None,
                None,
            )
            .await
        }
        BatchOp::SetAcl { acl } => {
            crate::s3::client::put_object_acl(client, bucket, key, acl).await
        }
    }
}
