use tauri::State;

use crate::models::object::{
    CopyObjectRequest, DeleteObjectsRequest, ListObjectsRequest, ListObjectsResponse,
    ObjectDetails, ObjectInfo, PresignMethod, PresignedUrlRequest,
};
use crate::s3::client::S3ClientPool;
use crate::store::credentials;
use crate::store::database::Database;

use super::connection::build_s3_config;

async fn get_client(
    db: &State<'_, Database>,
    pool: &State<'_, S3ClientPool>,
    connection_id: &str,
) -> Result<aws_sdk_s3::Client, String> {
    let conn = crate::store::database::get_connection(db, connection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connection not found: {connection_id}"))?;

    let secret_key = credentials::get_secret_key(connection_id)?;
    let session_token = credentials::get_session_token(connection_id)?;
    let config = build_s3_config(&conn, &secret_key, session_token.as_deref());

    pool.get_or_create(connection_id, &config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_objects(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    request: ListObjectsRequest,
) -> Result<ListObjectsResponse, String> {
    let client = get_client(&db, &pool, &request.connection_id).await?;

    let delimiter = request.delimiter.as_deref().or(Some("/"));

    let result = crate::s3::client::list_objects(
        &client,
        &request.bucket,
        request.prefix.as_deref(),
        delimiter,
        request.max_keys,
        request.continuation_token.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    let objects: Vec<ObjectInfo> = result
        .objects
        .into_iter()
        .map(|o| {
            let display_name = o
                .key
                .rsplit('/')
                .next()
                .unwrap_or(&o.key)
                .to_string();
            ObjectInfo {
                key: o.key,
                display_name,
                is_folder: false,
                size: Some(o.size),
                last_modified: o.last_modified,
                etag: o.etag,
                storage_class: o.storage_class,
            }
        })
        .collect();

    let mut all_objects: Vec<ObjectInfo> = result
        .common_prefixes
        .into_iter()
        .map(|prefix| {
            let display_name = prefix
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or(&prefix)
                .to_string();
            ObjectInfo {
                key: prefix,
                display_name,
                is_folder: true,
                size: None,
                last_modified: None,
                etag: None,
                storage_class: None,
            }
        })
        .collect();

    // Folders first, then files
    all_objects.extend(objects);

    Ok(ListObjectsResponse {
        objects: all_objects,
        common_prefixes: vec![],
        continuation_token: result.continuation_token,
        is_truncated: result.is_truncated,
    })
}

#[tauri::command]
pub async fn head_object(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    key: String,
) -> Result<ObjectDetails, String> {
    let client = get_client(&db, &pool, &connection_id).await?;

    crate::s3::client::head_object(&client, &bucket, &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_objects(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    request: DeleteObjectsRequest,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &request.connection_id).await?;

    // S3 DeleteObjects supports max 1000 keys per request
    for chunk in request.keys.chunks(1000) {
        crate::s3::client::delete_objects(&client, &request.bucket, chunk)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_object(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    request: CopyObjectRequest,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &request.connection_id).await?;

    crate::s3::client::copy_object(
        &client,
        &request.source_bucket,
        &request.source_key,
        &request.dest_bucket,
        &request.dest_key,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_folder(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    prefix: String,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;

    // Ensure prefix ends with /
    let key = if prefix.ends_with('/') {
        prefix
    } else {
        format!("{prefix}/")
    };

    client
        .put_object()
        .bucket(&bucket)
        .key(&key)
        .body(aws_sdk_s3::primitives::ByteStream::from_static(b""))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_presigned_url(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    request: PresignedUrlRequest,
) -> Result<String, String> {
    let client = get_client(&db, &pool, &request.connection_id).await?;

    match request.method {
        PresignMethod::Get => {
            crate::s3::presign::presign_get_object(
                &client,
                &request.bucket,
                &request.key,
                request.expiry_secs,
            )
            .await
            .map_err(|e| e.to_string())
        }
        PresignMethod::Put => {
            crate::s3::presign::presign_put_object(
                &client,
                &request.bucket,
                &request.key,
                request.expiry_secs,
            )
            .await
            .map_err(|e| e.to_string())
        }
    }
}
