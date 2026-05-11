use serde::{Deserialize, Serialize};

/// Choose between virtual-hosted (`false`) and path-style (`true`)
/// addressing when the user picked "Auto" in the connection profile.
///
/// The AWS SDK defaults to virtual-hosted, which is correct for AWS S3
/// and most managed providers but breaks on most on-prem servers
/// (MinIO, Ceph, StorageGRID, Dell ECS, generic S3 gateways) because
/// they don't resolve `<bucket>.<host>` either via DNS or via vhost
/// routing. Pick path-style for anything we don't recognize as a
/// known managed-vhost endpoint — safer default.
pub fn infer_force_path_style(endpoint: &str) -> bool {
    // Lowercase first so the scheme strip works on uppercase URLs too.
    let lc = endpoint.trim().to_ascii_lowercase();
    let host = lc
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");

    let known_vhost_suffix = [
        ".amazonaws.com",
        ".backblazeb2.com",
        ".wasabisys.com",
        ".digitaloceanspaces.com",
        ".scw.cloud",
        ".io.cloud.ovh.net",
        ".linodeobjects.com",
    ];
    let is_vhost = known_vhost_suffix
        .iter()
        .any(|suffix| host.ends_with(suffix));
    !is_vhost
}

/// Internal S3 client configuration, built from a Connection profile.
#[derive(Debug, Clone)]
pub struct S3ClientConfig {
    pub endpoint: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub force_path_style: Option<bool>,
    /// HTTP(S) proxy URL for outbound S3 traffic, applied in
    /// `create_s3_client` via `aws_smithy_http_client`. Optional —
    /// when `None`/empty the SDK uses its default direct connector.
    pub proxy: Option<String>,
    /// Path to a PEM file containing extra CA certificates to trust
    /// in addition to the system roots. Used by `create_s3_client`
    /// to build a custom rustls trust store — empty/`None` means
    /// "use only the system roots".
    pub ca_bundle: Option<String>,
    pub timeout_secs: u64,
    pub max_retries: u32,
}

/// Lightweight bucket entry from ListBuckets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Bucket {
    pub name: String,
    pub creation_date: Option<String>,
}

/// Lightweight object entry from ListObjectsV2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Object {
    pub key: String,
    pub size: i64,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
}

/// Result of ListObjectsV2 with pagination info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3ListResult {
    pub objects: Vec<S3Object>,
    pub common_prefixes: Vec<String>,
    pub continuation_token: Option<String>,
    pub is_truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::infer_force_path_style;

    #[test]
    fn vhost_endpoints_get_vhost_style() {
        for ep in [
            "https://s3.eu-west-1.amazonaws.com",
            "https://s3.amazonaws.com",
            "https://s3.us-west-004.backblazeb2.com",
            "https://s3.eu-central-1.wasabisys.com",
            "https://ams3.digitaloceanspaces.com",
            "https://s3.fr-par.scw.cloud",
            "https://s3.gra.io.cloud.ovh.net",
            "https://eu-central-1.linodeobjects.com",
            "HTTPS://S3.AMAZONAWS.COM/",
        ] {
            assert!(!infer_force_path_style(ep), "expected vhost for {ep}");
        }
    }

    #[test]
    fn on_prem_and_unknown_endpoints_get_path_style() {
        for ep in [
            "http://localhost:9000",
            "https://minio.example.com",
            "https://s3storage.panservice.it:8000",
            "https://<account>.r2.cloudflarestorage.com",
            "https://storage.googleapis.com",
            "https://something.compat.objectstorage.eu-milan-1.oraclecloud.com",
            "",
            "not-even-a-url",
        ] {
            assert!(infer_force_path_style(ep), "expected path-style for {ep}");
        }
    }
}
