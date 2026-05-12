use tauri::State;

use crate::models::bucket::{BucketDetails, BucketEncryption, BucketInfo, CreateBucketRequest};
use crate::s3::client::S3ClientPool;
use crate::store::credentials;
use crate::store::database::Database;

use super::connection::build_s3_config;

/// Helper to get an S3 client for a connection ID.
async fn get_client(
    db: &State<'_, Database>,
    pool: &State<'_, S3ClientPool>,
    connection_id: &str,
) -> Result<aws_sdk_s3::Client, String> {
    let conn = crate::store::database::get_connection(db, connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connection not found: {connection_id}"))?;

    // Try in-memory first, then fall back to DB-stored secret
    let secret_key = match credentials::get_secret_key(connection_id) {
        Ok(key) => key,
        Err(_) => {
            let key = crate::store::database::get_db_secret(db, connection_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Secret key not found for connection {connection_id}"))?;
            // Cache in memory for subsequent calls
            let _ = credentials::store_secret_key(connection_id, &key);
            key
        }
    };

    let session_token = match credentials::get_session_token(connection_id) {
        Ok(Some(token)) => Some(token),
        _ => {
            let token = crate::store::database::get_db_session_token(db, connection_id)
                .map_err(|e| e.to_string())?;
            if let Some(ref t) = token {
                let _ = credentials::store_session_token(connection_id, t);
            }
            token
        }
    };

    let config = build_s3_config(&conn, &secret_key, session_token.as_deref());

    pool.get_or_create(connection_id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_buckets(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
) -> Result<Vec<BucketInfo>, String> {
    tracing::info!("list_buckets called for connection {connection_id}");

    let client = get_client(&db, &pool, &connection_id).await
        .map_err(|e| {
            tracing::error!("get_client failed: {e}");
            e
        })?;

    let buckets = crate::s3::client::list_buckets(&client)
        .await
        .map_err(|e| {
            tracing::error!("list_buckets S3 call failed: {e}");
            e.to_string()
        })?;

    tracing::info!("Found {} buckets", buckets.len());

    Ok(buckets
        .into_iter()
        .map(|b| BucketInfo {
            name: b.name,
            creation_date: b.creation_date,
            region: None,
        })
        .collect())
}

#[tauri::command]
pub async fn create_bucket(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    request: CreateBucketRequest,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;

    crate::s3::client::create_bucket(&client, &request.name, request.region.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_bucket(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;

    crate::s3::client::delete_bucket(&client, &bucket)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_bucket_info(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
) -> Result<BucketDetails, String> {
    let client = get_client(&db, &pool, &connection_id).await?;

    // Get bucket location
    let location = client
        .get_bucket_location()
        .bucket(&bucket)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let region = location
        .location_constraint()
        .map(|l| l.as_str().to_string());

    // Get versioning status
    let versioning = client
        .get_bucket_versioning()
        .bucket(&bucket)
        .send()
        .await
        .ok()
        .and_then(|v| {
            v.status().map(|s| match s.as_str() {
                "Enabled" => crate::models::bucket::VersioningStatus::Enabled,
                "Suspended" => crate::models::bucket::VersioningStatus::Suspended,
                _ => crate::models::bucket::VersioningStatus::Disabled,
            })
        });

    Ok(BucketDetails {
        name: bucket,
        region,
        creation_date: None,
        versioning,
        encryption: None,
        object_count: None,
        total_size: None,
    })
}

#[tauri::command]
pub async fn set_bucket_versioning(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    enabled: bool,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::set_bucket_versioning(&client, &bucket, enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_bucket_encryption(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
) -> Result<Option<BucketEncryption>, String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::get_bucket_encryption(&client, &bucket)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_bucket_encryption(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    algorithm: String,
    kms_master_key_id: Option<String>,
    bucket_key_enabled: Option<bool>,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::set_bucket_encryption(
        &client,
        &bucket,
        &algorithm,
        kms_master_key_id.as_deref(),
        bucket_key_enabled,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_bucket_encryption(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::delete_bucket_encryption(&client, &bucket)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_bucket_policy(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
) -> Result<Option<String>, String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::get_bucket_policy(&client, &bucket)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_bucket_policy(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    policy: String,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::set_bucket_policy(&client, &bucket, &policy)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_bucket_policy(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::delete_bucket_policy(&client, &bucket)
        .await
        .map_err(|e| e.to_string())
}
