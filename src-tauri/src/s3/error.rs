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

    // A TLS hostname mismatch on a bucket-scoped request almost always means
    // we used virtual-hosted addressing (`<bucket>.endpoint`) against an
    // S3-compatible backend whose certificate only covers the base endpoint.
    // The SDK just reports a generic "dispatch failure"/transient error, so
    // append an actionable hint pointing at the Path Style setting.
    if is_tls_hostname_mismatch(&detail) {
        detail.push_str(
            " — hint: the server's TLS certificate does not cover the \
             per-bucket hostname. This backend likely requires path-style \
             addressing; enable \"Path Style\" in the connection settings.",
        );
    }

    detail
}

/// Detect, from a joined error-chain string, the signature of a TLS
/// certificate that is not valid for the hostname we connected to. rustls
/// renders this as `NotValidForName` / `NotValidForNameContext { .. }`; other
/// TLS stacks phrase it as "not valid for name" or "no alternative
/// certificate subject name matches target hostname" (OpenSSL/curl-style).
fn is_tls_hostname_mismatch(detail: &str) -> bool {
    let d = detail.to_ascii_lowercase();
    d.contains("notvalidforname")
        || d.contains("not valid for name")
        || d.contains("no alternative certificate subject name")
        || (d.contains("certificate")
            && (d.contains("does not match") || d.contains("doesn't match"))
            && d.contains("hostname"))
}

impl serde::Serialize for S3Error {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error as StdError;
    use std::fmt;

    /// Minimal error type that lets us build an arbitrary `source` chain,
    /// mirroring how the AWS SDK nests a dispatch failure over a TLS error.
    #[derive(Debug)]
    struct ChainErr {
        msg: String,
        source: Option<Box<ChainErr>>,
    }

    impl fmt::Display for ChainErr {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(&self.msg)
        }
    }

    impl StdError for ChainErr {
        fn source(&self) -> Option<&(dyn StdError + 'static)> {
            self.source
                .as_deref()
                .map(|s| s as &(dyn StdError + 'static))
        }
    }

    fn chain(msgs: &[&str]) -> ChainErr {
        let mut it = msgs.iter().rev();
        let last = it.next().expect("at least one message");
        let mut err = ChainErr {
            msg: (*last).to_string(),
            source: None,
        };
        for m in it {
            err = ChainErr {
                msg: (*m).to_string(),
                source: Some(Box::new(err)),
            };
        }
        err
    }

    #[test]
    fn appends_path_style_hint_on_rustls_name_mismatch() {
        let e = chain(&[
            "dispatch failure",
            "io error",
            "invalid peer certificate: NotValidForNameContext { expected: DnsName(\"magikup.s3storage.panservice.it\"), presented: [\"s3storage.panservice.it\"] }",
        ]);
        let detail = sdk_error_detail(&e);
        assert!(detail.contains("NotValidForNameContext"));
        assert!(
            detail.contains("Path Style"),
            "expected path-style hint, got: {detail}"
        );
    }

    #[test]
    fn appends_hint_on_openssl_style_name_mismatch() {
        let e = chain(&[
            "dispatch failure",
            "no alternative certificate subject name matches target hostname 'temp.s3storage.panservice.it'",
        ]);
        assert!(sdk_error_detail(&e).contains("Path Style"));
    }

    #[test]
    fn no_hint_on_ordinary_errors() {
        let e = chain(&["service error", "AccessDenied"]);
        let detail = sdk_error_detail(&e);
        assert!(!detail.contains("Path Style"), "unexpected hint: {detail}");
        // Chain is still joined as before.
        assert_eq!(detail, "service error — AccessDenied");
    }
}
