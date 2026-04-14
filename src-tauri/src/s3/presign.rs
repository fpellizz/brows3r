use std::time::Duration;

use aws_sdk_s3::Client;
use aws_sdk_s3::presigning::PresigningConfig;

use super::error::S3Error;

pub async fn presign_get_object(
    client: &Client,
    bucket: &str,
    key: &str,
    expiry_secs: u64,
) -> Result<String, S3Error> {
    let presigning_config = PresigningConfig::expires_in(Duration::from_secs(expiry_secs))
        .map_err(|e| S3Error::ConfigError(e.to_string()))?;

    let presigned = client
        .get_object()
        .bucket(bucket)
        .key(key)
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
