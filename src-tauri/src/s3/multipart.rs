use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Semaphore;

use super::error::S3Error;

/// Default part size: 8 MB
const DEFAULT_PART_SIZE: usize = 8 * 1024 * 1024;

/// Minimum part size per S3 spec: 5 MB
const MIN_PART_SIZE: usize = 5 * 1024 * 1024;

/// Default concurrent part uploads
const DEFAULT_CONCURRENCY: usize = 4;

pub struct MultipartUploader {
    client: Client,
    bucket: String,
    key: String,
    part_size: usize,
    concurrency: usize,
}

impl MultipartUploader {
    pub fn new(
        client: Client,
        bucket: String,
        key: String,
        part_size_mb: Option<u32>,
    ) -> Self {
        Self::with_concurrency(client, bucket, key, part_size_mb, None)
    }

    pub fn with_concurrency(
        client: Client,
        bucket: String,
        key: String,
        part_size_mb: Option<u32>,
        max_concurrent_parts: Option<u32>,
    ) -> Self {
        let part_size = part_size_mb
            .map(|mb| (mb as usize * 1024 * 1024).max(MIN_PART_SIZE))
            .unwrap_or(DEFAULT_PART_SIZE);

        let concurrency = max_concurrent_parts
            .map(|c| (c as usize).max(1))
            .unwrap_or(DEFAULT_CONCURRENCY);

        Self {
            client,
            bucket,
            key,
            part_size,
            concurrency,
        }
    }

    /// Execute a multipart upload from a file path with parallel part uploads.
    ///
    /// `progress_callback` is called after each part completes with (bytes_uploaded_so_far, total_bytes).
    pub async fn upload<F>(
        &self,
        file_path: &std::path::Path,
        progress_callback: F,
    ) -> Result<String, S3Error>
    where
        F: Fn(u64, u64) + Send + Sync + 'static,
    {
        let file_size = tokio::fs::metadata(file_path)
            .await
            .map_err(S3Error::IoError)?
            .len();

        // Initiate multipart upload
        let create_output = self
            .client
            .create_multipart_upload()
            .bucket(&self.bucket)
            .key(&self.key)
            .send()
            .await
            .map_err(|e| S3Error::MultipartError(e.to_string()))?;

        let upload_id = create_output
            .upload_id()
            .ok_or_else(|| S3Error::MultipartError("No upload ID returned".to_string()))?
            .to_string();

        // Calculate total parts
        let total_parts = ((file_size as usize + self.part_size - 1) / self.part_size).max(1);

        // Shared progress counter
        let bytes_uploaded = Arc::new(AtomicU64::new(0));
        let progress_cb = Arc::new(progress_callback);
        let semaphore = Arc::new(Semaphore::new(self.concurrency));

        // Spawn all part uploads
        let mut handles = Vec::with_capacity(total_parts);

        for part_idx in 0..total_parts {
            let client = self.client.clone();
            let bucket = self.bucket.clone();
            let key = self.key.clone();
            let uid = upload_id.clone();
            let file = file_path.to_path_buf();
            let part_size = self.part_size;
            let sem = semaphore.clone();
            let progress = bytes_uploaded.clone();
            let cb = progress_cb.clone();

            let part_number = (part_idx + 1) as i32;
            let offset = part_idx as u64 * part_size as u64;
            let this_part_size = if part_idx == total_parts - 1 {
                (file_size - offset) as usize
            } else {
                part_size
            };

            let handle = tokio::spawn(async move {
                // Acquire semaphore permit to limit concurrency
                let _permit = sem.acquire().await.map_err(|e| {
                    S3Error::MultipartError(format!("Semaphore error: {e}"))
                })?;

                // Read part data from file at the correct offset
                let mut f = tokio::fs::File::open(&file)
                    .await
                    .map_err(S3Error::IoError)?;
                f.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(S3Error::IoError)?;

                let mut buffer = vec![0u8; this_part_size];
                let mut bytes_read = 0;
                while bytes_read < this_part_size {
                    let n = f
                        .read(&mut buffer[bytes_read..])
                        .await
                        .map_err(S3Error::IoError)?;
                    if n == 0 {
                        break;
                    }
                    bytes_read += n;
                }
                buffer.truncate(bytes_read);

                let body = ByteStream::from(buffer);

                let upload_part_output = client
                    .upload_part()
                    .bucket(&bucket)
                    .key(&key)
                    .upload_id(&uid)
                    .part_number(part_number)
                    .body(body)
                    .send()
                    .await
                    .map_err(|e| S3Error::MultipartError(e.to_string()))?;

                let etag = upload_part_output
                    .e_tag()
                    .unwrap_or_default()
                    .to_string();

                // Update progress
                let uploaded = progress.fetch_add(bytes_read as u64, Ordering::Relaxed) + bytes_read as u64;
                cb(uploaded, file_size);

                Ok::<(i32, String), S3Error>((part_number, etag))
            });

            handles.push(handle);
        }

        // Collect results
        let mut completed_parts = Vec::with_capacity(total_parts);
        let mut upload_error: Option<S3Error> = None;

        for handle in handles {
            match handle.await {
                Ok(Ok((part_number, etag))) => {
                    completed_parts.push((part_number, etag));
                }
                Ok(Err(e)) => {
                    upload_error = Some(e);
                    break;
                }
                Err(e) => {
                    upload_error = Some(S3Error::MultipartError(format!("Task join error: {e}")));
                    break;
                }
            }
        }

        // If any part failed, abort the multipart upload
        if let Some(err) = upload_error {
            let _ = self
                .client
                .abort_multipart_upload()
                .bucket(&self.bucket)
                .key(&self.key)
                .upload_id(&upload_id)
                .send()
                .await;
            return Err(err);
        }

        // Sort parts by part number (required by S3)
        completed_parts.sort_by_key(|(pn, _)| *pn);

        let parts: Vec<_> = completed_parts
            .into_iter()
            .map(|(pn, etag)| {
                aws_sdk_s3::types::CompletedPart::builder()
                    .part_number(pn)
                    .e_tag(etag)
                    .build()
            })
            .collect();

        // Complete multipart upload
        let completed_upload = aws_sdk_s3::types::CompletedMultipartUpload::builder()
            .set_parts(Some(parts))
            .build();

        let complete_output = self
            .client
            .complete_multipart_upload()
            .bucket(&self.bucket)
            .key(&self.key)
            .upload_id(&upload_id)
            .multipart_upload(completed_upload)
            .send()
            .await
            .map_err(|e| S3Error::MultipartError(e.to_string()))?;

        let etag = complete_output
            .e_tag()
            .unwrap_or_default()
            .to_string();

        Ok(etag)
    }
}
