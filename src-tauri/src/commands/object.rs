use base64::Engine;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use crate::models::object::{
    BucketVersioningStatus, CopyObjectRequest, DeleteObjectsRequest, ListObjectVersionsRequest,
    ListObjectVersionsResponse, ListObjectsRequest, ListObjectsResponse, ObjectDetails, ObjectInfo,
    PresignMethod, PresignedUrlRequest,
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

    // Try in-memory first, then fall back to DB-stored secret
    let secret_key = match credentials::get_secret_key(connection_id) {
        Ok(key) => key,
        Err(_) => {
            let key = crate::store::database::get_db_secret(db, connection_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Secret key not found for connection {connection_id}"))?;
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
            let display_name = o.key.rsplit('/').next().unwrap_or(&o.key).to_string();
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

/// Recursively delete every object under a prefix. Required for "delete
/// folder" — in S3 folders are virtual, so removing one requires listing
/// all keys with that prefix and bulk-deleting them.
#[tauri::command]
pub async fn delete_prefix(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    prefix: String,
) -> Result<u64, String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::delete_prefix(&client, &bucket, &prefix)
        .await
        .map_err(|e| e.to_string())
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
pub async fn move_object(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    request: CopyObjectRequest,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &request.connection_id).await?;

    // Copy to new location
    crate::s3::client::copy_object(
        &client,
        &request.source_bucket,
        &request.source_key,
        &request.dest_bucket,
        &request.dest_key,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Delete original
    crate::s3::client::delete_objects(
        &client,
        &request.source_bucket,
        &[request.source_key.clone()],
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn rename_object(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    old_key: String,
    new_key: String,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;

    // Copy to new key
    crate::s3::client::copy_object(&client, &bucket, &old_key, &bucket, &new_key)
        .await
        .map_err(|e| e.to_string())?;

    // Delete original
    crate::s3::client::delete_objects(&client, &bucket, &[old_key])
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
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
        PresignMethod::Get => crate::s3::presign::presign_get_object_v(
            &client,
            &request.bucket,
            &request.key,
            request.version_id.as_deref(),
            request.expiry_secs,
        )
        .await
        .map_err(|e| e.to_string()),
        PresignMethod::Put => crate::s3::presign::presign_put_object(
            &client,
            &request.bucket,
            &request.key,
            request.expiry_secs,
        )
        .await
        .map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub async fn update_object_metadata(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    key: String,
    content_type: Option<String>,
    metadata: Vec<crate::models::object::MetadataEntry>,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;

    let copy_source = format!("{bucket}/{key}");

    let mut meta_map = std::collections::HashMap::new();
    for entry in &metadata {
        meta_map.insert(entry.key.clone(), entry.value.clone());
    }

    let mut request = client
        .copy_object()
        .copy_source(&copy_source)
        .bucket(&bucket)
        .key(&key)
        .metadata_directive(aws_sdk_s3::types::MetadataDirective::Replace)
        .set_metadata(Some(meta_map));

    if let Some(ct) = content_type {
        request = request.content_type(ct);
    }

    request.send().await.map_err(|e| e.to_string())?;

    Ok(())
}

/// Max preview size: 5 MB
const MAX_PREVIEW_BYTES: i64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PreviewResponse {
    /// "text", "image", "unsupported"
    pub preview_type: String,
    /// For text: the text content. For image: base64-encoded data.
    pub content: String,
    /// Detected content type
    pub content_type: String,
    /// Total file size
    pub size: i64,
    /// Whether the content was truncated
    pub truncated: bool,
}

#[tauri::command]
pub async fn get_object_preview(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    key: String,
) -> Result<PreviewResponse, String> {
    let client = get_client(&db, &pool, &connection_id).await?;

    // Head first to get size and content type
    let head = client
        .head_object()
        .bucket(&bucket)
        .key(&key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let size = head.content_length().unwrap_or(0);
    let content_type = head
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();

    let preview_type = classify_content_type(&content_type, &key);

    // PDF, video, and audio don't need content download — frontend uses presigned URLs
    if preview_type == "pdf" || preview_type == "video" || preview_type == "audio" {
        return Ok(PreviewResponse {
            preview_type,
            content: String::new(),
            content_type,
            size,
            truncated: false,
        });
    }

    if preview_type == "unsupported" || size == 0 {
        return Ok(PreviewResponse {
            preview_type,
            content: String::new(),
            content_type,
            size,
            truncated: false,
        });
    }

    if size > MAX_PREVIEW_BYTES && preview_type == "image" {
        // Images: don't preview if too large
        return Ok(PreviewResponse {
            preview_type: "unsupported".to_string(),
            content: String::new(),
            content_type,
            size,
            truncated: false,
        });
    }
    // Text: download first 500KB only

    let is_text_like = preview_type == "text" || preview_type == "markdown";
    let text_limit = 512 * 1024i64; // 500 KB for text
    let _download_limit = if is_text_like {
        text_limit.min(size)
    } else {
        size.min(MAX_PREVIEW_BYTES)
    };

    // Download the content (with range for text)
    let mut request = client.get_object().bucket(&bucket).key(&key);
    let truncated;

    if is_text_like && size > text_limit {
        request = request.range(format!("bytes=0-{}", text_limit - 1));
        truncated = true;
    } else {
        truncated = false;
    }

    let response = request.send().await.map_err(|e| e.to_string())?;

    let bytes = response
        .body
        .collect()
        .await
        .map_err(|e| e.to_string())?
        .into_bytes();

    // For image formats the browser can't render natively (currently TIFF),
    // transcode to PNG on the backend so the frontend can display them.
    let mut effective_content_type = content_type.clone();
    let content_bytes: Vec<u8> = if preview_type == "image" && is_tiff(&content_type, &key) {
        match transcode_tiff_to_png(&bytes) {
            Ok(png) => {
                effective_content_type = "image/png".to_string();
                png
            }
            Err(e) => {
                tracing::warn!("TIFF transcode failed for {}: {}", key, e);
                // Fall back to returning raw bytes — browser will fail to
                // render but the preview_type stays "image" so the user at
                // least sees a clear broken-image rather than "unsupported".
                bytes.to_vec()
            }
        }
    } else {
        bytes.to_vec()
    };

    let content = match preview_type.as_str() {
        "text" | "markdown" => {
            // Try to decode as UTF-8
            String::from_utf8(content_bytes).unwrap_or_else(|bytes| {
                // Lossy conversion for non-UTF8 text files
                String::from_utf8_lossy(&bytes.into_bytes()).to_string()
            })
        }
        "image" => {
            // Base64 encode for frontend rendering
            base64::engine::general_purpose::STANDARD.encode(&content_bytes)
        }
        _ => String::new(),
    };

    Ok(PreviewResponse {
        preview_type,
        content,
        content_type: effective_content_type,
        size,
        truncated,
    })
}

fn is_tiff(content_type: &str, key: &str) -> bool {
    let ct = content_type.to_lowercase();
    if ct == "image/tiff" || ct == "image/tif" || ct == "image/x-tiff" {
        return true;
    }
    let ext = key.rsplit('.').next().unwrap_or("").to_lowercase();
    ext == "tif" || ext == "tiff"
}

fn transcode_tiff_to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use image::ImageFormat;
    use std::io::Cursor;

    let img =
        image::load_from_memory_with_format(bytes, ImageFormat::Tiff).map_err(|e| e.to_string())?;
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

fn classify_content_type(content_type: &str, key: &str) -> String {
    let ct = content_type.to_lowercase();

    // PDF
    if ct == "application/pdf" {
        return "pdf".to_string();
    }

    // Video
    if ct == "video/mp4" || ct == "video/webm" {
        return "video".to_string();
    }

    // Audio
    if ct == "audio/mpeg" || ct == "audio/ogg" || ct == "audio/wav" || ct == "audio/flac" {
        return "audio".to_string();
    }

    // Markdown (before generic text)
    if ct == "text/markdown" {
        return "markdown".to_string();
    }

    // Images
    if ct.starts_with("image/") {
        return "image".to_string();
    }

    // Text types
    if ct.starts_with("text/")
        || ct == "application/json"
        || ct == "application/xml"
        || ct == "application/yaml"
        || ct == "application/x-yaml"
        || ct == "application/toml"
        || ct == "application/javascript"
        || ct == "application/typescript"
        || ct == "application/x-sh"
        || ct == "application/x-python"
    {
        return "text".to_string();
    }

    // Fallback: guess from extension
    let ext = key.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        // Markdown
        "md" | "markdown" => "markdown".to_string(),

        // PDF
        "pdf" => "pdf".to_string(),

        // Video
        "mp4" | "webm" => "video".to_string(),

        // Audio
        "mp3" | "ogg" | "wav" | "flac" => "audio".to_string(),

        // Text/code
        "txt" | "csv" | "tsv" | "log" | "ini" | "cfg" | "conf" | "json" | "xml" | "yaml"
        | "yml" | "toml" | "html" | "htm" | "css" | "js" | "ts" | "tsx" | "jsx" | "py" | "rb"
        | "rs" | "go" | "java" | "c" | "h" | "cpp" | "hpp" | "cs" | "sh" | "bash" | "zsh"
        | "fish" | "ps1" | "bat" | "cmd" | "sql" | "graphql" | "proto" | "tf" | "hcl"
        | "dockerfile" | "makefile" | "gitignore" | "env" | "properties" | "gradle" | "sbt"
        | "scala" | "kt" | "swift" | "r" | "lua" | "pl" | "php" | "ex" | "exs" | "erl" | "hs"
        | "ml" | "vim" | "el" | "lisp" | "clj" => "text".to_string(),

        // Images
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "svg" | "ico" | "tif" | "tiff" => {
            "image".to_string()
        }

        _ => "unsupported".to_string(),
    }
}

// --- Versioning commands ------------------------------------------------

#[tauri::command]
pub async fn list_object_versions(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    request: ListObjectVersionsRequest,
) -> Result<ListObjectVersionsResponse, String> {
    let client = get_client(&db, &pool, &request.connection_id).await?;

    let (versions, next_key_marker, next_version_id_marker, is_truncated) =
        crate::s3::client::list_object_versions(
            &client,
            &request.bucket,
            request.prefix.as_deref(),
            request.key_marker.as_deref(),
            request.version_id_marker.as_deref(),
            request.max_keys,
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(ListObjectVersionsResponse {
        versions,
        next_key_marker,
        next_version_id_marker,
        is_truncated,
    })
}

#[tauri::command]
pub async fn get_bucket_versioning(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
) -> Result<BucketVersioningStatus, String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::get_bucket_versioning(&client, &bucket)
        .await
        .map_err(|e| e.to_string())
}

/// Permanently delete a specific version of an object. No delete marker
/// is created — the version is irrecoverable.
#[tauri::command]
pub async fn delete_object_version(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    key: String,
    version_id: String,
) -> Result<(), String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::delete_object_version(&client, &bucket, &key, &version_id)
        .await
        .map_err(|e| e.to_string())
}

/// Copy a previous version as the current version (creates a new latest).
#[tauri::command]
pub async fn restore_object_version(
    db: State<'_, Database>,
    pool: State<'_, S3ClientPool>,
    connection_id: String,
    bucket: String,
    key: String,
    version_id: String,
) -> Result<String, String> {
    let client = get_client(&db, &pool, &connection_id).await?;
    crate::s3::client::restore_object_version(&client, &bucket, &key, &version_id)
        .await
        .map_err(|e| e.to_string())
}
