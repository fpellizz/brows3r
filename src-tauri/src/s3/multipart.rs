use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use tokio::io::AsyncReadExt;

use super::error::S3Error;

/// Default part size: 8 MB
const DEFAULT_PART_SIZE: usize = 8 * 1024 * 1024;

/// Minimum part size per S3 spec: 5 MB
const MIN_PART_SIZE: usize = 5 * 1024 * 1024;

pub struct MultipartUploader {
    client: Client,
    bucket: String,
    key: String,
    part_size: usize,
}

impl MultipartUploader {
    pub fn new(client: Client, bucket: String, key: String, part_size_mb: Option<u32>) -> Self {
        let part_size = part_size_mb
            .map(|mb| (mb as usize * 1024 * 1024).max(MIN_PART_SIZE))
            .unwrap_or(DEFAULT_PART_SIZE);

        Self {
            client,
            bucket,
            key,
            part_size,
        }
    }

    /// Execute a multipart upload from a file path.
    ///
    /// `progress_callback` is called after each part with (bytes_uploaded_so_far, total_bytes).
    pub async fn upload<F>(
        &self,
        file_path: &std::path::Path,
        progress_callback: F,
    ) -> Result<String, S3Error>
    where
        F: Fn(u64, u64) + Send + Sync,
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

        let mut file = tokio::fs::File::open(file_path)
            .await
            .map_err(S3Error::IoError)?;

        let mut part_number: i32 = 1;
        let mut completed_parts = Vec::new();
        let mut bytes_uploaded: u64 = 0;

        loop {
            let mut buffer = vec![0u8; self.part_size];
            let mut bytes_read = 0;

            // Read exactly part_size bytes (or less if EOF)
            loop {
                let n = file
                    .read(&mut buffer[bytes_read..])
                    .await
                    .map_err(S3Error::IoError)?;
                if n == 0 {
                    break;
                }
                bytes_read += n;
                if bytes_read >= self.part_size {
                    break;
                }
            }

            if bytes_read == 0 {
                break;
            }

            buffer.truncate(bytes_read);

            let body = ByteStream::from(buffer);

            let upload_part_output = self
                .client
                .upload_part()
                .bucket(&self.bucket)
                .key(&self.key)
                .upload_id(&upload_id)
                .part_number(part_number)
                .body(body)
                .send()
                .await
                .map_err(|e| {
                    // Best-effort abort on failure
                    let client = self.client.clone();
                    let bucket = self.bucket.clone();
                    let key = self.key.clone();
                    let uid = upload_id.clone();
                    tokio::spawn(async move {
                        let _ = client
                            .abort_multipart_upload()
                            .bucket(&bucket)
                            .key(&key)
                            .upload_id(&uid)
                            .send()
                            .await;
                    });
                    S3Error::MultipartError(e.to_string())
                })?;

            let etag = upload_part_output
                .e_tag()
                .unwrap_or_default()
                .to_string();

            completed_parts.push(
                aws_sdk_s3::types::CompletedPart::builder()
                    .part_number(part_number)
                    .e_tag(etag)
                    .build(),
            );

            bytes_uploaded += bytes_read as u64;
            progress_callback(bytes_uploaded, file_size);

            part_number += 1;
        }

        // Complete multipart upload
        let completed_upload = aws_sdk_s3::types::CompletedMultipartUpload::builder()
            .set_parts(Some(completed_parts))
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
