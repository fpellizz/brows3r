use thiserror::Error;

#[derive(Error, Debug)]
pub enum S3Error {
    #[error("Authentication failed: {0}")]
    AuthError(String),

    #[error("Access denied: {0}")]
    AccessDenied(String),

    #[error("Bucket not found: {0}")]
    BucketNotFound(String),

    #[error("Object not found: {key} in bucket {bucket}")]
    ObjectNotFound { bucket: String, key: String },

    #[error("Bucket already exists: {0}")]
    BucketAlreadyExists(String),

    #[error("Bucket not empty: {0}")]
    BucketNotEmpty(String),

    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("TLS error: {0}")]
    TlsError(String),

    #[error("DNS resolution failed: {0}")]
    DnsError(String),

    #[error("Request timeout after {0}s")]
    Timeout(u32),

    #[error("Rate limited — retrying after backoff")]
    RateLimited,

    #[error("Multipart upload error: {0}")]
    MultipartError(String),

    #[error("Invalid configuration: {0}")]
    ConfigError(String),

    #[error("SDK error: {0}")]
    SdkError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

impl serde::Serialize for S3Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
