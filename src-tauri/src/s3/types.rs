use serde::{Deserialize, Serialize};

/// Internal S3 client configuration, built from a Connection profile.
#[derive(Debug, Clone)]
pub struct S3ClientConfig {
    pub endpoint: String,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub force_path_style: Option<bool>,
    pub proxy: Option<String>,
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
