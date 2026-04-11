use std::path::Path;

use aws_sdk_s3::Client;
use tokio::io::AsyncWriteExt;

use crate::s3::error::S3Error;

/// Download an object to a local file.
pub async fn download_file<F>(
    client: &Client,
    bucket: &str,
    key: &str,
    local_path: &Path,
    progress_callback: F,
) -> Result<(), S3Error>
where
    F: Fn(u64, u64) + Send + Sync,
{
    // Get object size first
    let head = client
        .head_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(e.to_string()))?;

    let total_size = head.content_length().unwrap_or(0) as u64;

    // Create parent directories if needed
    if let Some(parent) = local_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(S3Error::IoError)?;
    }

    // Download the object
    let mut response = client
        .get_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map_err(|e| S3Error::SdkError(e.to_string()))?;

    let mut file = tokio::fs::File::create(local_path)
        .await
        .map_err(S3Error::IoError)?;

    let mut downloaded: u64 = 0;

    while let Some(chunk) = response
        .body
        .try_next()
        .await
        .map_err(|e| S3Error::SdkError(e.to_string()))?
    {
        file.write_all(&chunk).await.map_err(S3Error::IoError)?;
        downloaded += chunk.len() as u64;
        progress_callback(downloaded, total_size);
    }

    file.flush().await.map_err(S3Error::IoError)?;

    Ok(())
}
