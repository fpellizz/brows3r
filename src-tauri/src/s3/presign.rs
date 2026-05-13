use std::time::Duration;

use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client;

use super::error::S3Error;

/// Presign a GET for a specific version (or current, if `version_id` is
/// None). Used by the versioning UI to let the user download a previous
/// version without adding a whole new download-with-version_id pipeline.
pub async fn presign_get_object_v(
    client: &Client,
    bucket: &str,
    key: &str,
    version_id: Option<&str>,
    expiry_secs: u64,
) -> Result<String, S3Error> {
    let presigning_config = PresigningConfig::expires_in(Duration::from_secs(expiry_secs))
        .map_err(|e| S3Error::ConfigError(e.to_string()))?;

    let mut req = client.get_object().bucket(bucket).key(key);
    if let Some(v) = version_id {
        req = req.version_id(v);
    }
    let presigned = req
        .presigned(presigning_config)
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(presigned.uri().to_string())
}

pub async fn presign_put_object(
    client: &Client,
    bucket: &str,
    key: &str,
    expiry_secs: u64,
) -> Result<String, S3Error> {
    let presigning_config = PresigningConfig::expires_in(Duration::from_secs(expiry_secs))
        .map_err(|e| S3Error::ConfigError(e.to_string()))?;

    let presigned = client
        .put_object()
        .bucket(bucket)
        .key(key)
        .presigned(presigning_config)
        .await
        .map_err(|e| S3Error::SdkError(super::error::sdk_error_detail(&e)))?;

    Ok(presigned.uri().to_string())
}
