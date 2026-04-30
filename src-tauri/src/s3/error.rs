use thiserror::Error;

// Several variants are produced by mapping helpers we have not wired up
// yet (e.g. classifying SDK errors into AccessDenied / BucketNotFound /
// RateLimited). Keep them in the public surface so callers can match
// exhaustively as we wire more error paths through.
#[allow(dead_code)]
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

/// Walk the `Error::source` chain of an SDK error and join all messages
/// into one string. `SdkError::to_string()` usually gives just "service
/// error" or "dispatch failure"; the actual cause (TLS failure, DNS,
/// NoSuchKey, AccessDenied, ...) is nested further down.
pub fn sdk_error_detail<E: std::fmt::Display + std::error::Error>(e: &E) -> String {
    let mut detail = e.to_string();
    let mut src: Option<&dyn std::error::Error> = std::error::Error::source(e);
    while let Some(s) = src {
        detail.push_str(" — ");
        detail.push_str(&s.to_string());
        src = s.source();
    }
    detail
}

impl serde::Serialize for S3Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
