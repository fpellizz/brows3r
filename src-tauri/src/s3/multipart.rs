use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Semaphore;

use crate::models::transfer::UploadedPart;

use super::error::S3Error;

/// Hook for persisting multipart upload state so an interrupted upload can
/// be resumed on the next app launch. The `MultipartUploader` doesn't need
/// to know about SQLite/Tauri/etc. — callers wire these methods to whatever
/// storage they want (or pass `None` to disable persistence entirely).
pub trait MultipartPersistence: Send + Sync {
    /// Called once after `create_multipart_upload` returns, before any
    /// parts are uploaded.
    fn record_upload_id(&self, upload_id: &str, part_size_bytes: i64);

    /// Called after each `upload_part` succeeds. Implementations should
    /// expect concurrent calls (one per part-upload task).
    fn record_part(&self, part: UploadedPart);
}

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
    /// `persistence` (when `Some`) receives the upload_id and each completed part
    /// so the upload can be resumed across app restarts.
    pub async fn upload<F>(
        &self,
        file_path: &std::path::Path,
        progress_callback: F,
        persistence: Option<Arc<dyn MultipartPersistence>>,
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

        // Persist upload_id + part size BEFORE any parts go up so a crash
        // between create and the first part still leaves a recoverable row
        // (the user can Discard it from the recovery dialog).
        if let Some(p) = persistence.as_ref() {
            p.record_upload_id(&upload_id, self.part_size as i64);
        }

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
            let persist = persistence.clone();

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

                // Persist the completed part so it survives a crash. Done
                // BEFORE updating progress so a recoverable row never claims
                // more bytes than are actually durable in the persistence
                // layer.
                if let Some(p) = persist.as_ref() {
                    p.record_part(UploadedPart {
                        part_number,
                        etag: etag.clone(),
                        size: bytes_read as i64,
                    });
                }

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

/// Resume an interrupted multipart upload using an existing `upload_id`.
///
/// `list_parts` on S3 is the source of truth for which parts are already
/// uploaded — the DB record is only used to find the upload_id and part
/// size. This is robust to: (a) DB ahead of S3 (persist succeeded, S3 call
/// failed), (b) other clients having modified the upload, (c) S3
/// garbage-collecting the upload (returns NoSuchUpload, mapped to a clear
/// error message so the user can choose to Discard from the UI).
///
/// Missing parts are uploaded with the same concurrency as a fresh upload.
/// `progress_callback` reports cumulative bytes (already-uploaded + newly
/// uploaded), so the UI shows meaningful progress from the start.
pub async fn resume_upload<F>(
    client: &Client,
    bucket: &str,
    key: &str,
    file_path: &std::path::Path,
    upload_id: &str,
    part_size_bytes: usize,
    max_concurrent_parts: Option<u32>,
    progress_callback: F,
    persistence: Option<Arc<dyn MultipartPersistence>>,
) -> Result<String, S3Error>
where
    F: Fn(u64, u64) + Send + Sync + 'static,
{
    let file_size = tokio::fs::metadata(file_path)
        .await
        .map_err(S3Error::IoError)?
        .len();

    let part_size = part_size_bytes.max(MIN_PART_SIZE);
    let total_parts = ((file_size as usize + part_size - 1) / part_size).max(1);

    // Source of truth: ask S3 which parts are already there. Paginated.
    let mut existing: Vec<(i32, String)> = Vec::new();
    let mut part_marker: Option<i32> = None;
    loop {
        let mut req = client
            .list_parts()
            .bucket(bucket)
            .key(key)
            .upload_id(upload_id);
        if let Some(m) = part_marker {
            req = req.part_number_marker(m.to_string());
        }
        let out = req.send().await.map_err(|e| {
            // S3 returns NoSuchUpload if the upload was aborted/expired.
            // Surface a clear hint so the UI can prompt to Discard.
            S3Error::MultipartError(format!(
                "Cannot resume upload (S3 list_parts failed; upload may have been aborted or expired): {e}"
            ))
        })?;

        for p in out.parts() {
            if let (Some(pn), Some(et)) = (p.part_number(), p.e_tag()) {
                existing.push((pn, et.to_string()));
            }
        }

        if out.is_truncated().unwrap_or(false) {
            part_marker = out.next_part_number_marker().and_then(|s| s.parse().ok());
            if part_marker.is_none() {
                break;
            }
        } else {
            break;
        }
    }

    let already_done: std::collections::HashSet<i32> =
        existing.iter().map(|(pn, _)| *pn).collect();

    // Compute already-uploaded bytes for accurate initial progress.
    let already_bytes: u64 = (1..=total_parts)
        .filter(|pn| already_done.contains(&(*pn as i32)))
        .map(|pn| {
            let off = (pn - 1) as u64 * part_size as u64;
            let this = if pn == total_parts {
                (file_size - off) as usize
            } else {
                part_size
            };
            this as u64
        })
        .sum();

    let bytes_uploaded = Arc::new(AtomicU64::new(already_bytes));
    let progress_cb = Arc::new(progress_callback);
    progress_cb(already_bytes, file_size);

    let concurrency = max_concurrent_parts
        .map(|c| (c as usize).max(1))
        .unwrap_or(DEFAULT_CONCURRENCY);
    let semaphore = Arc::new(Semaphore::new(concurrency));

    let mut handles = Vec::new();
    for part_idx in 0..total_parts {
        let part_number = (part_idx + 1) as i32;
        if already_done.contains(&part_number) {
            continue;
        }

        let client = client.clone();
        let bucket = bucket.to_string();
        let key = key.to_string();
        let uid = upload_id.to_string();
        let file = file_path.to_path_buf();
        let sem = semaphore.clone();
        let progress = bytes_uploaded.clone();
        let cb = progress_cb.clone();
        let persist = persistence.clone();

        let offset = part_idx as u64 * part_size as u64;
        let this_part_size = if part_idx == total_parts - 1 {
            (file_size - offset) as usize
        } else {
            part_size
        };

        let handle = tokio::spawn(async move {
            let _permit = sem
                .acquire()
                .await
                .map_err(|e| S3Error::MultipartError(format!("Semaphore error: {e}")))?;

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

            if let Some(p) = persist.as_ref() {
                p.record_part(UploadedPart {
                    part_number,
                    etag: etag.clone(),
                    size: bytes_read as i64,
                });
            }

            let uploaded =
                progress.fetch_add(bytes_read as u64, Ordering::Relaxed) + bytes_read as u64;
            cb(uploaded, file_size);

            Ok::<(i32, String), S3Error>((part_number, etag))
        });

        handles.push(handle);
    }

    let mut newly_uploaded: Vec<(i32, String)> = Vec::with_capacity(handles.len());
    let mut upload_error: Option<S3Error> = None;
    for handle in handles {
        match handle.await {
            Ok(Ok(pair)) => newly_uploaded.push(pair),
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

    if let Some(err) = upload_error {
        // Don't abort here — leave the upload on S3 so the user can try
        // resuming again. (A fresh failure during resume usually means
        // network flakiness, not a permanent problem.)
        return Err(err);
    }

    // Combine S3-reported existing parts + newly uploaded ones.
    let mut all_parts: Vec<(i32, String)> = existing;
    all_parts.extend(newly_uploaded);
    all_parts.sort_by_key(|(pn, _)| *pn);

    let parts: Vec<_> = all_parts
        .into_iter()
        .map(|(pn, etag)| {
            aws_sdk_s3::types::CompletedPart::builder()
                .part_number(pn)
                .e_tag(etag)
                .build()
        })
        .collect();

    let completed_upload = aws_sdk_s3::types::CompletedMultipartUpload::builder()
        .set_parts(Some(parts))
        .build();

    let complete_output = client
        .complete_multipart_upload()
        .bucket(bucket)
        .key(key)
        .upload_id(upload_id)
        .multipart_upload(completed_upload)
        .send()
        .await
        .map_err(|e| S3Error::MultipartError(e.to_string()))?;

    Ok(complete_output.e_tag().unwrap_or_default().to_string())
}
