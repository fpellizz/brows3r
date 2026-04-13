use std::path::Path;
use std::sync::Arc;

use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;

use crate::s3::error::S3Error;
use crate::s3::multipart::{MultipartPersistence, MultipartUploader};

/// Threshold in bytes above which multipart upload is used.
const DEFAULT_MULTIPART_THRESHOLD: u64 = 100 * 1024 * 1024; // 100 MB

/// Upload a single file, choosing single-part or multipart based on size.
///
/// `persistence` is forwarded to the multipart path so interrupted uploads
/// can be resumed across restarts. Single-part uploads ignore it (they're
/// atomic from S3's perspective — either the PUT succeeds or it doesn't,
/// nothing partial to recover).
pub async fn upload_file<F>(
    client: &Client,
    bucket: &str,
    key: &str,
    local_path: &Path,
    multipart_threshold_mb: Option<u32>,
    part_size_mb: Option<u32>,
    progress_callback: F,
    persistence: Option<Arc<dyn MultipartPersistence>>,
) -> Result<String, S3Error>
where
    F: Fn(u64, u64) + Send + Sync + 'static,
{
    let file_size = tokio::fs::metadata(local_path)
        .await
        .map_err(S3Error::IoError)?
        .len();

    let threshold = multipart_threshold_mb
        .map(|mb| mb as u64 * 1024 * 1024)
        .unwrap_or(DEFAULT_MULTIPART_THRESHOLD);

    if file_size > threshold {
        // Multipart upload
        let uploader = MultipartUploader::new(
            client.clone(),
            bucket.to_string(),
            key.to_string(),
            part_size_mb,
        );
        uploader
            .upload(local_path, progress_callback, persistence)
            .await
    } else {
        // Single-part upload
        let body = ByteStream::from_path(local_path)
            .await
            .map_err(|e| S3Error::IoError(std::io::Error::other(e.to_string())))?;

        let output = client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(body)
            .send()
            .await
            .map_err(|e| S3Error::SdkError(e.to_string()))?;

        progress_callback(file_size, file_size);

        Ok(output.e_tag().unwrap_or_default().to_string())
    }
}
